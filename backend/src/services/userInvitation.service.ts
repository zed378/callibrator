/**
 * The invitation of an imported user, for a tenant administrator or the platform operator
 * (P24-09a; ADR-139 § 3 and Am. 1).
 *
 *  - `getInvitationState` — whether the account awaits an invitation, whether the operator has opened
 *    invitations for the tenant, whether the issue must name the person, the live invitation (when,
 *    by whom, until when), the first issue and the acceptance. Never the token or its hash.
 *  - `issueInvitation` — in ONE transaction that locks the user row: refuses an account that does not
 *    await an invitation (409 `INVITATION_NOT_APPLICABLE`), a tenant the operator has not opened
 *    (409 `PRE_INVITATION_GATE_OPEN`) and a shared account without the person's name (400
 *    `INVITATION_PERSON_REQUIRED`); writes the names, revokes the live invitation (`reissued`),
 *    inserts the new one and ONE audit row. The token (32 CSPRNG bytes, base64url) goes out in the
 *    e-mail after the commit and nowhere else; only its SHA-256 is stored.
 *  - `revokeInvitation` — revokes the live one (`revoked`), 409 `INVITATION_NONE` without one.
 *
 * The user is read in the caller's context: another tenant's, or a deleted one, is the 404 (never a
 * 403). Callers are unbound (the user routes are not facility-accessible). The acceptance is
 * invitation.service's. Named exports only.
 */
