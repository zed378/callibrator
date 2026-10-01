/**
 * authStore — the two-step MFA sign-in and impersonation failure, driven
 * through the REAL auth.service (only `@/api/client` is mocked). The bodies
 * are the backend's (auth.controller login / mfa/login):
 *   step 1: { success, data: { mfaRequired: true }, token: <short-lived> }
 *   step 2: { success, data: <user>, token, session }
 */
jest.mock("@/api/client", () => ({ api: { post: jest.fn(), get: jest.fn() } }));
jest.mock("@/lib/socket", () => ({ disconnectSocket: jest.fn(), getSocket: jest.fn() }));

import { api } from "@/api/client";
import { useAuthStore } from "../authStore";

const post = api.post as jest.Mock;

const cookie = (name: string) =>
  document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1];
const clearCookies = () => {
  for (const c of document.cookie.split("; ")) {
    const name = c.split("=")[0];
    if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  }
};

const initial = {
  user: null, avatarUrl: "", isAuthenticated: false, isLoading: false,
  error: null, token: null, isImpersonating: false,
};

beforeEach(() => {
  post.mockReset();
  clearCookies();
  useAuthStore.setState(initial);
});

describe("authStore — MFA sign-in", () => {
  it("step 1 on an MFA account stays signed out and hands back the short-lived token", async () => {
    post.mockResolvedValueOnce({ success: true, status: 200, message: "MFA required", data: { mfaRequired: true }, token: "mfa-tmp" });

    const result = await useAuthStore.getState().login("nurse@rs.id", "pw");

    expect(post).toHaveBeenCalledWith("/api/v1/auth/login", { user: "nurse@rs.id", password: "pw" });
    expect(result).toEqual({ mfaRequired: true, mfaToken: "mfa-tmp" });
    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, isLoading: false, user: null });
    expect(cookie("auth_logged_in")).toBeUndefined();
  });

  it("step 2 with a TOTP code signs in, normalises the snake_case profile and sets the logged-in marker", async () => {
    post.mockResolvedValueOnce({
      success: true, status: 200, message: "ok", token: "t", session: { id: "s1" },
      data: { id: "u1", tenantId: "t1", first_name: "Siti", last_name: "Aminah", avatarUrl: "/a.png" },
    });

    await useAuthStore.getState().completeMfaLogin("mfa-tmp", "123456");

    expect(post).toHaveBeenCalledWith("/api/v1/auth/mfa/login", { token: "mfa-tmp", code: "123456" });
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.user).toMatchObject({ id: "u1", firstName: "Siti", lastName: "Aminah", picture: "/a.png", roleId: null, role: null });
    expect(s.avatarUrl).toBe("/a.png");
    expect(cookie("auth_logged_in")).toBe("true");
  });

  it("step 2 with a recovery code sends it as recoveryCode, not code", async () => {
    post.mockResolvedValueOnce({ success: true, status: 200, message: "ok", token: "t", data: { id: "u1" } });

    await useAuthStore.getState().completeMfaLogin("mfa-tmp", "ABCD-EFGH", true);

    expect(post).toHaveBeenCalledWith("/api/v1/auth/mfa/login", { token: "mfa-tmp", recoveryCode: "ABCD-EFGH" });
  });

  it("a wrong code (401) leaves the user signed out with the backend's message, and rethrows for the form", async () => {
    post.mockRejectedValueOnce(new Error("Invalid MFA code"));

    await expect(useAuthStore.getState().completeMfaLogin("mfa-tmp", "000000")).rejects.toThrow("Invalid MFA code");

    expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, isLoading: false, error: "Invalid MFA code" });
    expect(cookie("auth_logged_in")).toBeUndefined();
  });

  it("a non-Error rejection gets the fallback message", async () => {
    post.mockRejectedValueOnce("opaque");
    await expect(useAuthStore.getState().completeMfaLogin("mfa-tmp", "1")).rejects.toBe("opaque");
    expect(useAuthStore.getState().error).toBe("MFA verification failed");
  });
});

describe("authStore — impersonation refused", () => {
  it("a refused impersonation keeps the operator's own session and says why", async () => {
    const operator = { id: "op", tenantId: "platform" } as unknown as NonNullable<ReturnType<typeof useAuthStore.getState>["user"]>;
    useAuthStore.setState({ user: operator, isAuthenticated: true });
    post.mockRejectedValueOnce(new Error("Only a super admin may impersonate"));

    await expect(useAuthStore.getState().impersonate("t2", "u9")).rejects.toThrow("Only a super admin may impersonate");

    const s = useAuthStore.getState();
    expect(s).toMatchObject({ isImpersonating: false, isLoading: false, error: "Only a super admin may impersonate" });
    expect(s.user).toBe(operator);
    expect(cookie("impersonating")).toBeUndefined();
    expect(cookie("x_tenant_id")).toBeUndefined();
  });
});
