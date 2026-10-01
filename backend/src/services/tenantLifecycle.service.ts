// P9-13 (ADR-087, Stage C; converted under the four isolation gates): from
// tenantLifecycle.service.js with no behaviour change. `export =` keeps the
// exact object `require()` returned (the same keys, in the same order; the
// formerly anonymous `exports.x = async () => …` functions are now named after
// their key, the one accepted surface change). A function that called a
// sibling through `exports.x` now calls it through that object
// (`service.checkGracePeriodExpired`, `service.offboardTenant`), so a spy on the
// module still intercepts the internal call. `Op`, `Transaction`, the five
// models, `AppError`, `logger`, `SYSTEM_ACTORS`, `db`, `runForTenant`,
// `PLATFORM_TENANT_ID`, the suspension helpers and the secret-setting helpers
// are captured at load, as the `.js` destructured them; `auditService` is the
// module object. featureFlag.service is still loaded here, at the same point:
// the `.js` destructured an `isEnabled` it never used, and the import keeps
// the load without the unused name. hardDeleteOffboardedTenant still requires
// the barrel, migration 0030 and the platform id when it runs. The
// environment is read once, at load, as before.
import { Op as LoadedOp, Transaction as LoadedTransaction } from "sequelize";
import type { ModelStatic, Model, Transaction as TransactionType } from "sequelize";

import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import "./featureFlag.service";
import auditService from "./audit.service";
import { SYSTEM_ACTORS as LOADED_SYSTEM_ACTORS } from "../constants/systemActors";
import { db as loadedDb } from "../config";
import { runForTenant as loadedRunForTenant } from "../utils/jobContext.util";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import {
  DUNNING_SUSPENSION_REASON as LOADED_DUNNING_SUSPENSION_REASON,
  isDunningSuspension as loadedIsDunningSuspension,
} from "../constants/tenantSuspension";
import {
  isRedactedSettingKey as loadedIsRedactedSettingKey,
  SECRET_SETTING_MASK as LOADED_SECRET_SETTING_MASK,
} from "../constants/tenantSecretSettings";
import { env, envOr } from "../config/env";
import type * as PlatformTenantModule from "../constants/platformTenant";
import type Migration0030 from "../migrations/0030-tenant-foreign-keys-restrict";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance, ModelsBarrel } from "../types/models";

const Op = LoadedOp;
const Transaction = LoadedTransaction;
const { Tenant, TenantSettings, User, Subscription, Invoice } = models;
const AppError = LoadedAppError;
const logger = loadedLogger;
const SYSTEM_ACTORS = LOADED_SYSTEM_ACTORS;
const db = loadedDb;
const runForTenant = loadedRunForTenant;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;
const DUNNING_SUSPENSION_REASON = LOADED_DUNNING_SUSPENSION_REASON;
const isDunningSuspension = loadedIsDunningSuspension;
const isRedactedSettingKey = loadedIsRedactedSettingKey;
const SECRET_SETTING_MASK = LOADED_SECRET_SETTING_MASK;

type TenantRow = ModelInstance<"Tenant">;

/** A thrown value, read the way the `.js` read it (`err.message`). */
interface Thrown {
  message?: unknown;
}

/** Who acted: auditActor(req), or `{ userId }` built from the caller's arguments. */
interface LifecycleActor {
  /** P9-20: widened to what auditActor(req) returns (type-only; written to the audit rows). */
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | readonly string[] | null;
}

/** The lifecycle fields an audit row records. */
interface LifecycleSnapshot {
  status: TenantRow["status"];
  suspensionReason: string | null;
  suspendedBy: UserId | null;
  gracePeriodExpiresAt: string | null;
  offboardedAt: string | null;
}

/**
 * The actor recorded on an audit row the scheduler writes: a job, not a user
 * (W-04). Since A-124 (ADR-051 Q-13) it is the row's first-class system
 * actor (`actor_type = 'system'`, `actor_name`), from the closed list in
 * constants/systemActors. `changes.actor` still carries it, so a reader of
 * rows from before and after migration 0033 finds it in the same place.
 */
const TENANT_LIFECYCLE_ACTOR = SYSTEM_ACTORS.TENANT_LIFECYCLE;

