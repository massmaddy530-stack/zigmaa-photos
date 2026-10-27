// Forwarding-header policy for server.mjs. Only proxies on this machine may pass forwarding headers through: the
// HTTPS entry point, or a browser on this PC. For every other peer they are replaced by what the socket shows, so
// a guest's phone can never choose the address it is rate-limited under.
//
// The trusted set matches uvicorn's default FORWARDED_ALLOW_IPS ("127.0.0.1,::1"). The backend only accepts
// X-Forwarded-For from those addresses (where Next.js proxies from) and takes the rightmost untrusted entry as
// the client, which after this policy is always the real peer.

export const TRUSTED_PROXIES = new Set(["127.0.0.1", "::1"]);

// Client-identity and forwarding headers a guest could send. Nothing downstream reads the vendor ones today; they
// are removed anyway so no future reader can be fooled by them.
const FORWARDING_HEADERS = [
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "forwarded",
  "x-real-ip", "true-client-ip", "cf-connecting-ip", "x-client-ip",
];

/** Socket address in the form uvicorn compares: IPv4-mapped IPv6 ("::ffff:192.168.1.5") becomes plain IPv4. */
export function normalizeAddress(address) {
  if (!address) return "unknown";
  const a = String(address).trim().toLowerCase();
  return a.startsWith("::ffff:") && a.includes(".") ? a.slice("::ffff:".length) : a;
}

/** Rewrites Node request headers in place for a request that arrived from `remoteAddress`. */
export function applyForwarding(headers, remoteAddress) {
  const peer = normalizeAddress(remoteAddress);
  if (TRUSTED_PROXIES.has(peer)) {
    // A local proxy: keep what it reported and record this hop, as proxies do.
    const prior = headers["x-forwarded-for"];
    headers["x-forwarded-for"] = prior ? `${prior}, ${peer}` : peer;
    return headers;
  }
  // Anyone else: discard client-supplied forwarding metadata. Next.js re-derives host/proto/port from the request.
  for (const h of FORWARDING_HEADERS) delete headers[h];
  headers["x-forwarded-for"] = peer;
  return headers;
}

/**
 * Applies the same policy to WebSocket upgrade requests, which Node never passes to the "request" listener. Next.js
 * proxies upgrades for rewritten paths (/api/v1/public, /media) with the request's headers, through an "upgrade"
 * listener it adds to the server on the first HTTP request. Call this right after creating the server: listeners
 * run in the order they were added, so this one always rewrites the headers before Next.js reads them.
 */
export function sanitizeUpgrades(server) {
  server.on("upgrade", (req, socket) => {
    applyForwarding(req.headers, req.socket.remoteAddress);
    // Until Next.js has added its listener, nothing would answer this upgrade; close it rather than leave it open.
    if (server.listenerCount("upgrade") === 1) socket.destroy();
  });
  return server;
}
