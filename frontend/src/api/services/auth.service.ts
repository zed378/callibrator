// src/api/services/auth.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client; the request and answer
// types are the contract's (backend/src/routes/api/auth.openapi.ts,
// authPublic.openapi.ts, accessRequests.openapi.ts). The exported names are
// unchanged.
//
// Two kinds of call stay on `api`, each for a reason the contract cannot
// express:
//  - the routes the NEXT server answers itself, writing the httpOnly session
//    cookies (app/api/v1/auth/{login,logout,logout-all,refresh,passkey/verify}):
//    their answer is the Next route's, not the backend's (the tokens are
//    taken out of the body);
//  - the SAML metadata (XML text).
// A sign-in answered through the generic proxy (POST /auth/mfa/login,
// /auth/impersonate) is typed by the contract on the way out; the proxy takes
// `token` / `refreshToken` out of its answer (A-71), so the body is handed on
// as the app's BackendLoginResponse.
import { api } from "../client";
import { typedApi, unwrap, type DataOf, type JsonBody, type Op } from "../typed";
import {
  LoginCredentials,
  AuthResponse,
  User,
  RegisterCredentials,
  BackendLoginResponse,
  SignInLocation,
} from "@/types";
import type { AssertionJSON, RequestOptionsJSON } from "@/lib/passkey";

type A = "/api/v1/auth";

/** P10-04 (doc 20 §7.2): what the identifier-first step does next. */
export type DiscoverResult = DataOf<Op<`${A}/login/discover`, "post">>;

/** P10-06 (spec P10-05 § API): the request-access submission (`website` is the honeypot; a person never fills it). */
export type AccessRequestInput = JsonBody<Op<"/api/v1/access-requests", "post">>;

/** POST /auth/mfa/setup: the pending secret, its QR code, and whether it replaces a live one (A-114). */
export type MfaSetupResult = DataOf<Op<`${A}/mfa/setup`, "post">>;

/** A sign-in answered through the proxy, as the browser receives it (A-71: no tokens). */
const asLogin = (body: unknown): BackendLoginResponse => body as BackendLoginResponse;

interface VerifyResponse {
  success: boolean;
  status: number;
  message?: string;
  data?: User | { success: boolean; data: User };
}

