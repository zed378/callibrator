import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";

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
    // Always clear the cookies
    cookieStore.delete("auth_token");
    cookieStore.delete("auth_session");
    cookieStore.delete("auth_logged_in");
  }

  return NextResponse.json({ success: true, message: "All sessions revoked successfully" }, { status: 200 });
}
