import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";

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
        "X-Forwarded-For": req.headers.get("x-forwarded-for") || "",
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

    const { token, session } = responseData;
    const cookieStore = await cookies();

    // Set secure httpOnly cookies
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    };

    if (token) {
      cookieStore.set("auth_token", token, cookieOptions);
    }
    if (session?.id) {
      cookieStore.set("auth_session", session.id, cookieOptions);
    }

    // Set a non-httpOnly cookie so client-side JavaScript knows the user is logged in
    cookieStore.set("auth_logged_in", "true", {
      ...cookieOptions,
      httpOnly: false,
    });

    return NextResponse.json(responseData, { status: 200 });
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
