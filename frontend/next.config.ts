import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  // Camera is needed for selfie capture on our own origin only.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

// Backend address as seen from this server (same resolution as lib/server-config.ts). Guest API calls and
// signed media links go through this origin, so phones on the LAN never need to reach the backend directly.
const backend = (process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000")
  .replace(/\/$/, "");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Selfie matching can exceed the 30 s default on a cold start (model loading).
    proxyTimeout: 120_000,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      { source: "/api/v1/public/:path*", destination: `${backend}/api/v1/public/:path*` },
      { source: "/media/:path*", destination: `${backend}/media/:path*` },
      // No /health rewrite: the dashboard reads health through the signed-in /api/admin/health route.
    ];
  },
};

export default nextConfig;
