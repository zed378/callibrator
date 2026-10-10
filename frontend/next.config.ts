import path from "node:path";
import type { NextConfig } from "next";
import { CAMERA_PAGES, CAMERA_PERMISSIONS_POLICY, PAGE_SECURITY_HEADERS } from "./src/lib/securityHeaders";
import { PAGE_REDIRECTS } from "./src/lib/redirects";

const isProd =
  process.env.NODE_ENV === "production" || process.env.NEXT_COMPILE === "true";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000";

const nextConfig: NextConfig = {
  // P7-08: the framework banner tells a scanner the stack for free.
  poweredByHeader: false,
  // P9-22 (ADR-097): the shared request schemas ship as TypeScript source
  // (packages/contracts). Compile them with the app, and bundle rather than
  // externalise them on the server: the standalone output has no TypeScript
  // loader, so an externalised .ts import would fail at run time.
  transpilePackages: ["@callibrator/contracts"],
  // P7-08, ADR-071: the static page security headers. The CSP is NOT here —
  // it carries a per-request nonce, so src/proxy.ts sets it. /api/ and
  // /uploads/public/ are excluded: both relay backend responses that already
  // carry helmet's headers (and, for uploads, a sandbox CSP), and repeating
  // them would send each header twice. nginx adds only HSTS.
  async headers() {
    return [
      {
        source: "/((?!api/|uploads/public/).*)",
        headers: [...PAGE_SECURITY_HEADERS],
      },
      // P22-03 (ADR-127 Am. 2): the QR-scanning page alone may use the camera.
      ...CAMERA_PAGES.map((source) => ({ source, headers: [{ key: "Permissions-Policy", value: CAMERA_PERMISSIONS_POLICY }] })),
      // P10-08 (doc 20 §10): the verification page is never indexed. The page
      // also sets robots metadata; the header covers crawlers that read only headers.
      {
        source: "/verify/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
  // P10-06 (/register → /request-access) and ADR-102 (/dashboard/warehouse →
  // /dashboard/warehouses): the list and its reasons are in src/lib/redirects.
  async redirects() {
    return PAGE_REDIRECTS;
  },
  // Serve the backend's PUBLIC upload class (avatars, tenant logos, CMS
  // images) same-origin, so the host-relative /uploads/public URLs saved in
  // content work in both dev and prod. Unlike /api/v1 (see note below), these
  // are static files with no auth injection, so a rewrite is safe here.
  // S-01 / ADR-042: ONLY /uploads/public/ — certificates and attachments are
  // no longer static files; they are gated /api/v1 routes (through the proxy).
  async rewrites() {
    return [
      {
        source: "/uploads/public/:path*",
        destination: `${API_BASE_URL}/uploads/public/:path*`,
      },
    ];
  },
  images: {
    // P10-03: the landing's product screenshots are served as AVIF where the
    // browser takes it (doc 20 §13 AC-7: hero ≤ 160 KB AVIF at 1440 w).
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "http" as const,
        hostname: "localhost",
        port: "5000",
        pathname: "/uploads/public/**",
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
  // The WORKSPACE root, not frontend/. Under the npm workspace (ADR-044) every
  // dependency — `next` included — is hoisted to <repo>/node_modules, and
  // Turbopack refuses to resolve anything outside its root: with root set to
  // frontend/ (the previous `process.cwd()`), `next build` fails with
  // "couldn't find the Next.js package (next/package.json) from the project
  // directory". Output-file tracing must use the same root, so the standalone
  // bundle is emitted as .next/standalone/frontend/server.js with the traced
  // node_modules beside it (frontend/Dockerfile copies that layout, S-29).
  outputFileTracingRoot: path.join(__dirname, ".."),
  turbopack: {
    root: path.join(__dirname, ".."),
  },
  cacheComponents: true,
  experimental: {
    // ADR-131 (P10-18): two root layouts — app/(public) and app/(app) — leave no
    // single layout to compose a 404 from; a URL no route matches renders
    // app/global-not-found.tsx (Next 16, still behind this flag).
    globalNotFound: true,
  },
  // NOTE: API requests are proxied by the app-router route handler at
  // src/app/api/v1/[...path]/route.ts, which injects the Authorization header
  // and X-Tenant-ID from httpOnly cookies and strips backend Set-Cookie
  // headers. A next.config `rewrites()` for /api/v1/* is intentionally OMITTED
  // — it would shadow that handler and bypass the auth/cookie injection.
};

export default nextConfig;
