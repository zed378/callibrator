/**
 * A-310: the headers every server-side call from Next.js to the backend
 * carries, in ONE place.
 *
 * SERVER-ONLY — used by the route handlers under app/api/v1 and by
 * lib/content.api.ts, never by the browser bundle.
 *
 * With the backend's `FORCE_HTTPS=true` (the Helm default and the compose
 * prod/staging overlays) every request that is neither `req.secure` nor marked
 * `X-Forwarded-Proto: https` is answered with a 301 to `https://<Host>/…`
 * (backend routes/internal/health.route.js#forceHttps). The internal hop
 * Next → backend is plain HTTP, and the dedicated auth routes (login, refresh,
 * sso-session, logout, logout-all) sent no `X-Forwarded-Proto`: the backend
 * redirected sign-in to `https://backend:3000`, the fetch failed, and the
 * browser got a 500. The catch-all proxy already forwarded the scheme
 * (A-189, lib/forwardedOrigin.ts); these routes now use the same function.
 *
 * Trust: the value is the one nginx wrote (`$scheme`, overwriting any client
 * value, deploy/compose/nginx/*.conf) when it is `http`/`https`, else the
 * scheme Next was reached on. It says what the ORIGINAL request was, so the
 * backend redirects a genuinely plain-HTTP browser request and not the internal
 * hop. A client cannot use it to skip the redirect: the frontend is reachable
 * only through nginx (same deployment property as the client address, A-16).
 */
import { clientIpHeader } from "./clientIp";
import { forwardedOriginHeaders } from "./forwardedOrigin";

/** The subset of a Next request the headers are computed from. */
export interface IncomingRequestLike {
  headers: Headers;
  nextUrl: { protocol: string };
}

/** Client address + forwarded origin (host, scheme) for a call made on behalf of a request. */
export function backendForwardHeaders(req: IncomingRequestLike): Record<string, string> {
  return {
    ...clientIpHeader(req.headers),
    ...forwardedOriginHeaders(req.headers, req.nextUrl.protocol),
  };
}

/**
 * For a server-side call with no incoming request (cached public content):
 * the scheme of the configured public site, so a FORCE_HTTPS backend serves
 * rather than redirects. `http` when no site URL is configured (development).
 */
export function configuredForwardedProto(siteUrl = process.env.NEXT_PUBLIC_SITE_URL): Record<string, string> {
  try {
    const proto = siteUrl ? new URL(siteUrl).protocol.replace(/:$/, "") : "http";
    return { "X-Forwarded-Proto": proto === "https" ? "https" : "http" };
  } catch {
    return { "X-Forwarded-Proto": "http" };
  }
}
