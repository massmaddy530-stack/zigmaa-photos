// Same-origin proxy for admin API calls. The browser's signed session cookie is verified here, then the admin API
// key from the server environment is attached, so the key never reaches the browser in any form.
import { NextRequest, NextResponse } from "next/server";
import { hasCsrfHeader } from "@/lib/auth/request";
import { verifySessionToken } from "@/lib/auth/session";
import {
  API_BASE_URL,
  authConfig,
  LEGACY_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
} from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROOTS = new Set(["events", "dashboard"]);
const FORWARD_RESPONSE_HEADERS = ["content-type", "retry-after", "cache-control"];

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, details: null } }, { status });
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (!path?.length || !ALLOWED_ROOTS.has(path[0]) || path.some((p) => p === ".." || p === "." || p === "")) {
    return errorJson(404, "not_found", "Not found");
  }
  const config = authConfig();
  if (!config) {
    return errorJson(503, "auth_not_configured", "Sign-in is not configured on the server. Contact the administrator.");
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token, config, SESSION_MAX_AGE_S))) {
    const res = errorJson(401, "unauthorized", "Please sign in.");
    if (token) res.cookies.delete(SESSION_COOKIE);
    if (req.cookies.has(LEGACY_SESSION_COOKIE)) res.cookies.delete(LEGACY_SESSION_COOKIE);
    return res;
  }

  // CSRF defence in depth (cookie is also SameSite=Strict): cross-site forms cannot set custom headers.
  if (req.method !== "GET" && req.method !== "HEAD" && !hasCsrfHeader(req)) {
    return errorJson(403, "csrf", "Missing request header");
  }

  const target = `${API_BASE_URL}/api/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers({ Authorization: `Bearer ${config.adminApiKey}`, Accept: "application/json" });
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) headers.set("x-forwarded-for", fwd);

  const hasBody = !["GET", "HEAD"].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      cache: "no-store",
      redirect: "manual",
      // Required by Node's fetch when streaming a request body (uploads are streamed, not buffered).
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    // If local connection refused, try alternative localhost port (e.g. 8001 <-> 8000)
    if (process.env.NODE_ENV !== "test" && (API_BASE_URL.includes("localhost") || API_BASE_URL.includes("127.0.0.1"))) {
      const altUrl = API_BASE_URL.includes(":8001")
        ? API_BASE_URL.replace(":8001", ":8000")
        : API_BASE_URL.replace(":8000", ":8001");
      const altTarget = `${altUrl}/api/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
      try {
        upstream = await fetch(altTarget, {
          method: req.method,
          headers,
          body: hasBody ? req.body : undefined,
          cache: "no-store",
          redirect: "manual",
          ...(hasBody ? { duplex: "half" } : {}),
        } as RequestInit);
      } catch {
        return errorJson(502, "backend_unreachable", "The API server is not reachable.");
      }
    } else {
      return errorJson(502, "backend_unreachable", "The API server is not reachable.");
    }
  }

  // The backend only answers 401/403 when it rejects the API key itself: a server misconfiguration, not an
  // expired session, so the user is not signed out.
  if (upstream.status === 401 || upstream.status === 403) {
    await upstream.body?.cancel().catch(() => undefined);
    console.error(`Admin proxy: backend rejected ADMIN_API_KEY (HTTP ${upstream.status}); frontend and backend values must match`);
    return errorJson(502, "backend_auth_misconfigured", "The server is misconfigured. Contact the administrator.");
  }

  const resHeaders = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) resHeaders.set(h, v);
  }
  return new NextResponse(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