const GRACE_PERIOD_DAYS = parseInt(envOr("TENANT_GRACE_PERIOD_DAYS", "7"), 10);
const OFFBOARD_RETENTION_DAYS = parseInt(envOr("TENANT_OFFBOARD_RETENTION_DAYS", "30"), 10);

/**
 * Tenant Lifecycle Service
 *
 * Manages tenant states through their lifecycle:
 * - trial → active → suspended (dunning) → active → offboarded
 *
 * States:
 * - ACTIVE: normal operation
 * - SUSPENDED: dunning / payment failure / admin action
 * - TRIAL: free trial period
 * - OFFBOARDED: scheduled for deletion after retention period
 */

// A-276 (ADR-094): dunning's suspension (stripeWebhook.service) and the
// operator's are told apart by constants/tenantSuspension. Re-exported for
// callers of this service (the first two keys of the export object below).

/**
 * A-278 (ADR-094) — a lifecycle change by the platform operator is recorded
 * as A-165 records every operator change to a tenant: under PLATFORM (the
 * operator's trail, which outlives an offboarded tenant) and under the
 * tenant (whose administrators must see why they were suspended), inside the
 * change's transaction. docs/MULTI-TENANCY/01 § Lifecycle recorded that four
 * of the six transitions wrote none.
 *
 * @param {object} transaction
 * @param {{userId?: (string|null), ipAddress?: (string|null), userAgent?: (string|null)}} actor
 * @param {string} tenantId
 * @param {string} operation
 * @param {object} before
 * @param {object} after
 */
const auditOperatorChange = async (
  transaction: TransactionType,
  actor: LifecycleActor,
  tenantId: TenantId,
  operation: string,
  before: object,
  after: object,
): Promise<void> => {
  const entry = {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as no user
    userId: actor.userId || null,
    action: "UPDATE" as const,
    resourceType: "Tenant",
    resourceId: tenantId,
    changes: { operation, before, after },
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address reads as null
    ipAddress: actor.ipAddress || null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty agent reads as null
    userAgent: actor.userAgent || null,
  };
  await auditService.logAction({ ...entry, tenantId: PLATFORM_TENANT_ID }, { transaction });
  await auditService.logAction({ ...entry, tenantId }, { transaction });
};

/** The lifecycle fields an audit row records, as plain values. */
const lifecycleSnapshot = (tenant: TenantRow): LifecycleSnapshot => ({
  status: tenant.status,
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty reason reads as null
  suspensionReason: tenant.suspensionReason || null,
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as null
  suspendedBy: tenant.suspendedBy || null,
  gracePeriodExpiresAt: tenant.gracePeriodExpiresAt ? new Date(tenant.gracePeriodExpiresAt).toISOString() : null,
  offboardedAt: tenant.offboardedAt ? new Date(tenant.offboardedAt).toISOString() : null,
});

/** A-279: the one explanation for acting on an offboarded tenant. */
const offboardedConflict = (action: string): LoadedAppError =>
  new AppError(
    409,
    `This tenant is offboarded: it cannot be ${action}. Cancel the offboarding first ` +
      "(POST /tenants/:tenantId/offboard/cancel), which returns it to active.",
  );

const suspendTenant = async (
  tenantId: TenantId,
  reason: string | null,
  suspendedBy: UserId | null = null,
  actor: LifecycleActor = { userId: suspendedBy },
): Promise<TenantRow> => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }
  // A-279: suspending an offboarded tenant would leave offboarded_at set on a
  // tenant the scheduler then reads as merely suspended.
  if (tenant.status === "deleted") {
    throw offboardedConflict("suspended");
  }

  // A-276: an operator suspension already in place is a no-op. A DUNNING
  // suspension is not: the operator's suspension replaces it, so that a later
  // payment cannot lift what the operator decided.
  if (tenant.status === "suspended" && !isDunningSuspension(tenant)) {
    return tenant;
  }

  const before = lifecycleSnapshot(tenant);
  await db.transaction(async (transaction) => {
    tenant.status = "suspended";
    tenant.suspensionReason = reason;
    tenant.suspendedAt = new Date();
    tenant.suspendedBy = suspendedBy;
    await tenant.save({ transaction });

    await TenantSettings.upsert(
      {
        tenantId,
        key: "lifecycle_status",
        value: "SUSPENDED",
      },
      { transaction },
    );

    await auditOperatorChange(transaction, actor, tenantId, "TENANT_SUSPEND", before, lifecycleSnapshot(tenant));
  });

  // eslint-disable-next-line @typescript-eslint/await-thenable -- as built: the `.js` awaited the logger's return value, which yields one tick before returning
  await logger.warn(`Tenant suspended: ${tenantId}`, { reason, suspendedBy });

  return tenant;
};

