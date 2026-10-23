// Turns whatever a QR code (or a typed code) contains into this site's guest page path.
//
// Only the event code is taken from the input; the result is always a path on this site (/e/<code>), so a
// scanned QR can never navigate the guest to another website.

const CODE = /^[a-z0-9]{4,32}$/; // guest codes are lowercase letters and digits (12 characters today)

/** Returns "/e/<code>" for a guest link or a bare guest code, or null if the input is neither. */
export function guestPathFromScan(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const bare = text.replace(/\s+/g, "").toLowerCase();
  if (CODE.test(bare)) return `/e/${bare}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const m = /^\/e\/([^/]+)\/?$/.exec(url.pathname);
  if (!m) return null;
  const code = decodeURIComponent(m[1]).toLowerCase();
  return CODE.test(code) ? `/e/${code}` : null;
}
