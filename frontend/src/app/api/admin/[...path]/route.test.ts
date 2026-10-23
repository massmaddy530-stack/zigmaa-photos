import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "@/lib/auth/session";
import { isDeletion, setCookies, stubAuthEnv, TEST_ADMIN_API_KEY, testKeys } from "@/lib/auth/test-helpers";
import { API_BASE_URL, SESSION_MAX_AGE_S } from "@/lib/server-config";
import { GET, POST } from "./route";

const ORIGIN = "http://photos.example.test";
let fetchMock: ReturnType<typeof vi.fn>;
let consoleError: ReturnType<typeof vi.spyOn>;

async function validCookie(now = Date.now()) {
  return `evp_session=${await createSessionToken(await testKeys(), SESSION_MAX_AGE_S, now)}`;
}

function call(handler: typeof GET, path: string[], init: {
  method?: string;
  cookie?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
  search?: string;
} = {}) {
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers.cookie = init.cookie;
  const req = new NextRequest(`${ORIGIN}/api/admin/${path.join("/")}${init.search ?? ""}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    ...(init.body ? { duplex: "half" } : {}),
  } as ConstructorParameters<typeof NextRequest>[1]);
  return handler(req, { params: Promise.resolve({ path }) });
}

function upstream(status: number, body: string | null = '{"ok":true}') {
  fetchMock.mockResolvedValue(new Response(body, { status, headers: { "content-type": "application/json" } }));
}

beforeEach(async () => {
  await stubAuthEnv();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  upstream(200);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("admin proxy", () => {
  it("forwards a signed-in request with the server-side API key, never the cookie", async () => {
    const cookie = await validCookie();
    const res = await call(GET, ["events"], { cookie, search: "?q=wedding" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe(`${API_BASE_URL}/api/v1/events?q=wedding`);
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe(`Bearer ${TEST_ADMIN_API_KEY}`);
    expect(headers.get("cookie")).toBeNull();
    expect(JSON.stringify([...headers])).not.toContain(cookie.split("=")[1]);
  });

  it("streams upload bodies to the backend without buffering", async () => {
    const res = await call(POST, ["events", "e1", "photos"], {
      method: "POST",
      cookie: await validCookie(),
      headers: { "x-requested-with": "evp", "content-type": "multipart/form-data; boundary=xyz" },
      body: "--xyz\r\nphoto-bytes\r\n--xyz--",
    });
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.duplex).toBe("half");
    expect(init.body).toBeInstanceOf(ReadableStream);
    expect(await new Response(init.body).text()).toBe("--xyz\r\nphoto-bytes\r\n--xyz--");
    expect((init.headers as Headers).get("content-type")).toBe("multipart/form-data; boundary=xyz");
  });

  it.each([
    ["no cookie", undefined],
    ["forged token", "evp_session=eyJ2IjoxfQ.AAAA"],
    ["legacy raw API key cookie", `evp_admin=${TEST_ADMIN_API_KEY}`],
  ])("rejects %s without contacting the backend", async (_name, cookie) => {
    const res = await call(GET, ["events"], { cookie });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an expired session and clears the cookies", async () => {
    const expired = await validCookie(Date.now() - (SESSION_MAX_AGE_S + 60) * 1000);
    const res = await call(GET, ["events"], { cookie: `${expired}; evp_admin=${TEST_ADMIN_API_KEY}` });
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    const cookies = setCookies(res);
    expect(isDeletion(cookies.evp_session)).toBe(true);
    expect(isDeletion(cookies.evp_admin)).toBe(true);
  });

  it("requires the CSRF header on writes", async () => {
    const res = await call(POST, ["events"], { method: "POST", cookie: await validCookie(), body: "{}" });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([[["health"]], [["public", "events"]], [["events", ".."]], [[]]])("refuses path %j", async (path) => {
    const res = await call(GET, path, { cookie: await validCookie() });
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed without contacting the backend when sign-in is not configured", async () => {
    const cookie = await validCookie();
    vi.stubEnv("ADMIN_API_KEY", "");
    const res = await call(GET, ["events"], { cookie });
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([401, 403])("reports a backend %i as a server misconfiguration without signing the user out", async (status) => {
    upstream(status, '{"error":{"code":"unauthorized"}}');
    const res = await call(GET, ["events"], { cookie: await validCookie() });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("backend_auth_misconfigured");
    expect(setCookies(res).evp_session).toBeUndefined();
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain(TEST_ADMIN_API_KEY);
  });

  it("passes through 204 and error responses from the backend", async () => {
    upstream(204, null);
    expect((await call(GET, ["events"], { cookie: await validCookie() })).status).toBe(204);
    upstream(404, '{"error":{"code":"not_found"}}');
    expect((await call(GET, ["events", "missing"], { cookie: await validCookie() })).status).toBe(404);
  });

  it("returns 502 when the backend is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect((await call(GET, ["events"], { cookie: await validCookie() })).status).toBe(502);
  });
});
