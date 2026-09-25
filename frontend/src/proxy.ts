import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_LOGGED_IN_COOKIE,
  AUTH_SESSION_COOKIE,
  AUTH_TOKEN_COOKIE,
} from "@/lib/authCookies";
import { hasUsableSession } from "@/lib/sessionRouting";
import {
  NONCE_HEADER,
  buildContentSecurityPolicy,
  generateNonce,
} from "@/lib/securityHeaders";

/**
 * Route guard (Next 16 "proxy", formerly middleware). F-08: this is the ONLY
 * proxy file — a second, divergent copy at the project root was deleted. With
 * a `src/` directory Next resolves the proxy from `src/`, so the root copy was
 * never the one running.
 *
 * It decides where a page navigation goes, and it mints the page's CSP nonce
 * (P7-08, ADR-071). It authorises nothing: the backend verifies the token on
 * every API call.
 */

const CSP_HEADER = "Content-Security-Policy";

/** F-05/F-08: a dead session's cookies go, so /login is not bounced back. */
const clearSession = (response: NextResponse): NextResponse => {
  for (const name of [
    AUTH_TOKEN_COOKIE,
    AUTH_SESSION_COOKIE,
    AUTH_LOGGED_IN_COOKIE,
    "x_tenant_id",
    "impersonating",
  ]) {
    response.cookies.delete(name);
  }
  return response;
};

/**
 * P7-08: let the request through carrying this request's CSP.
 *
 * The policy goes on the REQUEST as well as the response: Next extracts the
 * nonce from the request's Content-Security-Policy header while rendering and
 * stamps it on its own scripts. `x-nonce` hands the same value to Server
 * Components (the root layout's theme script).
 */
const pass = (request: NextRequest, nonce: string, csp: string): NextResponse => {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(CSP_HEADER, csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(CSP_HEADER, csp);
  return response;
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasToken = Boolean(request.cookies.get(AUTH_TOKEN_COOKIE)?.value);
  const usable = hasUsableSession(request);

  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isAuthRoute = pathname === "/login" || pathname === "/register";

  if (isDashboardRoute && !usable) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    const response = NextResponse.redirect(loginUrl);
    // An expired, unrenewable token is cleared on the way out.
    return hasToken ? clearSession(response) : response;
  }

  if (isAuthRoute && usable) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    host: request.headers.get("host"),
    // The value lib/socket.ts connects to in the browser (constants/index.ts
    // falls back the same way) — not BACKEND_INTERNAL_URL, which is the
    // server-side hop the browser never sees.
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:5000",
  });

  if (isAuthRoute && hasToken) {
    // F-05: a dead token on /login used to send the user back to /dashboard,
    // where the API 401'd and sent them to /login again. Stay here, and clear it.
    return clearSession(pass(request, nonce, csp));
  }

  return pass(request, nonce, csp);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - uploads/public (backend images, relayed with the backend's own
     *   sandbox CSP — a page CSP on top would be a second, redundant policy)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|uploads/public/).*)",
  ],
};
