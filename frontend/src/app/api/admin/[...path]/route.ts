// Same-origin proxy for admin API calls. The admin key lives in an httpOnly cookie and is attached here,
// server-side, so it is never readable by browser JavaScript.
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL, SESSION_COOKIE } from "@/lib/server-config";

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
  const key = req.cookies.get(SESSION_COOKIE)?.value;
  if (!key) return errorJson(401, "unauthorized", "Please sign in.");

  // CSRF defence in depth (cookie is also SameSite=Strict): cross-site forms cannot set custom headers.
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers.get("x-requested-with") !== "evp") {
    return errorJson(403, "csrf", "Missing request header");
  }

  const target = `${API_BASE_URL}/api/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers({ Authorization: `Bearer ${key}`, Accept: "application/json" });
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
    return errorJson(502, "backend_unreachable", "The API server is not reachable.");
  }

  const resHeaders = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) resHeaders.set(h, v);
  }
  const res = new NextResponse(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
  if (upstream.status === 401) res.cookies.delete(SESSION_COOKIE); // key rotated/revoked: force re-login
  return res;
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
