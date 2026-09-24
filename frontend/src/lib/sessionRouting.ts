import type { NextRequest } from "next/server";
import { AUTH_REFRESH_COOKIE, AUTH_TOKEN_COOKIE } from "@/lib/authCookies";

// Helpers for src/proxy.ts, kept out of it so the proxy file exports only
// what Next reads (proxy, config).

/**
 * The `exp` claim of a JWT, in seconds, or null when the value does not look
 * like a JWT with one. A ROUTING hint only — the signature is not (and cannot
 * be, here) verified; the backend is the authority.
 */
export const jwtExpiry = (token: string): number | null => {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp : null;
  } catch {
    return null;
  }
};

/**
 * Whether the request carries a session worth sending to a protected page:
 * an access token that has not visibly expired, or — when it has — a refresh
 * token the API client can renew it with (F-05).
 */
export const hasUsableSession = (
  request: NextRequest,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean => {
  const token = request.cookies.get(AUTH_TOKEN_COOKIE)?.value;
  if (!token) return false;
  const exp = jwtExpiry(token);
  if (exp === null || exp > nowSeconds) return true;
  return Boolean(request.cookies.get(AUTH_REFRESH_COOKIE)?.value);
};

