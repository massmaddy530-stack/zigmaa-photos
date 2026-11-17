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
import { findUserAsync, findUserByEmail, saveUserAsync, updateUserProfileAsync } from "@/lib/auth/user-store";
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
  const google = googleConfig(req.headers.get("host"));
  const auth = authConfig();
  if (!google || !auth) return fail("not_configured", "google_unavailable");

  const client = clientIp(req);

  const q = req.nextUrl.searchParams;
  if (q.get("error")) return fail("provider_error"); // e.g. the user cancelled at Google
  const code = q.get("code") ?? "";
  const state = q.get("state") ?? "";
  if (!code || code.length > 2048 || !state || state.length > 256) return fail("malformed_callback");

  const tx = openTransaction(req.cookies.get(OAUTH_TX_COOKIE)?.value, auth.sessionSecret);
  if (!tx) return fail("missing_or_expired_transaction");
  if (!safeEqual(state, tx.state)) {
    return fail("state_mismatch");
  }

  let verifiedUser;
  try {
    const idToken = await exchangeCode(google, code, tx.verifier);
    verifiedUser = await verifyIdToken(idToken, {
      clientId: google.clientId, nonce: tx.nonce, allowedEmails: google.allowedEmails, getKey: (kid) => googleSigningKey(kid),
    });
  } catch (err) {
    return fail(err instanceof GoogleAuthError ? err.reason : "verification_error");
  }
  loginLimiter.reset(client);

  const existingUser = (await findUserAsync(verifiedUser.email)) || findUserByEmail(verifiedUser.email);
  if (!existingUser) {
    await saveUserAsync({
      id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      email: verifiedUser.email,
      passwordHash: "",
      name: verifiedUser.name || verifiedUser.email.split("@")[0],
      picture: verifiedUser.picture || "",
      role: "admin",
      createdAt: Date.now(),
    });
  } else if (verifiedUser.name || verifiedUser.picture) {
    await updateUserProfileAsync(verifiedUser.email, {
      name: verifiedUser.name || existingUser.name,
      picture: verifiedUser.picture || existingUser.picture,
    });
  }

  const next = escapeHtml(safeNextPath(tx.next));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">`
    + `<meta http-equiv="refresh" content="0;url=${next}">`
    + `<title>Signing in · Zigmaa Photos</title>`
    + `<style>`
    + `* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }`
    + `body { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #0f172a; color: #f8fafc; text-align: center; padding: 1.5rem; }`
    + `.card { max-width: 400px; width: 100%; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 1.25rem; padding: 2.5rem 2rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); backdrop-filter: blur(12px); }`
    + `.spinner { width: 44px; height: 44px; border: 3px solid rgba(229,9,20,0.2); border-top-color: #e50914; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 1.5rem; }`
    + `@keyframes spin { to { transform: rotate(360deg); } }`
    + `h1 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; }`
    + `p { font-size: 0.875rem; color: #94a3b8; margin-bottom: 1.5rem; }`
    + `a { display: inline-block; background: #e50914; color: #ffffff; text-decoration: none; font-size: 0.875rem; font-weight: 600; padding: 0.625rem 1.25rem; border-radius: 0.5rem; transition: background 0.15s; }`
    + `a:hover { background: #b80710; }`
    + `</style>`
    + `</head><body>`
    + `<div class="card">`
    + `<div class="spinner"></div>`
    + `<h1>Signing you in...</h1>`
    + `<p>Signed in. Taking you to your dashboard.</p>`
    + `<a href="${next}">Continue to Zigmaa Photos</a>`
    + `</div>`
    + `<script>`
    + `setTimeout(function(){ try { window.location.replace("${next}"); } catch(e) { window.location.href = "${next}"; } }, 80);`
    + `</script>`
    + `</body></html>`;
  const res = new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE } });
  res.cookies.delete(LEGACY_SESSION_COOKIE);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(auth, SESSION_MAX_AGE_S), {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });

  const profile = {
    name: verifiedUser.name || "Zigmaa Admin",
    email: verifiedUser.email,
    picture: verifiedUser.picture || "",
    provider: "google",
  };
  res.cookies.set("evp_profile", encodeURIComponent(JSON.stringify(profile)), {
    httpOnly: false,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });

  return clearTx(res);
}
