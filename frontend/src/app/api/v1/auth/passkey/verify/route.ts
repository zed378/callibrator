// P10-10 (ADR-108): passwordless passkey sign-in, the browser half.
//
// POST /api/v1/auth/passkey/verify answers EXACTLY like a successful
// POST /auth/login (token, refreshToken, session at the top level), so this
// route does what the login route does: it writes the session as httpOnly
// cookies and strips both tokens from the body the browser gets (F-62). It
// never answers 202 (a user-verifying passkey is the second factor, Q-46).
// A-310: it forwards the original scheme and the client address.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";
import { backendForwardHeaders } from "@/lib/backendHeaders";
import { writeSessionCookies } from "@/lib/authCookies";
import { isSameOriginRequest } from "@/lib/sameOrigin";

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers, req.nextUrl.host)) {
    return NextResponse.json({ success: false, status: 403, message: "Cross-origin request refused" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, status: 400, message: "Invalid request" }, { status: 400 });
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/passkey/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": req.headers.get("user-agent") || "",
        ...backendForwardHeaders(req),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      return NextResponse.json(data ?? { success: false, status: res.status }, { status: res.status });
    }
    const { token, session, refreshToken, ...browserBody } = data;
    if (token) {
      writeSessionCookies(await cookies(), {
        token,
        sessionId: session?.id,
        refreshToken: typeof refreshToken === "string" ? refreshToken : null,
      });
    }
    return NextResponse.json({ ...browserBody, session }, { status: 200 });
  } catch (error: unknown) {
    console.error("[Passkey Proxy] Error forwarding to backend:", error);
    return NextResponse.json({ success: false, status: 502, message: "Backend unreachable" }, { status: 502 });
  }
}
