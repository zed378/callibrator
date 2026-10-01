/**
 * P10-15 (ADR-098 §8.4, Q-45) — accepting the invitation an approved access
 * request sent its first tenant administrator: the single-use, time-limited
 * link sets the password.
 *
 * THE TOKEN is 256 random bits (base64url), not a JWT: its sha256 is stored on
 * the access request (`invitation_token_hash`, unique), so it can be spent
 * exactly once and re-issuing it (P10-07) invalidates the old one. Being no
 * JWT at all, it can never be taken for an access, activation, MFA or
 * password-change token — nor any of those for it (P10-15 abuse case).
 *
 * Every refusal — no such token, spent, expired, the request not approved, the
 * account gone — is ONE 400 with one message: the caller learns nothing about
 * which. The password is set, the address marked verified (the mailbox is now
 * proven), the token spent and the audit row written in one transaction.
 */
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { AppError } from "../utils/appError.util";
import { logger } from "../middlewares/activityLog.middleware";
import { hashPassword } from "../utils/password.util";
import { invitationTokenHash } from "./accessRequest.service";

const { AccessRequest, User } = models;

/** The one answer to any invitation that cannot be accepted. */
export const INVITATION_INVALID = "This invitation link is invalid or has expired";

/** The statuses an account may not be activated from (auth.service's REFUSED_STATUSES). */
const REFUSED_STATUSES = new Set(["INACTIVE", "SUSPENDED", "erased"]);

/** Where the acceptance came from (never the body). */
export interface AcceptContext {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/**
 * Accept an invitation: set the administrator's password.
 *
 * @param token - the token from the link
 * @param password - already checked against the password rule (validator)
 * @throws {AppError} 400 INVITATION_INVALID for every refusal
 */
export const acceptInvitation = async (token: string, password: string, context: AcceptContext): Promise<void> => {
  const hash = invitationTokenHash(token);
  // Hashed before the transaction: bcrypt holds no row lock.
  const hashed = await hashPassword(password);

  const accepted = await db.transaction(async (transaction) => {
    const request = await AccessRequest.findOne({
      where: { invitationTokenHash: hash },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const now = new Date();
    if (
      request?.status !== "approved" ||
      request.adminUserId === null ||
      request.invitationAcceptedAt !== null ||
      request.invitationExpiresAt === null ||
      request.invitationExpiresAt.getTime() <= now.getTime()
    ) {
      // Which of the reasons it was is visible from the request row itself.
      logger.info("Invitation refused", { accessRequestId: request?.id ?? null });
      return null;
    }

    // Pre-authentication: there is no tenant context to scope by (the hooks
    // skip without one), and the account is named by the request, not input.
    const user = await User.findByPk(request.adminUserId, { transaction });
    if (!user || !user.isActive || REFUSED_STATUSES.has(user.status)) {
      logger.info("Invitation refused: the account is gone or refused", { accessRequestId: request.id });
      return null;
    }

    // An instance save, so the User model's hooks run (the one-time flag is
    // cleared with any password change, P10-16 — ADR-099).
    user.set({
      password: hashed,
      isEmailVerified: true,
      mustChangePassword: false,
      temporaryPasswordExpiresAt: null,
      passwordChangedAt: now,
      passwordOneTime: false,
    });
    await user.save({ transaction });
    await request.update({ invitationTokenHash: null, invitationAcceptedAt: now }, { transaction });
    await auditService.logAction(
      {
        tenantId: user.tenantId,
        userId: user.id,
        action: "UPDATE",
        resourceType: "User",
        resourceId: user.id,
        // No secret: `operation` names the act (audit rows are permanent).
        changes: { operation: "INVITATION_ACCEPTED", accessRequestId: request.id, emailVerified: true },
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
      { transaction },
    );
    return user.id;
  });

  if (accepted === null) {
    throw new AppError(400, INVITATION_INVALID);
  }
  logger.info("Invitation accepted", { userId: accepted });
};
