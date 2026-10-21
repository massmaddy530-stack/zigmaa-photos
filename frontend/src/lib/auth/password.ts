// Admin password hashing with scrypt (node:crypto), stored as "scrypt$N$r$p$<salt b64>$<hash b64>".
// Node.js runtime only: import from route handlers, not from middleware.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP-equivalent scrypt cost (N=2^14, r=8, p=5), about 16 MiB per check.
// Keep in sync with scripts/hash-password.mjs.
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 5 } as const;
export const MAX_PASSWORD_LENGTH = 1024;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export class PasswordHashFormatError extends Error {
  constructor() {
    super("ADMIN_PASSWORD_HASH has an invalid format or parameters");
    this.name = "PasswordHashFormatError";
  }
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function derive(password: string, salt: Buffer, N: number, r: number, p: number, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, keyLength, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Parses a stored hash, rejecting parameters too weak to accept or too costly to run. */
export function parsePasswordHash(stored: string): ParsedHash {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") throw new PasswordHashFormatError();
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const powerOfTwo = Number.isInteger(N) && (N & (N - 1)) === 0;
  if (!powerOfTwo || N < 2 ** 14 || N > 2 ** 17) throw new PasswordHashFormatError();
  if (!Number.isInteger(r) || r < 8 || r > 16 || !Number.isInteger(p) || p < 1 || p > 16) {
    throw new PasswordHashFormatError();
  }
  const salt = Buffer.from(parts[4], "base64");
  const hash = Buffer.from(parts[5], "base64");
  if (salt.length < SALT_LENGTH || hash.length < 32 || hash.length > 64) throw new PasswordHashFormatError();
  return { N, r, p, salt, hash };
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = SCRYPT_PARAMS;
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, N, r, p, KEY_LENGTH);
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Constant-time check of a password against a stored hash. Throws PasswordHashFormatError for a bad hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const { N, r, p, salt, hash } = parsePasswordHash(stored);
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  const candidate = await derive(password, salt, N, r, p, hash.length);
  return timingSafeEqual(candidate, hash);
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Checks a username and password against the configured admin. The password hash is always verified, even for
 * an unknown username, so response timing does not reveal which of the two was wrong.
 */
export async function checkCredentials(
  username: string,
  password: string,
  admin: { username: string; passwordHash: string },
): Promise<boolean> {
  const passwordOk = await verifyPassword(password, admin.passwordHash);
  const usernameOk = timingSafeEqual(digest(username), digest(admin.username));
  return passwordOk && usernameOk;
}