const resumeTenant = async (
  tenantId: TenantId,
  resumedBy: UserId | null = null,
  actor: LifecycleActor = { userId: resumedBy },
): Promise<TenantRow> => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  if (tenant.status === "active") {
    return tenant;
  }
  // A-279: resuming an offboarded tenant set it active and left offboarded_at
  // and its retention deadline behind; cancelOffboarding is the way back.
  if (tenant.status === "deleted") {
    throw offboardedConflict("resumed");
  }

  const before = lifecycleSnapshot(tenant);
  await db.transaction(async (transaction) => {
    tenant.status = "active";
    tenant.suspensionReason = null;
    tenant.suspendedAt = null;
    tenant.suspendedBy = null;
    // A grace period belongs to the suspension it was granted in. Left in place,
    // a stale (already past) deadline would offboard the tenant on the first
    // scheduler run after any LATER suspension, with no grace at all.
    tenant.gracePeriodExpiresAt = null;
    await tenant.save({ transaction });

    await TenantSettings.upsert(
      {
        tenantId,
        key: "lifecycle_status",
        value: "ACTIVE",
      },
      { transaction },
    );

    await auditOperatorChange(transaction, actor, tenantId, "TENANT_RESUME", before, lifecycleSnapshot(tenant));
  });

  // eslint-disable-next-line @typescript-eslint/await-thenable -- as built: the `.js` awaited the logger's return value, which yields one tick before returning
  await logger.info(`Tenant resumed: ${tenantId}`, { resumedBy });

  return tenant;
};

const enterGracePeriod = async (tenantId: TenantId, actor: LifecycleActor = {}): Promise<TenantRow> => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  // W-21 (ADR-079): a grace period is the time a SUSPENDED tenant has before
  // it is offboarded. Set on any other tenant, the deadline waited silently:
  // a suspension after it had passed was offboarded by the next scheduler run,
  // with no grace at all.
  if (tenant.status !== "suspended") {
    throw new AppError(
      409,
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the status is interpolated as it is (a null reads "null")
      `This tenant is "${tenant.status}", not suspended: a grace period can only be set on a suspended tenant. Suspend it first.`,
    );
  }

  const graceExpiresAt = new Date();
  graceExpiresAt.setDate(graceExpiresAt.getDate() + GRACE_PERIOD_DAYS);

  const before = lifecycleSnapshot(tenant);
  await db.transaction(async (transaction) => {
    tenant.gracePeriodExpiresAt = graceExpiresAt;
    await tenant.save({ transaction });
    await auditOperatorChange(transaction, actor, tenantId, "TENANT_GRACE_PERIOD", before, {
      ...lifecycleSnapshot(tenant),
      gracePeriodDays: GRACE_PERIOD_DAYS,
    });
  });

  // eslint-disable-next-line @typescript-eslint/await-thenable -- as built: the `.js` awaited the logger's return value, which yields one tick before returning
  await logger.info(`Tenant entered grace period: ${tenantId}`, {
    gracePeriodDays: GRACE_PERIOD_DAYS,
    expiresAt: graceExpiresAt,
  });

  return tenant;
};

const checkGracePeriodExpired = async (tenantId: TenantId): Promise<boolean> => {
  const tenant = await Tenant.findByPk(tenantId);
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `!tenant || !tenant.gracePeriodExpiresAt`
  if (!tenant || !tenant.gracePeriodExpiresAt) {
    return false;
  }

  return new Date() > new Date(tenant.gracePeriodExpiresAt);
};

