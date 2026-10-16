// Sign-in / sign-out for the admin dashboard. The key is verified against the backend, then stored in an
// httpOnly, SameSite=Strict cookie that only the server-side proxy reads.
import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL, COOKIE_SECURE, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message, details: null } }, { status });
}

export async function POST(req: NextRequest) {
  if (req.headers.get("x-requested-with") !== "evp") return errorJson(403, "csrf", "Missing request header");
  let apiKey = "";
  try {
    const body = (await req.json()) as { apiKey?: unknown };
    apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  } catch {
    return errorJson(400, "bad_request", "Invalid request body");
  }
  if (!apiKey || apiKey.length > 512) return errorJson(422, "validation_error", "Enter your admin API key.");

  let check: Response;
  try {
    check = await fetch(`${API_BASE_URL}/api/v1/dashboard/overview`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return errorJson(502, "backend_unreachable", "The API server is not reachable. Is the backend running?");
  }
  if (check.status === 401) return errorJson(401, "invalid_key", "That API key was not accepted.");
  if (check.status === 403) return errorJson(403, "forbidden", "This key cannot access the dashboard (admin key required).");
  if (check.status === 503) {
    const body = await check.json().catch(() => null);
    return errorJson(503, body?.error?.code ?? "unavailable", body?.error?.message ?? "Backend unavailable.");
  }
  if (!check.ok) return errorJson(502, "backend_error", `Backend returned ${check.status}.`);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, apiKey, {
    httpOnly: true,
    sameSite: "strict",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  if (req.headers.get("x-requested-with") !== "evp") return errorJson(403, "csrf", "Missing request header");
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
