import { createServer, request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { applyForwarding, normalizeAddress, sanitizeUpgrades, TRUSTED_PROXIES } from "./forwarded-for.mjs";

const VENDOR_SPOOF = { "x-real-ip": "203.0.113.1", "true-client-ip": "203.0.113.2", "cf-connecting-ip": "203.0.113.3",
  "x-client-ip": "203.0.113.4" };

/** Mirrors uvicorn's choice (proxy_headers.py get_trusted_client_address): rightmost X-Forwarded-For entry that is
 *  not a trusted proxy, applied because Next.js connects to the backend from 127.0.0.1. */
function backendIdentity(xff) {
  const hosts = xff.split(",").map((h) => h.trim());
  for (const h of [...hosts].reverse()) if (!TRUSTED_PROXIES.has(h)) return h;
  return hosts[0];
}

describe("applyForwarding", () => {
  it("replaces a LAN client's forwarding headers with its socket address", () => {
    const h = applyForwarding({ "x-forwarded-for": "203.0.113.9", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https",
      "x-forwarded-port": "443", forwarded: "for=1.2.3.4", host: "192.168.1.11:3000" }, "::ffff:192.168.1.50");
    expect(h).toEqual({ "x-forwarded-for": "192.168.1.50", host: "192.168.1.11:3000" });
  });

  it("removes X-Real-IP, True-Client-IP, CF-Connecting-IP and X-Client-IP from untrusted requests", () => {
    const h = applyForwarding({ ...VENDOR_SPOOF, host: "192.168.1.11:3000" }, "192.168.1.53");
    expect(h).toEqual({ "x-forwarded-for": "192.168.1.53", host: "192.168.1.11:3000" });
  });

  it("sets the socket address when a LAN client sent no header", () => {
    expect(applyForwarding({}, "192.168.1.51")["x-forwarded-for"]).toBe("192.168.1.51");
  });

  it("appends its own hop for a local proxy and keeps what that proxy reported", () => {
    const h = applyForwarding({ "x-forwarded-for": "192.168.1.52", "x-forwarded-proto": "https" }, "127.0.0.1");
    expect(h).toEqual({ "x-forwarded-for": "192.168.1.52, 127.0.0.1", "x-forwarded-proto": "https" });
    expect(applyForwarding({}, "::1")["x-forwarded-for"]).toBe("::1");
  });

  it("treats IPv4-mapped loopback as the trusted local proxy", () => {
    const h = applyForwarding({ "x-forwarded-for": "192.168.1.54" }, "::ffff:127.0.0.1");
    expect(h["x-forwarded-for"]).toBe("192.168.1.54, 127.0.0.1");
  });

  it("treats other loopback addresses and IPv6 LAN addresses as untrusted", () => {
    expect(applyForwarding({ "x-forwarded-for": "1.1.1.1" }, "127.0.0.2")["x-forwarded-for"]).toBe("127.0.0.2");
    expect(applyForwarding({ "x-forwarded-for": "1.1.1.1" }, "::ffff:127.0.0.2")["x-forwarded-for"]).toBe("127.0.0.2");
    expect(applyForwarding({ "x-forwarded-for": "1.1.1.1" }, "fe80::1")["x-forwarded-for"]).toBe("fe80::1");
  });

  it("treats a missing peer address as untrusted and still strips client headers", () => {
    for (const missing of [undefined, null, ""]) {
      const h = applyForwarding({ "x-forwarded-for": "1.1.1.1", ...VENDOR_SPOOF, forwarded: "for=1.1.1.1" }, missing);
      expect(h).toEqual({ "x-forwarded-for": "unknown" });
    }
  });

  it("never lets spoofed headers from a guest change the identity the backend rate-limits on", () => {
    const spoofs = [
      { "x-forwarded-for": "203.0.113.7" },
      { "x-forwarded-for": "127.0.0.1" }, // pretending to be the local proxy
      { "x-forwarded-for": "203.0.113.7, 127.0.0.1" },
      { "x-forwarded-for": "203.0.113.7,   ::1, 127.0.0.1" },
      { "x-forwarded-for": "" },
      { forwarded: "for=203.0.113.7", ...VENDOR_SPOOF },
    ];
    for (const peer of ["192.168.1.60", "::ffff:192.168.1.61", "127.0.0.2"]) {
      for (const spoof of spoofs) {
        const h = applyForwarding({ ...spoof }, peer);
        expect(backendIdentity(h["x-forwarded-for"])).toBe(normalizeAddress(peer));
      }
    }
  });

  it("keeps the phone's address for requests from the HTTPS entry point", () => {
    // https_proxy.mjs replaces all client forwarding headers with X-Forwarded-For: <phone>, then connects from 127.0.0.1.
    const h = applyForwarding({ "x-forwarded-for": "192.168.1.62" }, "127.0.0.1");
    expect(backendIdentity(h["x-forwarded-for"])).toBe("192.168.1.62");
  });
});

describe("normalizeAddress", () => {
  it("unwraps IPv4-mapped IPv6 and handles a missing address", () => {
    expect(normalizeAddress("::FFFF:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeAddress("::1")).toBe("::1");
    expect(normalizeAddress(undefined)).toBe("unknown");
  });
});

describe("sanitizeUpgrades (real HTTP server on 127.0.0.1)", () => {
  let server;
  afterEach(() => new Promise((resolve) => (server ? server.close(() => resolve()) : resolve())));

  function listen(s) {
    return new Promise((resolve) => s.listen(0, "127.0.0.1", () => resolve(s.address().port)));
  }

  /** Sends a WebSocket-style upgrade request from `localAddress` and reports how the server dealt with it. */
  function upgradeFrom(port, localAddress, headers) {
    return new Promise((resolve) => {
      const req = request({ host: "127.0.0.1", port, localAddress, headers: { Connection: "Upgrade", Upgrade: "websocket", ...headers } });
      const timer = setTimeout(() => { req.destroy(); resolve("hung"); }, 3000);
      req.on("upgrade", (res, socket) => { clearTimeout(timer); socket.destroy(); resolve(`upgraded ${res.statusCode}`); });
      req.on("response", (res) => { clearTimeout(timer); res.resume(); resolve(`http ${res.statusCode}`); });
      req.on("error", () => { clearTimeout(timer); resolve("closed"); });
      req.end();
    });
  }

  const SPOOF = { "x-forwarded-for": "203.0.113.99", forwarded: "for=203.0.113.97", ...VENDOR_SPOOF };

  it("rewrites upgrade headers before a listener added later (as Next.js does) reads them", async () => {
    server = sanitizeUpgrades(createServer());
    let seen;
    server.on("upgrade", (req, socket) => { // stands in for Next.js's upgrade proxy
      seen = { ...req.headers };
      socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    });
    const port = await listen(server);
    expect(await upgradeFrom(port, "127.0.0.2", SPOOF)).toBe("upgraded 101");
    expect(seen["x-forwarded-for"]).toBe("127.0.0.2");
    for (const h of ["forwarded", "x-real-ip", "true-client-ip", "cf-connecting-ip", "x-client-ip"]) expect(seen[h]).toBeUndefined();
  });

  it("appends the hop for an upgrade from the local proxy", async () => {
    server = sanitizeUpgrades(createServer());
    let seen;
    server.on("upgrade", (req, socket) => {
      seen = req.headers["x-forwarded-for"];
      socket.end("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    });
    const port = await listen(server);
    await upgradeFrom(port, "127.0.0.1", { "x-forwarded-for": "192.168.1.63" });
    expect(seen).toBe("192.168.1.63, 127.0.0.1");
  });

  it("closes an upgrade nobody else handles instead of leaving it open", async () => {
    server = sanitizeUpgrades(createServer());
    const port = await listen(server);
    expect(await upgradeFrom(port, "127.0.0.2", SPOOF)).toBe("closed");
  });

  it("leaves ordinary requests to the request listener", async () => {
    server = sanitizeUpgrades(createServer((req, res) => res.end(req.headers["x-forwarded-for"] ?? "none")));
    const port = await listen(server);
    const body = await new Promise((resolve) => request({ host: "127.0.0.1", port, localAddress: "127.0.0.2" }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(d));
    }).end());
    expect(body).toBe("none"); // the HTTP path is applied by server.mjs's request listener, not by sanitizeUpgrades
  });
});