/**
 * Offboard a tenant: status -> 'deleted', a retention deadline, and the
 * OFFBOARDED lifecycle setting — and two audit rows recording it (A-305:
 * PLATFORM and the tenant), all in ONE
 * transaction (W-01 / W-04). A failed audit insert re-throws inside the
 * transaction (audit.service A-41), so the offboarding cannot commit
 * unrecorded; a failure part-way through leaves the tenant as it was.
 *
 * @param {string} tenantId
 * @param {boolean} [force=false] - re-offboard a tenant already 'deleted'
 * @param {object} [actor] - who did it (utils/auditActor.util shape)
 * @param {string|null} [actor.userId=null] - the operator; null means the
 *   scheduler, recorded as `changes.actor: "system:tenant-lifecycle"`
 * @param {string|null} [actor.ipAddress=null]
 * @param {string|null} [actor.userAgent=null]
 */
const offboardTenant = async (
  tenantId: TenantId,
  force: unknown = false,
  { userId = null, ipAddress = null, userAgent = null }: LifecycleActor = {},
): Promise<TenantRow | { tenant: TenantRow }> => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  if (tenant.status === "deleted" && !force) {
    return tenant;
  }

  // W-17 (ADR-073): no export is built here. The one this used to build was
  // taken before the transaction, returned to the operator's screen (which
  // ignored it) and discarded by the scheduler. Offboarding deletes nothing:
  // the data stays readable through GET /tenants/:tenantId/export until the
  // hard delete, which refuses while regulated records remain (D-23).
  const before = {
    status: tenant.status,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `|| null`
    gracePeriodExpiresAt: tenant.gracePeriodExpiresAt || null,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `|| null`
    offboardedAt: tenant.offboardedAt || null,
  };
  const offboardedAt = new Date();
  const retentionExpiresAt = new Date(offboardedAt);
  retentionExpiresAt.setDate(retentionExpiresAt.getDate() + OFFBOARD_RETENTION_DAYS);

  await db.transaction(async (transaction) => {
    tenant.status = "deleted";
    tenant.offboardedAt = offboardedAt;
    tenant.offboardRetentionExpiresAt = retentionExpiresAt;
    await tenant.save({ transaction });

    // tenant.status uses the enum's terminal 'deleted'; the granular lifecycle
    // state lives in the lifecycle_status setting that getStatus surfaces.
    await TenantSettings.upsert(
      {
        tenantId,
        key: "lifecycle_status",
        value: "OFFBOARDED",
      },
      { transaction },
    );

    const entry = {
      // A-124: exactly one actor — the operator, or else the scheduler.
      ...(userId ? { userId } : { systemActor: TENANT_LIFECYCLE_ACTOR }),
      action: "DELETE" as const,
      resourceType: "Tenant",
      resourceId: tenantId,
      ipAddress,
      userAgent,
      changes: {
        operation: "TENANT_OFFBOARD",
        ...(userId ? {} : { actor: TENANT_LIFECYCLE_ACTOR }),
        force: Boolean(force),
        before,
        after: {
          status: "deleted",
          lifecycleStatus: "OFFBOARDED",
          offboardedAt: offboardedAt.toISOString(),
          offboardRetentionExpiresAt: retentionExpiresAt.toISOString(),
          retentionDays: OFFBOARD_RETENTION_DAYS,
        },
      },
    };
    // A-305 (ADR-100): the A-165 rule, as suspend/resume (A-278) — under
    // PLATFORM (the operator's trail, which outlives the offboarded tenant)
    // and under the tenant, both in this transaction.
    await auditService.logAction({ ...entry, tenantId: PLATFORM_TENANT_ID }, { transaction });
    await auditService.logAction({ ...entry, tenantId }, { transaction });
  });

  // eslint-disable-next-line @typescript-eslint/await-thenable -- as built: the `.js` awaited the logger's return value, which yields one tick before returning
  await logger.warn(`Tenant offboarded: ${tenantId}`, {
    retentionDays: OFFBOARD_RETENTION_DAYS,
    expiresAt: tenant.offboardRetentionExpiresAt,
  });

  return { tenant };
};

