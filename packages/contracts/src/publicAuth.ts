/**
 * Phase 10 (ADR-098) — the request shapes of the public sign-in additions:
 * identifier-first discovery and the organisation-code SSO start (P10-04), the
 * passwordless passkey ceremony (P10-10), accepting an invitation (P10-15), and
 * the super admin's SSO email-domain claim (P10-04).
 *
 * A 400 from any of them describes the SHAPE of what was sent, never an
 * account, a tenant or a token.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/publicAuth.validator.ts,
 * which re-exports these same objects by name. The contract for
 * the public sign-in additions (discovery, SSO start, passkey sign-in, invitation, SSO domains).
 */
import { z } from "zod";
import { resetPasswordSchema } from "./auth";
import { uuid } from "./fields";

/** POST /auth/login/discover — an email or a username, as typed. */
export const loginDiscoverSchema = z.object({
  identifier: z.string().trim().min(1).max(255),
});

/** POST /auth/sso/start — the organisation (tenant) code. */
export const ssoStartSchema = z.object({
  orgCode: z.string().trim().min(2).max(50),
});

const base64url = z.string().max(16384).regex(/^[A-Za-z0-9_-]*$/, { error: "Expected base64url" });

/**
 * POST /auth/passkey/verify — the ceremony id `options` returned, and the
 * browser's `AuthenticationResponseJSON`, as `@simplewebauthn/browser`
 * serialises `navigator.credentials.get()`.
 */
export const passkeyVerifySchema = z.object({
  ceremonyId: z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/),
  credential: z.object({
    id: base64url.min(1),
    rawId: base64url.min(1),
    type: z.literal("public-key"),
    response: z.object({
      clientDataJSON: base64url.min(1),
      authenticatorData: base64url.min(1),
      signature: base64url.min(1),
      userHandle: base64url.optional(),
    }),
    clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  }),
});

/**
 * POST /auth/invitation/accept — the invitation token and the new password,
 * under the SAME rule as every password a user chooses (the reset schema's).
 */
export const invitationAcceptSchema = z.object({
  token: z.string().min(20).max(200),
  password: resetPasswordSchema.shape.password,
});

/** A DNS domain as it appears after the `@`: lower-case labels, at least one dot. */
const domain = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, { error: "Enter a domain such as rs-contoh.co.id" });

/** PUT /admin/tenants/:id/sso-domains (super admin) — the whole list, replacing the old one. */
export const ssoEmailDomainsSchema = z.object({
  id: uuid(),
  domains: z.array(domain).max(20),
});
