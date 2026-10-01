import { NextResponse, type NextRequest } from "next/server";
import { backendForwardHeaders } from "@/lib/backendHeaders";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";
import { clearSessionCookies } from "@/lib/authCookies";

export async function POST(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  const session = cookieStore.get("auth_session")?.value;

  try {
    // Call the backend logout API if we have a token
    if (token) {
      await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "X-Session": session || "",
          // A-310: the original scheme, or a FORCE_HTTPS backend 301s the call.
          ...backendForwardHeaders(req),
        },
      });
    }
  } catch (error) {
    console.error("Backend logout error:", error);
  } finally {
    // Always clear the cookies — the refresh token, the tenant override and
    // the impersonation marker included (F-06, F-05).
    clearSessionCookies(cookieStore);
  }

  return NextResponse.json({ success: true, message: "Logged out successfully" }, { status: 200 });
}