const cancelOffboarding = async (tenantId: TenantId, actor: LifecycleActor = {}): Promise<TenantRow> => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  // A-279: a state conflict is a 409 that explains the state (CLAUDE.md
  // § Status Codes), not a 400.
  if (tenant.status !== "deleted") {
    throw new AppError(
      409,
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the status is interpolated as it is (a null reads "null")
      `This tenant is "${tenant.status}", not offboarded: there is no offboarding to cancel. ` +
        "Only an offboarded tenant can have its offboarding cancelled.",
    );
  }

  const before = lifecycleSnapshot(tenant);
  await db.transaction(async (transaction) => {
    tenant.status = "active";
    tenant.offboardedAt = null;
    tenant.offboardRetentionExpiresAt = null;
    // As in resumeTenant: an expired deadline must not survive into a later
    // suspension and offboard the tenant again with no grace.
    tenant.gracePeriodExpiresAt = null;
    await tenant.save({ transaction });

    // The OFFBOARDED lifecycle setting offboardTenant wrote goes with it.
    await TenantSettings.upsert(
      {
        tenantId,
        key: "lifecycle_status",
        value: "ACTIVE",
      },
      { transaction },
    );

    await auditOperatorChange(transaction, actor, tenantId, "TENANT_CANCEL_OFFBOARDING", before, lifecycleSnapshot(tenant));
  });

  // eslint-disable-next-line @typescript-eslint/await-thenable -- as built: the `.js` awaited the logger's return value, which yields one tick before returning
  await logger.info(`Offboarding cancelled for tenant: ${tenantId}`);

  return tenant;
};

/**
 * The tenant-scoped tables a hard delete removes itself, in this order, once
 * nothing retained is left (D-23): configuration, accounts, billing plan.
 * Everything on 0030's TENANT_FK_CASCADE list goes with the tenant row.
 */
const DELETED_WITH_TENANT = Object.freeze(["tenant_settings", "users", "subscriptions"]);

/** A tenant-scoped model and the attribute that carries its tenant. */
interface ScopedModel {
  model: ModelStatic<Model>;
  attribute: "tenantId" | "tenant_id" | null;
}

/**
 * Hard-delete an offboarded tenant whose retention period has expired.
 *
 * D-23 (ADR-064) — this force-deleted four tables in four autocommits and then
 * the tenant row, trusting CASCADE for the other ~50. Since 0030 every
 * regulated table's tenant key is ON DELETE RESTRICT, so on real data it
 * failed part-way — users and subscriptions gone, the tenant and its records
 * still there — or, before 0030, silently cascaded away calibration evidence.
 * Now, in ONE transaction:
 *  - the tenant must be offboarded (409) and past its retention date (409);
 *  - every tenant-scoped table that is neither CASCADE (0030) nor on
 *    DELETED_WITH_TENANT is counted — soft-deleted rows included, they are
 *    records too. If any holds rows, the delete is REFUSED (409) naming each
 *    table and count. Those are the records a hospital must retain
 *    (calibration records, certificates, signatures, the audit trail — which
 *    includes the offboarding itself); removing them is an archival
 *    decision, not a side effect of this call;
 *  - otherwise DELETED_WITH_TENANT goes in order, then the tenant row (its
 *    CASCADE tables with it), and one audit row under the platform tenant.
 *
 * In practice a tenant that ever wrote an audit row is refused: the answer to
 * "what is retained after a purge" is "every regulated record, until an
 * archival process removes it". None exists yet; nothing calls this today.
 *
 * @param {string} tenantId
 * @param {object} [actor] - auditActor(req); null userId records the scheduler
 * @returns {Promise<{tenantId: string, deleted: Object<string, number>}>}
 * @throws {AppError} 404 unknown tenant; 409 not offboarded, retention running, or records retained
 */
