/**
 * F-09: is this request from a page on our own origin?
 *
 * SERVER-ONLY — for route handlers that write session cookies from a browser
 * POST (`/api/v1/auth/sso-session`). The one-time code the backend verifies is
 * the real control (A-60); this refuses a request no page of ours sent, so the
 * route cannot be driven from another site at all.
 *
 *  - `Sec-Fetch-Site`, when the browser sends it (every current browser does
 *    on a secure or localhost origin), must be `same-origin`. It is a
 *    forbidden header name: page script cannot set or forge it.
 *  - `Origin` must be present — browsers send it on every POST, same-origin
 *    included — and its host must equal the `Host` the request arrived with.
 *    Behind nginx that is `$host` (deploy/compose/nginx/*.conf), the public
 *    host the page was loaded from. The scheme is not compared: TLS ends at
 *    nginx or the tunnel, so Next itself is reached over http.
 *
 * A missing `Origin` is refused: a caller that sends none is not a page of ours.
 */
export function isSameOriginRequest(headers: Headers, ownHost: string): boolean {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    return false;
  }

  const origin = headers.get("origin");
  if (!origin || origin === "null") {
    return false;
  }

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const host = headers.get("host") || ownHost;
  return Boolean(host) && originHost.toLowerCase() === host.toLowerCase();
}
