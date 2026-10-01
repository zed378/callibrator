/**
 * Phase 10 (ADR-098) — the contract of `authPublic.route.ts`, code-first
 * (P9-25): identifier-first discovery and the organisation-code SSO start
 * (P10-04), the passwordless passkey ceremony (P10-10) and accepting an
 * invitation (P10-15). Every request body IS the schema `validate()` enforces.
 */
import { z } from "zod";
import {
  invitationAcceptSchema,
  loginDiscoverSchema,
  passkeyVerifySchema,
  ssoStartSchema,
} from "../../validators/publicAuth.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

const Discovery = z
  .union([
    z.object({ next: z.literal("password") }),
    z.object({ next: z.literal("sso"), redirectUrl: z.url() }),
  ])
  .meta({
    id: "SignInDiscovery",
    description: "The step after the identifier. Decided by the email DOMAIN only — never by the account.",
    example: { next: "sso", redirectUrl: "https://idp.rs-contoh.example/sso?SAMLRequest=fZJNT8MwDIb&RelayState=RSCONTOH" },
  });

const Redirect = z
  .object({ redirectUrl: z.url() })
  .meta({ id: "SsoRedirect", example: { redirectUrl: "https://login.rs-contoh.example/authorize?client_id=callibrator&state=abc" } });

const PasskeyOptions = z
  .object({
    ceremonyId: z.string().meta({ description: "Send it back to /passkey/verify; single use, 120 s" }),
    options: z.record(z.string(), z.unknown()).meta({
      description: "PublicKeyCredentialRequestOptionsJSON: userVerification required, NO allowCredentials",
    }),
  })
  .meta({ id: "PasskeyOptions" });

const SignedIn = z
  .record(z.string(), z.unknown())
  .meta({ id: "PasskeySignIn", description: "Exactly what POST /auth/login answers for a completed sign-in" });

export default defineRouteDocs({
  router: "api/authPublic.route",
  mount: "/api/v1/auth",
  tag: "Auth",
  tenantScoped: false,
  operations: [
    {
      method: "post",
      path: "/login/discover",
      operationId: "discoverSignIn",
      summary: "Identifier-first: which sign-in step is next",
      description:
        "Public. A username (no `@`) is always `password`. An address whose domain a tenant with SSO has claimed " +
        "(set by the super admin only) starts that tenant's SSO; anything else — including an SSO that cannot " +
        "start — is `password`. No account is looked up: an existing and a non-existent address in one domain get " +
        "the same answer. For OIDC the response also sets the browser-binding cookie.",
      permission: null,
      audited: false,
      body: loginDiscoverSchema,
      success: { status: 200, description: "The next step", data: Discovery },
    },
    {
      method: "post",
      path: "/sso/start",
      operationId: "startSso",
      summary: "Start SSO by organisation code (the protocol is the server's choice)",
      description:
        "Public. OIDC when the tenant has an OIDC client, else SAML. Every refusal — unknown code, SSO off, " +
        "misconfigured, the identity provider unreachable — is ONE 404 `Single sign-on is not available for this " +
        "organisation code` (A-292). Budget shared with /sso/login and /sso/oidc/login (`ssoStart`).",
      permission: null,
      audited: false,
      body: ssoStartSchema,
      success: { status: 200, description: "Where to send the browser", data: Redirect },
      errors: [404],
    },
    {
      method: "post",
      path: "/passkey/options",
      operationId: "passkeySignInOptions",
      summary: "Start a passwordless passkey sign-in",
      description: "Public. No identifier in, nothing about any account out: the options carry no `allowCredentials`.",
      permission: null,
      audited: false,
      success: { status: 200, description: "The ceremony", data: PasskeyOptions },
    },
    {
      method: "post",
      path: "/passkey/verify",
      operationId: "passkeySignIn",
      summary: "Finish a passkey sign-in",
      description:
        "Public. The assertion must carry user verification; a user-verifying passkey counts as MFA (Q-46), so no " +
        "TOTP step follows. Every failure before the account is proven is the one 401 `Invalid credentials`; a " +
        "suspended account or tenant 403, a locked account 423, a paused one 429 — as the password sign-in.",
      permission: null,
      audited: true,
      body: passkeyVerifySchema,
      success: { status: 200, description: "Signed in", data: SignedIn },
      errors: [401, 403],
    },
    {
      method: "post",
      path: "/invitation/accept",
      operationId: "acceptInvitation",
      summary: "Accept an invitation: set the first administrator's password",
      description:
        "Public; the single-use, seven-day invitation token (from the approval email) is the capability. Any " +
        "token that cannot be accepted — unknown, used, expired, re-issued — is ONE 400 `This invitation link is " +
        "invalid or has expired`. The password rule is the reset rule.",
      permission: null,
      audited: true,
      body: invitationAcceptSchema,
      success: { status: 200, description: "The password is set; sign in", empty: true },
    },
  ],
});
