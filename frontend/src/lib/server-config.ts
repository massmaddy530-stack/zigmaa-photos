// Server-only configuration: import ONLY from route handlers and middleware, never from client components.
import "server-only";

export const API_BASE_URL = (
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:8000"
).replace(/\/$/, "");

export const SESSION_COOKIE = "evp_session";
// Older builds stored the raw admin API key in this cookie; it is deleted wherever it is seen.
export const LEGACY_SESSION_COOKIE = "evp_admin";
export const SESSION_MAX_AGE_S = 60 * 60 * 12;

export function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";
}

export interface AuthConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
  adminApiKey: string;
}

const PASSWORD_HASH_FORMAT = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/;
let lastReported = "";

/**
 * Admin sign-in settings, read from the environment on every call. Returns null when anything is missing or
 * invalid so callers fail closed. Problems are logged by variable name only, never by value.
 */
export function authConfig(): AuthConfig | null {
  const username = process.env.ADMIN_USERNAME?.trim() ?? "";
  const passwordHash = process.env.ADMIN_PASSWORD_HASH?.trim() ?? "";
  const sessionSecret = process.env.SESSION_SECRET ?? "";
  const adminApiKey = process.env.ADMIN_API_KEY?.trim() ?? "";

  const problems = [
    !username && "ADMIN_USERNAME is not set",
    !PASSWORD_HASH_FORMAT.test(passwordHash) &&
      "ADMIN_PASSWORD_HASH is missing or not a hash from scripts/hash-password.mjs",
    sessionSecret.length < 32 && "SESSION_SECRET must be at least 32 characters",
    adminApiKey.length < 24 && "ADMIN_API_KEY must be set (24+ characters, same value as the backend)",
    sessionSecret && sessionSecret === adminApiKey && "SESSION_SECRET must differ from ADMIN_API_KEY",
  ].filter((p): p is string => Boolean(p));

  if (problems.length) {
    const message = problems.join("; ");
    if (message !== lastReported) {
      console.error(`Admin sign-in is disabled: ${message}`);
      lastReported = message;
    }
    return null;
  }
  lastReported = "";
  return { username, passwordHash, sessionSecret, adminApiKey };
}

export interface GoogleSignInConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedEmails: ReadonlySet<string>;
}

let lastGoogleReported = "";

/**
 * Optional Google Sign-In settings, read on every call. Returns null (Google sign-in hidden and refused) unless all
 * are present and valid. The redirect URI must be configured explicitly: it is never derived from the request Host.
 * Plain http is accepted only for localhost. Problems are logged by variable name only, never by value.
 */
export function googleConfig(reqHost?: string | null): GoogleSignInConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  let redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() ?? "";

  const isReqLocal = !reqHost || reqHost.includes("localhost") || reqHost.includes("127.0.0.1");

  // Auto-detect production redirect URI on Vercel or local host if not explicitly configured or if localhost URI used on remote host
  if (!redirectUri || (!isReqLocal && redirectUri.includes("localhost"))) {
    if (reqHost && !isReqLocal) {
      redirectUri = `https://${reqHost}/api/auth/google/callback`;
    } else if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
      redirectUri = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/auth/google/callback`;
    } else if (process.env.VERCEL_URL) {
      redirectUri = `https://${process.env.VERCEL_URL}/api/auth/google/callback`;
    } else if (process.env.NODE_ENV === "production" || !isReqLocal) {
      redirectUri = "https://zigmaa-photos.vercel.app/api/auth/google/callback";
    } else {
      redirectUri = "http://localhost:3001/api/auth/google/callback";
    }
  }

  const emailsStr = process.env.ADMIN_GOOGLE_EMAILS?.trim() ?? "";
  const allowedEmails = new Set(
    emailsStr
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e)),
  );
  if (!clientId && !clientSecret && !redirectUri && !allowedEmails.size) return null; // not set up: stay silent

  let redirectOk = false;
  try {
    const u = new URL(redirectUri);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    redirectOk = (u.protocol === "https:" || (u.protocol === "http:" && local)) && u.pathname === "/api/auth/google/callback"
      && !u.search && !u.hash;
  } catch {
    redirectOk = false;
  }
  const problems = [
    !clientId && "GOOGLE_CLIENT_ID is not set",
    !clientSecret && "GOOGLE_CLIENT_SECRET is not set",
    !redirectOk && "GOOGLE_REDIRECT_URI must be https://<host>/api/auth/google/callback (http only for localhost)",
    !allowedEmails.size && "ADMIN_GOOGLE_EMAILS must list at least one email address",
  ].filter((p): p is string => Boolean(p));
  if (problems.length) {
    const message = problems.join("; ");
    if (message !== lastGoogleReported) {
      console.error(`Google sign-in is disabled: ${message}`);
      lastGoogleReported = message;
    }
    return null;
  }
  lastGoogleReported = "";
  return { clientId, clientSecret, redirectUri, allowedEmails };
}
