// Application constants

export const APP_NAME = "Hospital Device Callibrator";
export const APP_VERSION = "1.0.0";

// API Configuration
// This one value is read from TWO places with DIFFERENT reachability needs:
//
//   - server-side, by the proxy route handlers in app/api/v1/** (which set the
//     httpOnly auth cookie and inject Authorization on every later call)
//   - client-side, by lib/socket.ts, which opens the Socket.IO connection
//     straight from the browser
//
// Behind a reverse proxy those are not the same URL. The server-side hop must
// go DIRECTLY to the backend container, or it re-enters the proxy that called
// it and loops. The browser cannot resolve that internal name and needs the
// public origin.
//
// BACKEND_INTERNAL_URL is a server-only variable (no NEXT_PUBLIC_ prefix), so
// it is never inlined into the client bundle; the window check keeps the
// browser on the public URL.
export const API_BASE_URL =
  (typeof window === "undefined"
    ? process.env.BACKEND_INTERNAL_URL
    : undefined) ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:5000";
export const API_VERSION = "/api/v1";
/**
 * F-14: the client's budget must be LONGER than the server's, so the user sees
 * the backend's own 408 ("Request timeout", with its X-Request-Id) rather than
 * axios's "timeout of 30000ms exceeded" — the two used to be equal, and the
 * client's clock starts first.
 *
 *   client 35 s  >  Next proxy (should sit between; see F-14 in the audit)  >  backend 30 s
 *
 * The backend's budget is `app.use(timeout("30s"))` in backend/index.js.
 */
export const BACKEND_TIMEOUT_MS = 30000;
export const API_TIMEOUT = 35000;

// Deploy-time tenant binding. When a single-tenant frontend is deployed with
// NEXT_PUBLIC_TENANT_ID set, the login/register pages fetch that tenant's
// public branding (name/logo/color) BEFORE sign-in, and the proxy sends
// `X-Tenant-ID` on every API call. Empty = default (multi-tenant) build.
export const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID || "";
export const HAS_CONFIGURED_TENANT = TENANT_ID.length > 0;

// Auth
export const AUTH_TOKEN_KEY = "auth_token";
export const AUTH_USER_KEY = "auth_user";
export const LOGIN_REDIRECT = "/dashboard";
export const DASHBOARD_PATH = "/dashboard";

// Routes
export const PUBLIC_ROUTES = ["/", "/login"];
export const PROTECTED_ROUTES = ["/dashboard"];

// F-15: there is no static dashboard menu. The sidebar is built only from the
// menu tree the server resolved for the caller's role (stores/menuStore.ts);
// the static DASHBOARD_MENU that used to live here was the fallback when the
// role was unknown — a client-side permission array that handed every
// principal the full administrative navigation.
