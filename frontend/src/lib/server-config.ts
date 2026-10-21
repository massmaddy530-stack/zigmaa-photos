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
