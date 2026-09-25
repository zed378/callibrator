// src/lib/securityHeaders.ts

/**
 * The page security headers of the Next.js content origin (P7-08, ADR-071).
 *
 * The API origin has had a CSP since P7-08's first half (backend
 * csp.util.js). This origin — the one that renders user-authored
 * `posts.contentHtml` and ticket descriptions through
 * `dangerouslySetInnerHTML` — sent none. Two halves:
 *
 * - `buildContentSecurityPolicy` is called by the proxy (src/proxy.ts) once
 *   per request with a fresh nonce. Next reads the nonce back out of the
 *   REQUEST's `Content-Security-Policy` header while rendering
 *   (next/dist/server/app-render/get-script-nonce-from-header.js) and puts it
 *   on its own scripts, so the header value is also the channel to Next.
 * - `PAGE_SECURITY_HEADERS` are static; next.config.ts sets them.
 *
 * This file is imported by next.config.ts, so it must stay free of `@/`
 * imports and of anything that is not plain TypeScript.
 */

/** The request header the proxy hands the nonce to Server Components in. */
export const NONCE_HEADER = "x-nonce";

/** 128 bits from the platform CSPRNG, base64 — the form a CSP nonce takes. */
export const generateNonce = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

export interface CspOptions {
  /** A fresh value per request, from `generateNonce`. */
  nonce: string;
  /** `next dev` — React needs `eval` for its error stacks, and HMR injects styles. */
  isDev: boolean;
  /** The request's Host header: the origin the Socket.IO websocket opens on. */
  host?: string | null;
  /**
   * NEXT_PUBLIC_API_BASE_URL — the origin lib/socket.ts connects to and the
   * certificate page frames. The same origin in production (nginx routes
   * /socket.io/ and /api/); a separate one in development.
   */
  apiBaseUrl?: string | null;
}

// A hostname or IPv4 with an optional port, or a bracketed IPv6. The Host
// header is client-supplied: anything else is left out rather than reflected
// into a security header.
const HOST_RE = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

const sameHostSockets = (host?: string | null): string[] =>
  // Both schemes, deliberately. On an https page the browser refuses ws:// as
  // mixed content, so listing it widens nothing — and choosing one from
  // X-Forwarded-Proto would make the websocket depend on a proxy header whose
  // absence silently downgrades Socket.IO to long-polling.
  host && HOST_RE.test(host) ? [`ws://${host}`, `wss://${host}`] : [];

/** The API origin and its websocket twin, or nothing if it is not an http(s) URL. */
const apiOrigins = (apiBaseUrl?: string | null): { http: string[]; ws: string[] } => {
  if (!apiBaseUrl) return { http: [], ws: [] };
  try {
    const url = new URL(apiBaseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { http: [], ws: [] };
    const wsScheme = url.protocol === "https:" ? "wss:" : "ws:";
    return { http: [url.origin], ws: [`${wsScheme}//${url.host}`] };
  } catch {
    return { http: [], ws: [] };
  }
};

const unique = (sources: string[]): string[] => [...new Set(sources)];

/**
 * The page CSP, as one header value. Nonce-based with `'strict-dynamic'`:
 * a script runs only if it carries this request's nonce or was loaded by one
 * that did — so markup injected through `contentHtml` cannot run script, with
 * or without a `src`.
 */
export const buildContentSecurityPolicy = ({
  nonce,
  isDev,
  host,
  apiBaseUrl,
}: CspOptions): string => {
  const api = apiOrigins(apiBaseUrl);
  const nonceSource = `'nonce-${nonce}'`;

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    // 'self' is ignored by CSP3 browsers once 'strict-dynamic' is present; it
    // is the fallback for a CSP2 browser, which ignores 'strict-dynamic'.
    ["script-src", ["'self'", nonceSource, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])]],
    ["script-src-attr", ["'none'"]],
    // Styles, ADR-071: <style> elements need the nonce; style ATTRIBUTES stay
    // inline. React server-renders every `style={{…}}` prop (39 of them, plus
    // Motion's initial states) as an attribute, and hydration does not re-apply
    // an attribute the browser dropped. `style-src` is the fallback for a
    // browser without the -elem/-attr split.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["style-src-elem", ["'self'", ...(isDev ? ["'unsafe-inline'"] : [nonceSource])]],
    ["style-src-attr", ["'unsafe-inline'"]],
    // data: — TipTap is configured with allowBase64, and next/image blur
    // placeholders are data: URIs. blob: — the avatar upload preview
    // (URL.createObjectURL). The API origin — absolute /uploads/public URLs
    // the backend builds from its HOST_URL.
    ["img-src", unique(["'self'", "data:", "blob:", ...api.http])],
    // next/font self-hosts every face; nothing is fetched from a font CDN.
    ["font-src", ["'self'"]],
    // The /api proxy is same-origin; the websocket needs its scheme named.
    ["connect-src", unique(["'self'", ...sameHostSockets(host), ...api.http, ...api.ws])],
    // The certificate verification page frames the signed PDF.
    ["frame-src", unique(["'self'", ...api.http])],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  return directives.map(([name, sources]) => `${name} ${sources.join(" ")}`).join("; ");
};

/**
 * The static page headers. nginx adds only Strict-Transport-Security
 * (deploy/compose/nginx/*.conf), so none of these is duplicated there.
 */
export const PAGE_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // The browser default, made explicit: other origins see the origin, never
  // the path (/verify/<certificate number>, /dashboard/tickets/<id>).
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // geolocation=(self): dashboard/network-security reads the position.
  // WebAuthn and clipboard-write keep their same-origin defaults.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()",
  },
];
