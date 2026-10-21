import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifySessionToken } from "@/lib/auth/session";
import {
  cookieValue,
  isDeletion,
  setCookies,
  stubAuthEnv,
  TEST_ADMIN_API_KEY,
  TEST_PASSWORD,
  TEST_SESSION_SECRET,
  TEST_USERNAME,
  testKeys,
  testPasswordHash,
} from "@/lib/auth/test-helpers";
import { DELETE, POST } from "./route";

const HOST = "photos.example.test";
let ipCounter = 0;

function sessionRequest(method: "POST" | "DELETE", opts: {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string | null>;
  ip?: string;
  scheme?: "http" | "https";
} = {}) {
  const scheme = opts.scheme ?? "http";
  const headers: Record<string, string> = {};
  const defaults: Record<string, string | null> = {
    host: HOST,
    origin: `${scheme}://${HOST}`,
    "x-requested-with": "evp",
    "content-type": "application/json",
    "x-forwarded-for": opts.ip ?? `192.0.2.${++ipCounter}`,
    ...opts.headers,
  };
  for (const [k, v] of Object.entries(defaults)) if (v !== null) headers[k] = v;
  const body = opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  return new NextRequest(`${scheme}://${HOST}/api/session`, { method, headers, body });
}

const login = (body: unknown = { username: TEST_USERNAME, password: TEST_PASSWORD }, opts = {}) =>
  POST(sessionRequest("POST", { body, ...opts }));

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await stubAuthEnv();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/session", () => {
  it("signs in with the right username and password and sets a signed session cookie", async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cookies = setCookies(res);
    const session = cookies.evp_session;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=strict/i);
    expect(session).toMatch(/Path=\//);
    expect(session).toMatch(/Max-Age=43200/);
    expect(session).not.toMatch(/Secure/i); // not production
    const token = cookieValue(session);
    expect(await verifySessionToken(token, await testKeys(), 43200)).not.toBeNull();
    for (const secret of [TEST_PASSWORD, TEST_ADMIN_API_KEY, TEST_SESSION_SECRET, await testPasswordHash()]) {
      expect(session).not.toContain(secret);
    }
    expect(isDeletion(cookies.evp_admin)).toBe(true); // legacy cookie with the raw API key is removed
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await login(undefined, { scheme: "https" });
    expect(res.status).toBe(200);
    expect(setCookies(res).evp_session).toMatch(/;\s*Secure/i);
  });

  it.each([
    ["wrong password", { username: TEST_USERNAME, password: "not the password" }],
    ["wrong username", { username: "someone", password: TEST_PASSWORD }],
  ])("rejects a %s with the same generic error and no cookie", async (_name, body) => {
    const res = await login(body);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "invalid_credentials", message: "Invalid username or password.", details: null },
    });
    expect(setCookies(res).evp_session).toBeUndefined();
  });

  it.each([
    ["missing CSRF header", { "x-requested-with": null }],
    ["wrong CSRF header", { "x-requested-with": "other" }],
    ["missing Origin", { origin: null }],
    ["cross-site Origin", { origin: "https://evil.example" }],
    ["opaque Origin", { origin: "null" }],
  ])("blocks a request with %s", async (_name, headers) => {
    const res = await login(undefined, { headers });
    expect(res.status).toBe(403);
    expect(setCookies(res).evp_session).toBeUndefined();
  });

  it("accepts the public host from X-Forwarded-Host behind a proxy", async () => {
    const res = await login(undefined, { headers: { host: "internal:3000", "x-forwarded-host": HOST } });
    expect(res.status).toBe(200);
  });

  it("requires an https Origin in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(new NextRequest(`https://${HOST}/api/session`, {
      method: "POST",
      headers: { host: HOST, origin: `http://${HOST}`, "x-requested-with": "evp", "x-forwarded-for": "198.51.100.1" },
      body: JSON.stringify({ username: TEST_USERNAME, password: TEST_PASSWORD }),
    }));
    expect(res.status).toBe(403);
  });

  it.each(["ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "SESSION_SECRET", "ADMIN_API_KEY"])(
    "fails closed when %s is missing, logging only the variable name",
    async (name) => {
      vi.stubEnv(name, "");
      const res = await login();
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("auth_not_configured");
      expect(setCookies(res).evp_session).toBeUndefined();
      const logged = consoleError.mock.calls.flat().join(" ");
      expect(logged).toContain(name);
      for (const secret of [TEST_ADMIN_API_KEY, TEST_SESSION_SECRET, await testPasswordHash()]) {
        expect(logged).not.toContain(secret);
      }
    },
  );

  it("fails closed when SESSION_SECRET is too short or equals ADMIN_API_KEY", async () => {
    vi.stubEnv("SESSION_SECRET", "too-short");
    expect((await login()).status).toBe(503);
    vi.stubEnv("SESSION_SECRET", TEST_ADMIN_API_KEY);
    expect((await login()).status).toBe(503);
  });

  it("fails closed when the password hash has unacceptable parameters", async () => {
    const weak = (await testPasswordHash()).replace(/^scrypt\$16384\$/, "scrypt$1024$");
    vi.stubEnv("ADMIN_PASSWORD_HASH", weak);
    const res = await login();
    expect(res.status).toBe(503);
    expect(setCookies(res).evp_session).toBeUndefined();
  });

  it("throttles repeated failures from one client, even for the right password", async () => {
    const ip = "203.0.113.50";
    for (let i = 0; i < 5; i++) {
      expect((await login({ username: TEST_USERNAME, password: `wrong-${i}` }, { ip })).status).toBe(401);
    }
    const blocked = await login(undefined, { ip });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(setCookies(blocked).evp_session).toBeUndefined();
  });

  it.each([
    ["missing fields", { body: {} }, 422],
    ["non-string password", { body: { username: TEST_USERNAME, password: 123 } }, 422],
    ["blank username", { body: { username: "   ", password: TEST_PASSWORD } }, 422],
    ["overlong password", { body: { username: TEST_USERNAME, password: "x".repeat(1025) } }, 422],
    ["invalid JSON", { rawBody: "{not json" }, 400],
    ["oversized body", { rawBody: JSON.stringify({ username: "a", password: "x".repeat(10_000) }) }, 413],
  ])("rejects %s", async (_name, opts, status) => {
    const res = await POST(sessionRequest("POST", opts));
    expect(res.status).toBe(status);
  });
});

describe("DELETE /api/session", () => {
  it("clears both the session cookie and the legacy cookie", async () => {
    const res = await DELETE(sessionRequest("DELETE"));
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(isDeletion(cookies.evp_session)).toBe(true);
    expect(isDeletion(cookies.evp_admin)).toBe(true);
  });

  it("works even when sign-in is not configured", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    expect((await DELETE(sessionRequest("DELETE"))).status).toBe(200);
  });

  it.each([
    ["missing CSRF header", { "x-requested-with": null }],
    ["cross-site Origin", { origin: "https://evil.example" }],
  ])("blocks %s", async (_name, headers) => {
    const res = await DELETE(sessionRequest("DELETE", { headers }));
    expect(res.status).toBe(403);
    expect(setCookies(res).evp_session).toBeUndefined();
  });
});
