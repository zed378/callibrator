import { isIP } from "node:net";

/**
 * The client address the Next.js proxy routes hand to the backend (A-16).
 *
 * SERVER-ONLY — used by the route handlers under app/api/v1, never by the
 * browser bundle.
 *
 * The chain is  [edge ->] nginx -> Next.js -> backend. nginx OVERWRITES
 * X-Forwarded-For with the one address it resolved (deploy/compose/nginx/
 * *.conf), and the backend trusts exactly one hop (TRUST_PROXY_HOPS), so it
 * reads the rightmost X-Forwarded-For entry of the request that reaches it.
 * These routes are that request. They therefore send exactly ONE entry — the
 * address nginx wrote — and never the header as it arrived, which on any
 * path that is not nginx is whatever the browser typed.
 *
 * Why the rightmost entry: every proxy that appends writes on the right, so
 * the rightmost entry is the one written by the hop nearest to us and the
 * leftmost is the one a client can choose. Behind nginx there is only one.
 *
 * What this cannot do: tell nginx from a client that reaches Next.js
 * directly — a route handler is not given the socket's peer address. That is a
 * deployment property: the frontend container publishes no port and is
 * reached only through nginx (deploy/compose). `next dev`, reached directly,
 * trusts the browser; it is not a deployment.
 */

/**
 * Every request header that names a client address. The catch-all proxy
 * copies the browser's headers, so each of these is dropped and only the
 * sanitized X-Forwarded-For is set in their place.
 */
export const CLIENT_ADDRESS_HEADERS: readonly string[] = [
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "cf-connecting-ip",
  "true-client-ip",
  "x-client-ip",
  "x-cluster-client-ip",
];

/**
 * The address nginx forwarded, or null when there is none that parses.
 *
 * @param headers - the incoming request's headers
 * @returns one IPv4/IPv6 literal, or null
 */
export function forwardedClientIp(headers: Headers): string | null {
  const raw = headers.get("x-forwarded-for");
  if (!raw) {
    return null;
  }
  const entries = raw.split(",");
  const nearest = entries[entries.length - 1].trim();
  return isIP(nearest) ? nearest : null;
}

/**
 * The address header to send to the backend: `{ "X-Forwarded-For": ip }`, or
 * nothing at all — never an empty or unparsed value, which the backend would
 * record as the client.
 *
 * @param headers - the incoming request's headers
 * @returns a header record to spread into the outgoing request
 */
export function clientIpHeader(headers: Headers): Record<string, string> {
  const ip = forwardedClientIp(headers);
  return ip ? { "X-Forwarded-For": ip } : {};
}
