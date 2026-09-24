import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { API_BASE_URL } from "@/constants";

export async function POST() {
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
        },
      });
    }
  } catch (error) {
    console.error("Backend logout error:", error);
  } finally {
    // Always clear the cookies
    cookieStore.delete("auth_token");
    cookieStore.delete("auth_session");
    cookieStore.delete("auth_logged_in");
    // F-06: the tenant override and the impersonation marker end with the
    // session. The proxy sends x_tenant_id as X-Tenant-ID and the backend
    // honours it for a super admin, so a surviving one silently scopes the
    // next sign-in to another tenant.
    cookieStore.delete("x_tenant_id");
    cookieStore.delete("impersonating");
  }

  return NextResponse.json({ success: true, message: "Logged out successfully" }, { status: 200 });
}
