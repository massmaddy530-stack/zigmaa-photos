// Google Sign-In for the admin (server-side OAuth 2.0 authorization-code flow with PKCE, state and nonce).
// A successful sign-in issues the SAME signed session cookie as the password login (createSessionToken), so the
// middleware, the admin proxy and password-version checks are unchanged. Node.js runtime only (node:crypto).
// Never log authorization codes, tokens, client secrets or email addresses: only short reason codes.
import "server-only";
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify, type KeyObject } from "node:crypto";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

/** Temporary OAuth transaction cookie: scoped to the Google routes, signed, short-lived, httpOnly, SameSite=Lax. */
export const OAUTH_TX_COOKIE = "evp_oauth_tx";
export const OAUTH_TX_PATH = "/api/auth/google";
export const OAUTH_TX_MAX_AGE_S = 10 * 60;
const CLOCK_SKEW_S = 60;
const MAX_ID_TOKEN_LENGTH = 8192;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedEmails: ReadonlySet<string>;
}

// ------------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------------

/** Constant-time string comparison (length is not secret here: state/nonce are fixed-length random values). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** PKCE (RFC 7636): a random verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/**
 * Post-login destination: only same-site dashboard paths are allowed, so the flow can never become an open
 * redirect. Anything else (absolute URLs, //host, backslashes, control characters, other paths) falls back to
 * /dashboard.
 */
export function safeNextPath(raw: string | null | undefined): string {
  const fallback = "/dashboard";
  if (!raw || raw.length > 512) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw) || raw.startsWith("//")) return fallback;
  if (!(raw === "/dashboard" || raw.startsWith("/dashboard/") || raw.startsWith("/dashboard?"))) return fallback;
  try {
    const u = new URL(raw, "http://local.invalid");
    if (u.origin !== "http://local.invalid") return fallback;
    return `${u.pathname}${u.search}`;
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------------------------------------------
// Signed transaction cookie (state, nonce, PKCE verifier, destination)
// ------------------------------------------------------------------------------------------------

export interface OAuthTransaction {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  exp: number;
}

function txMac(body: string, sessionSecret: string): string {
  // Domain-separated from the session-token MAC so a value of one kind can never be used as the other.
  return createHmac("sha256", `oauth-tx\0${sessionSecret}`).update(body).digest("base64url");
}

export function newTransaction(next: string, now = Date.now()): { tx: OAuthTransaction; challenge: string } {
  const { verifier, challenge } = pkcePair();
  return {
    tx: { state: randomToken(32), nonce: randomToken(32), verifier, next: safeNextPath(next), exp: Math.floor(now / 1000) + OAUTH_TX_MAX_AGE_S },
    challenge,
  };
}

export function sealTransaction(tx: OAuthTransaction, sessionSecret: string): string {
  const body = Buffer.from(JSON.stringify(tx), "utf8").toString("base64url");
  return `${body}.${txMac(body, sessionSecret)}`;
}

/** Returns the transaction if the cookie is intact (constant-time MAC check), well-formed and unexpired. */
export function openTransaction(value: string | undefined, sessionSecret: string, now = Date.now()): OAuthTransaction | null {
  if (!value || value.length > 2048) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot !== value.lastIndexOf(".")) return null;
  const body = value.slice(0, dot);
  if (!safeEqual(value.slice(dot + 1), txMac(body, sessionSecret))) return null;
  let tx: Partial<OAuthTransaction>;
  try {
    tx = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const strings = [tx.state, tx.nonce, tx.verifier, tx.next].every((s) => typeof s === "string" && s.length > 0 && s.length <= 512);
  if (!strings || !Number.isInteger(tx.exp) || (tx.exp as number) <= Math.floor(now / 1000)) return null;
  return { state: tx.state!, nonce: tx.nonce!, verifier: tx.verifier!, next: safeNextPath(tx.next), exp: tx.exp! };
}

// ------------------------------------------------------------------------------------------------
// Authorization request and code exchange
// ------------------------------------------------------------------------------------------------

export function authorizationUrl(config: GoogleConfig, tx: OAuthTransaction, challenge: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri, // the configured value only, never derived from the request Host
    response_type: "code",
    scope: "openid email",
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    access_type: "online",
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Exchanges the authorization code (with the PKCE verifier) for tokens. Returns only the ID token. */
export async function exchangeCode(config: GoogleConfig, code: string, verifier: string, fetchImpl: FetchLike = fetch): Promise<string> {
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new GoogleAuthError("token_exchange_failed");
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!body || typeof body.id_token !== "string") throw new GoogleAuthError("no_id_token");
  return body.id_token;
}

export class GoogleAuthError extends Error {
  constructor(public readonly reason: string) {
    super(`Google sign-in rejected: ${reason}`);
    this.name = "GoogleAuthError";
  }
}

// ------------------------------------------------------------------------------------------------
// ID token verification
// ------------------------------------------------------------------------------------------------

export type KeyLookup = (kid: string) => Promise<KeyObject | undefined>;

interface IdTokenClaims {
  iss?: unknown; aud?: unknown; azp?: unknown; exp?: unknown; iat?: unknown; nonce?: unknown;
  sub?: unknown; email?: unknown; email_verified?: unknown;
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const value = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a Google ID token: RS256 signature against Google's published key, issuer, audience (and azp when
 * several audiences are present), expiry and issue time (60s skew), the expected nonce, a verified email, and the
 * admin allow-list. Throws GoogleAuthError with a short reason; returns nothing personal beyond what is needed.
 */
export async function verifyIdToken(
  idToken: string,
  opts: { clientId: string; nonce: string; allowedEmails: ReadonlySet<string>; getKey: KeyLookup; now?: number },
): Promise<{ sub: string }> {
  if (typeof idToken !== "string" || idToken.length > MAX_ID_TOKEN_LENGTH) throw new GoogleAuthError("malformed");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new GoogleAuthError("malformed");
  const header = decodeSegment(parts[0]);
  const claims = decodeSegment(parts[1]) as IdTokenClaims | null;
  if (!header || !claims || !/^[A-Za-z0-9_-]+$/.test(parts[2])) throw new GoogleAuthError("malformed");
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new GoogleAuthError("bad_algorithm");

  const key = await opts.getKey(header.kid);
  if (!key) throw new GoogleAuthError("unknown_key");
  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  if (!verify("RSA-SHA256", signed, key, Buffer.from(parts[2], "base64url"))) throw new GoogleAuthError("bad_signature");

  const nowS = Math.floor((opts.now ?? Date.now()) / 1000);
  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) throw new GoogleAuthError("bad_issuer");
  const audOk = typeof claims.aud === "string"
    ? claims.aud === opts.clientId
    : Array.isArray(claims.aud) && claims.aud.includes(opts.clientId) && claims.azp === opts.clientId;
  if (!audOk) throw new GoogleAuthError("bad_audience");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S <= nowS) throw new GoogleAuthError("expired");
  if (typeof claims.iat !== "number" || claims.iat - CLOCK_SKEW_S > nowS) throw new GoogleAuthError("bad_iat");
  if (typeof claims.nonce !== "string" || !safeEqual(claims.nonce, opts.nonce)) throw new GoogleAuthError("bad_nonce");
  if (typeof claims.sub !== "string" || !claims.sub) throw new GoogleAuthError("no_subject");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new GoogleAuthError("email_unverified");
  if (typeof claims.email !== "string" || !opts.allowedEmails.has(claims.email.trim().toLowerCase())) {
    throw new GoogleAuthError("not_allowed");
  }
  return { sub: claims.sub };
}

