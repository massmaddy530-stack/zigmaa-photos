import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as otpSendPOST } from "@/app/api/auth/otp/send/route";
import { POST as otpVerifyPOST } from "@/app/api/auth/otp/verify/route";
import { GET as downloadGET } from "@/app/api/download/route";
import { GET as sessionGET } from "@/app/api/session/route";
import { POST as watermarkPOST } from "@/app/api/watermark/route";
import { SESSION_COOKIE } from "@/lib/server-config";
import { stubAuthEnv } from "@/lib/auth/test-helpers";

beforeEach(async () => {
  await stubAuthEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Security hardening regression tests", () => {
  it("GET /api/download blocks SSRF to cloud metadata, private IPs, and untrusted hosts", async () => {
    const blockedUrls = [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:5432/admin",
      "http://10.0.0.5/internal.png",
      "http://192.168.1.1/router.png",
      "https://evil.example.com/photo.jpg",
    ];
    for (const target of blockedUrls) {
      const req = new NextRequest(`http://localhost:3000/api/download?url=${encodeURIComponent(target)}`);
      const res = await downloadGET(req);
      expect(res.status).toBe(403);
    }
  });

  it("POST /api/watermark rejects unauthenticated requests with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/watermark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "ev-1", config: { sizePercent: 20 } }),
    });
    const res = await watermarkPOST(req);
    expect(res.status).toBe(401);
  });

  it("GET /api/session rejects forged or invalid session cookies", async () => {
    const req = new NextRequest("http://localhost:3000/api/session", {
      headers: { cookie: `${SESSION_COOKIE}=forged.invalid.token` },
    });
    const res = await sessionGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.user).toBeNull();
  });

  it("POST /api/auth/otp/send blocks cross-site requests missing the CSRF header", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/otp/send", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      body: JSON.stringify({ email: "victim@example.com" }),
    });
    const res = await otpSendPOST(req);
    expect(res.status).toBe(403);
  });

  it("POST /api/auth/otp/verify blocks cross-site requests missing the CSRF header", async () => {
    const req = new NextRequest("http://localhost:3000/api/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example.com" },
      body: JSON.stringify({ email: "victim@example.com", otp: "123456" }),
    });
    const res = await otpVerifyPOST(req);
    expect(res.status).toBe(403);
  });
});
