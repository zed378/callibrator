import { api } from "../client";
import {
  LoginCredentials,
  AuthResponse,
  User,
  RegisterCredentials,
  BackendLoginResponse,
} from "@/types";

interface VerifyResponse {
  success: boolean;
  status: number;
  message?: string;
  data?: User | { success: boolean; data: User };
}

export const authService = {
  login: async (
    credentials: LoginCredentials,
  ): Promise<BackendLoginResponse> => {
    return api.post<BackendLoginResponse>(
      "/api/v1/auth/login",
      credentials,
    );
  },

  ssoLogin: async (tenantCode: string): Promise<{ redirectUrl: string }> => {
    const response = await api.post<{ success: boolean; data: { redirectUrl: string } }>(
      "/api/v1/auth/sso/login",
      { tenantCode }
    );
    return response.data;
  },

  /**
   * POST /api/v1/auth/sso/oidc/login — start an OIDC (OpenID Connect) SSO login
   * for a tenant. Mirrors ssoLogin (SAML) and returns the IdP redirect URL.
   */
  oidcSsoLogin: async (tenantCode: string): Promise<{ redirectUrl: string }> => {
    const response = await api.post<{
      success: boolean;
      data: { redirectUrl: string };
    }>("/api/v1/auth/sso/oidc/login", { tenantCode });
    return response.data;
  },

  /**
   * GET /api/v1/auth/sso/metadata[/:tenantCode] — this app's SAML Service
   * Provider metadata XML, for configuring the tenant's IdP. Returns raw XML.
   */
  getSsoMetadata: async (tenantCode?: string): Promise<string> => {
    const path = tenantCode
      ? `/api/v1/auth/sso/metadata/${encodeURIComponent(tenantCode)}`
      : "/api/v1/auth/sso/metadata";
    return api.get<string>(path, { responseType: "text" });
  },

  register: async (data: RegisterCredentials): Promise<AuthResponse> => {
    return api.post<AuthResponse>("/api/v1/auth/register", data);
  },

  logout: async (sessionId?: string): Promise<void> => {
    await api.post("/api/v1/auth/logout", { sessionId });
  },

  logoutAll: async (): Promise<void> => {
    await api.post("/api/v1/auth/logout-all");
  },

  // Verify token and get fresh user data from backend
  verifyAndFetchUser: async (): Promise<User> => {
    const response = await api.post<VerifyResponse>("/api/v1/auth/verify", {});
    let userData: User;

    const data = response.data;
    if (data && typeof data === "object" && "data" in data) {
      const nested = data as { success: boolean; data: User };
      userData = nested.data;
    } else if (data) {
      userData = data as User;
    } else {
      userData = response as unknown as User;
    }

    return userData;
  },

  verifyToken: async (): Promise<boolean> => {
    try {
      await api.post("/api/v1/auth/verify", {});
      return true;
    } catch {
      return false;
    }
  },

  sendOtp: async (email: string): Promise<void> => {
    await api.post("/api/v1/auth/send-otp", { email });
  },

  resetPassword: async (
    email: string,
    otp: string,
    password: string,
  ): Promise<void> => {
    await api.post("/api/v1/auth/reset-password", { email, otp, password });
  },

  updatePassword: async (
    currentPassword: string,
    newPassword: string,
  ): Promise<void> => {
    await api.post("/api/v1/auth/just-update-password", {
      currentPassword,
      newPassword,
    });
  },

  /**
   * POST /api/v1/auth/pass-is-valid — confirm the current user's password.
   *
   * The backend enveloping is `{ success, status, message, data: { valid } }`
   * (auth.service.js passIsValid), so the flag lives at `data.valid`.
   */
  verifyPassword: async (password: string): Promise<boolean> => {
    const response = await api.post<{
      success: boolean;
      status: number;
      message: string;
      data: { valid: boolean };
    }>("/api/v1/auth/pass-is-valid", { password });
    return response.data?.valid === true;
  },

  activateAccount: async (token: string): Promise<void> => {
    await api.get("/api/v1/auth/activation", { params: { token } });
  },

  // ----------------------------------------------------------------
  // MFA / TOTP
  // ----------------------------------------------------------------

  /**
   * POST /api/v1/auth/mfa/setup — generate a TOTP secret + QR for enrollment.
   * The backend returns a ready-to-render QR data URL plus the manual secret.
   */
  mfaSetup: async (): Promise<{ secret: string; qrCodeUrl: string }> => {
    const response = await api.post<{
      success: boolean;
      data: { secret: string; qrCodeUrl: string };
    }>("/api/v1/auth/mfa/setup", {});
    return response.data;
  },

  /**
   * POST /api/v1/auth/mfa/verify — confirm the enrollment code and enable MFA.
   */
  mfaVerify: async (code: string): Promise<void> => {
    await api.post("/api/v1/auth/mfa/verify", { code });
  },

  /**
   * POST /api/v1/auth/mfa/login — complete a login that requires the second
   * factor. `token` is the temporary token returned by /auth/login (202); the
   * response is a normal login body and the proxy sets the real session cookie.
   */
  mfaLogin: async (
    token: string,
    code: string,
  ): Promise<BackendLoginResponse> => {
    return api.post<BackendLoginResponse>("/api/v1/auth/mfa/login", {
      token,
      code,
    });
  },

  // ----------------------------------------------------------------
  // Impersonation (super-admin)
  // ----------------------------------------------------------------

  /**
   * POST /api/v1/auth/impersonate — start acting as another user. The backend
   * issues a fresh session (via the login helper), so the proxy swaps the auth
   * cookies to the impersonated session. Requires SUPER_ADMIN server-side.
   */
  impersonate: async (
    tenantId: string,
    userId: string,
  ): Promise<BackendLoginResponse> => {
    return api.post<BackendLoginResponse>("/api/v1/auth/impersonate", {
      tenantId,
      userId,
    });
  },

  /**
   * POST /api/v1/auth/impersonate/exit — end impersonation. The backend maps
   * this to logout, so the impersonation session is revoked and the operator
   * must sign back in as themselves.
   */
  exitImpersonation: async (): Promise<void> => {
    await api.post("/api/v1/auth/impersonate/exit", {});
  },

  /**
   * Rotate access/refresh tokens.
   * Backend route: POST /api/v1/auth/refresh
   * The Next proxy re-sets httpOnly cookies when the response
   * contains a rotated token/session, so callers usually only
   * need to know whether the refresh succeeded.
   */
  refresh: async (
    refreshToken: string,
    sessionId?: string,
  ): Promise<{ token?: string; refreshToken?: string }> => {
    const response = await api.post<{
      success: boolean;
      data?: { token?: string; refreshToken?: string };
      token?: string;
      refreshToken?: string;
    }>("/api/v1/auth/refresh", { refreshToken, sessionId });
    return response.data ?? {
      token: response.token,
      refreshToken: response.refreshToken,
    };
  },
};
