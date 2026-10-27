import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "@/lib/auth/session";
import { isDeletion, setCookies, stubAuthEnv, TEST_ADMIN_API_KEY, testKeys } from "@/lib/auth/test-helpers";
import { API_BASE_URL, SESSION_MAX_AGE_S } from "@/lib/server-config";
import { GET } from "./route";

const HEALTH = { status: "ok", version: "0.1.0", checks: { database: "ok", storage: "local" } };
let fetchMock: ReturnType<typeof vi.fn>;

async function validCookie(now = Date.now()) {
  return `evp_session=${await createSessionToken(await testKeys(), SESSION_MAX_AGE_S, now)}`;
}

function call(cookie?: string) {
  return GET(new NextRequest("http://photos.example.test/api/admin/health", { headers: cookie ? { cookie } : {} }));
}

function upstream(status: number, body: string) {
  fetchMock.mockResolvedValue(new Response(body, { status, headers: { "content-type": "application/json" } }));
}

beforeEach(async () => {
  await stubAuthEnv();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  upstream(200, JSON.stringify(HEALTH));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin health route", () => {
  it("returns backend health to a signed-in admin without sending the API key or cookie", async () => {
    const cookie = await validCookie();
    const res = await call(cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(HEALTH);
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe(`${API_BASE_URL}/health`);
    const sent = JSON.stringify(init.headers);
    expect(sent).not.toContain(TEST_ADMIN_API_KEY);
    expect(sent).not.toContain(cookie.split("=")[1]);
  });

  it("passes a degraded (503) report through with its checks", async () => {
    upstream(503, JSON.stringify({ ...HEALTH, status: "degraded", checks: { database: "error: OperationalError" } }));
    const res = await call(await validCookie());
    expect(res.status).toBe(503);
    expect((await res.json()).checks.database).toBe("error: OperationalError");
  });

  it.each([
    ["no cookie", undefined],
    ["forged token", "evp_session=eyJ2IjoxfQ.AAAA"],
    ["legacy raw API key cookie", `evp_admin=${TEST_ADMIN_API_KEY}`],
  ])("rejects %s with JSON 401 and never contacts the backend", async (_name, cookie) => {
    const res = await call(cookie);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an expired session and clears the cookies", async () => {
    const expired = await validCookie(Date.now() - (SESSION_MAX_AGE_S + 60) * 1000);
    const res = await call(`${expired}; evp_admin=${TEST_ADMIN_API_KEY}`);
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    const cookies = setCookies(res);
    expect(isDeletion(cookies.evp_session)).toBe(true);
    expect(isDeletion(cookies.evp_admin)).toBe(true);
  });

  it("fails closed when sign-in is not configured", async () => {
    const cookie = await validCookie();
    vi.stubEnv("ADMIN_API_KEY", "");
    const res = await call(cookie);
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the backend is unreachable or answers unexpectedly", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect((await call(await validCookie())).status).toBe(502);
    upstream(404, "<html>not found</html>");
    expect((await call(await validCookie())).status).toBe(502);
    upstream(200, "not json");
    expect((await call(await validCookie())).status).toBe(502);
  });
});
