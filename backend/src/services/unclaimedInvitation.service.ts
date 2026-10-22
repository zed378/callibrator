/**
 * P24-09b — the nightly deactivation of an imported account that has not claimed its invitation
 * (ADR-139 § 5).
 *
 * An imported account awaits its invitation (`awaiting_invitation`, P24-08) until the person accepts
 * one (P24-09a). This job marks it INACTIVE when its FIRST invitation was issued at least
 * UNCLAIMED_INVITATION_DAYS (30) ago and it still awaits:
 *
 *  - the active accounts still awaiting an invitation are read across tenants (a reviewed system
 *    task), a page of UNCLAIMED_INVITATION_PAGE at a time by id, at most UNCLAIMED_INVITATION_MAX_USERS
 *    per run — a page of never-invited accounts never stalls the run;
 *  - each account is judged and deactivated inside runForTenant(its tenant): the first invitation's
 *    `created_at`; then, in one transaction with the user row locked and re-checked,
 *    `isActive = false`, `status = INACTIVE` and one audit row (system actor
 *    `system:unclaimed-invitation`, the facility stamped);
 *  - an account never invited is untouched (the 30 days start at the first issue, not at import);
 *    the live invitation is left as it is — its acceptance is refused for an inactive account;
 *  - an administrator may reactivate the account and issue again; a re-run finds nothing more.
 *
 * Named exports only.
 */
import { Op } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import { runAsSystem, runForTenant, SYSTEM_TASKS } from "../utils/jobContext.util";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import { logger } from "../middlewares/activityLog.middleware";

/** The days after the first invitation (ADR-139 § 5). */
export const UNCLAIMED_INVITATION_DAYS = 30;
/** Accounts read per page. */
export const UNCLAIMED_INVITATION_PAGE = 500;
/** Accounts examined per run (the next run continues). */
export const UNCLAIMED_INVITATION_MAX_USERS = 5000;

const DAY_MS = 24 * 3600 * 1000;

/** What one run did. */
export interface UnclaimedSummary {
  readonly examined: number;
  readonly deactivated: number;
  readonly errors: number;
}

interface AwaitingUser {
  id: string;
  tenantId: string;
}

/** A page of active accounts still awaiting an invitation, after `afterId`, across tenants. */
const awaitingPage = (afterId: string | null): Promise<AwaitingUser[]> =>
  runAsSystem(SYSTEM_TASKS.UNCLAIMED_INVITATION, () =>
    models.User.findAll({
      where: { awaitingInvitation: true, isActive: true, ...(afterId ? { id: { [Op.gt]: afterId } } : {}) },
      attributes: ["id", "tenantId"],
      order: [["id", "ASC"]],
      limit: UNCLAIMED_INVITATION_PAGE,
    }),
  ) as unknown as Promise<AwaitingUser[]>;

/** Deactivate one account whose first invitation is old enough; whether it was. */
const deactivateIfUnclaimed = (account: AwaitingUser, now: Date): Promise<boolean> =>
  runForTenant(account.tenantId, async () => {
    const first = await models.UserInvitation.findOne({
      where: { userId: account.id },
      attributes: ["id", "createdAt"],
      order: [["createdAt", "ASC"]],
    });
    if (!first || first.createdAt.getTime() + UNCLAIMED_INVITATION_DAYS * DAY_MS > now.getTime()) {
      return false;
    }
    return db.transaction(async (transaction) => {
      const user = await models.User.findOne({ where: { id: account.id }, transaction, lock: transaction.LOCK.UPDATE });
      // Accepted or switched off since the page was read: nothing to do.
      if (!user?.awaitingInvitation || !user.isActive) {
        return false;
      }
      const statusBefore = user.status;
      await user.update({ isActive: false, status: "INACTIVE" }, { transaction });
      await auditService.logAction(
        {
          tenantId: account.tenantId,
          systemActor: SYSTEM_ACTORS.UNCLAIMED_INVITATION,
          action: "UPDATE",
          resourceType: "User",
          resourceId: user.id,
          clientFacilityId: user.clientFacilityId ?? null,
          changes: {
            operation: "DEACTIVATE_UNCLAIMED_ACCOUNT",
            reason: "INVITATION_UNCLAIMED",
            firstInvitationAt: first.createdAt.toISOString(),
            afterDays: UNCLAIMED_INVITATION_DAYS,
            statusBefore,
          },
        },
        { transaction },
      );
      return true;
    });
  });

/**
 * One run: every active account still awaiting an invitation whose first invitation is at least 30
 * days old is marked INACTIVE.
 *
 * @param now - the run's clock (tests pass one)
 * @returns accounts examined, deactivated, and accounts that failed
 */
export const deactivateUnclaimedAccounts = async (now: Date = new Date()): Promise<UnclaimedSummary> => {
  let examined = 0;
  let deactivated = 0;
  let errors = 0;
  let afterId: string | null = null;
  while (examined < UNCLAIMED_INVITATION_MAX_USERS) {
    const page: AwaitingUser[] = await awaitingPage(afterId);
    for (const account of page) {
      examined += 1;
      try {
        if (await deactivateIfUnclaimed(account, now)) {
          deactivated += 1;
        }
      } catch (err) {
        errors += 1;
        logger.error("Unclaimed invitation deactivation failed for an account; the next run retries it", { userId: account.id, error: String(err) });
      }
    }
    if (page.length < UNCLAIMED_INVITATION_PAGE) {
      break;
    }
    afterId = (page.at(-1) as AwaitingUser).id;
  }
  return { examined, deactivated, errors };
};
