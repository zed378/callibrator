/**
 * The session cookies the Next server owns — one definition for the route
 * handlers that write them (login, sso-session, refresh) and clear them
 * (logout, logout-all, refresh on failure).
 *
 * Server-only in effect: the options are plain data, but only route handlers
 * (via `next/headers` cookies()) may write httpOnly cookies.
 */

/** The access token (JWT). httpOnly; the proxy sends it as `Authorization`. */
export const AUTH_TOKEN_COOKIE = "auth_token";
/** The backend session id. httpOnly; the proxy sends it as `X-Session`. */
export const AUTH_SESSION_COOKIE = "auth_session";
/**
 * F-05: the opaque refresh token. httpOnly and scoped to the one path that
 * reads it — the browser sends it to `POST /api/v1/auth/refresh` and nowhere
 * else, and no script can read it.
 */
export const AUTH_REFRESH_COOKIE = "auth_refresh";
export const AUTH_REFRESH_PATH = "/api/v1/auth/refresh";
/** Non-httpOnly marker so client code knows a session exists. No secret. */
export const AUTH_LOGGED_IN_COOKIE = "auth_logged_in";

/**
 * F-05: why seven days, when the access token inside the cookie lives
 * `JWT_ACCESS_EXPIRED` (15m by default, backend/src/utils/jwt.util.js)?
 *
 * The cookie's lifetime is the SESSION's, not the access token's: the backend
 * opens every login session with `expiredAt = now + 7 days`
 * (auth.service.js openLoginSession) and a refresh renews that window. Inside
 * it an expired access token is renewed by `POST /api/v1/auth/refresh` from
 * `auth_refresh`, and the backend rejects an expired JWT on its own — the
 * cookie outliving the token grants nothing. Expiring the cookie with the
 * token would instead make `proxy.ts` treat a refreshable session as signed
 * out. Keep this equal to the backend session window.
 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface AuthCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
}

/** Options for the httpOnly session cookies (token and session id). */
export const sessionCookieOptions = (): AuthCookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
});

/** Options for the refresh-token cookie: httpOnly, sent only to the refresh route. */
export const refreshCookieOptions = (): AuthCookieOptions => ({
  ...sessionCookieOptions(),
  path: AUTH_REFRESH_PATH,
});

/** Options for the non-httpOnly logged-in marker. */
export const loggedInCookieOptions = (): AuthCookieOptions => ({
  ...sessionCookieOptions(),
  httpOnly: false,
});

/** The minimal cookie-jar surface these helpers need (next/headers cookies()). */
export interface CookieJar {
  set(name: string, value: string, options: AuthCookieOptions): unknown;
  delete(name: string | { name: string; path?: string }): unknown;
}

/**
 * Write a signed-in session. `refreshToken` is optional because not every
 * backend sign-in response carries one (see the F-05 note in the report).
 */
export function writeSessionCookies(
  jar: CookieJar,
  session: { token: string; sessionId?: string | null; refreshToken?: string | null },
): void {
  jar.set(AUTH_TOKEN_COOKIE, session.token, sessionCookieOptions());
  if (session.sessionId) {
    jar.set(AUTH_SESSION_COOKIE, session.sessionId, sessionCookieOptions());
  }
  if (session.refreshToken) {
    jar.set(AUTH_REFRESH_COOKIE, session.refreshToken, refreshCookieOptions());
  }
  jar.set(AUTH_LOGGED_IN_COOKIE, "true", loggedInCookieOptions());
}

/**
 * Clear every session cookie, including the tenant override and the
 * impersonation marker (F-06) — a session that ends takes its tenant context
 * with it.
 */
export function clearSessionCookies(jar: CookieJar): void {
  jar.delete(AUTH_TOKEN_COOKIE);
  jar.delete(AUTH_SESSION_COOKIE);
  jar.delete({ name: AUTH_REFRESH_COOKIE, path: AUTH_REFRESH_PATH });
  jar.delete(AUTH_LOGGED_IN_COOKIE);
  jar.delete("x_tenant_id");
  jar.delete("impersonating");
}
