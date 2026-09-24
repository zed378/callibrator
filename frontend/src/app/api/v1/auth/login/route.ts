import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";
import { clientIpHeader } from "@/lib/clientIp";
import { writeSessionCookies } from "@/lib/authCookies";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const backendUrl = `${API_BASE_URL}/api/v1/auth/login`;

    // Forward login request to the backend
    const res = await fetch(backendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": req.headers.get("user-agent") || "",
        // A-16: the one address nginx forwarded, never the header as received.
        ...clientIpHeader(req.headers),
      },
      body: JSON.stringify(body),
    });

    const responseData = await res.json();

    if (!res.ok || !responseData.success) {
      return NextResponse.json(responseData, { status: res.status });
    }

    // MFA-required: the backend answers 202 with a short-lived token in the body
    // instead of a full session. Do NOT set auth cookies or the logged-in marker
    // — the client must complete the second factor via /auth/mfa/login, which
    // returns the real session. Pass the 202 + body (temp token) straight
    // through so the client can drive the code step.
    if (res.status === 202 || responseData?.data?.mfaRequired) {
      return NextResponse.json(responseData, { status: 202 });
    }

    const { token, session, refreshToken, ...browserBody } = responseData;
    const cookieStore = await cookies();

    // httpOnly cookies — including, F-05, the refresh token when the backend
    // sends one. Both tokens are written ONLY as cookies: the body the browser
    // gets has them removed (F-62), so no script can read either — the point
    // of an httpOnly cookie. (The MFA 202 above is different: its token is a
    // short-lived "mfa" purpose token the client must post back.)
    if (token) {
      writeSessionCookies(cookieStore, {
        token,
        sessionId: session?.id,
        refreshToken: typeof refreshToken === "string" ? refreshToken : null,
      });
    }

    return NextResponse.json({ ...browserBody, session }, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Internal login error";
    console.error("[Login Proxy] Error forwarding to backend:", error);
    return NextResponse.json(
      {
        success: false,
        message: `Backend connection error: ${message}. Please ensure the backend server is running on ${API_BASE_URL}.`,
      },
      { status: 500 },
    );
  }
}
