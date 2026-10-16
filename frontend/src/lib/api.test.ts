import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, publicApi } from "./api";

/** Minimal XMLHttpRequest stand-in: records what was sent and answers with a canned response. */
function fakeXhr(status: number, response: unknown) {
  const sent: { url?: string; body?: FormData } = {};
  class FakeXHR {
    status = status;
    response = response;
    responseType = "";
    timeout = 0;
    upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ontimeout: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open(_method: string, url: string) { sent.url = url; }
    setRequestHeader() {}
    getResponseHeader() { return null; }
    abort() {}
    send(body: FormData) {
      sent.body = body;
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
  return sent;
}

const EMPTY_MATCH = { match_token: null, total: 0, items: [], next_cursor: null, threshold: 0.4, timings: null };
const selfie = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

afterEach(() => vi.unstubAllGlobals());

describe("publicApi.match consent", () => {
  it("sends consent=true when the checkbox is checked", async () => {
    const sent = fakeXhr(200, EMPTY_MATCH);
    await expect(publicApi.match("abc123", selfie, true)).resolves.toEqual(EMPTY_MATCH);
    expect(sent.body?.get("consent")).toBe("true");
    expect(sent.body?.get("selfie")).toBeInstanceOf(Blob);
    expect(sent.url).toContain("/api/v1/public/events/abc123/match");
  });

  it("sends consent=false when the checkbox is unchecked", async () => {
    const sent = fakeXhr(400, { error: { code: "consent_required", message: "Please confirm consent.", details: null } });
    const err = await publicApi.match("abc123", selfie, false).catch((e: unknown) => e);
    expect(sent.body?.get("consent")).toBe("false");
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "consent_required" });
  });
});