export const authService = {
  /** POST /api/v1/auth/login — the NEXT route (writes the session cookies). */
  login: async (
    credentials: LoginCredentials,
  ): Promise<BackendLoginResponse> => {
    return api.post<BackendLoginResponse>(
      "/api/v1/auth/login",
      credentials,
    );
  },

  ssoLogin: async (tenantCode: string): Promise<{ redirectUrl: string }> =>
    (await typedApi.POST("/api/v1/auth/sso/login", { body: { tenantCode } }).then(unwrap)).data,

  /**
   * POST /api/v1/auth/sso/oidc/login — start an OIDC (OpenID Connect) SSO login
   * for a tenant. Mirrors ssoLogin (SAML) and returns the IdP redirect URL.
   */
  oidcSsoLogin: async (tenantCode: string): Promise<{ redirectUrl: string }> =>
    (await typedApi.POST("/api/v1/auth/sso/oidc/login", { body: { tenantCode } }).then(unwrap)).data,

  /**
   * POST /api/v1/auth/login/discover — P10-04. Decided by the email's DOMAIN
   * only (never the account), so the answer reveals nothing about whether an
   * account exists. A username always gets `password`.
   */
  discoverLogin: async (identifier: string): Promise<DiscoverResult> =>
    (await typedApi.POST("/api/v1/auth/login/discover", { body: { identifier } }).then(unwrap)).data,

  /**
   * POST /api/v1/auth/sso/start — P10-04 / A-292. The server picks the
   * tenant's protocol (SAML or OIDC); the user never chooses it. Every refusal
   * (unknown code, SSO off, misconfigured) is one generic answer.
   */
  ssoStart: async (orgCode: string): Promise<{ redirectUrl: string }> =>
    (await typedApi.POST("/api/v1/auth/sso/start", { body: { orgCode } }).then(unwrap)).data,

  /** POST /api/v1/auth/passkey/options — P10-10. No identifier: a discoverable credential. */
  passkeyOptions: async (): Promise<{ ceremonyId: string; options: RequestOptionsJSON }> => {
    const { ceremonyId, options } = (
      await typedApi
        // As built: posts `{}`; the contract reads no body.
        .POST("/api/v1/auth/passkey/options", { body: {} as never })
        .then(unwrap)
    ).data;
    // The options are published as an open object (the WebAuthn library defines them).
    return { ceremonyId, options: options as unknown as RequestOptionsJSON };
  },

  /**
   * POST /api/v1/auth/passkey/verify — through the Next route of the same path,
   * which writes the session cookies like the login route. Answers like a
   * successful /auth/login, never 202.
   */
  passkeyVerify: async (
    ceremonyId: string,
    credential: AssertionJSON,
    location?: SignInLocation,
  ): Promise<BackendLoginResponse> => {
    return api.post<BackendLoginResponse>(
      "/api/v1/auth/passkey/verify",
      location ? { ceremonyId, credential, location } : { ceremonyId, credential },
    );
  },

  /** POST /api/v1/access-requests — P10-05/06. Always the same neutral 202. */
  requestAccess: async (input: AccessRequestInput): Promise<void> => {
    await typedApi.POST("/api/v1/access-requests", { body: input });
  },

  /** POST /api/v1/auth/invitation/accept — P10-15. One generic 400 for any bad token. */
  acceptInvitation: async (token: string, password: string): Promise<void> => {
    await typedApi.POST("/api/v1/auth/invitation/accept", { body: { token, password } });
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

  register: async (data: RegisterCredentials): Promise<AuthResponse> =>
    // As built: the whole body (the API answers `data: null`; no caller reads it).
    (await typedApi
      .POST("/api/v1/auth/register", { body: data as JsonBody<Op<`${A}/register`, "post">> })
      .then(unwrap)) as unknown as AuthResponse,

  /** POST /api/v1/auth/logout — the NEXT route (clears the session cookies). */
  logout: async (sessionId?: string): Promise<void> => {
    await api.post("/api/v1/auth/logout", { sessionId });
  },

  /** POST /api/v1/auth/logout-all — the NEXT route. */
  logoutAll: async (): Promise<void> => {
    await api.post("/api/v1/auth/logout-all");
  },

  // Verify token and get fresh user data from backend
  verifyAndFetchUser: async (): Promise<User> => {
    // As built: posts `{}`; the contract reads no body. The answer is read
    // defensively (a nested envelope, or the body itself), as built.
    const response = (await typedApi
      .POST("/api/v1/auth/verify", { body: {} as never })
      .then(unwrap)) as unknown as VerifyResponse;
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
      await typedApi.POST("/api/v1/auth/verify", { body: {} as never });
      return true;
    } catch {
      return false;
    }
  },

  sendOtp: async (email: string): Promise<void> => {
    await typedApi.POST("/api/v1/auth/send-otp", { body: { email } });
  },

  resetPassword: async (
    email: string,
    otp: string,
    password: string,
  ): Promise<void> => {
    await typedApi.POST("/api/v1/auth/reset-password", { body: { email, otp, password } });
  },

  updatePassword: async (
    currentPassword: string,
    newPassword: string,
  ): Promise<void> => {
    await typedApi.POST("/api/v1/auth/just-update-password", {
      body: {
        currentPassword,
        newPassword,
      },
    });
  },

  /**
   * POST /api/v1/auth/pass-is-valid — confirm the current user's password.
   *
   * The backend enveloping is `{ success, status, message, data: { valid } }`
   * (auth.service#passIsValid), so the flag lives at `data.valid`.
   */
  verifyPassword: async (password: string): Promise<boolean> => {
    const response = await typedApi.POST("/api/v1/auth/pass-is-valid", { body: { password } }).then(unwrap);
    return response.data?.valid === true;
  },

  activateAccount: async (token: string): Promise<void> => {
    await typedApi.GET("/api/v1/auth/activation", { params: { query: { token } } });
  },

  // ----------------------------------------------------------------
  // MFA / TOTP
  // ----------------------------------------------------------------

  /**
   * POST /api/v1/auth/mfa/setup — generate a TOTP secret + QR for enrollment.
   * The backend returns a ready-to-render QR data URL plus the manual secret.
   *
   * A-114: the new secret is PENDING until mfaVerify accepts a code from it;
   * the current authenticator keeps working until then. On an account that
   * already has MFA this is a rotation, and the backend requires the current
   * password and a code from the CURRENT authenticator (409 without them,
   * 400 when either is wrong).
   */
  mfaSetup: async (reauth?: {
    currentPassword: string;
    code: string;
  }): Promise<MfaSetupResult> =>
    (await typedApi.POST("/api/v1/auth/mfa/setup", { body: reauth ?? {} }).then(unwrap)).data,

  /**
   * POST /api/v1/auth/mfa/verify — confirm the enrollment code and enable MFA.
   *
   * A-141: resolves with the ten one-time recovery codes. This response is the
   * ONLY time they exist in plain text (the backend keeps hashes), so the
   * caller must show them now. On a replacement, every other session of the
   * user has been signed out.
   */
  mfaVerify: async (code: string): Promise<{ recoveryCodes: string[] }> => {
    const response = await typedApi.POST("/api/v1/auth/mfa/verify", { body: { code } }).then(unwrap);
    // Defensive, as built: an answer without codes gives none.
    return { recoveryCodes: response?.data?.recoveryCodes ?? [] };
  },

  /**
   * POST /api/v1/auth/mfa/disable — turn MFA off (A-141). Needs the current
   * password AND either a current authenticator code or a recovery code.
   * Every other session of the user is signed out.
   */
  mfaDisable: async (reauth: {
    currentPassword: string;
    code?: string;
    recoveryCode?: string;
  }): Promise<void> => {
    await typedApi.POST("/api/v1/auth/mfa/disable", { body: reauth });
  },

  /**
   * POST /api/v1/auth/mfa/login — complete a login that requires the second
   * factor. `token` is the temporary token returned by /auth/login (202); the
   * response is a normal login body and the proxy sets the real session cookie.
   *
   * A-141: with `useRecoveryCode`, `code` is sent as a one-time recovery code
   * instead of a TOTP code. It is spent on success.
   */
  mfaLogin: async (
    token: string,
    code: string,
    useRecoveryCode = false,
    location?: SignInLocation,
  ): Promise<BackendLoginResponse> => {
    const body = useRecoveryCode ? { token, recoveryCode: code } : { token, code };
    return asLogin(
      await typedApi
        .POST("/api/v1/auth/mfa/login", {
          // A-288: only when the password step was asked for it.
          body: location ? { ...body, location } : body,
        })
        .then(unwrap),
    );
  },

  /**
   * POST /api/v1/auth/first-sign-in/password — P10-16 (ADR-099). Replace a
   * one-time password after its first sign-in. `token` is the password-change
   * token /auth/login returned instead of a session; it opens nothing else.
   * No session is issued: sign in with the new password afterwards.
   */
  completeFirstSignIn: async (token: string, newPassword: string): Promise<void> => {
    await typedApi.POST("/api/v1/auth/first-sign-in/password", { body: { token, newPassword } });
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
  ): Promise<BackendLoginResponse> =>
    asLogin(
      await typedApi
        .POST("/api/v1/auth/impersonate", {
          body: {
            tenantId,
            userId,
          },
        })
        .then(unwrap),
    ),

  /**
   * POST /api/v1/auth/impersonate/exit — end impersonation. The backend maps
   * this to logout, so the impersonation session is revoked and the operator
   * must sign back in as themselves.
   */
  exitImpersonation: async (): Promise<void> => {
    // As built: posts `{}`; the contract reads no body.
    await typedApi.POST("/api/v1/auth/impersonate/exit", { body: {} as never });
  },

  /**
   * F-05: renew the session. POST /api/v1/auth/refresh is the NEXT route
   * (app/api/v1/auth/refresh/route.ts), not the backend's: it reads the
   * httpOnly refresh cookie, rotates it with the backend and rewrites the
   * session cookies. The browser never sees a token, so this takes no
   * argument and returns nothing — it rejects when the session is over.
   * The API client calls the same route itself on a 401; this is for a caller
   * that wants to renew ahead of time.
   */
  refresh: async (): Promise<void> => {
    await api.post("/api/v1/auth/refresh", {});
  },
};
