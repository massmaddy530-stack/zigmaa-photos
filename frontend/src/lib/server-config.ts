// Server-only configuration: import ONLY from route handlers and middleware, never from client components.
export const API_BASE_URL = (
  process.env.API_BASE_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:8000"
).replace(/\/$/, "");

export const SESSION_COOKIE = "evp_admin";
export const SESSION_MAX_AGE_S = 60 * 60 * 12;
export const COOKIE_SECURE = process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";
