// Starts Google Sign-In: stores state, nonce and the PKCE verifier in a short-lived signed cookie, then redirects to
// Google. The redirect URI sent to Google is the configured GOOGLE_REDIRECT_URI, never derived from this request.
import { NextRequest, NextResponse } from "next/server";
import { authorizationUrl, newTransaction, OAUTH_TX_COOKIE, OAUTH_TX_MAX_AGE_S, OAUTH_TX_PATH, sealTransaction } from "@/lib/auth/google";
import { authConfig, cookieSecure, googleConfig } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const google = googleConfig();
  const auth = authConfig();
  if (!google || !auth) {
    // Same-origin relative redirect: the login page shows a generic "Google sign-in unavailable" message.
    return new NextResponse(null, { status: 303, headers: { Location: "/login?error=google_unavailable", "Cache-Control": "no-store" } });
  }

  // The transaction cookie must be set on the same host Google will redirect back to. If the user opened the app on
  // another address (e.g. the LAN IP), restart on the configured host. The target comes from configuration only;
  // the request Host is merely compared, never used to build a URL.
  const configured = new URL(google.redirectUri);
  if (req.headers.get("host") !== configured.host) {
    const restart = new URL("/api/auth/google/start", configured.origin);
    restart.searchParams.set("next", req.nextUrl.searchParams.get("next") ?? "/dashboard");
    return new NextResponse(null, { status: 303, headers: { Location: restart.toString(), "Cache-Control": "no-store" } });
  }

  const { tx, challenge } = newTransaction(req.nextUrl.searchParams.get("next") ?? "/dashboard");
  const res = new NextResponse(null, {
    status: 303,
    headers: { Location: authorizationUrl(google, tx, challenge), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
  // Lax (not Strict): it must be sent on the top-level redirect back from Google. Scoped to /api/auth/google only.
  res.cookies.set(OAUTH_TX_COOKIE, sealTransaction(tx, auth.sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure() || new URL(google.redirectUri).protocol === "https:",
    path: OAUTH_TX_PATH,
    maxAge: OAUTH_TX_MAX_AGE_S,
  });
  return res;
}
