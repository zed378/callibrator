import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * SSO session bootstrap.
 *
 * Receives the SSO access token (obtained via the SSO callback) and persists
 * it in an httpOnly cookie so the server-side API proxy can attach the
 * Authorization header on subsequent requests. This mirrors the regular
 * /auth/login route and keeps the JWT out of localStorage (XSS-exfiltratable).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token: string | undefined = body?.token;
    const sessionId: string | undefined = body?.session;

    if (!token) {
      return NextResponse.json(
        { success: false, message: "token is required" },
        { status: 400 },
      );
    }

    const cookieStore = await cookies();

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: 7 * 24 * 60 * 60, // 7 days
    };

    cookieStore.set("auth_token", token, cookieOptions);
    if (sessionId) {
      cookieStore.set("auth_session", sessionId, cookieOptions);
    }

    // Non-httpOnly flag so client-side code can detect the logged-in state.
    cookieStore.set("auth_logged_in", "true", {
      ...cookieOptions,
      httpOnly: false,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to establish SSO session";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
