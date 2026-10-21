import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "@/lib/auth/session";
import { isDeletion, setCookies, stubAuthEnv, TEST_ADMIN_API_KEY, testKeys } from "@/lib/auth/test-helpers";
import { SESSION_MAX_AGE_S } from "@/lib/server-config";
import { config, middleware } from "./middleware";

const PAGE = "http://photos.example.test/dashboard/events?q=1";

function visit(cookie?: string) {
  return middleware(new NextRequest(PAGE, { headers: cookie ? { cookie } : {} }));
}

async function sessionCookie(now = Date.now()) {
  return `evp_session=${await createSessionToken(await testKeys(), SESSION_MAX_AGE_S, now)}`;
}

function expectLoginRedirect(res: Response) {
  expect(res.status).toBe(307);
  const location = new URL(res.headers.get("location")!);
  expect(location.pathname).toBe("/login");
  expect(location.searchParams.get("next")).toBe("/dashboard/events?q=1");
}

beforeEach(async () => {
  await stubAuthEnv();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("dashboard middleware", () => {
  it("lets a valid session through", async () => {
    const res = await visit(await sessionCookie());
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects to login without a session", async () => {
    expectLoginRedirect(await visit());
  });

  it("redirects a forged session and clears it", async () => {
    const res = await visit("evp_session=forged.token");
    expectLoginRedirect(res);
    expect(isDeletion(setCookies(res).evp_session)).toBe(true);
  });

  it("redirects an expired session", async () => {
    expectLoginRedirect(await visit(await sessionCookie(Date.now() - (SESSION_MAX_AGE_S + 60) * 1000)));
  });

  it("does not accept the legacy raw API key cookie, and deletes it", async () => {
    const res = await visit(`evp_admin=${TEST_ADMIN_API_KEY}`);
    expectLoginRedirect(res);
    expect(isDeletion(setCookies(res).evp_admin)).toBe(true);
  });

  it("deletes a leftover legacy cookie for signed-in users too", async () => {
    const res = await visit(`${await sessionCookie()}; evp_admin=${TEST_ADMIN_API_KEY}`);
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(isDeletion(setCookies(res).evp_admin)).toBe(true);
  });

  it("fails closed when sign-in is not configured", async () => {
    const cookie = await sessionCookie();
    vi.stubEnv("SESSION_SECRET", "");
    expectLoginRedirect(await visit(cookie));
  });

  it("guards only dashboard pages, on the Node.js runtime", () => {
    expect(config).toEqual({ matcher: ["/dashboard/:path*"], runtime: "nodejs" });
  });
});
