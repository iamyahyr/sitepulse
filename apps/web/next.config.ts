import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // The Docker image sets NEXT_OUTPUT=standalone; `next start` needs the default output.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Trace from the monorepo root so workspace packages land in the standalone bundle.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  // Every page is per-user and reads live monitoring data, so we use classic
  // request-time rendering rather than Cache Components.
  cacheComponents: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
