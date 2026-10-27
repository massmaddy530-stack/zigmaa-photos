// Backend health for the dashboard, for signed-in admins only. The backend's /health is not exposed through this
// origin: it runs a database query on every call and reports version and infrastructure details.
import { NextRequest, NextResponse } from "next/server";
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

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, details: null } }, { status });
}

export async function GET(req: NextRequest) {
  // Same session check as the admin proxy (app/api/admin/[...path]/route.ts).
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

  // The backend's /health needs no API key, so none is sent.
  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/health`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    return errorJson(502, "backend_unreachable", "The API server is not reachable.");
  }
  // 200 when healthy, 503 with the same body when degraded: both carry the checks the dashboard shows.
  if (upstream.status !== 200 && upstream.status !== 503) {
    await upstream.body?.cancel().catch(() => undefined);
    return errorJson(502, "backend_unreachable", "The API server returned an unexpected response.");
  }
  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return errorJson(502, "backend_unreachable", "The API server returned an unexpected response.");
  }
  return NextResponse.json(body, { status: upstream.status, headers: { "cache-control": "no-store" } });
}
