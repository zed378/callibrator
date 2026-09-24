import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";
import { clearSessionCookies } from "@/lib/authCookies";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  const session = cookieStore.get("auth_session")?.value;

  try {
    if (token) {
      await fetch(`${API_BASE_URL}/api/v1/auth/logout-all`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "X-Session": session || "",
        },
      });
    }
  } catch (error) {
    console.error("Backend logout-all error:", error);
  } finally {
    // Always clear the cookies — the refresh token, the tenant override and
    // the impersonation marker included (F-06, F-05).
    clearSessionCookies(cookieStore);
  }

  return NextResponse.json({ success: true, message: "All sessions revoked successfully" }, { status: 200 });
}