const hardDeleteOffboardedTenant = async (
  tenantId: TenantId,
  { userId = null, ipAddress = null, userAgent = null }: LifecycleActor = {},
): Promise<{ tenantId: TenantId; deleted: Record<string, number> }> => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: the barrel is required when the hard delete runs (see the file header)
  const barrel = require("../models") as ModelsBarrel;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: migration 0030's table list is required when the hard delete runs
  const { TENANT_FK_CASCADE } = require("../migrations/0030-tenant-foreign-keys-restrict") as typeof Migration0030;
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: the platform id is required again here, as the `.js` did (the same value)
  const { PLATFORM_TENANT_ID: platformTenantId } = require("../constants/platformTenant") as typeof PlatformTenantModule;

  return db.transaction(async (transaction) => {
    const tenant = await Tenant.findByPk(tenantId, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!tenant) {
      throw new AppError(404, "Tenant not found");
    }
    if (tenant.status !== "deleted") {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the status is interpolated as it is (a null reads "null")
      throw new AppError(409, `This tenant is "${tenant.status}", not offboarded: offboard it before it can be deleted`);
    }
    if (tenant.offboardRetentionExpiresAt && new Date() < new Date(tenant.offboardRetentionExpiresAt)) {
      throw new AppError(
        409,
        `The offboarded tenant's retention period runs until ${new Date(tenant.offboardRetentionExpiresAt).toISOString()}; it cannot be deleted before then`,
      );
    }

    const scoped: ScopedModel[] = [...new Set(Object.values(barrel.sequelize.models))]
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- as built: `rawAttributes` is what the `.js` read (tests stand models in with it); getAttributes() is a different call
      .map((model): ScopedModel => ({ model, attribute: model.rawAttributes["tenantId"] ? "tenantId" : model.rawAttributes["tenant_id"] ? "tenant_id" : null }))
      .filter(({ model, attribute }) => attribute && model.name !== "Tenant");
    const count = ({ model, attribute }: ScopedModel): Promise<number> =>
      model.unscoped().count({ where: { [attribute as string]: tenantId }, paranoid: false, skipTenantScope: true, transaction });

    const retained: string[] = [];
    for (const entry of scoped) {
      const table = entry.model.tableName;
      if (TENANT_FK_CASCADE.includes(table) || DELETED_WITH_TENANT.includes(table)) {continue;}
      const n = await count(entry);
      if (n > 0) {retained.push(`${table} (${String(n)})`);}
    }
    if (retained.length) {
      throw new AppError(
        409,
        `This tenant still holds records that are retained after offboarding: ${retained.sort().join(", ")}. ` +
          "Nothing was deleted. Removing retained records is an archival decision, not part of this operation.",
      );
    }

    const deleted: Record<string, number> = {};
    for (const table of DELETED_WITH_TENANT) {
      // As built: a table missing from the models throws here, reading `.model` of undefined.
      const entry = scoped.find(({ model }) => model.tableName === table) as ScopedModel;
      deleted[table] = await entry.model.unscoped().destroy({
        where: { [entry.attribute as string]: tenantId },
        force: true,
        skipTenantScope: true,
        transaction,
      });
    }
    await tenant.destroy({ force: true, transaction });

    await auditService.logAction(
      {
        tenantId: platformTenantId,
        ...(userId ? { userId } : { systemActor: TENANT_LIFECYCLE_ACTOR }),
        action: "DELETE",
        resourceType: "Tenant",
        resourceId: tenantId,
        ipAddress,
        userAgent,
        changes: {
          operation: "TENANT_HARD_DELETE",
          ...(userId ? {} : { actor: TENANT_LIFECYCLE_ACTOR }),
          before: { name: tenant.name, status: tenant.status },
          deleted,
        },
      },
      { transaction },
    );

    // eslint-disable-next-line @typescript-eslint/await-thenable -- as built: the `.js` awaited the logger's return value, which yields one tick before returning
    await logger.warn(`Hard-deleted offboarded tenant: ${tenantId}`);
    return { tenantId, deleted };
  });
};

/**
 * A-179 — the user attributes a tenant export may carry: an ALLOW-list.
 *
 * The export used to be `User.findAll()` whole, then `toJSON()`: the password
 * hash, the TOTP secret (live and pending), the recovery-code hashes, the
 * WebAuthn credential id and public key, the OTP hash and the lockout state of
 * every account went to the super admin's screen (GET /:tenantId/export) and
 * into the offboarding response. A deny-list is the shape A-139 showed fails —
 * a column added tomorrow (A-141's `mfaRecoveryCodes` was one) is exported
 * until someone remembers it — so the export names what it carries instead.
 * No credential, second-factor, one-time-code or lockout attribute is here.
 */
