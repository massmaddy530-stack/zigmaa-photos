// Signed, expiring admin session tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature).
// Web Crypto only, so the same code runs in middleware and route handlers. Tokens are signed, not encrypted,
// and carry no secrets: no password, no password hash and no backend API key.

export interface SessionPayload {
  v: 1;
  sub: string;
  iat: number;
  exp: number;
  pwv: string;
}

export interface SessionKeys {
  username: string;
  passwordHash: string;
  sessionSecret: string;
}

const MAX_TOKEN_LENGTH = 2048;
const CLOCK_SKEW_S = 60;
const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Keyed fingerprint of the password hash: changing ADMIN_PASSWORD_HASH invalidates every existing session. */
export async function passwordVersion(keys: SessionKeys): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(keys.sessionSecret), encoder.encode(`pwv\0${keys.passwordHash}`));
  return toBase64Url(new Uint8Array(mac).slice(0, 16));
}

export async function createSessionToken(keys: SessionKeys, maxAgeS: number, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = { v: 1, sub: keys.username, iat, exp: iat + maxAgeS, pwv: await passwordVersion(keys) };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(keys.sessionSecret), encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(mac))}`;
}

function isPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return p.v === 1 && typeof p.sub === "string" && typeof p.pwv === "string" &&
    Number.isInteger(p.iat) && Number.isInteger(p.exp);
}

/** Returns the payload of a valid, unexpired token for the configured admin, or null. */
export async function verifySessionToken(
  token: string,
  keys: SessionKeys,
  maxAgeS: number,
  now = Date.now(),
): Promise<SessionPayload | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signatureText] = parts;
  const signature = fromBase64Url(signatureText);
  const raw = fromBase64Url(body);
  if (!signature || signature.length !== 32 || !raw) return null;

  // crypto.subtle.verify compares the MAC in constant time.
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(keys.sessionSecret), signature, encoder.encode(body)))) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return null;
  }
  if (!isPayload(payload)) return null;

  const nowS = Math.floor(now / 1000);
  if (payload.exp <= nowS || payload.iat > nowS + CLOCK_SKEW_S || payload.exp - payload.iat > maxAgeS) return null;
  if (payload.sub !== keys.username) return null;
  if (payload.pwv !== (await passwordVersion(keys))) return null;
  return payload;
}
