/**
 * The invitation of an imported user (P24-09a; ADR-139 § 3 – § 4 and Am. 1).
 *
 *  - The token: 32 CSPRNG bytes, base64url (43 characters), as the access request's (P10-15). Only
 *    its SHA-256 is stored; it travels in the e-mail only, never in an answer.
 *  - The operator's switch: the tenant flag `upstream_invitations_open` (`tenants.settings`, written
 *    only by `PATCH /admin/tenants/:id/flags`). Until it is `true`, an issue is 409.
 *  - A shared account (first name equal to the username, or no last name) needs the person's name
 *    in the issue request.
 *  - The machine codes of the refusals.
 *
 * Named exports only.
 */
import { z } from "zod";
import { personDisplay } from "./people";

/** The tenant flag (in `tenants.settings`) that opens invitations, set by the platform operator only. */
export const UPSTREAM_INVITATIONS_OPEN_FLAG = "upstream_invitations_open";

/** Why an invitation stopped working before it was accepted (migration 0144's CHECK). */
export const USER_INVITATION_REVOKED_REASONS = Object.freeze(["reissued", "revoked"] as const);
export type UserInvitationRevokedReason = (typeof USER_INVITATION_REVOKED_REASONS)[number];

/** The machine codes (top-level `code` of the error envelope). */
export const USER_INVITATION_CODES = Object.freeze({
  /** The account is not one an invitation opens (not awaiting one, inactive, or erased). */
  notApplicable: "INVITATION_NOT_APPLICABLE",
  /** The operator has not opened invitations for this tenant. */
  gateClosed: "PRE_INVITATION_GATE_OPEN",
  /** A shared account: the person's first and last name are required. */
  personRequired: "INVITATION_PERSON_REQUIRED",
  /** Revoke while no invitation is live. */
  none: "INVITATION_NONE",
} as const);

/** A person's name part: trimmed, 1 – 100 characters (the `users` columns). */
const namePart = z.string().trim().min(1).max(100);

/** `/users/:userId/invitation`. */
export const userInvitationParams = z.strictObject({
  userId: z.uuid(),
});
export type UserInvitationParams = z.output<typeof userInvitationParams>;

/**
 * `POST /users/:userId/invitation` — path and body together (`validate(schema, { from: ["params",
 * "body"] })`): the person behind a shared account, both names or neither.
 */
export const issueUserInvitation = z
  .strictObject({
    userId: z.uuid(),
    firstName: namePart.optional(),
    lastName: namePart.optional(),
  })
  .refine((body) => (body.firstName === undefined) === (body.lastName === undefined), {
    message: "Give both the first and the last name, or neither",
    path: ["lastName"],
  });
export type IssueUserInvitationInput = z.output<typeof issueUserInvitation>;

/** An account whose name says nothing about a person (the 76 shared upstream accounts). */
export const isSharedAccountName = (user: { username: string; firstName: string | null; lastName: string | null }): boolean =>
  !user.lastName?.trim() || user.firstName?.trim() === user.username;

/** The invitation's state for an administrator — never the token or its hash. */
export const userInvitationState = z.strictObject({
  awaitingInvitation: z.boolean(),
  invitationsOpen: z.boolean(),
  personRequired: z.boolean(),
  live: z
    .strictObject({
      issuedAt: z.string(),
      expiresAt: z.string(),
      expired: z.boolean(),
      issuedBy: personDisplay.nullable(),
    })
    .nullable(),
  firstIssuedAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
});
export type UserInvitationState = z.output<typeof userInvitationState>;

/** What an issue answers: when it expires and whether the e-mail was queued — never the token. */
export const userInvitationIssued = z.strictObject({
  issuedAt: z.string(),
  expiresAt: z.string(),
  emailQueued: z.boolean(),
});
export type UserInvitationIssued = z.output<typeof userInvitationIssued>;
