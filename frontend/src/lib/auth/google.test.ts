// Network-free tests for Google Sign-In. Keys are generated locally; Google's token and key endpoints are faked.
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/api/auth/google/callback/route";
import { GET as start } from "@/app/api/auth/google/start/route";
import { verifySessionToken } from "./session";
import {
  authorizationUrl, exchangeCode, GOOGLE_JWKS_URL, GOOGLE_TOKEN_URL, googleSigningKey, newTransaction, OAUTH_TX_COOKIE,
  openTransaction, pkcePair, resetGoogleKeyCache, safeEqual, safeNextPath, sealTransaction, verifyIdToken,
} from "./google";
import { cookieValue, isDeletion, setCookies, stubAuthEnv, TEST_SESSION_SECRET, testKeys } from "./test-helpers";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const REDIRECT = "http://localhost:3000/api/auth/google/callback";
const ADMIN_EMAIL = "owner@example.test";
const NOW = 1_800_000_000_000;

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key-1";
const getKey = async (kid: string): Promise<KeyObject | undefined> => (kid === KID ? publicKey : undefined);

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function idToken(claims: Record<string, unknown> = {}, opts: { header?: Record<string, unknown>; key?: KeyObject } = {}): string {
  const nowS = Math.floor(NOW / 1000);
  const head = b64({ alg: "RS256", kid: KID, typ: "JWT", ...opts.header });
  const body = b64({
    iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "1234567890", email: ADMIN_EMAIL, email_verified: true,
    iat: nowS - 10, exp: nowS + 3600, nonce: "expected-nonce", ...claims,
  });
  const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), opts.key ?? privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

const verifyOpts = { clientId: CLIENT_ID, nonce: "expected-nonce", allowedEmails: new Set([ADMIN_EMAIL]), getKey, now: NOW };

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "accepted";
  } catch (err) {
    return (err as { reason?: string }).reason ?? String(err);
  }
}

describe("verifyIdToken", () => {
  it("accepts a correctly signed token for the configured client, nonce and allowed, verified email", async () => {
    await expect(verifyIdToken(idToken(), verifyOpts)).resolves.toEqual({ sub: "1234567890" });
    await expect(verifyIdToken(idToken({ iss: "accounts.google.com" }), verifyOpts)).resolves.toBeTruthy();
    await expect(verifyIdToken(idToken({ email: "Owner@Example.TEST" }), verifyOpts)).resolves.toBeTruthy(); // case-insensitive
  });

  it("rejects a token signed with a different key", async () => {
    expect(await reason(verifyIdToken(idToken({}, { key: other.privateKey }), verifyOpts))).toBe("bad_signature");
  });

  it("rejects a tampered payload", async () => {
    const [h, , s] = idToken().split(".");
    expect(await reason(verifyIdToken(`${h}.${b64({ email: "attacker@example.test" })}.${s}`, verifyOpts))).toBe("bad_signature");
  });

  it("rejects non-RS256 algorithms (including 'none') and unknown key ids", async () => {
    expect(await reason(verifyIdToken(idToken({}, { header: { alg: "HS256" } }), verifyOpts))).toBe("bad_algorithm");
    expect(await reason(verifyIdToken(idToken({}, { header: { alg: "none" } }), verifyOpts))).toBe("bad_algorithm");
    expect(await reason(verifyIdToken(idToken({}, { header: { kid: "other" } }), verifyOpts))).toBe("unknown_key");
  });

  it("rejects the wrong issuer", async () => {
    expect(await reason(verifyIdToken(idToken({ iss: "https://evil.example" }), verifyOpts))).toBe("bad_issuer");
  });

  it("rejects the wrong audience, and multi-audience tokens without a matching azp", async () => {
    expect(await reason(verifyIdToken(idToken({ aud: "someone-else" }), verifyOpts))).toBe("bad_audience");
    expect(await reason(verifyIdToken(idToken({ aud: [CLIENT_ID, "x"] }), verifyOpts))).toBe("bad_audience");
    await expect(verifyIdToken(idToken({ aud: [CLIENT_ID, "x"], azp: CLIENT_ID }), verifyOpts)).resolves.toBeTruthy();
  });

  it("rejects expired tokens and tokens issued in the future (beyond 60s skew)", async () => {
    const nowS = Math.floor(NOW / 1000);
    expect(await reason(verifyIdToken(idToken({ exp: nowS - 61 }), verifyOpts))).toBe("expired");
    expect(await reason(verifyIdToken(idToken({ iat: nowS + 120 }), verifyOpts))).toBe("bad_iat");
    await expect(verifyIdToken(idToken({ exp: nowS - 30 }), verifyOpts)).resolves.toBeTruthy(); // within skew
  });

  it("rejects a nonce mismatch or a missing nonce", async () => {
    expect(await reason(verifyIdToken(idToken({ nonce: "other" }), verifyOpts))).toBe("bad_nonce");
    expect(await reason(verifyIdToken(idToken({ nonce: undefined }), verifyOpts))).toBe("bad_nonce");
  });

  it("rejects unverified emails and emails not on the allow-list", async () => {
    expect(await reason(verifyIdToken(idToken({ email_verified: false }), verifyOpts))).toBe("email_unverified");
    expect(await reason(verifyIdToken(idToken({ email: "guest@example.test" }), verifyOpts))).toBe("not_allowed");
    expect(await reason(verifyIdToken(idToken({ email: undefined }), verifyOpts))).toBe("not_allowed");
  });

  it("rejects malformed input", async () => {
    for (const bad of ["", "abc", "a.b", "a.b.c.d", "!!.@@.##", `${b64([1])}.${b64({})}.sig`, "x".repeat(9000)]) {
      expect(await reason(verifyIdToken(bad, verifyOpts))).toBe("malformed");
    }
  });
});

