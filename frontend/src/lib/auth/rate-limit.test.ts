import { describe, expect, it } from "vitest";
import { LoginLimiter } from "./rate-limit";

const WINDOW = 15 * 60_000;

describe("LoginLimiter", () => {
  it("blocks a client after 5 failures until the window passes", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("1.1.1.1", i * 1000).allowed).toBe(true);
      limiter.recordFailure("1.1.1.1", i * 1000);
    }
    const blocked = limiter.check("1.1.1.1", 5000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterS).toBe(WINDOW / 1000 - 5);
    expect(limiter.check("2.2.2.2", 5000).allowed).toBe(true);
    expect(limiter.check("1.1.1.1", WINDOW).allowed).toBe(true); // the first failure has expired
  });

  it("clears a client's failures after a successful sign-in", () => {
    const limiter = new LoginLimiter();
    for (let i = 0; i < 4; i++) limiter.recordFailure("1.1.1.1", 0);
    limiter.reset("1.1.1.1");
    limiter.recordFailure("1.1.1.1", 0);
    expect(limiter.check("1.1.1.1", 0).allowed).toBe(true);
  });

  it("blocks everyone after too many failures in total (spoofed client addresses)", () => {
    const limiter = new LoginLimiter({ globalMax: 30 });
    for (let i = 0; i < 30; i++) limiter.recordFailure(`10.0.0.${i}`, 0);
    const result = limiter.check("fresh-client", 1000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterS).toBe(WINDOW / 1000 - 1);
    expect(limiter.check("fresh-client", WINDOW).allowed).toBe(true);
  });

  it("keeps memory bounded when many clients fail", () => {
    const limiter = new LoginLimiter({ maxClients: 100, globalMax: 1e9 });
    for (let i = 0; i < 1000; i++) limiter.recordFailure(`client-${i}`, 0);
    expect((limiter as unknown as { perClient: Map<string, number[]> }).perClient.size).toBeLessThanOrEqual(100);
  });
});