const EXPORTED_USER_ATTRIBUTES = Object.freeze([
  "id",
  "tenantId",
  "roleId",
  "username",
  "email",
  "firstName",
  "lastName",
  "phone",
  "avatarUrl",
  "isActive",
  "status",
  "isEmailVerified",
  "lastLoginAt",
  "createdAt",
  "updatedAt",
] as const);

/** A row the export reads: anything with `toJSON()`. */
interface JsonRow {
  toJSON: () => object;
}

/**
 * Copy the allow-listed fields of a row (nulls kept). A second line of defence
 * behind the SELECT list: whatever the row object carries — getters included
 * — only allow-listed keys leave.
 *
 * @param {object} row - a model instance
 * @param {ReadonlyArray<string>} fields - the allow-list
 * @returns {object} the projected plain object
 */
const project = (row: JsonRow, fields: readonly string[]): Record<string, unknown> => {
  const plain = row.toJSON() as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(plain, field)) {
      out[field] = plain[field];
    }
  }
  return out;
};

/**
 * A-179 — a `tenant_settings` row for the export. TenantSettings' `afterFind`
 * hook has already DECRYPTED every secret key, so a secret row keeps its key
 * (the reader can see it was configured) and its value reads
 * SECRET_SETTING_MASK — the same rule `GET /tenants/settings` applies (A-150).
 * An empty secret stays empty: nothing was configured.
 *
 * @param {object} setting - a TenantSettings instance
 * @returns {object} the plain row, with any secret value masked
 */
const exportedSetting = (setting: JsonRow): { key: string; value: unknown } => {
  const plain = setting.toJSON() as { key: string; value: unknown };
  if (isRedactedSettingKey(plain.key) && plain.value !== null && plain.value !== "") {
    plain.value = SECRET_SETTING_MASK;
  }
  return plain;
};

/**
 * A-179 — the tenant row without any credential mirrored into its
 * `tenants.settings` JSONB column (written there before migration 0035
 * scrubbed it, or by any path that still does).
 *
 * @param {object} tenant - a Tenant instance
 * @returns {object} the plain row
 */
const exportedTenant = (tenant: JsonRow): { settings?: unknown } => {
  const plain = tenant.toJSON() as { settings?: unknown };
  const { settings } = plain;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    plain.settings = Object.fromEntries(
      Object.entries(settings).filter(([key]) => !isRedactedSettingKey(key)),
    );
  }
  return plain;
};

const exportTenantData = async (
  tenantId: TenantId,
): Promise<{
  tenant: { settings?: unknown };
  users: Record<string, unknown>[];
  settings: { key: string; value: unknown }[];
  subscriptions: object[];
  invoices: object[];
  exportedAt: Date;
}> => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  // A-179: only allow-listed columns are selected, and only allow-listed keys
  // are returned.
  const users = await User.findAll({
    where: { tenantId },
    attributes: [...EXPORTED_USER_ATTRIBUTES],
  });
  const settings = await TenantSettings.findAll({ where: { tenantId } });
  const subscriptions = await Subscription.findAll({ where: { tenantId } });
  const invoices = await Invoice.findAll({ where: { tenantId } });

  return {
    tenant: exportedTenant(tenant),
    users: users.map((u) => project(u, EXPORTED_USER_ATTRIBUTES)),
    settings: settings.map(exportedSetting),
    subscriptions: subscriptions.map((s) => s.toJSON()),
    invoices: invoices.map((i) => i.toJSON()),
    exportedAt: new Date(),
  };
};

