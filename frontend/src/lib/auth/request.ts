// Request checks shared by the session and admin proxy routes.
import type { NextRequest } from "next/server";
import { cookieSecure } from "@/lib/server-config";

/** Cross-site forms cannot send custom headers, so requiring one blocks classic CSRF. */
export function hasCsrfHeader(req: NextRequest): boolean {
  return req.headers.get("x-requested-with") === "evp";
}

/** True when the browser reports that the request comes from a page on this site's own host. */
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (cookieSecure() && url.protocol !== "https:") return false;
  const hosts = [req.headers.get("x-forwarded-host")?.split(",")[0]?.trim(), req.headers.get("host")?.trim()];
  return hosts.some((h) => Boolean(h) && h === url.host);
}

/** Best-effort client address for throttling. Spoofable behind some proxies; the global limit still applies. */
export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