import { randomBytes } from "node:crypto";
import { Op, type Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import emailQueue from "./emailQueue.service";
import { displayPeople } from "./personDisplay.service";
import { invitationTokenHash } from "./accessRequest.service";
import { INVITATION_TTL_MS } from "../constants/accessRequest";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";
import { emailLinkOrigin } from "../utils/publicLinkOrigin.util";
import { actorChanges, auditEntryActor, type AuditActorInput } from "../utils/auditPrincipal.util";
import { logger } from "../middlewares/activityLog.middleware";
import {
  UPSTREAM_INVITATIONS_OPEN_FLAG,
  USER_INVITATION_CODES,
  isSharedAccountName,
  type IssueUserInvitationInput,
  type UserInvitationIssued,
  type UserInvitationRevokedReason,
  type UserInvitationState,
} from "@callibrator/contracts/userInvitations";
import type { PersonDisplay } from "@callibrator/contracts/people";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

type UserRow = ModelInstance<"User">;
type InvitationRow = ModelInstance<"UserInvitation">;

export const USER_NOT_FOUND = "User not found";

/** The statuses an account is never invited from (auth.service's REFUSED_STATUSES). */
const REFUSED_STATUSES = new Set(["INACTIVE", "SUSPENDED", "erased"]);

/** The first 8 hex characters of a token's hash — the only form an audit row carries. */
const hashPrefix = (tokenHash: string): string => tokenHash.slice(0, 8);

/** The invitation link, on the configured public origin only (A-289) — the acceptance page of P10-15. */
const invitationLink = (origin: string, token: string): string => `${origin}/invitation?token=${encodeURIComponent(token)}`;

/** The e-mail, in Indonesian and English (the account has no language of its own). No credential in it. */
const INVITATION_TITLE = "Undangan ke Device Calibrator / Your invitation to Device Calibrator";
const invitationMessage = (organisation: string): string =>
  `${organisation} mengundang Anda ke Device Calibrator. Buka tautan di bawah untuk membuat kata sandi Anda. ` +
  "Tautan berlaku 7 hari dan hanya dapat dipakai sekali. / " +
  `${organisation} invites you to Device Calibrator. Open the link below to set your password. ` +
  "The link is valid for 7 days and works once.";

/**
 * The tenant's name when the platform operator has opened invitations for it, else null (fail-closed:
 * only a JSON `true` opens).
 */
export const openTenantName = async (tenantId: string, transaction?: Transaction): Promise<string | null> => {
  const tenant = await models.Tenant.findByPk(tenantId, { attributes: ["id", "name", "settings"], ...(transaction ? { transaction } : {}) });
  if (!tenant) {
    return null;
  }
  const settings = tenant.settings as Record<string, unknown> | null;
  return settings?.[UPSTREAM_INVITATIONS_OPEN_FLAG] === true ? tenant.name : null;
};

/** Whether an account is one an invitation opens. */
const applicable = (user: UserRow): boolean => user.awaitingInvitation && user.isActive === true && !REFUSED_STATUSES.has(user.status);

/** The user in the caller's context, locked; absent, another tenant's or deleted → 404. */
const lockUser = async (userId: string, transaction: Transaction): Promise<UserRow> => {
  const user = await models.User.findOne({ where: { id: userId }, transaction, lock: transaction.LOCK.UPDATE });
  if (!user) {
    throw new AppError(404, USER_NOT_FOUND);
  }
  return user;
};

/** The user's live invitation (neither accepted nor revoked). */
const liveInvitationOf = (userId: string, transaction?: Transaction): Promise<InvitationRow | null> =>
  models.UserInvitation.findOne({
    where: { userId, acceptedAt: null, revokedAt: null },
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
  });

const revokeRow = async (invitation: InvitationRow, reason: UserInvitationRevokedReason, userId: string, transaction: Transaction): Promise<void> => {
  invitation.revokedAt = new Date();
  invitation.revokedBy = userId as UserId;
  invitation.revokedReason = reason;
  await invitation.save({ transaction });
};

/** The acting person; an invitation is always issued by one (the routes refuse API keys). */
const userOf = (actor: AuditActorInput): string => {
  if (!actor.userId) {
    throw new AppError(403, "An invitation is issued by a signed-in person.");
  }
  return actor.userId;
};

/**
 * GET /users/:userId/invitation.
 *
 * @param userId - the account
 * @returns its invitation state
 * @throws AppError 404 when the account is out of view
 */
export const getInvitationState = async (userId: string): Promise<UserInvitationState> => {
  const user = await models.User.findOne({ where: { id: userId } });
  if (!user) {
    throw new AppError(404, USER_NOT_FOUND);
  }
  const live = await liveInvitationOf(user.id);
  const first = await models.UserInvitation.findOne({ where: { userId: user.id }, attributes: ["id", "createdAt"], order: [["createdAt", "ASC"]] });
  const accepted = await models.UserInvitation.findOne({ where: { userId: user.id, acceptedAt: { [Op.ne]: null } }, attributes: ["id", "acceptedAt"] });
  const people = live ? await displayPeople([live.issuedBy]) : new Map<string, PersonDisplay>();
  return {
    awaitingInvitation: user.awaitingInvitation,
    invitationsOpen: (await openTenantName(user.tenantId as string)) !== null,
    personRequired: isSharedAccountName(user),
    live: live
      ? {
        issuedAt: live.createdAt.toISOString(),
        expiresAt: live.expiresAt.toISOString(),
        expired: live.expiresAt.getTime() <= Date.now(),
        // displayPeople answers every id it is given (one outside the tenant as "Platform support").
        issuedBy: people.get(live.issuedBy) as PersonDisplay,
      }
      : null,
    firstIssuedAt: first ? first.createdAt.toISOString() : null,
    acceptedAt: accepted ? (accepted.acceptedAt as Date).toISOString() : null,
  };
};

/**
 * POST /users/:userId/invitation — issue, or issue again (the live one is revoked `reissued`).
 *
 * @param tenantId - the caller's tenant
 * @param input - the account and, for a shared account, the person's name
 * @param actor - the audit principal
 * @returns when it was issued, when it expires and whether the e-mail was queued — never the token
 */
export const issueInvitation = async (tenantId: TenantId, input: IssueUserInvitationInput, actor: AuditActorInput): Promise<UserInvitationIssued> => {
  const actorId = userOf(actor);
  // Before anything is written: in production an unset public origin refuses (A-289).
  const origin = emailLinkOrigin();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = invitationTokenHash(token);

  const outcome = await db.transaction(async (transaction) => {
    const user = await lockUser(input.userId, transaction);
    if (!applicable(user)) {
      throw new CodedError(409, USER_INVITATION_CODES.notApplicable, "This account does not wait for an invitation.");
    }
    const organisation = await openTenantName(user.tenantId as string, transaction);
    if (organisation === null) {
      throw new CodedError(
        409,
        USER_INVITATION_CODES.gateClosed,
        "Invitations for this organisation are not open yet. The platform operator opens them after the pre-invitation checks.",
      );
    }
    // The schema gives both names or neither.
    const person = input.firstName !== undefined && input.lastName !== undefined ? { firstName: input.firstName, lastName: input.lastName } : null;
    if (!person && isSharedAccountName(user)) {
      throw new CodedError(
        400,
        USER_INVITATION_CODES.personRequired,
        "This is a shared account. Give the first and last name of the person who will use it.",
      );
    }
    const renamed = person ? { before: { firstName: user.firstName, lastName: user.lastName }, after: person } : null;
    if (person) {
      user.set(person);
      await user.save({ transaction });
    }

    const previous = await liveInvitationOf(user.id, transaction);
    if (previous) {
      await revokeRow(previous, "reissued", actorId, transaction);
    }
    const now = new Date();
    const invitation = await models.UserInvitation.create(
      {
        tenantId,
        userId: user.id,
        tokenHash,
        issuedBy: actorId as UserId,
        // One clock for both, so the expiry is exactly the TTL after the issue.
        createdAt: now,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        acceptedAt: null,
        revokedAt: null,
        revokedBy: null,
        revokedReason: null,
      },
      { transaction },
    );
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(actor),
        action: "UPDATE",
        resourceType: "User",
        resourceId: user.id,
        clientFacilityId: user.clientFacilityId ?? null,
        changes: {
          operation: "ISSUE_USER_INVITATION",
          invitation: { id: invitation.id, hashPrefix: hashPrefix(tokenHash), expiresAt: invitation.expiresAt.toISOString() },
          ...(previous ? { reissued: { id: previous.id, hashPrefix: hashPrefix(previous.tokenHash) } } : {}),
          ...(renamed ? { renamed } : {}),
          ...actorChanges(actor),
        },
      },
      { transaction },
    );
    return { user, invitation, organisation };
  });

  // After the commit: a queue failure leaves a valid invitation the administrator can issue again.
  let emailQueued = false;
  try {
    emailQueued = await emailQueue.queueNotificationEmail({
      email: outcome.user.email,
      firstName: outcome.user.firstName,
      title: INVITATION_TITLE,
      message: invitationMessage(outcome.organisation),
      actionUrl: invitationLink(origin, token),
    });
  } catch (err) {
    logger.warn("User invitation email not queued", { userId: outcome.user.id, error: (err as Error).message });
  }
  return {
    issuedAt: outcome.invitation.createdAt.toISOString(),
    expiresAt: outcome.invitation.expiresAt.toISOString(),
    emailQueued,
  };
};

/**
 * DELETE /users/:userId/invitation — revoke the live invitation (`revoked`).
 *
 * @param tenantId - the caller's tenant
 * @param userId - the account
 * @param actor - the audit principal
 * @returns when it was revoked
 */
export const revokeInvitation = async (tenantId: TenantId, userId: string, actor: AuditActorInput): Promise<{ revokedAt: string }> => {
  const actorId = userOf(actor);
  return db.transaction(async (transaction) => {
    const user = await lockUser(userId, transaction);
    const live = await liveInvitationOf(user.id, transaction);
    if (!live) {
      throw new CodedError(409, USER_INVITATION_CODES.none, "This account has no live invitation.");
    }
    await revokeRow(live, "revoked", actorId, transaction);
    await auditService.logAction(
      {
        tenantId,
        ...auditEntryActor(actor),
        action: "UPDATE",
        resourceType: "User",
        resourceId: user.id,
        clientFacilityId: user.clientFacilityId ?? null,
        changes: { operation: "REVOKE_USER_INVITATION", invitation: { id: live.id, hashPrefix: hashPrefix(live.tokenHash) }, ...actorChanges(actor) },
      },
      { transaction },
    );
    return { revokedAt: (live.revokedAt as Date).toISOString() };
  });
};
