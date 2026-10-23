import { describe, expect, it } from "vitest";
import { guestPathFromScan } from "./qr-target";

describe("guestPathFromScan", () => {
  it.each([
    ["https://photos.example.com/e/abcd2345wxyz", "/e/abcd2345wxyz"],
    ["https://photos.example.com/e/abcd2345wxyz/", "/e/abcd2345wxyz"],
    ["http://localhost:3000/e/abcd2345wxyz", "/e/abcd2345wxyz"],
    ["  https://photos.example.com/e/ABCD2345WXYZ  ", "/e/abcd2345wxyz"],
    ["abcd2345wxyz", "/e/abcd2345wxyz"],
    ["ABCD 2345 WXYZ", "/e/abcd2345wxyz"],
  ])("accepts %j", (input, path) => {
    expect(guestPathFromScan(input)).toBe(path);
  });

  it.each([
    "",
    "   ",
    "https://photos.example.com/dashboard",
    "https://photos.example.com/e/",
    "https://photos.example.com/e/abc/../../dashboard",
    "https://photos.example.com/e/abcd2345wxyz/extra",
    "https://photos.example.com/e/%2F%2Fevil.example",
    "javascript:alert(1)//e/abcd2345wxyz",
    "data:text/html,/e/abcd2345wxyz",
    "ftp://photos.example.com/e/abcd2345wxyz",
    "WIFI:S:guest;T:WPA;P:secret;;",
    "abc",
    "a".repeat(33),
  ])("rejects %j", (input) => {
    expect(guestPathFromScan(input)).toBeNull();
  });

  it("only ever returns a path on this site", () => {
    expect(guestPathFromScan("https://evil.example/e/abcd2345wxyz")).toBe("/e/abcd2345wxyz");
  });
});
