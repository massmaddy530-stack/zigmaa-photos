// Sign-in / sign-out for the admin dashboard. The username and password are checked here, on the server, against
// a scrypt hash from the environment. The browser receives a signed, expiring, httpOnly session cookie that
// contains neither the password nor the backend API key.
import { NextRequest, NextResponse } from "next/server";
import { checkCredentials, MAX_PASSWORD_LENGTH, PasswordHashFormatError } from "@/lib/auth/password";
import { loginLimiter } from "@/lib/auth/rate-limit";
import { clientIp, hasCsrfHeader, isSameOrigin } from "@/lib/auth/request";
import { createSessionToken } from "@/lib/auth/session";
import {
  authConfig,
  cookieSecure,
  LEGACY_SESSION_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE_S,
} from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_USERNAME_LENGTH = 128;
const MAX_BODY_BYTES = 8 * 1024;

function errorJson(status: number, code: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message, details: null } }, { status, headers });
}

const notConfigured = () =>
  errorJson(503, "auth_not_configured", "Sign-in is not configured on the server. Contact the administrator.");

export async function POST(req: NextRequest) {
  if (!hasCsrfHeader(req) || !isSameOrigin(req)) return errorJson(403, "csrf", "Cross-site request blocked.");
  const config = authConfig();
  if (!config) return notConfigured();

  const client = clientIp(req);
  const limit = loginLimiter.check(client);
  if (!limit.allowed) {
    return errorJson(429, "too_many_attempts", "Too many sign-in attempts. Please try again later.", {
      "Retry-After": String(limit.retryAfterS),
    });
  }

  let username = "";
  let password = "";
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return errorJson(413, "payload_too_large", "Request body is too large.");
    const body = JSON.parse(text) as { username?: unknown; password?: unknown };
    username = typeof body?.username === "string" ? body.username.trim() : "";
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return errorJson(400, "bad_request", "Invalid request body");
  }
  if (!username || !password || username.length > MAX_USERNAME_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return errorJson(422, "validation_error", "Enter your username and password.");
  }

  let valid: boolean;
  try {
    valid = await checkCredentials(username, password, config);
  } catch (err) {
    if (err instanceof PasswordHashFormatError) {
      console.error("Admin sign-in is disabled: ADMIN_PASSWORD_HASH has an invalid format or parameters");
      return notConfigured();
    }
    throw err;
  }
  if (!valid) {
    loginLimiter.recordFailure(client);
    return errorJson(401, "invalid_credentials", "Invalid username or password.");
  }
  loginLimiter.reset(client);

  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.delete(LEGACY_SESSION_COOKIE);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(config, SESSION_MAX_AGE_S), {
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });

  const profile = {
    name: "Studio Admin",
    email: "massmaddy530@gmail.com",
    picture: "",
    provider: "password",
  };
  res.cookies.set("evp_profile", encodeURIComponent(JSON.stringify(profile)), {
    httpOnly: false,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });

  return res;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const config = authConfig();
  if (!token || !config) {
    return NextResponse.json({ authenticated: false, user: null }, { headers: { "Cache-Control": "no-store" } });
  }

  let profile = {
    name: "Studio Admin",
    email: "massmaddy530@gmail.com",
    picture: "",
    provider: "password",
  };

  const rawProfile = req.cookies.get("evp_profile")?.value;
  if (rawProfile) {
    try {
      profile = JSON.parse(decodeURIComponent(rawProfile));
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ authenticated: true, user: profile }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(req: NextRequest) {
  if (!hasCsrfHeader(req) || !isSameOrigin(req)) return errorJson(403, "csrf", "Cross-site request blocked.");
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(LEGACY_SESSION_COOKIE);
  res.cookies.delete("evp_profile");
  return res;
}
