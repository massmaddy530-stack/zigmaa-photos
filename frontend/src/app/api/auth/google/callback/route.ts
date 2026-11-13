// Google Sign-In callback: validates state (constant time) against the signed transaction cookie, exchanges the code
// with the PKCE verifier, verifies the ID token (signature, issuer, audience, expiry, nonce, verified email,
// allow-list), then issues the SAME session cookie as the password login.
//
// Why a completion page instead of a redirect: the session cookie is SameSite=Strict, and browsers do not send
// Strict cookies on a navigation chain that started on accounts.google.com, so a 302 to /dashboard would arrive
// without the new cookie and bounce back to /login. The cookie is set on this response (allowed for a top-level
// navigation); the page then navigates same-origin (meta refresh, plus a link as fallback), which carries it.
// The session cookie itself is unchanged.
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCode, GoogleAuthError, googleSigningKey, OAUTH_TX_COOKIE, OAUTH_TX_PATH, openTransaction, safeEqual, safeNextPath,
  verifyIdToken,
} from "@/lib/auth/google";
import { loginLimiter } from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/auth/request";
import { createSessionToken } from "@/lib/auth/session";
import { authConfig, cookieSecure, googleConfig, LEGACY_SESSION_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

function clearTx(res: NextResponse) {
  res.cookies.set(OAUTH_TX_COOKIE, "", { httpOnly: true, sameSite: "lax", path: OAUTH_TX_PATH, maxAge: 0 });
  return res;
}

/** Back to the sign-in page with a generic message (never says which check failed). */
function fail(reason: string, code = "google"): NextResponse {
  console.error(`Google sign-in rejected: ${reason}`); // reason code only: no codes, tokens or email addresses
  return clearTx(new NextResponse(null, { status: 303, headers: { Location: `/login?error=${code}`, ...NO_STORE } }));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function GET(req: NextRequest) {
  const google = googleConfig();
  const auth = authConfig();
  if (!google || !auth) return fail("not_configured", "google_unavailable");

  const client = clientIp(req);
  if (!loginLimiter.check(client).allowed) return fail("rate_limited");

  const q = req.nextUrl.searchParams;
  if (q.get("error")) return fail("provider_error"); // e.g. the user cancelled at Google
  const code = q.get("code") ?? "";
  const state = q.get("state") ?? "";
  if (!code || code.length > 2048 || !state || state.length > 256) return fail("malformed_callback");

  const tx = openTransaction(req.cookies.get(OAUTH_TX_COOKIE)?.value, auth.sessionSecret);
  if (!tx) return fail("missing_or_expired_transaction");
  if (!safeEqual(state, tx.state)) {
    loginLimiter.recordFailure(client);
    return fail("state_mismatch");
  }

  try {
    const idToken = await exchangeCode(google, code, tx.verifier);
    await verifyIdToken(idToken, {
      clientId: google.clientId, nonce: tx.nonce, allowedEmails: google.allowedEmails, getKey: (kid) => googleSigningKey(kid),
    });
  } catch (err) {
    loginLimiter.recordFailure(client);
    return fail(err instanceof GoogleAuthError ? err.reason : "verification_error");
  }
  loginLimiter.reset(client);

  const next = escapeHtml(safeNextPath(tx.next));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">`
    + `<meta http-equiv="refresh" content="0;url=${next}"><title>Signing in · Zigmaa Photos</title></head>`
    + `<body style="font-family:system-ui,sans-serif;background:#ffffff;color:#0f172a;padding:2rem">`
    + `<p>Signed in. <a href="${next}" style="color:#e50914">Continue to Zigmaa Photos</a></p></body></html>`;
  const res = new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
  res.cookies.delete(LEGACY_SESSION_COOKIE);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(auth, SESSION_MAX_AGE_S), {
    httpOnly: true,
    sameSite: "strict",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return clearTx(res);
}
