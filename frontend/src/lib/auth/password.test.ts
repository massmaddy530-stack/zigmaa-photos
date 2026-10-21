import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkCredentials,
  hashPassword,
  parsePasswordHash,
  PasswordHashFormatError,
  SCRYPT_PARAMS,
  verifyPassword,
} from "./password";
import { TEST_PASSWORD, TEST_USERNAME, testPasswordHash } from "./test-helpers";

const SCRIPT = fileURLToPath(new URL("../../../scripts/hash-password.mjs", import.meta.url));
const VALID_SALT = Buffer.alloc(16, 1).toString("base64");
const VALID_HASH = Buffer.alloc(32, 2).toString("base64");

describe("hashPassword / verifyPassword", () => {
  it("produces a self-describing scrypt hash that verifies only the right password", async () => {
    const stored = await testPasswordHash();
    const { N, r, p } = SCRYPT_PARAMS;
    expect(stored).toMatch(new RegExp(`^scrypt\\$${N}\\$${r}\\$${p}\\$[A-Za-z0-9+/]+=*\\$[A-Za-z0-9+/]+=*$`));
    expect(stored).not.toContain(TEST_PASSWORD);
    await expect(verifyPassword(TEST_PASSWORD, stored)).resolves.toBe(true);
    await expect(verifyPassword(`${TEST_PASSWORD} `, stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("uses a random salt", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it("treats composed and decomposed Unicode as the same password", async () => {
    const stored = await hashPassword("café-password");
    await expect(verifyPassword("café-password", stored)).resolves.toBe(true);
  });
});

describe("parsePasswordHash", () => {
  it.each([
    ["empty", ""],
    ["wrong algorithm", `bcrypt$16384$8$5$${VALID_SALT}$${VALID_HASH}`],
    ["too few parts", `scrypt$16384$8$5$${VALID_SALT}`],
    ["weak N", `scrypt$1024$8$5$${VALID_SALT}$${VALID_HASH}`],
    ["N not a power of two", `scrypt$20000$8$5$${VALID_SALT}$${VALID_HASH}`],
    ["N too costly", `scrypt$${2 ** 20}$8$5$${VALID_SALT}$${VALID_HASH}`],
    ["weak r", `scrypt$16384$1$5$${VALID_SALT}$${VALID_HASH}`],
    ["p zero", `scrypt$16384$8$0$${VALID_SALT}$${VALID_HASH}`],
    ["short salt", `scrypt$16384$8$5$${Buffer.alloc(4).toString("base64")}$${VALID_HASH}`],
    ["short hash", `scrypt$16384$8$5$${VALID_SALT}$${Buffer.alloc(8).toString("base64")}`],
  ])("rejects %s", (_name, stored) => {
    expect(() => parsePasswordHash(stored)).toThrow(PasswordHashFormatError);
  });

  it("rejects a bad hash when verifying instead of returning false", async () => {
    await expect(verifyPassword("x", "scrypt$1024$8$5$abc$def")).rejects.toThrow(PasswordHashFormatError);
  });
});

describe("checkCredentials", () => {
  it("accepts only the configured username and password", async () => {
    const admin = { username: TEST_USERNAME, passwordHash: await testPasswordHash() };
    await expect(checkCredentials(TEST_USERNAME, TEST_PASSWORD, admin)).resolves.toBe(true);
    await expect(checkCredentials(TEST_USERNAME, "wrong password!", admin)).resolves.toBe(false);
    await expect(checkCredentials("someone-else", TEST_PASSWORD, admin)).resolves.toBe(false);
    await expect(checkCredentials(TEST_USERNAME.toUpperCase(), TEST_PASSWORD, admin)).resolves.toBe(false);
  });

  it("verifies the password hash even when the username is wrong (no timing shortcut)", async () => {
    // A malformed hash only throws if the hash check runs, proving it is not skipped for unknown usernames.
    await expect(checkCredentials("unknown-user", "pw", { username: TEST_USERNAME, passwordHash: "invalid" }))
      .rejects.toThrow(PasswordHashFormatError);
  });
});

describe("scripts/hash-password.mjs", () => {
  it("prints only a hash that verifies with the app's password check", async () => {
    const run = spawnSync(process.execPath, [SCRIPT], { input: `${TEST_PASSWORD}\n`, encoding: "utf8" });
    expect(run.status).toBe(0);
    const stored = run.stdout.trim();
    expect(stored.split("\n")).toHaveLength(1);
    expect(run.stdout + run.stderr).not.toContain(TEST_PASSWORD);
    expect(() => parsePasswordHash(stored)).not.toThrow();
    await expect(verifyPassword(TEST_PASSWORD, stored)).resolves.toBe(true);
  });

  it("refuses short passwords", () => {
    const run = spawnSync(process.execPath, [SCRIPT], { input: "short\n", encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
  });
});
