import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/server-config";

// Only guards dashboard pages. API routes are excluded on purpose: middleware would buffer request bodies
// (photo uploads), and the proxy performs its own auth check.
export function middleware(req: NextRequest) {
  if (!req.cookies.get(SESSION_COOKIE)?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*"] };
