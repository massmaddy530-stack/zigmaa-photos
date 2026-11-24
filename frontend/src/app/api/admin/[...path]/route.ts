// Same-origin proxy for admin API calls. The browser's signed session cookie is verified here, then the admin API
// key from the server environment is attached, so the key never reaches the browser in any form.
import { NextRequest, NextResponse } from "next/server";
import { hasCsrfHeader } from "@/lib/auth/request";
import { verifyMiddlewareSession, verifySessionToken } from "@/lib/auth/session";
import { getUserEventIds, getUserPhotoTimeline, recordUserEvent, removeUserEvent } from "@/lib/auth/user-events";
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
  const sessionValid = Boolean(
    token && (
      (await verifySessionToken(token, config, SESSION_MAX_AGE_S)) !== null ||
      (await verifyMiddlewareSession(token, config.sessionSecret, SESSION_MAX_AGE_S))
    )
  );
  if (!token || !sessionValid) {
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

  // Identify current user email to ensure multi-tenant event isolation
  let userEmail = "";
  const headerEmail = req.headers.get("x-user-email");
  if (headerEmail && headerEmail.includes("@")) {
    userEmail = headerEmail.trim().toLowerCase();
  }
  if (!userEmail) {
    const profileRaw = req.cookies.get("evp_profile")?.value;
    if (profileRaw) {
      try {
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(profileRaw);
        } catch {
          parsed = JSON.parse(decodeURIComponent(profileRaw));
        }
        if (parsed && typeof parsed.email === "string" && parsed.email.includes("@")) {
          userEmail = parsed.email.trim().toLowerCase();
        }
      } catch {}
    }
  }
  if (!userEmail && token) {
    try {
      const p = await verifySessionToken(token, config, SESSION_MAX_AGE_S);
      if (p?.sub && p.sub.includes("@")) {
        userEmail = p.sub.trim().toLowerCase();
      }
    } catch {}
  }
  if (userEmail) {
    headers.set("x-user-email", userEmail);
  }

  const contentLength = req.headers.get("content-length");
  const isChunked = req.headers.get("transfer-encoding") === "chunked";
  const hasBody = !["GET", "HEAD"].includes(req.method) && Boolean(
    (contentLength && contentLength !== "0") || isChunked || (contentType && !contentType.includes("json"))
  );
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
      // Production on Vercel: retry once after 1s in case Render is spinning up
      try {
        await new Promise((r) => setTimeout(r, 1000));
        upstream = await fetch(target, {
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
    }
  }

  // Gracefully handle upstream 502/503/504 on Render wakeups for GET requests
  if ([502, 503, 504].includes(upstream.status) && (req.method === "GET" || req.method === "HEAD")) {
    try {
      await new Promise((r) => setTimeout(r, 1200));
      const retryUpstream = await fetch(target, {
        method: req.method,
        headers,
        cache: "no-store",
        redirect: "manual",
      });
      if (retryUpstream.ok || retryUpstream.status < 500) {
        upstream = retryUpstream;
      }
    } catch {}
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

  // Intercept and isolate events per user account
  const isEventsRoot = path[0] === "events" && path.length === 1;
  const isDashboardOverview = path[0] === "dashboard" && path[1] === "overview";

  if (req.method === "DELETE" && path[0] === "events" && path.length === 2 && upstream.ok) {
    if (userEmail && path[1]) {
      await removeUserEvent(userEmail, path[1]);
    }
  }

  if (req.method === "POST" && isEventsRoot && upstream.status === 201) {
    try {
      const data = await upstream.json();
      if (userEmail && data?.id) {
        await recordUserEvent(userEmail, String(data.id));
      }
      return NextResponse.json(data, { status: 201, headers: resHeaders });
    } catch {
      // Fallback to normal response
    }
  }

  if (req.method === "GET" && isEventsRoot && upstream.ok) {
    try {
      const data = await upstream.json();
      if (userEmail && Array.isArray(data?.items)) {
        const userEventIds = await getUserEventIds(userEmail);
        data.items = data.items.filter((item: Record<string, unknown>) => {
          const id = String(item?.id || "");
          const owner = typeof item?.owner_email === "string" ? item.owner_email.toLowerCase() : "";
          return userEventIds.has(id) || (owner && owner === userEmail);
        });
        data.total = data.items.length;
      }
      return NextResponse.json(data, { status: 200, headers: resHeaders });
    } catch {
      // Fallback
    }
  }

  if (req.method === "GET" && isDashboardOverview && upstream.ok) {
    try {
      const data = await upstream.json();
      if (userEmail) {
        const userEventIds = await getUserEventIds(userEmail);
        if (userEventIds.size === 0) {
          data.events = 0;
          data.active_events = 0;
          data.photos = 0;
          data.indexed_photos = 0;
          data.indexed_faces = 0;
          data.processing = 0;
          data.failures = 0;
          data.recent_events = [];
          data.photo_timeline = [];
        } else {
          if (Array.isArray(data.recent_events)) {
            data.recent_events = data.recent_events.filter((item: Record<string, unknown>) => {
              const id = String(item?.id || "");
              const owner = typeof item?.owner_email === "string" ? item.owner_email.toLowerCase() : "";
              return userEventIds.has(id) || (owner && owner === userEmail);
            });
          }
          data.events = userEventIds.size;
          const userEvents: Array<Record<string, unknown>> = Array.isArray(data.recent_events) ? data.recent_events : [];
          data.active_events = userEvents.filter((e) => e.status === "active").length;
          data.photos = userEvents.reduce((sum, e) => {
            const c = e.counts as Record<string, unknown> | undefined;
            return sum + (Number(c?.total) || 0);
          }, 0);
          data.indexed_photos = userEvents.reduce((sum, e) => {
            const c = e.counts as Record<string, unknown> | undefined;
            return sum + (Number(c?.indexed) || 0);
          }, 0);
          data.indexed_faces = userEvents.reduce((sum, e) => {
            const c = e.counts as Record<string, unknown> | undefined;
            return sum + (Number(c?.faces) || 0);
          }, 0);
          data.processing = userEvents.reduce((sum, e) => {
            const c = e.counts as Record<string, unknown> | undefined;
            return sum + (Number(c?.processing) || 0) + (Number(c?.pending) || 0);
          }, 0);
          data.failures = userEvents.reduce((sum, e) => {
            const c = e.counts as Record<string, unknown> | undefined;
            return sum + (Number(c?.failed) || 0);
          }, 0);

          data.photo_timeline = await getUserPhotoTimeline(userEmail, userEventIds);
        }
      }
      return NextResponse.json(data, { status: 200, headers: resHeaders });
    } catch {
      // Fallback
    }
  }

  return new NextResponse(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: resHeaders,
  });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