describe("transaction cookie, state and redirects", () => {
  it("round-trips and rejects tampering, a wrong secret, expiry and malformed values", () => {
    const { tx } = newTransaction("/dashboard/events", NOW);
    const sealed = sealTransaction(tx, TEST_SESSION_SECRET);
    expect(openTransaction(sealed, TEST_SESSION_SECRET, NOW)).toEqual(tx);
    const [body, mac] = sealed.split(".");
    expect(openTransaction(`${body}x.${mac}`, TEST_SESSION_SECRET, NOW)).toBeNull();
    expect(openTransaction(`${body}.${mac.slice(0, -2)}AA`, TEST_SESSION_SECRET, NOW)).toBeNull();
    expect(openTransaction(sealed, "another-secret-another-secret-123456", NOW)).toBeNull();
    expect(openTransaction(sealed, TEST_SESSION_SECRET, NOW + 11 * 60_000)).toBeNull();
    for (const bad of [undefined, "", "nodot", "a.b.c", "x".repeat(3000)]) expect(openTransaction(bad, TEST_SESSION_SECRET, NOW)).toBeNull();
  });

  it("compares in constant time and treats different lengths as unequal", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("only allows same-site dashboard destinations", () => {
    expect(safeNextPath("/dashboard/events/1?tab=share")).toBe("/dashboard/events/1?tab=share");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/login", "/dashboardx", "javascript:alert(1)", "/dashboard\n", null]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });

  it("builds a PKCE S256 pair and an authorization URL with the configured redirect URI only", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const { tx, challenge: c } = newTransaction("/dashboard", NOW);
    const url = new URL(authorizationUrl({ clientId: CLIENT_ID, clientSecret: "s", redirectUri: REDIRECT, allowedEmails: new Set() }, tx, c));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: "openid email", state: tx.state, nonce: tx.nonce,
      code_challenge: c, code_challenge_method: "S256",
    });
  });
});

describe("code exchange and signing keys (faked network)", () => {
  const config = { clientId: CLIENT_ID, clientSecret: "client-secret", redirectUri: REDIRECT, allowedEmails: new Set([ADMIN_EMAIL]) };

  it("sends the code with the PKCE verifier and configured redirect URI, and returns only the ID token", async () => {
    const fake = vi.fn(async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init.body));
      expect(Object.fromEntries(body)).toMatchObject({ code: "the-code", code_verifier: "the-verifier", redirect_uri: REDIRECT, grant_type: "authorization_code" });
      return Response.json({ id_token: "header.payload.sig", access_token: "unused" });
    });
    await expect(exchangeCode(config, "the-code", "the-verifier", fake)).resolves.toBe("header.payload.sig");
    expect(fake).toHaveBeenCalledWith(GOOGLE_TOKEN_URL, expect.anything());
  });

  it("fails safely on token-endpoint errors or a missing ID token", async () => {
    expect(await reason(exchangeCode(config, "c", "v", async () => new Response("no", { status: 400 })))).toBe("token_exchange_failed");
    expect(await reason(exchangeCode(config, "c", "v", async () => Response.json({ access_token: "x" })))).toBe("no_id_token");
  });

  it("caches Google's keys and refreshes for an unknown key id at most once a minute", async () => {
    resetGoogleKeyCache();
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };
    const fake = vi.fn(async () => Response.json({ keys: [jwk] }, { headers: { "cache-control": "public, max-age=3600" } }));
    expect(await googleSigningKey(KID, fake, NOW)).toBeTruthy();
    expect(await googleSigningKey(KID, fake, NOW + 1000)).toBeTruthy();
    expect(fake).toHaveBeenCalledTimes(1);
    expect(fake).toHaveBeenCalledWith(GOOGLE_JWKS_URL, expect.anything());
    expect(await googleSigningKey("rotated", fake, NOW + 2000)).toBeUndefined();
    expect(fake).toHaveBeenCalledTimes(1); // throttled
    expect(await googleSigningKey("rotated", fake, NOW + 61_000)).toBeUndefined();
    expect(fake).toHaveBeenCalledTimes(2);
    resetGoogleKeyCache();
  });
});

