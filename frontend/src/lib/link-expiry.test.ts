import { describe, expect, it } from "vitest";
import { expiryState, fromLocalInput, toLocalInput } from "./link-expiry";

describe("link expiry helpers", () => {
  const now = new Date("2026-10-22T12:00:00Z");

  it("classifies expiry", () => {
    expect(expiryState(null, now)).toBe("none");
    expect(expiryState(undefined, now)).toBe("none");
    expect(expiryState("garbage", now)).toBe("none");
    expect(expiryState("2026-10-22T12:00:01Z", now)).toBe("active");
    expect(expiryState("2026-10-22T12:00:00Z", now)).toBe("expired");
    expect(expiryState("2026-10-21T00:00:00+05:30", now)).toBe("expired");
  });

  it("round-trips through the datetime-local format in local time", () => {
    const iso = new Date(2026, 11, 31, 18, 30).toISOString(); // local 31 Dec 18:30
    expect(toLocalInput(iso)).toBe("2026-12-31T18:30");
    expect(fromLocalInput("2026-12-31T18:30")).toBe(iso);
  });

  it("handles empty and invalid input", () => {
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput("nope")).toBe("");
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("not-a-date")).toBeNull();
  });
});
