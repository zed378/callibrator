/**
 * P9-21 / P9-25 (ADR-103) — the contract of `auth.route.ts`, code-first.
 *
 * Sign-in, sign-out, the password and MFA flows, enterprise SSO (SAML and
 * OIDC as a RELYING party), and impersonation, under `/api/v1/auth` (index.js
 * mounts authPublic.route on the same path, for the identifier-first and
 * passkey sign-in, documented there).
 *
 * Most routes are PUBLIC (no `auth`): they carry the A-67 failure throttles
 * (`authPreCheck`) and the ADR-100 request budgets instead, and answer 429
 * when either is spent. The signed-in routes carry `auth` and no gate factory:
 * they act on the caller's own account and session (`authenticated`);
 * impersonation is refused (403) inside the service to anyone but the super
 * admin. Sign-in answers put `token`, `refreshToken` and `session` beside
 * `data` (response.util#login). The bodies are the shared schemas
 * (`@callibrator/contracts/auth`, `/sso`) the services and controllers check;
 * the rest are read raw and documented as read. Examples are synthetic.
 */
import { z } from "zod";
import { forgotPasswordSchema, firstSignInPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from "../../validators/auth.validator";
import { ssoExchangeSchema, ssoLoginSchema } from "../../validators/sso.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

const own = { kind: "authenticated", reason: "the caller's own account and session" } as const;

/** The signed-in user, as the sign-in answers carry it (auth.service). */
const signedInUser = z
  .looseObject({
    id: z.guid(),
    username: z.string(),
    email: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    picture: z.string().nullable().optional(),
    roleId: z.guid().nullable(),
    role: z.unknown(),
    tenantId: z.guid().nullable(),
    mfaEnabled: z.boolean(),
    mustChangePassword: z.boolean().meta({ description: "A-123: go to the change-password screen" }),
    mfaEnrolmentRequired: z.boolean().meta({ description: "P6-07: an enrolment-only session" }),
  })
  .meta({ id: "SignedInUser", description: "The signed-in user, as a sign-in answers it" });

/** The MFA step of a password sign-in: `token` is the ten-minute MFA token for /auth/mfa/login. */
const mfaPending = z.object({ id: z.guid(), username: z.string(), email: z.string(), mfaRequired: z.literal(true) });

const signInAnswer = (data: z.ZodType) =>
  z.object({
    success: z.literal(true),
    status: z.literal(200),
    message: z.string(),
    data,
    token: z.string().meta({ description: "The access token (JWT), or the MFA token when `data.mfaRequired`" }),
    refreshToken: z.string().nullable(),
    session: z.object({ id: z.guid(), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime() }).nullable(),
  });

const reauth = {
  currentPassword: z.string().optional(),
  code: z.string().optional().meta({ description: "A current TOTP code" }),
  recoveryCode: z.string().optional(),
};

const tenantCodeParams = z.object({ tenantCode: z.string().meta({ description: "The tenant's code", example: "gh" }) });

const THROTTLED = "Throttled (A-67) and budgeted (ADR-100): a spent budget or a locked-out caller is a 429.";

export default defineRouteDocs({
  router: "api/auth.route",
  mount: "/api/v1/auth",
  tag: "Auth",
  tagDescription: "Sign-in, sign-out, password and MFA flows, enterprise SSO (SAML / OIDC relying party) and impersonation.",
  tenantScoped: false,
  operations: [
    {
      method: "post",
      path: "/register",
      operationId: "register",
      summary: "Self-register an account",
      description:
        "P10-12: only where self-registration is enabled (SELF_REGISTRATION_ENABLED); otherwise the route answers 404 as if " +
        `absent. The account is created unverified and an activation link is mailed. ${THROTTLED}`,
      permission: null,
      audited: true,
      body: registerSchema,
      success: { status: 201, description: "Registered; check your mail", empty: true },
      conflict: "The username or email is already an account.",
      errors: [404],
    },
    {
      method: "get",
      path: "/activation",
      operationId: "activateAccount",
      summary: "Activate an account from its mailed link",
      permission: null,
      audited: true,
      query: z.object({ token: z.string().meta({ description: "The activation token; missing is a 400" }) }),
      success: { status: 200, description: "Activated", empty: true },
      errors: [404],
    },
    {
      method: "post",
      path: "/login",
      operationId: "login",
      summary: "Sign in with a password",
      description:
        "With MFA, the answer is the MFA step: `data.mfaRequired` and an MFA `token` for POST /auth/mfa/login (no " +
        "refresh token, no session). The tenant's sign-in policy (IP allowlist, geofence from `location`) refuses with a " +
        `403. ${THROTTLED}`,
      permission: null,
      audited: true,
      body: loginSchema,
      success: { status: 200, description: "Signed in, or the MFA step", body: signInAnswer(z.union([signedInUser, mfaPending])) },
      errors: [401, 403],
    },
    {
      method: "post",
      path: "/send-otp",
      operationId: "sendPasswordResetOtp",
      summary: "Mail a password-reset code",
      description: `The same answer whether or not the address is an account. ${THROTTLED} The mailed-to address has its own budget.`,
      permission: null,
      audited: false,
      body: forgotPasswordSchema,
      success: { status: 200, description: "If the account exists, a code was sent", empty: true },
    },
    {
      method: "post",
      path: "/reset-password",
      operationId: "resetPassword",
      summary: "Reset a password with the mailed code",
      description: THROTTLED,
      permission: null,
      audited: true,
      body: resetPasswordSchema,
      success: { status: 200, description: "Password reset", empty: true },
    },
    {
      method: "post",
      path: "/logout",
      operationId: "logout",
      summary: "Sign out",
      permission: own,
      audited: false,
      success: { status: 200, description: "Signed out", empty: true },
    },
    {
      method: "post",
      path: "/logout-all",
      operationId: "logoutAll",
      summary: "Sign out every session of the caller",
      permission: own,
      audited: false,
      success: { status: 200, description: "Every session revoked", empty: true },
    },
    {
      method: "post",
      path: "/socket-token",
      operationId: "issueSocketToken",
      summary: "Issue a short-lived Socket.IO token",
      permission: own,
      audited: false,
      success: { status: 200, description: "The token, for 300 s", data: z.object({ token: z.string(), expiresIn: z.literal(300) }) },
    },
    {
      method: "post",
      path: "/verify",
      operationId: "verifySession",
      summary: "Verify the caller's session",
      description: "The user, whether an MFA enrolment is required, and who manages the password (`passwordManagedBy`).",
      permission: own,
      audited: false,
      success: {
        status: 200,
        description: "The session's user",
        // P9-25 item 11: passwordManagedBy is auth.service#passwordManagedBy's
        // object (A-216), not a string.
        data: z.looseObject({
          mfaEnrolmentRequired: z.boolean(),
          passwordManagedBy: z
            .object({ protocol: z.string().meta({ description: "The federated sign-in method (saml, oidc)" }), provider: z.string().nullable() })
            .nullable()
            .meta({ description: "Who manages the password when it is not this application; null when it is" }),
        }),
      },
    },
    {
      method: "post",
      path: "/just-update-password",
      operationId: "changePassword",
      summary: "Change the caller's password",
      description: "Needs the current password. A federated (SSO) account's password is managed by its identity provider.",
      permission: own,
      audited: true,
      body: z.object({ currentPassword: z.string(), newPassword: z.string() }),
      success: { status: 200, description: "Password changed", empty: true },
      errors: [429],
    },
    {
      method: "post",
      path: "/pass-is-valid",
      operationId: "checkPassword",
      summary: "Check the caller's password",
      description: "A-260: counted against the signed-in password-check budget (429 when spent).",
      permission: own,
      audited: false,
      body: z.object({ password: z.string() }),
      // P9-25 item 11: a wrong password is still a 200; the answer is `valid`
      // (auth.service#passIsValid), never `success`.
      success: { status: 200, description: "The answer", data: z.object({ valid: z.boolean() }) },
    },
    {
      method: "post",
      path: "/refresh",
      operationId: "refreshToken",
      summary: "Exchange a refresh token",
      description: "The refresh token rotates. Throttled (A-67).",
      permission: null,
      audited: false,
      body: z.object({ refreshToken: z.string(), sessionId: z.guid().nullable().optional() }),
      success: { status: 200, description: "New tokens", data: z.looseObject({ token: z.string(), refreshToken: z.string() }) },
      errors: [401],
    },
    {
      method: "post",
      path: "/sso/login",
      operationId: "ssoSamlLogin",
      summary: "Start a SAML sign-in",
      description: "Budgeted (ADR-100 `ssoStart`). A tenant without SSO is refused.",
      permission: null,
      audited: false,
      body: ssoLoginSchema,
      success: { status: 200, description: "Where to send the browser", data: z.object({ redirectUrl: z.string() }) },
    },
    {
      method: "post",
      path: "/sso/callback",
      operationId: "ssoSamlCallback",
      summary: "SAML assertion consumer (the IdP posts here)",
      description: "The tenant is the `RelayState`. Success and refusal both redirect to the frontend; success carries a one-time code (A-60).",
      permission: null,
      audited: true,
      body: z.object({ SAMLResponse: z.string(), RelayState: z.string().optional() }),
      success: { status: 302, description: "To the frontend", redirect: true },
    },
    {
      method: "post",
      path: "/sso/callback/:tenantCode",
      operationId: "ssoSamlCallbackForTenant",
      summary: "SAML assertion consumer for a named tenant",
      permission: null,
      audited: true,
      params: tenantCodeParams,
      body: z.object({ SAMLResponse: z.string(), RelayState: z.string().optional() }),
      success: { status: 302, description: "To the frontend", redirect: true },
    },
    {
      method: "post",
      path: "/sso/oidc/login",
      operationId: "ssoOidcLogin",
      summary: "Start an OIDC sign-in",
      description: "Budgeted (ADR-100 `ssoStart`). Binds the flow to the browser with a cookie.",
      permission: null,
      audited: false,
      body: ssoLoginSchema,
      success: { status: 200, description: "Where to send the browser", data: z.object({ redirectUrl: z.string() }) },
    },
    {
      method: "post",
      path: "/sso/oidc/callback",
      operationId: "ssoOidcCallbackPost",
      summary: "OIDC callback (form post)",
      description: "The stored `state`, bound to the browser's cookie, is the credential. Redirects like the SAML callback.",
      permission: null,
      audited: true,
      body: z.object({ code: z.string(), state: z.string() }),
      success: { status: 302, description: "To the frontend", redirect: true },
    },
    {
      method: "post",
      path: "/sso/oidc/callback/:tenantCode",
      operationId: "ssoOidcCallbackPostForTenant",
      summary: "OIDC callback for a named tenant (form post)",
      permission: null,
      audited: true,
      params: tenantCodeParams,
      body: z.object({ code: z.string(), state: z.string() }),
      success: { status: 302, description: "To the frontend", redirect: true },
    },
    {
      method: "get",
      path: "/sso/oidc/callback",
      operationId: "ssoOidcCallback",
      summary: "OIDC callback (response_mode=query)",
      description: "A-68/A-69: the IdP returns the browser here with `?code&state`.",
      permission: null,
      audited: true,
      query: z.object({ code: z.string(), state: z.string() }),
      success: { status: 302, description: "To the frontend", redirect: true },
    },
    {
      method: "get",
      path: "/sso/oidc/callback/:tenantCode",
      operationId: "ssoOidcCallbackForTenant",
      summary: "OIDC callback for a named tenant (response_mode=query)",
      permission: null,
      audited: true,
      params: tenantCodeParams,
      query: z.object({ code: z.string(), state: z.string() }),
      success: { status: 302, description: "To the frontend", redirect: true },
    },
    {
      method: "get",
      path: "/sso/metadata",
      operationId: "ssoSamlMetadata",
      summary: "SAML service-provider metadata",
      description: "The tenant is `tenantCode` in the query.",
      permission: null,
      audited: false,
      query: z.object({ tenantCode: z.string().optional() }),
      success: { status: 200, description: "The SP metadata", file: { contentType: "application/xml" } },
      errors: [404],
    },
    {
      method: "get",
      path: "/sso/metadata/:tenantCode",
      operationId: "ssoSamlMetadataForTenant",
      summary: "SAML service-provider metadata for a named tenant",
      permission: null,
      audited: false,
      params: tenantCodeParams,
      success: { status: 200, description: "The SP metadata", file: { contentType: "application/xml" } },
    },
    {
      method: "post",
      path: "/sso/exchange",
      operationId: "ssoExchange",
      summary: "Exchange an SSO one-time code for a session",
      description:
        "A-60: the code the callback put in its redirect (single use). A spent, unknown or expired code is a 401; a suspended " +
        "account or a sign-in policy refusal, a 403. Throttled (A-67).",
      permission: null,
      audited: false,
      body: ssoExchangeSchema,
      success: { status: 200, description: "Signed in", body: signInAnswer(signedInUser) },
      errors: [401, 403],
    },
    {
      method: "post",
      path: "/mfa/setup",
      operationId: "setupMfa",
      summary: "Begin MFA enrolment",
      description: "A new TOTP secret to scan. An account that already has MFA must prove it (A-114). Rate-limited (A-142).",
      permission: own,
      audited: false,
      body: z.object({ currentPassword: z.string().optional(), code: z.string().optional() }),
      // P9-25 item 11: exactly what auth.service#setupMfa returns.
      success: {
        status: 200,
        description: "The secret and its QR code",
        data: z.object({
          secret: z.string().meta({ description: "The TOTP secret, for manual entry" }),
          qrCodeUrl: z.string().meta({ description: "A data: URL of the otpauth QR code" }),
          rotation: z.boolean().meta({ description: "The account already had MFA: this replaces it once verified (A-114)" }),
        }),
      },
    },
    {
      method: "post",
      path: "/mfa/verify",
      operationId: "verifyMfaSetup",
      summary: "Finish MFA enrolment",
      description: "A wrong code is a 400. Answers the recovery codes ONCE. Rate-limited (A-142).",
      permission: own,
      audited: true,
      body: z.object({ code: z.string() }),
      success: { status: 200, description: "MFA is on", data: z.object({ recoveryCodes: z.array(z.string()) }) },
    },
    {
      method: "post",
      path: "/mfa/disable",
      operationId: "disableMfa",
      summary: "Turn MFA off",
      description: "Needs the current password and a current code or a recovery code (A-114). Other sessions are revoked. Rate-limited.",
      permission: own,
      audited: true,
      body: z.object(reauth),
      success: { status: 200, description: "MFA is off", data: z.object({ otherSessionsRevoked: z.number().int() }) },
    },
    {
      method: "post",
      path: "/impersonate",
      operationId: "impersonateUser",
      summary: "Start a support session as another user",
      description: "Super admin only (refused with a 403 in the service). A-146: the holder sees that it exists.",
      permission: own,
      audited: true,
      body: z.object({ tenantId: z.guid(), userId: z.guid() }),
      success: { status: 200, description: "Signed in as the user", body: signInAnswer(signedInUser) },
      errors: [404],
    },
    {
      method: "post",
      path: "/impersonate/exit",
      operationId: "exitImpersonation",
      summary: "End a support session",
      description: "The same handler as POST /auth/logout.",
      permission: own,
      audited: false,
      success: { status: 200, description: "Signed out", empty: true },
    },
    {
      method: "post",
      path: "/mfa/login",
      operationId: "loginMfa",
      summary: "Finish an MFA sign-in",
      description:
        "The MFA token from POST /auth/login, and a current code or a recovery code; `location` feeds the geofence (A-288). " +
        "A wrong code or a bad token is a 401. Throttled (A-81) and budgeted (`mfaSignIn`).",
      permission: null,
      audited: true,
      body: z.object({
        token: z.string(),
        code: z.string().optional(),
        recoveryCode: z.string().optional(),
        location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
      }),
      success: { status: 200, description: "Signed in", body: signInAnswer(signedInUser) },
      errors: [401, 403],
    },
    {
      method: "post",
      path: "/first-sign-in/password",
      operationId: "changeFirstSignInPassword",
      summary: "Set the password after a one-time password's first sign-in",
      description: "P10-16 (ADR-099): the password-change token that first sign-in returned. Then sign in again.",
      permission: null,
      audited: true,
      body: firstSignInPasswordSchema,
      success: { status: 200, description: "Changed; sign in again", data: z.object({ signInRequired: z.literal(true) }) },
    },
  ],
});