describe("start and callback routes", () => {
  let ip = 0;

  beforeEach(async () => {
    resetGoogleKeyCache();
    await stubAuthEnv({
      GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: "client-secret", GOOGLE_REDIRECT_URI: REDIRECT, ADMIN_GOOGLE_EMAILS: ` ${ADMIN_EMAIL} , second@example.test`,
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetGoogleKeyCache();
  });

  function req(path: string, opts: { host?: string; cookie?: string } = {}) {
    const host = opts.host ?? "localhost:3000";
    const headers: Record<string, string> = { host, "x-forwarded-for": `198.51.100.${++ip}` };
    if (opts.cookie) headers.cookie = opts.cookie;
    return new NextRequest(`http://${host}${path}`, { headers });
  }

  async function begin(next = "/dashboard/events") {
    const res = await start(req(`/api/auth/google/start?next=${encodeURIComponent(next)}`));
    const location = new URL(res.headers.get("location")!);
    const txCookie = setCookies(res)[OAUTH_TX_COOKIE];
    return { res, location, txCookie, state: location.searchParams.get("state")!, nonce: location.searchParams.get("nonce")! };
  }

  function fakeGoogle(token: (nonce: string) => string, nonce: string) {
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === GOOGLE_TOKEN_URL
      ? Response.json({ id_token: token(nonce) })
      : Response.json({ keys: [jwk] }))));
  }

  it("start: redirects to Google with the configured redirect URI and sets a scoped, httpOnly, Lax transaction cookie", async () => {
    const { res, location, txCookie } = await begin();
    expect(res.status).toBe(303);
    expect(location.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(txCookie).toMatch(/HttpOnly/i);
    expect(txCookie).toMatch(/SameSite=lax/i);
    expect(txCookie).toMatch(/Path=\/api\/auth\/google/);
  });

  it("start: on another host, restarts on the configured host (the request Host is never used to build URLs)", async () => {
    const res = await start(req("/api/auth/google/start", { host: "192.168.1.11:3000" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/api/auth/google/start?next=%2Fdashboard");
    expect(setCookies(res)[OAUTH_TX_COOKIE]).toBeUndefined();
  });

  it("start: without complete Google settings, falls back to the login page and sets nothing", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const res = await start(req("/api/auth/google/start"));
    expect(res.headers.get("location")).toBe("/login?error=google_unavailable");
    expect(setCookies(res)[OAUTH_TX_COOKIE]).toBeUndefined();
  });

  it("callback: signs in with the existing session cookie, clears the transaction cookie and completes same-origin", async () => {
    const { txCookie, state, nonce } = await begin("/dashboard/events");
    fakeGoogle((n) => idToken({ nonce: n, iat: Math.floor(Date.now() / 1000) - 5, exp: Math.floor(Date.now() / 1000) + 3600 }), nonce);
    const res = await callback(req(`/api/auth/google/callback?code=c0de&state=${state}`, { cookie: `${OAUTH_TX_COOKIE}=${cookieValue(txCookie)}` }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('http-equiv="refresh" content="0;url=/dashboard/events"');
    expect(html).toContain('href="/dashboard/events"');
    const cookies = setCookies(res);
    expect(cookies.evp_session).toMatch(/HttpOnly/i);
    expect(cookies.evp_session).toMatch(/SameSite=strict/i);
    expect(await verifySessionToken(cookieValue(cookies.evp_session), await testKeys(), 12 * 3600)).not.toBeNull();
    expect(isDeletion(cookies[OAUTH_TX_COOKIE])).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("callback: rejects a state mismatch, a missing transaction and a disallowed email, generically and without a session", async () => {
    const first = await begin();
    fakeGoogle((n) => idToken({ nonce: n, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }), first.nonce);
    const cookie = `${OAUTH_TX_COOKIE}=${cookieValue(first.txCookie)}`;

    const mismatch = await callback(req(`/api/auth/google/callback?code=c&state=${first.state}x`, { cookie }));
    const missing = await callback(req(`/api/auth/google/callback?code=c&state=${first.state}`));
    fakeGoogle((n) => idToken({ nonce: n, email: "guest@example.test", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }), first.nonce);
    const notAllowed = await callback(req(`/api/auth/google/callback?code=c&state=${first.state}`, { cookie }));
    const cancelled = await callback(req(`/api/auth/google/callback?error=access_denied&state=${first.state}`, { cookie }));

    for (const res of [mismatch, missing, notAllowed, cancelled]) {
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/login?error=google");
      expect(setCookies(res).evp_session).toBeUndefined();
      expect(isDeletion(setCookies(res)[OAUTH_TX_COOKIE])).toBe(true);
    }
  });

  it("callback: never logs codes, tokens, secrets or email addresses", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { txCookie, state, nonce } = await begin();
    fakeGoogle((n) => idToken({ nonce: n, email: "guest@example.test", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }), nonce);
    await callback(req(`/api/auth/google/callback?code=SECRET-CODE&state=${state}`, { cookie: `${OAUTH_TX_COOKIE}=${cookieValue(txCookie)}` }));
    const logged = log.mock.calls.flat().join(" ");
    expect(logged).toContain("not_allowed");
    for (const leak of ["SECRET-CODE", "guest@example.test", "client-secret", state, nonce]) expect(logged).not.toContain(leak);
    log.mockRestore();
  });
});
