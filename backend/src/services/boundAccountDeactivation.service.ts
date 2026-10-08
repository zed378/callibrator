/**
 * P21-09e — the nightly deactivation of a client facility's bound accounts after it ended
 * (spec MEMORY/specs/P19-04-client-facilities.md § 4.6; UD-18 (b), working decision 2026-10-08).
 *
 * Ending a facility deletes nothing and revokes its bound users' sessions (P21-09b). Its accounts
 * stay bound and refused (403 `FACILITY_ENDED`) and still count as seats; this job deactivates them
 * `client_facilities_bound_user_deactivation_days` days (per tenant; default 30) after the facility's
 * `statusChangedAt`:
 *
 *  - the ended facilities are read once across tenants (a reviewed system task, bounded);
 *  - each facility's ACTIVE bound users are deactivated inside runForTenant(its tenant), in one
 *    transaction per facility: `isActive = false`, `status = INACTIVE`, every session revoked, one
 *    audit row per user (system actor `system:bound-account-deactivation`, the facility named);
 *  - a reinstated facility (no longer `ended`) is not touched; a re-run finds nothing more.
 *
 * `client_facilities_ended_retention_years` (unset = no end date) is read by `endedRetentionYears`
 * for the data-retention report; nothing here purges evidence (a purge of append-only evidence
 * needs its own ADR). Named exports only.
 */
import { Op } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import sessionService from "./session.service";
import { runAsSystem, runForTenant, SYSTEM_TASKS } from "../utils/jobContext.util";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import { TENANT_ADMIN_INTEGER_SETTINGS, type TenantAdminIntegerSettingKey } from "../constants/tenantAdminSettings";
import { logger } from "../middlewares/activityLog.middleware";
import type { TenantId } from "../types/ids";

export const DEACTIVATION_DAYS_KEY: TenantAdminIntegerSettingKey = "client_facilities_bound_user_deactivation_days";
export const ENDED_RETENTION_YEARS_KEY: TenantAdminIntegerSettingKey = "client_facilities_ended_retention_years";
/** The days after `ended` when no tenant setting says otherwise (UD-18 (b)). */
export const DEFAULT_DEACTIVATION_DAYS = 30;
/** Ended facilities examined per run (the next run continues). */
export const DEACTIVATION_FACILITY_BATCH = 500;

const DAY_MS = 24 * 3600 * 1000;

/** A tenant's integer setting in its range, or null when unset or malformed. */
const integerSetting = async (tenantId: string, key: TenantAdminIntegerSettingKey): Promise<number | null> => {
  const row = await models.TenantSettings.findOne({ where: { tenantId, key }, attributes: ["value"] });
  const range = TENANT_ADMIN_INTEGER_SETTINGS[key];
  const raw = row?.value;
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }
  const n = Number(raw);
  return Number.isInteger(n) && n >= range.min && n <= range.max ? n : null;
};

/** The days after `ended` before a tenant's bound accounts are deactivated. */
export const deactivationDaysOf = async (tenantId: string): Promise<number> =>
  (await integerSetting(tenantId, DEACTIVATION_DAYS_KEY)) ?? DEFAULT_DEACTIVATION_DAYS;

/** The years a tenant keeps an ended facility's records, or null for no end date. */
export const endedRetentionYears = async (tenantId: string): Promise<number | null> => integerSetting(tenantId, ENDED_RETENTION_YEARS_KEY);

/** What one run did. */
export interface DeactivationSummary {
  readonly facilities: number;
  readonly due: number;
  readonly deactivated: number;
  readonly errors: number;
}

interface EndedFacility {
  id: string;
  tenantId: string;
  /** Never null here: the read excludes facilities without one. */
  statusChangedAt: Date;
}

/** Deactivate one ended facility's active bound accounts, audited, in one transaction. */
const deactivateFacilityAccounts = async (facility: EndedFacility, days: number): Promise<number> =>
  runForTenant(facility.tenantId, () =>
    db.transaction(async (transaction) => {
      const users = await models.User.findAll({
        where: { tenantId: facility.tenantId as TenantId, clientFacilityId: facility.id, isActive: true },
        attributes: ["id", "status", "isActive"],
        order: [["id", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      for (const user of users) {
        const statusBefore = user.status;
        await user.update({ isActive: false, status: "INACTIVE" }, { transaction });
        const sessionsRevoked = await sessionService.revokeOtherSessions(user.id, null, "FACILITY_ENDED", { transaction });
        await auditService.logAction(
          {
            tenantId: facility.tenantId,
            systemActor: SYSTEM_ACTORS.BOUND_ACCOUNT_DEACTIVATION,
            action: "UPDATE",
            resourceType: "User",
            resourceId: user.id,
            clientFacilityId: facility.id,
            changes: {
              operation: "DEACTIVATE_BOUND_ACCOUNT",
              reason: "FACILITY_ENDED",
              endedAt: facility.statusChangedAt,
              afterDays: days,
              statusBefore,
              sessionsRevoked,
            },
          },
          { transaction },
        );
      }
      return users.length;
    }),
  );

/**
 * One run: every facility ended at least its tenant's deactivation period ago loses its active
 * bound accounts.
 *
 * @param now - the run's clock (tests pass one)
 * @returns facilities examined, due, accounts deactivated, facilities that failed
 */
export const deactivateEndedFacilityAccounts = async (now: Date = new Date()): Promise<DeactivationSummary> => {
  const ended = (await runAsSystem(SYSTEM_TASKS.BOUND_ACCOUNT_DEACTIVATION, () =>
    models.ClientFacility.findAll({
      where: { status: "ended", statusChangedAt: { [Op.ne]: null } },
      attributes: ["id", "tenantId", "statusChangedAt"],
      order: [["id", "ASC"]],
      limit: DEACTIVATION_FACILITY_BATCH,
    }),
  )) as unknown as EndedFacility[];
  let due = 0;
  let deactivated = 0;
  let errors = 0;
  for (const facility of ended) {
    try {
      const days = await runForTenant(facility.tenantId, () => deactivationDaysOf(facility.tenantId));
      const endedAt = new Date(facility.statusChangedAt).getTime();
      if (endedAt + days * DAY_MS > now.getTime()) {
        continue;
      }
      due += 1;
      deactivated += await deactivateFacilityAccounts(facility, days);
    } catch (err) {
      errors += 1;
      logger.error("Bound account deactivation failed for a facility; the next run retries it", { clientFacilityId: facility.id, error: String(err) });
    }
  }
  return { facilities: ended.length, due, deactivated, errors };
};
