import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { authConfig, LEGACY_SESSION_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/server-config";

// Only guards dashboard pages. API routes are excluded on purpose: middleware would buffer request bodies
// (photo uploads), and the proxy performs its own session check.
export async function middleware(req: NextRequest) {
  const config = authConfig();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = Boolean(config && token && (await verifySessionToken(token, config, SESSION_MAX_AGE_S)));

  let res: NextResponse;
  if (valid) {
    res = NextResponse.next();
  } else {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    res = NextResponse.redirect(url);
    if (token) res.cookies.delete(SESSION_COOKIE);
  }
  if (req.cookies.has(LEGACY_SESSION_COOKIE)) res.cookies.delete(LEGACY_SESSION_COOKIE);
  return res;
}

// Node.js runtime: secrets are read from the server environment at request time.
export const config = { matcher: ["/dashboard/:path*"], runtime: "nodejs" };
