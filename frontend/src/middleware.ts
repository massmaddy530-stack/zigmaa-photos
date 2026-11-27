import { NextRequest, NextResponse } from "next/server";
import { verifyMiddlewareSession } from "@/lib/auth/session";

const SESSION_COOKIE = "evp_session";
const LEGACY_SESSION_COOKIE = "evp_admin";
const SESSION_MAX_AGE_S = 60 * 60 * 12;

// Only guards dashboard pages. API routes are excluded on purpose: middleware would buffer request bodies
// (photo uploads), and the proxy performs its own session check.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const rawSecret = process.env.SESSION_SECRET?.trim() || "";
  const secret = rawSecret.replace(/^["']|["']$/g, "");
  const valid = Boolean(secret && token && (await verifyMiddlewareSession(token, secret, SESSION_MAX_AGE_S)));

  let res: NextResponse;
  if (valid) {
    res = NextResponse.next();
  } else {
    const url = req.nextUrl.clone();
    const fwdHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host")?.trim();
    const fwdProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (fwdHost && !fwdHost.startsWith("127.0.0.1") && !fwdHost.startsWith("localhost")) {
      url.host = fwdHost;
      url.port = "";
      if (fwdProto === "https" || fwdProto === "http") url.protocol = `${fwdProto}:`;
    }
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