// ------------------------------------------------------------------------------------------------
// Google signing keys (JWKS), cached in memory
// ------------------------------------------------------------------------------------------------

let jwksCache: { keys: Map<string, KeyObject>; expires: number } | null = null;
let lastRefresh = 0;

/** Looks up Google's public key by id; refreshes the cached key set when it expires or an unknown id appears. */
export async function googleSigningKey(kid: string, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<KeyObject | undefined> {
  const fresh = jwksCache && jwksCache.expires > now;
  if (fresh && jwksCache!.keys.has(kid)) return jwksCache!.keys.get(kid);
  if (fresh && now - lastRefresh < 60_000) return undefined; // unknown id: at most one refresh per minute
  lastRefresh = now;
  const res = await fetchImpl(GOOGLE_JWKS_URL, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new GoogleAuthError("jwks_unavailable");
  const body = (await res.json().catch(() => null)) as { keys?: Array<Record<string, unknown>> } | null;
  const keys = new Map<string, KeyObject>();
  for (const jwk of body?.keys ?? []) {
    if (jwk.kty !== "RSA" || typeof jwk.kid !== "string") continue;
    try {
      keys.set(jwk.kid, createPublicKey({ key: jwk as never, format: "jwk" }));
    } catch {
      /* skip malformed keys */
    }
  }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  jwksCache = { keys, expires: now + Math.min(Math.max(maxAge, 60), 24 * 3600) * 1000 };
  return keys.get(kid);
}

/** Test hook: forget cached keys. */
export function resetGoogleKeyCache(): void {
  jwksCache = null;
  lastRefresh = 0;
}
