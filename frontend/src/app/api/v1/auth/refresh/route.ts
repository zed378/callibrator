import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";
import { clientIpHeader } from "@/lib/clientIp";
import {
  AUTH_REFRESH_COOKIE,
  AUTH_SESSION_COOKIE,
  clearSessionCookies,
  writeSessionCookies,
} from "@/lib/authCookies";

/**
 * F-05 — silent session refresh, owned end to end by the Next server.
 *
 * The browser never holds the refresh token: it is an httpOnly cookie scoped
 * to this path (lib/authCookies.ts). The API client (api/client.ts) posts here
 * once when a request comes back 401, and retries the request if this
 * answers 200.
 *
 * Backend: POST /api/v1/auth/refresh with `{ refreshToken, sessionId }`. It
 * answers with the standard envelope and the rotated credentials INSIDE
 * `data` (auth.controller.js refresh → success(res, result.data);
 * auth.service.js refreshUserToken):
 *
 *   { success: true, data: { token, refreshToken, session: { id, ... } } }
 *
 * — not at the top level, where the generic proxy's rotation check looks
 * (the reason refresh was dead end to end). The old refresh token is revoked
 * by the backend on success (rotation), so every cookie is rewritten.
 *
 * On any refusal the session cannot be recovered: every session cookie is
 * cleared here, BEFORE the client navigates, so /login is not bounced back to
 * /dashboard by proxy.ts on a stale auth_token (the loop F-05 describes).
 *
 * This static route takes precedence over the catch-all [...path] proxy.
 */

type RefreshBody = {
  success?: boolean;
  message?: string;
  data?: {
    token?: unknown;
    refreshToken?: unknown;
    session?: { id?: unknown } | null;
  } | null;
};

const refuse = (message: string, status: number) =>
  NextResponse.json({ success: false, status, message }, { status });

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(AUTH_REFRESH_COOKIE)?.value;
  const sessionId = cookieStore.get(AUTH_SESSION_COOKIE)?.value;

  if (!refreshToken) {
    clearSessionCookies(cookieStore);
    return refuse("Session expired — please sign in again", 401);
  }

  let res: Response;
  let body: RefreshBody | null;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": req.headers.get("user-agent") || "",
        // A-16: the one address nginx forwarded, never the header as received.
        ...clientIpHeader(req.headers),
      },
      body: JSON.stringify({ refreshToken, ...(sessionId ? { sessionId } : {}) }),
      cache: "no-store",
    });
    body = (await res.json().catch(() => null)) as RefreshBody | null;
  } catch (error: unknown) {
    // The backend is unreachable: the session may still be fine. Keep the
    // cookies and let the caller surface the failure; do not sign the user out
    // over a network blip.
    console.error("[Auth Refresh] Error calling the backend:", error);
    return refuse("Session refresh is temporarily unavailable", 502);
  }

  if (res.status >= 500) {
    // A backend fault, not a verdict on the session: keep the cookies.
    return refuse(body?.message || "Session refresh failed", res.status);
  }

  const token = body?.data?.token;
  const rotated = body?.data?.refreshToken;
  const newSessionId = body?.data?.session?.id;
  if (
    !res.ok ||
    !body?.success ||
    typeof token !== "string" ||
    !token ||
    typeof rotated !== "string" ||
    !rotated
  ) {
    // Refused (revoked, expired, rotated elsewhere) or malformed: the session
    // is over.
    clearSessionCookies(cookieStore);
    return refuse(body?.message || "Session expired — please sign in again", 401);
  }

  writeSessionCookies(cookieStore, {
    token,
    sessionId: typeof newSessionId === "string" ? newSessionId : null,
    refreshToken: rotated,
  });

  // No token in the body: the browser has no use for one.
  return NextResponse.json(
    { success: true, status: 200, message: body.message || "Session refreshed" },
    { status: 200 },
  );
}
