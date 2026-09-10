import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that don't require authentication
const publicRoutes = ["/", "/login"];

// Routes that are under the /dashboard path
const dashboardPrefix = "/dashboard";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Check cookies OR Authorization header (localStorage is not available in Edge runtime)
  const cookieToken = request.cookies.get("auth_token")?.value;
  const authHeader = request.headers.get("authorization") || "";
  const hasBearerToken = authHeader.startsWith("Bearer ");
  const isAuthenticated = !!cookieToken || hasBearerToken;

  // Check if accessing protected dashboard route
  if (pathname.startsWith(dashboardPrefix)) {
    if (!isAuthenticated) {
      // Logout and remove session cookies
      const response = NextResponse.redirect(new URL("/login", request.url));
      response.cookies.set("auth_token", "", {
        maxAge: 0,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
      });
      // Also remove any session-related cookies
      response.cookies.set("session", "", {
        maxAge: 0,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
      });
      return response;
    }
  }

  // If authenticated user tries to access login page, redirect to dashboard
  if (pathname === "/login" && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
