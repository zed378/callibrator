import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_LOGGED_IN_COOKIE,
  AUTH_SESSION_COOKIE,
  AUTH_TOKEN_COOKIE,
} from "@/lib/authCookies";
import { hasUsableSession } from "@/lib/sessionRouting";

/**
 * Route guard (Next 16 "proxy", formerly middleware). F-08: this is the ONLY
 * proxy file — a second, divergent copy at the project root was deleted. With
 * a `src/` directory Next resolves the proxy from `src/`, so the root copy was
 * never the one running.
 *
 * It decides only where a page navigation goes. It authorises nothing: the
 * backend verifies the token on every API call.
 */

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

  if (isAuthRoute && hasToken) {
    // F-05: a dead token on /login used to send the user back to /dashboard,
    // where the API 401'd and sent them to /login again. Stay here, and clear it.
    return clearSession(NextResponse.next());
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
