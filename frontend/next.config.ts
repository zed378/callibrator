import type { NextConfig } from "next";

const isProd =
  process.env.NODE_ENV === "production" || process.env.NEXT_COMPILE === "true";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";

const nextConfig: NextConfig = {
  // Serve backend-stored uploads (CMS images, attachments) same-origin, so the
  // host-relative /uploads URLs saved in content work in both dev and prod.
  // Unlike /api/v1 (see note below), these are static files with no auth
  // injection, so a rewrite is safe here.
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: `${API_BASE_URL}/uploads/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "http" as const,
        hostname: "localhost",
        port: "5000",
        pathname: "/uploads/**",
      },
    ],
  },
  ...(isProd
    ? {
        output: "standalone",
        // The bun-compile adapter is OPT-IN via NEXT_COMPILE=true.
        //
        // It post-processes the build into a single binary and needs trace
        // artefacts a plain Node build does not emit, so leaving it always-on
        // breaks `next build` with:
        //   ENOENT: no such file or directory, open .next/next-server.js.nft.json
        //
        // Standalone output is what the Docker image consumes, so the two are
        // kept independent: the image builds without the adapter, and the
        // binary path still works when explicitly requested.
        ...(process.env.NEXT_COMPILE === "true"
          ? { adapterPath: import.meta.resolve("next-bun-compile") }
          : {}),
      }
    : {}),
  // Explicitly set root to silence multi-lockfile warning
  turbopack: {
    root: process.cwd(),
  },
  cacheComponents: true,
  // NOTE: API requests are proxied by the app-router route handler at
  // src/app/api/v1/[...path]/route.ts, which injects the Authorization header
  // and X-Tenant-ID from httpOnly cookies and strips backend Set-Cookie
  // headers. A next.config `rewrites()` for /api/v1/* is intentionally OMITTED
  // — it would shadow that handler and bypass the auth/cookie injection.
};

export default nextConfig;
