/**
 * The public origin the Next.js proxy routes hand to the backend (A-189).
 *
 * SERVER-ONLY — used by the route handlers under app/api/v1, never by the
 * browser bundle.
 *
 * The proxy's own `fetch` sets `Host` to the backend's address
 * (`backend:3000`), so a backend that built a link from `Host` — a
 * certificate's verification URL, an attachment's signed URL — pointed at a
 * container name no browser can reach. The proxy therefore tells the backend
 * which origin the request really arrived on, in the two headers Express reads
 * from a trusted hop (`req.host`, `req.protocol` under the backend's one-hop
 * `trust proxy`, ADR-050):
 *
 *  - `X-Forwarded-Host` — the `Host` of the request that reached Next. Behind
 *    nginx that is `$host` (deploy/compose/nginx/*.conf). A browser-sent
 *    `X-Forwarded-Host` is never forwarded: nginx does not set one, so any
 *    that reaches Next came from the client.
 *  - `X-Forwarded-Proto` — the value nginx wrote (`$scheme`, or
 *    `$client_proto` behind the tunnel), when it is `http` or `https`;
 *    otherwise the scheme Next itself was reached on.
 *
 * In production the backend does not rely on these: it uses its configured
 * public origin (PUBLIC_BASE_URL / HOST_URL) and refuses to guess without one
 * (backend utils/publicBaseUrl.util.js). They make development — and any
 * deployment that has not set the origin — produce reachable links.
 */

/** The forwarded-origin headers a browser could send; each is replaced, never copied. */
export const FORWARDED_ORIGIN_HEADERS: readonly string[] = [
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
];

/**
 * The forwarded-origin headers to send to the backend.
 *
 * @param headers - the incoming request's headers
 * @param ownProtocol - the scheme Next was reached on (`req.nextUrl.protocol`, e.g. "https:")
 * @returns `{ "X-Forwarded-Host"?: host, "X-Forwarded-Proto": proto }`
 */
export function forwardedOriginHeaders(
  headers: Headers,
  ownProtocol: string
): Record<string, string> {
  const out: Record<string, string> = {};
  const host = headers.get("host");
  if (host) {
    out["X-Forwarded-Host"] = host;
  }
  const upstream = headers.get("x-forwarded-proto")?.split(",").pop()?.trim().toLowerCase();
  out["X-Forwarded-Proto"] =
    upstream === "http" || upstream === "https" ? upstream : ownProtocol.replace(/:$/, "");
  return out;
}
