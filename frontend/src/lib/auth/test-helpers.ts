// Shared fixtures for the auth tests. Every value here is a fake used only by tests.
import { vi } from "vitest";
import { hashPassword } from "./password";

export const TEST_USERNAME = "studio-admin";
export const TEST_PASSWORD = "correct horse battery staple";
export const TEST_SESSION_SECRET = "test-session-secret-0123456789-abcdefghij";
export const TEST_ADMIN_API_KEY = "test-admin-api-key-DO-NOT-LEAK-0123456789";

let cachedHash: Promise<string> | null = null;

export function testPasswordHash(): Promise<string> {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  return cachedHash;
}

export async function testKeys() {
  return { username: TEST_USERNAME, passwordHash: await testPasswordHash(), sessionSecret: TEST_SESSION_SECRET };
}

/** Configures the sign-in environment variables; undo with vi.unstubAllEnvs(). */
export async function stubAuthEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = {
    ADMIN_USERNAME: TEST_USERNAME,
    ADMIN_PASSWORD_HASH: await testPasswordHash(),
    SESSION_SECRET: TEST_SESSION_SECRET,
    ADMIN_API_KEY: TEST_ADMIN_API_KEY,
    ...overrides,
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

/** Set-Cookie headers of a response, keyed by cookie name. */
export function setCookies(res: Response): Record<string, string> {
  return Object.fromEntries(res.headers.getSetCookie().map((c) => [c.slice(0, c.indexOf("=")), c]));
}

export function cookieValue(setCookie: string): string {
  return setCookie.slice(setCookie.indexOf("=") + 1).split(";")[0];
}

export function isDeletion(setCookie: string | undefined): boolean {
  return Boolean(setCookie) && (/Max-Age=0/i.test(setCookie!) || /Expires=Thu, 01 Jan 1970/i.test(setCookie!));
}
