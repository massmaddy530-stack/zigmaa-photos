import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const ALLOWED_URL = "https://pub-example.r2.dev/events/1/originals/a.jpg";

function downloadRequest(url: string) {
  return new NextRequest(`https://photos.example.test/api/download?url=${encodeURIComponent(url)}`);
}

function fakeResponse(init: { status: number; headers?: Record<string, string>; body?: ArrayBuffer }) {
  const headers = new Headers(init.headers ?? {});
  return {
    status: init.status,
    ok: init.status >= 200 && init.status < 300,
    statusText: String(init.status),
    headers,
    arrayBuffer: async () => init.body ?? new ArrayBuffer(0),
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/download", () => {
  it("rejects a disallowed host outright, before ever calling fetch", async () => {
    const res = await GET(downloadRequest("https://evil.example.com/x.jpg"));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("follows a redirect to another allow-listed host", async () => {
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ status: 302, headers: { location: "https://other.r2.dev/x.jpg" } }))
      .mockResolvedValueOnce(fakeResponse({ status: 200, headers: { "content-type": "image/jpeg" } }));
    const res = await GET(downloadRequest(ALLOWED_URL));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["loopback", "http://127.0.0.1:8000/secret"],
    ["cloud metadata IP", "http://169.254.169.254/latest/meta-data/"],
    ["private RFC1918 IP", "http://192.168.1.50/internal"],
    ["IPv6 loopback", "http://[::1]:6379/"],
  ])("blocks a 302 redirect to a private/internal host (%s)", async (_label, target) => {
    fetchMock.mockResolvedValueOnce(fakeResponse({ status: 302, headers: { location: target } }));
    const res = await GET(downloadRequest(ALLOWED_URL));
    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps the number of redirect hops", async () => {
    for (let i = 0; i < 7; i++) {
      fetchMock.mockResolvedValueOnce(
        fakeResponse({ status: 302, headers: { location: `https://pub-example.r2.dev/hop-${i}.jpg` } })
      );
    }
    const res = await GET(downloadRequest(ALLOWED_URL));
    expect(res.status).toBe(502);
  });
});
