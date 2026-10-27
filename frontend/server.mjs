// Front server for LAN use. Runs Next.js unchanged, but first records which device actually connected, so guest
// rate limits (backend) and the login limiter count each phone separately instead of as one shared, spoofable
// client. Next.js's own rewrite proxy forwards whatever X-Forwarded-For the client sent and never adds the real
// address; this server is the only place that can see it. Policy: forwarded-for.mjs.
//
//   node server.mjs                 development (like `next dev`)
//   node server.mjs --production    after `next build` (like `next start`)
// HOST and PORT mirror `next dev -H/-p`: unset HOST listens on all interfaces and lets Next.js use "localhost"
// for its own URLs, exactly as `next dev` does, so redirects and rewrites behave the same.
import { createServer } from "node:http";
import next from "next";
import { applyForwarding, sanitizeUpgrades } from "./forwarded-for.mjs";

const dev = !process.argv.includes("--production");
const hostname = process.env.HOST || undefined;
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer((req, res) => {
  applyForwarding(req.headers, req.socket.remoteAddress);
  void handle(req, res);
});
sanitizeUpgrades(server); // before Next.js adds its own upgrade listener (on the first request)
server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname ?? "localhost"}:${port} (${dev ? "development" : "production"})`);
});
