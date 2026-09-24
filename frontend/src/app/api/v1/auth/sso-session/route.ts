import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";
import { clientIpHeader } from "@/lib/clientIp";
import { writeSessionCookies } from "@/lib/authCookies";

/**
 * SSO session bootstrap (A-60).
 *
 * The backend's SSO callbacks redirect to /sso-callback with a one-time `code`
 * — never a token. The page posts that code here, and this route exchanges it
 * SERVER-TO-SERVER at POST /api/v1/auth/sso/exchange. Only what the backend
 * returns from that exchange is written into the httpOnly auth cookies, set
 * exactly as the /auth/login route sets them.
 *
 * This route used to accept `{ token }` from the browser and write it into the
 * auth cookie without verifying it — the shape of a session-fixation endpoint.
 * It now accepts nothing but a code, and a body carrying a token is refused.
 *
 * The access token is not returned to the browser: it lives only in the
 * httpOnly cookie.
 */

// 32 random bytes, base64url — the backend's ssoExchangeSchema.
const SSO_CODE = /^[A-Za-z0-9_-]{43}$/;

type ExchangeResponse = {
  success?: boolean;
  message?: string;
  data?: unknown;
  token?: unknown;
  refreshToken?: unknown;
  session?: { id?: unknown } | null;
};

const refuse = (message: string, status: number) =>
  NextResponse.json({ success: false, status, message }, { status });

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refuse("A valid SSO code is required", 400);
  }

  const code =
    body && typeof body === "object" && "code" in body
      ? (body as { code: unknown }).code
      : undefined;
  if (typeof code !== "string" || !SSO_CODE.test(code)) {
    return refuse("A valid SSO code is required", 400);
  }

  let res: Response;
  let data: ExchangeResponse | null;
  try {
    res = await fetch(`${API_BASE_URL}/api/v1/auth/sso/exchange`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": req.headers.get("user-agent") || "",
        // A-16: the one address nginx forwarded, never the header as received.
        ...clientIpHeader(req.headers),
      },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
    data = (await res.json().catch(() => null)) as ExchangeResponse | null;
  } catch (error: unknown) {
    console.error("[SSO Session] Error calling the backend exchange:", error);
    return refuse("SSO sign-in is temporarily unavailable", 502);
  }

  if (!res.ok || !data?.success) {
    return refuse(
      data?.message || "SSO sign-in failed",
      res.ok ? 502 : res.status,
    );
  }

  const token = data.token;
  const sessionId = data.session?.id;
  if (typeof token !== "string" || !token || typeof sessionId !== "string") {
    return refuse("SSO sign-in failed", 502);
  }

  const cookieStore = await cookies();
  // httpOnly token + session id (+ the refresh token when the exchange carries
  // one, F-05), and the non-httpOnly logged-in marker.
  writeSessionCookies(cookieStore, {
    token,
    sessionId,
    refreshToken:
      typeof data.refreshToken === "string" ? data.refreshToken : null,
  });

  return NextResponse.json(
    {
      success: true,
      status: 200,
      message: data.message || "Login successful",
      data: data.data ?? null,
    },
    { status: 200 },
  );
}
