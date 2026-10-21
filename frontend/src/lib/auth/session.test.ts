import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "./session";
import { TEST_ADMIN_API_KEY, TEST_PASSWORD, TEST_SESSION_SECRET, testKeys } from "./test-helpers";

const MAX_AGE = 12 * 60 * 60;
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

function decodeBody(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
}

function reencode(token: string, change: (p: Record<string, unknown>) => void): string {
  const payload = decodeBody(token);
  change(payload);
  return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${token.split(".")[1]}`;
}

describe("session tokens", () => {
  it("round-trips a valid token with the expected claims", async () => {
    const keys = await testKeys();
    const token = await createSessionToken(keys, MAX_AGE, NOW);
    const payload = await verifySessionToken(token, keys, MAX_AGE, NOW + 1000);
    expect(payload).toMatchObject({ v: 1, sub: keys.username, iat: NOW / 1000, exp: NOW / 1000 + MAX_AGE });
  });

  it("contains no password, password hash, session secret or API key", async () => {
    const keys = await testKeys();
    const token = await createSessionToken(keys, MAX_AGE, NOW);
    const decoded = JSON.stringify(decodeBody(token));
    for (const secret of [TEST_PASSWORD, keys.passwordHash, TEST_SESSION_SECRET, TEST_ADMIN_API_KEY]) {
      expect(token).not.toContain(secret);
      expect(decoded).not.toContain(secret);
    }
  });

  it("rejects tampered payloads and signatures", async () => {
    const keys = await testKeys();
    const token = await createSessionToken(keys, MAX_AGE, NOW);
    const later = NOW + 1000;
    expect(await verifySessionToken(reencode(token, (p) => (p.exp = (p.exp as number) + 3600)), keys, MAX_AGE, later)).toBeNull();
    expect(await verifySessionToken(reencode(token, (p) => (p.sub = "attacker")), keys, MAX_AGE, later)).toBeNull();
    const [body, sig] = token.split(".");
    const flipped = sig.slice(0, -2) + (sig.at(-2) === "A" ? "B" : "A") + sig.at(-1);
    expect(await verifySessionToken(`${body}.${flipped}`, keys, MAX_AGE, later)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const keys = await testKeys();
    const token = await createSessionToken({ ...keys, sessionSecret: "another-secret-another-secret-123456" }, MAX_AGE, NOW);
    expect(await verifySessionToken(token, keys, MAX_AGE, NOW)).toBeNull();
  });

  it("rejects expired, future-dated and over-long tokens", async () => {
    const keys = await testKeys();
    const token = await createSessionToken(keys, MAX_AGE, NOW);
    expect(await verifySessionToken(token, keys, MAX_AGE, NOW + MAX_AGE * 1000)).toBeNull();
    expect(await verifySessionToken(token, keys, MAX_AGE, NOW - 5 * 60 * 1000)).toBeNull();
    const longLived = await createSessionToken(keys, MAX_AGE * 10, NOW);
    expect(await verifySessionToken(longLived, keys, MAX_AGE, NOW)).toBeNull();
  });

  it("is invalidated by a password change or a different admin username", async () => {
    const keys = await testKeys();
    const token = await createSessionToken(keys, MAX_AGE, NOW);
    expect(await verifySessionToken(token, { ...keys, passwordHash: `${keys.passwordHash}x` }, MAX_AGE, NOW)).toBeNull();
    expect(await verifySessionToken(token, { ...keys, username: "new-admin" }, MAX_AGE, NOW)).toBeNull();
  });

  it.each([
    ["empty", ""],
    ["no signature", "abc"],
    ["three parts", "a.b.c"],
    ["not base64url", "ab$c.def"],
    ["oversized", `${"a".repeat(3000)}.b`],
    ["legacy raw API key", TEST_ADMIN_API_KEY],
  ])("rejects malformed token: %s", async (_name, token) => {
    expect(await verifySessionToken(token, await testKeys(), MAX_AGE, NOW)).toBeNull();
  });
});
