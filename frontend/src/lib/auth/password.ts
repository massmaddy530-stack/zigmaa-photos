// Admin password hashing with scrypt (node:crypto), stored as "scrypt$N$r$p$<salt b64>$<hash b64>".
// Node.js runtime only: import from route handlers, not from middleware.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findUserAsync, findUserByEmail } from "./user-store";

// OWASP-equivalent scrypt cost (N=2^14, r=8, p=5), about 16 MiB per check.
// Keep in sync with scripts/hash-password.mjs.
export const SCRYPT_PARAMS = { N: 16384, r: 8, p: 5 } as const;
export const MAX_PASSWORD_LENGTH = 1024;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

const TMP_HASH_FILE = join(tmpdir(), "zigmaa_admin_hash.json");

declare global {
  var __ZIGMAA_DYNAMIC_HASH: string | undefined;
}

export function getDynamicPasswordHash(): string | null {
  if (globalThis.__ZIGMAA_DYNAMIC_HASH) return globalThis.__ZIGMAA_DYNAMIC_HASH;
  try {
    if (existsSync(TMP_HASH_FILE)) {
      const data = JSON.parse(readFileSync(TMP_HASH_FILE, "utf-8"));
      if (typeof data?.hash === "string" && data.hash.startsWith("scrypt$")) {
        globalThis.__ZIGMAA_DYNAMIC_HASH = data.hash;
        return data.hash;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function saveDynamicPasswordHash(hash: string): void {
  globalThis.__ZIGMAA_DYNAMIC_HASH = hash;
  try {
    writeFileSync(TMP_HASH_FILE, JSON.stringify({ hash, updatedAt: Date.now() }), "utf-8");
  } catch {
    // ignore on read-only environments
  }
}

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
 * Checks a username and password against the configured admin or registered user.
 * The primary password hash is always verified first (and throws on malformed hash) so timing does not leak.
 */
export async function checkCredentials(
  username: string,
  password: string,
  admin: { username: string; passwordHash: string },
): Promise<boolean> {
  // Always verify primary password hash first (throws PasswordHashFormatError if malformed, no timing leak)
  const passwordOk = await verifyPassword(password, admin.passwordHash);

  // Exact match for configured admin username (timing-safe, case-sensitive)
  const usernameOk = timingSafeEqual(digest(username), digest(admin.username));

  const normUser = username.trim().toLowerCase();

  // 1. Look up the user in Supabase DB / user store
  const storedUser = (await findUserAsync(normUser)) || findUserByEmail(normUser);
  if (storedUser && storedUser.passwordHash) {
    try {
      // ONLY check the active password set for this account in the database.
      // If password matches, return true. If not, reject (old passwords will NOT work).
      return await verifyPassword(password, storedUser.passwordHash);
    } catch {
      return false;
    }
  }

  // 2. Fallback for the primary admin username (when not yet populated in DB)
  if (usernameOk) {
    return passwordOk;
  }

  // 3. Any unregistered email or unknown username is rejected
  return false;
}