const getTenantLifecycleStatus = async (
  tenantId: TenantId,
): Promise<{
  status: TenantRow["status"];
  lifecycleStatus: string | null;
  gracePeriodExpiresAt: Date | null;
  gracePeriodExpired: boolean;
  offboardedAt: Date | null;
  offboardRetentionExpiresAt: Date | null;
}> => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  const lifecycleSetting = await TenantSettings.findOne({
    where: {
      tenantId,
      key: "lifecycle_status",
    },
  });

  const gracePeriodExpired = await service.checkGracePeriodExpired(tenantId);

  return {
    status: tenant.status,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty setting falls back to the tenant's status
    lifecycleStatus: lifecycleSetting?.value || tenant.status,
    gracePeriodExpiresAt: tenant.gracePeriodExpiresAt,
    gracePeriodExpired,
    offboardedAt: tenant.offboardedAt,
    offboardRetentionExpiresAt: tenant.offboardRetentionExpiresAt,
  };
};

/** Tenants read per page by the lifecycle processor (W-17). */
const LIFECYCLE_PAGE_SIZE = Number(env("TENANT_LIFECYCLE_PAGE_SIZE")) || 50;

/** One tenant's outcome in the lifecycle processor. */
type ProcessResult =
  | { tenantId: TenantId; action: "offboarded" }
  | { tenantId: TenantId; action: "failed"; error: unknown };

/**
 * The scheduled job (middlewares/tenantLifecycleScheduler.middleware):
 * offboard every suspended tenant whose grace period has passed.
 *
 * Tenant isolation. The job has no request, so it starts with no tenant
 * context — which the isolation hooks treat as "skip". `tenants` itself is not
 * tenant-scoped, so the SELECT below is the one legitimately cross-tenant read.
 * Each tenant's offboarding then runs inside a context naming THAT tenant and
 * nothing more (not super-admin, not system-task), so every tenant-scoped read
 * and write it makes is confined to it by the hooks as well as by its explicit
 * predicates. The job never runs with a scope wider than one tenant.
 *
 * One tenant's failure is logged and recorded, and the next tenant still runs.
 *
 * @returns {Promise<Array<{tenantId: string, action: 'offboarded'|'failed', error?: string}>>}
 */
const processExpiredGracePeriods = async (
  { pageSize = LIFECYCLE_PAGE_SIZE }: { pageSize?: number } = {},
): Promise<ProcessResult[]> => {
  const now = new Date();
  const results: ProcessResult[] = [];

  // W-17: keyset pages of ids, never the whole table's rows at once.
  let afterId: TenantId | null = null;
  for (;;) {
    // The ENUM's own lowercase value — PostgreSQL does not coerce, and
    // 'SUSPENDED' raised `invalid input value for enum enum_tenants_status`.
    const where: { status: "suspended"; gracePeriodExpiresAt: { [Op.lte]: Date }; id?: { [Op.gt]: TenantId } } = {
      status: "suspended",
      gracePeriodExpiresAt: { [Op.lte]: now },
    };
    if (afterId) {
      where.id = { [Op.gt]: afterId };
    }
    const tenants: TenantRow[] = await Tenant.findAll({
      where,
      attributes: ["id"],
      order: [["id", "ASC"]],
      limit: pageSize,
    });

    for (const tenant of tenants) {
      try {
        // W-12: the job helper, so every job's context is declared the same way.
        await runForTenant(tenant.id, () => service.offboardTenant(tenant.id));
        results.push({ tenantId: tenant.id, action: "offboarded" });
      } catch (err) {
        results.push({ tenantId: tenant.id, action: "failed", error: (err as Thrown).message });
        logger.error(`Tenant lifecycle: offboarding ${tenant.id} failed`, {
          tenantId: tenant.id,
          error: (err as Thrown).message,
        });
      }
    }

    if (tenants.length < pageSize) {
      break;
    }
    afterId = (tenants[tenants.length - 1] as TenantRow).id;
  }

  logger.info(`Processed ${String(results.length)} expired grace period(s)`, { results });

  return results;
};

const service = {
  DUNNING_SUSPENSION_REASON,
  isDunningSuspension,
  suspendTenant,
  resumeTenant,
  enterGracePeriod,
  checkGracePeriodExpired,
  offboardTenant,
  cancelOffboarding,
  hardDeleteOffboardedTenant,
  EXPORTED_USER_ATTRIBUTES,
  exportTenantData,
  getTenantLifecycleStatus,
  processExpiredGracePeriods,
};

export = service;
