// P9-13 (ADR-087, Stage C): converted from dataRetention.service.js with no
// behaviour change. `export =` keeps the exact object `require()` returned (the
// same keys, in the same order; the formerly anonymous `exports.x = async () =>
// …` functions are now named after their key, the one accepted surface
// change). A function that called a sibling through `exports.x` now calls it
// through that object (`service.isOnLegalHold`, `service.purgeExpiredRecords`),
// so a spy on the module still intercepts the internal call. `Op`, the four
// models, `AppError`, `logger`, `db` and `runForTenant` are captured at load, as
// the `.js` destructured them; `auditService` is the module object. The lazy
// requires stay lazy: the models barrel (Tenant, AuditLog, User), gdpr.service
// and upload.util. The environment is still read once, at load.
import { Op as LoadedOp } from "sequelize";
import type { Transaction } from "sequelize";

import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import auditService from "./audit.service";
import { db as loadedDb } from "../config";
import { runForTenant as loadedRunForTenant } from "../utils/jobContext.util";
import { env, envOr } from "../config/env";
import type * as UploadUtil from "../utils/upload.util";
import type { TenantId } from "../types/ids";
import type { ModelInstance, ModelsBarrel } from "../types/models";

const Op = LoadedOp;
const { IotReading, Notification, Session, TenantSettings } = models;
const AppError = LoadedAppError;
const logger = loadedLogger;
const db = loadedDb;
const runForTenant = loadedRunForTenant;

type AuditLogRow = ModelInstance<"AuditLog">;
type TenantRow = ModelInstance<"Tenant">;

/** The barrel, required when the calling function runs (never at this module's load), as the `.js` did. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: the functions that need Tenant, AuditLog and User load the barrel when they run (see the file header)
const loadModels = (): ModelsBarrel => require("../models") as ModelsBarrel;

/** What gdpr.service (still JavaScript) gives this module: the export purge (W-15). */
interface GdprExportPurge {
  purgeExpiredExports: () => Promise<{ deleted: number; errors: number }>;
}

/** A thrown value, read the way the `.js` read it (`err.message`). */
interface Thrown {
  message?: unknown;
}

/** Who acted: auditActor(req). */
interface RetentionActor {
  /** P9-20: widened to what auditActor(req) returns (type-only; written to the audit row and echoed back). */
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | readonly string[] | null;
}

/** The actor recorded on the purge's audit row: a job, not a user (W-04). */
const RETENTION_ACTOR = "system:retention-purge";

/**
 * The entities the retention purge may destroy, and their platform default
 * periods in days. Every tenant inherits these; `tenant_settings`
 * `retention_policy_<entity>` overrides them per tenant. `0` means keep forever.
 *
 * `audit_logs` is deliberately NOT here, and must never be added (A-121,
 * ADR-051 Q-12). Audit rows are the Part 11 / ISO 17025 trail: they are never
 * purged by a scheduled job. Volume is handled by partitioning and archiving,
 * and GDPR minimisation inside an audit row by masking (`maskPII`), never by
 * deleting the row. There is one purge engine, this one (Q-10, F-4).
 */
const DEFAULT_RETENTION_DAYS = {
  notifications: parseInt(envOr("NOTIFICATION_RETENTION_DAYS", "90"), 10),
  sessions: parseInt(envOr("SESSION_RETENTION_DAYS", "30"), 10),
  // D-19: device telemetry, one row per device per interval. The platform
  // default is 0 — kept — because readings are the environmental record a
  // calibration relies on (ISO 17025 6.3.3; 0037 made their device link
  // RESTRICT for that reason). A tenant, or IOT_READING_RETENTION_DAYS, opts
  // in to a period, never shorter than the floor below.
  iot_readings: parseInt(envOr("IOT_READING_RETENTION_DAYS", "0"), 10),
};

/** A purgeable entity: a key of DEFAULT_RETENTION_DAYS. */
type PurgeableEntity = keyof typeof DEFAULT_RETENTION_DAYS;

/**
 * The shortest purge period each entity may be given, in days (A-121, ADR-051
 * Q-10). A tenant may raise a period or set `0` (keep forever); it may not go
 * below the floor. The floor is also applied to what is already stored, so an
 * override written before the floor existed cannot purge sooner.
 *
 * - notifications, 30 days: calibration-due, approval and signing requests are
 *   delivered as notifications. A user back from a month's leave must still
 *   find what was sent to them while away.
 * - sessions, 30 days: a session row carries the IP, user agent and revocation
 *   reason of a sign-in. It must outlive the longest refresh token
 *   (`JWT_REFRESH_EXPIRED`, 7 days by default) with a margin, and a month of
 *   sign-in history is the least a security investigation needs.
 */
const MIN_RETENTION_DAYS = Object.freeze({
  notifications: 30,
  sessions: 30,
  // - iot_readings, 730 days: two annual calibration intervals — the readings
  //   behind the current calibration and the one before it stay available to
  //   an assessor asking about the conditions a device was used in.
  iot_readings: 730,
});

const isPurgeable = (entity: unknown): entity is PurgeableEntity =>
  Object.prototype.hasOwnProperty.call(DEFAULT_RETENTION_DAYS, entity as PropertyKey);

/** One retention value that could not be applied (W-16). */
interface RetentionAnomaly {
  entity: string;
  source: "environment" | "tenant_settings";
  value: unknown;
  appliedDays: number | null;
}

/**
 * Data Retention & Purge Service
 *
 * Manages:
 * - Automated purging of old records based on retention policies
 * - Legal hold (prevents purge for specific tenants/records)
 * - PII masking for anonymized datasets
 */

/**
 * A tenant's retention periods: the platform defaults overlaid with the
 * tenant's stored overrides. Only purgeable entities are reported; a stored
 * key for anything else (a `retention_policy_audit_logs` row written before
 * A-121) is ignored, so it neither shows as configured nor reaches the purge.
 *
 * W-16 (ADR-079): a stored override that is not a whole number of days (`""`,
 * `"forever"`, `"30abc"`, null) is NOT applied. The entity keeps its platform
 * default and the value is reported as an anomaly by readRetentionPolicy.
 * `parseInt` used to turn it into NaN (or silently into 30 for `"30abc"`),
 * and the purge then skipped that entity every night with no trace.
 *
 * @param {string} tenantId
 * @returns {Promise<Record<string, number>>}
 */
const getRetentionPolicy = async (tenantId: TenantId): Promise<Record<PurgeableEntity, number>> =>
  (await readRetentionPolicy(tenantId)).policies;

/** A stored retention period: a whole, non-negative number of days, as text. */
const STORED_DAYS = /^\d+$/;

/**
 * W-16 — the tenant's periods, and every value that could not be applied.
 *
 * - A stored override that does not parse falls back to the platform default
 *   (`source: "tenant_settings"`, `appliedDays`: the default).
 * - A platform default that does not parse (a malformed
 *   `NOTIFICATION_RETENTION_DAYS`, say) has nothing to fall back to: that
 *   entity is not purged, and it is reported (`source: "environment"`,
 *   `appliedDays: null`).
 *
 * @param {string} tenantId
 * @returns {Promise<{policies: Record<string, number>, anomalies: Array<{entity: string, source: string, value: *, appliedDays: number|null}>}>}
 */
const readRetentionPolicy = async (
  tenantId: TenantId,
): Promise<{ policies: Record<PurgeableEntity, number>; anomalies: RetentionAnomaly[] }> => {
  const stored = await TenantSettings.findAll({
    where: {
      tenantId,
      key: { [Op.like]: "retention_policy_%" },
    },
  });

  const policies = { ...DEFAULT_RETENTION_DAYS };
  const anomalies: RetentionAnomaly[] = [];
  for (const [entity, days] of Object.entries(DEFAULT_RETENTION_DAYS)) {
    if (!Number.isInteger(days) || days < 0) {
      anomalies.push({ entity, source: "environment", value: days, appliedDays: null });
    }
  }
  stored.forEach((p) => {
    const key = p.key.replace("retention_policy_", "");
    if (!isPurgeable(key)) {
      return;
    }
    // As built: a stored value that is not text is still read.
    const text = typeof p.value === "string" ? p.value.trim() : String(p.value);
    if (STORED_DAYS.test(text)) {
      policies[key] = Number(text);
    } else {
      anomalies.push({ entity: key, source: "tenant_settings", value: p.value, appliedDays: DEFAULT_RETENTION_DAYS[key] });
    }
  });

  return { policies, anomalies };
};

/**
 * Set one tenant's retention period for one purgeable entity.
 *
 * Refused with 400: a missing tenant (retention policies are per tenant; the
 * platform default lives in code and the environment, ADR-051 Q-10),
 * `audit_logs` (never purged, Q-12), an unknown entity, a negative period, and
 * a positive period below the entity's floor (`MIN_RETENTION_DAYS`). `0` means
 * keep forever and is always allowed.
 *
 * A-153: the change and its audit row (the period before and after) are ONE
 * transaction. A retention period decides when records are destroyed; it was
 * changed with no record of who changed it or from what.
 *
 * @param {string} tenantId
 * @param {string} policyKey
 * @param {number} days
 * @param {object} [actor] - auditActor(req): the audit row's actor
 * @returns {Promise<{policyKey: string, days: number}>}
 */
const setRetentionPolicy = async (
  tenantId: TenantId,
  policyKey: string,
  days: number,
  actor: RetentionActor = {},
): Promise<{ policyKey: PurgeableEntity; days: number }> => {
  if (!tenantId) {
    throw new AppError(
      400,
      "Retention policies are set per tenant. The platform default is set by NOTIFICATION_RETENTION_DAYS and SESSION_RETENTION_DAYS.",
    );
  }

  if (policyKey === "audit_logs") {
    throw new AppError(
      400,
      "Audit logs are not subject to retention purge: audit rows are kept, never deleted.",
    );
  }

  if (!isPurgeable(policyKey)) {
    throw new AppError(400, `Unknown retention policy: ${policyKey}`);
  }

  // W-16: the route's validator already requires an integer; the service is
  // the supported path for every caller, so it refuses one too.
  if (!Number.isInteger(days)) {
    throw new AppError(400, "Retention days must be a whole number of days");
  }

  if (days < 0) {
    throw new AppError(400, "Retention days must be non-negative");
  }

  const floor = MIN_RETENTION_DAYS[policyKey];
  if (days > 0 && days < floor) {
    throw new AppError(
      400,
      `Retention for ${policyKey} must be at least ${String(floor)} days, or 0 to keep forever.`,
    );
  }

  const key = `retention_policy_${policyKey}`;
  await db.transaction(async (transaction) => {
    const existing = await TenantSettings.findOne({ where: { tenantId, key }, transaction });
    await TenantSettings.upsert({ tenantId, key, value: String(days) }, { transaction });
    await auditService.logAction(
      {
        ...actorEntry(tenantId, actor),
        action: "UPDATE",
        resourceType: "DataRetention",
        resourceId: tenantId,
        changes: {
          operation: "SET_RETENTION_POLICY",
          policyKey,
          // null: the platform default applied until now.
          // parseInt applies ToString to its argument, so String(null) → NaN, as parseInt(null) was.
          before: { days: existing ? parseInt(String(existing.value), 10) : null },
          after: { days },
        },
      },
      { transaction },
    );
  });

  return { policyKey, days };
};

const isOnLegalHold = async (tenantId: TenantId): Promise<boolean> => {
  const setting = await TenantSettings.findOne({
    where: {
      tenantId,
      key: "legal_hold_enabled",
    },
  });

  return setting?.value === "true";
};

/**
 * The audit-row fields for a request's actor (auditActor(req)). The user is the
 * actor; logAction refuses an entry that names none (A-124), which rolls the
 * change back.
 *
 * @param {string} tenantId - the tenant the change is about
 * @param {object} actor - auditActor(req)
 * @returns {object} tenantId, userId, ipAddress, userAgent
 */
const actorEntry = (
  tenantId: TenantId,
  actor: RetentionActor,
): { tenantId: TenantId; userId: string | null; ipAddress: string | null; userAgent: string | readonly string[] | null } => ({
  tenantId,
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as no user
  userId: actor.userId || null,
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address reads as null
  ipAddress: actor.ipAddress || null,
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty agent reads as null
  userAgent: actor.userAgent || null,
});

/**
 * Place a tenant under legal hold: no purge, masking or anonymisation until it
 * is released.
 *
 * A-153: the three settings and the audit row are ONE transaction. A hold
 * suspends the retention engine — whether one was in force, from when, set by
 * whom and why is exactly what a regulator or a court asks — and it was
 * enabled with a log line only.
 *
 * @param {string} tenantId
 * @param {object} actor - auditActor(req); its user is recorded as enabling it
 * @param {string} [reason]
 * @returns {Promise<{tenantId: string, enabled: true, reason: string, enabledBy: string}>}
 */
const enableLegalHold = async (
  tenantId: TenantId,
  actor: RetentionActor,
  reason?: string | null,
): Promise<{ tenantId: TenantId; enabled: true; reason: string | null | undefined; enabledBy: string | null | undefined }> => {
  const enabledBy = actor.userId;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty reason gets the default text
  const holdReason = reason || "Legal hold enabled";

  await db.transaction(async (transaction) => {
    const wasOnHold = await TenantSettings.findOne({
      where: { tenantId, key: "legal_hold_enabled" },
      transaction,
    });
    for (const [key, value] of [
      ["legal_hold_enabled", "true"],
      ["legal_hold_reason", holdReason],
      ["legal_hold_enabled_by", String(enabledBy)],
    ] as const) {
      await TenantSettings.upsert({ tenantId, key, value }, { transaction });
    }
    await auditService.logAction(
      {
        ...actorEntry(tenantId, actor),
        action: "UPDATE",
        resourceType: "LegalHold",
        resourceId: tenantId,
        changes: {
          operation: "LEGAL_HOLD_ENABLE",
          before: { onHold: wasOnHold?.value === "true" },
          after: { onHold: true, reason: holdReason },
        },
      },
      { transaction },
    );
  });

  logger.warn(`Legal hold enabled for tenant ${tenantId}`, { reason, enabledBy });

  return { tenantId, enabled: true, reason, enabledBy };
};

/**
 * Release a tenant's legal hold (A-153: in one transaction with its audit
 * row, which keeps the reason the hold was placed for).
 *
 * @param {string} tenantId
 * @param {object} actor - auditActor(req); its user is recorded as releasing it
 * @returns {Promise<{tenantId: string, enabled: false, disabledBy: string}>}
 */
const disableLegalHold = async (
  tenantId: TenantId,
  actor: RetentionActor,
): Promise<{ tenantId: TenantId; enabled: false; disabledBy: string | null | undefined }> => {
  const disabledBy = actor.userId;

  await db.transaction(async (transaction) => {
    const reason = await TenantSettings.findOne({
      where: { tenantId, key: "legal_hold_reason" },
      transaction,
    });
    const released = await TenantSettings.destroy({
      where: {
        tenantId,
        key: ["legal_hold_enabled", "legal_hold_reason", "legal_hold_enabled_by"],
      },
      transaction,
    });
    await auditService.logAction(
      {
        ...actorEntry(tenantId, actor),
        action: "UPDATE",
        resourceType: "LegalHold",
        resourceId: tenantId,
        changes: {
          operation: "LEGAL_HOLD_RELEASE",
          before: { onHold: released > 0, reason: reason ? reason.value : null },
          after: { onHold: false },
        },
      },
      { transaction },
    );
  });

  logger.info(`Legal hold disabled for tenant ${tenantId}`, { disabledBy });

  return { tenantId, enabled: false, disabledBy };
};

/** Rows of one table one purge pass deletes at most (W-17). */
const PURGE_BATCH_SIZE = Number(env("RETENTION_PURGE_BATCH_SIZE")) || 5000;
/** Tenants read per page by the sweep (W-17). */
const SWEEP_TENANT_PAGE_SIZE = Number(env("RETENTION_SWEEP_TENANT_PAGE_SIZE")) || 100;
/** After this long, a sweep stops starting catch-up passes (W-17). */
const SWEEP_BUDGET_MS = Number(env("RETENTION_SWEEP_BUDGET_MS")) || 15 * 60 * 1000;

/**
 * Delete one bounded batch of `entity` rows older than `cutoff`, for one tenant.
 * `limit` becomes `DELETE ... WHERE id IN (SELECT id ... LIMIT n)` on PostgreSQL.
 */
const purgeBatch = (
  entity: string,
  tenantId: TenantId,
  cutoff: Date,
  limit: number,
  transaction: Transaction,
): Promise<number> => {
  switch (entity) {
    case "notifications":
      return Notification.destroy({
        where: { tenantId, createdAt: { [Op.lt]: cutoff } },
        limit,
        transaction,
      });
    case "sessions":
      return Session.destroy({
        where: {
          // The Session model names this attribute `tenant_id` (not tenantId),
          // so querying by `tenantId` throws "column tenantId does not exist".
          tenant_id: tenantId,
          createdAt: { [Op.lt]: cutoff },
        },
        limit,
        transaction,
      });
    default:
      // "iot_readings" — D-19: served by iot_readings_tenant_id_timestamp (migration 0067).
      return IotReading.destroy({
        where: { tenantId, timestamp: { [Op.lt]: cutoff } },
        limit,
        transaction,
      });
  }
};

/** What one tenant's purge answers. */
type PurgeResult =
  | { skipped: true; reason: "legal_hold" }
  | {
      tenantId: TenantId;
      purged: Record<string, number>;
      skipped: false;
      complete: boolean;
      anomalies: RetentionAnomaly[];
    };

/**
 * Purge one tenant's expired notifications, sessions and (when configured)
 * IoT readings.
 *
 * W-04 / W-16 — each pass's deletes and the audit row that records them are
 * ONE transaction: a purge whose record cannot be written does not happen
 * (logAction re-throws inside a transaction), and a failure part-way through
 * rolls the pass back instead of leaving the tenant half-purged.
 *
 * W-17 — a pass deletes at most `batchSize` rows of each table. A table that
 * filled its batch gets another pass (another transaction, another audit row)
 * until it is done or `deadline` has passed; `complete: false` then says rows
 * were left for the next run. One tenant's backlog can no longer make one
 * transaction delete millions of rows.
 *
 * A-121 (ADR-051 Q-12): audit_logs is not a purgeable entity. There is no
 * case for it here and getRetentionPolicy never reports it.
 *
 * @param {string} tenantId
 * @param {object} [opts]
 * @param {number} [opts.batchSize] - rows per table per pass (RETENTION_PURGE_BATCH_SIZE, 5000)
 * @param {number|null} [opts.deadline] - epoch ms after which no further pass starts
 * @returns {Promise<{tenantId: string, purged: object, skipped: false, complete: boolean}|{skipped: true, reason: string}>}
 */
const purgeExpiredRecords = async (
  tenantId: TenantId,
  { batchSize = PURGE_BATCH_SIZE, deadline = null }: { batchSize?: number; deadline?: number | null } = {},
): Promise<PurgeResult> => {
  const onLegalHold = await service.isOnLegalHold(tenantId);

  if (onLegalHold) {
    logger.info(`Purge skipped for tenant ${tenantId}: legal hold active`);
    return { skipped: true, reason: "legal_hold" };
  }

  const { policies, anomalies } = await readRetentionPolicy(tenantId);
  // W-16: a value that could not be applied is reported loudly, and the run
  // that met it counts it (runRetentionSweep's `anomalies`, which the
  // scheduler treats as a failed run). It is never a silent skip.
  for (const anomaly of anomalies) {
    logger.error(
      `Retention policy for tenant ${tenantId}: ${anomaly.entity} = ${JSON.stringify(anomaly.value)} ` +
        `(${anomaly.source}) is not a whole number of days; ` +
        (anomaly.appliedDays === null
          ? "that entity is NOT purged until it is fixed"
          : `the platform default of ${String(anomaly.appliedDays)} days applies`),
    );
  }
  const results: Record<string, number> = {};
  const cutoffs: Record<string, string> = {};
  const cutoffDates: Record<string, Date> = {};

  for (const [entity, configuredDays] of Object.entries(policies)) {
    // 0 means keep forever; a value that does not parse is an anomaly above.
    if (!Number.isInteger(configuredDays) || configuredDays <= 0) {
      continue;
    }
    // An override stored before the floor existed cannot purge sooner.
    // `policies` holds only purgeable entities (readRetentionPolicy).
    const retentionDays = Math.max(configuredDays, MIN_RETENTION_DAYS[entity as PurgeableEntity]);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);
    cutoffDates[entity] = cutoff;
    cutoffs[entity] = cutoff.toISOString();
  }

  let pending = Object.keys(cutoffDates);
  while (pending.length > 0) {
    const pass: Record<string, number> = {};
    const full: string[] = [];
    const entities = pending;
    await db.transaction(async (transaction) => {
      for (const entity of entities) {
        const deletedCount = await purgeBatch(entity, tenantId, cutoffDates[entity] as Date, batchSize, transaction);
        if (deletedCount > 0) {
          pass[entity] = deletedCount;
        }
        if (deletedCount >= batchSize) {
          full.push(entity);
        }
      }

      // Nothing destroyed, nothing to record.
      if (Object.keys(pass).length > 0) {
        await auditService.logAction(
          {
            tenantId,
            systemActor: RETENTION_ACTOR, // A-124: a job, from constants/systemActors
            action: "DELETE",
            resourceType: "DataRetention",
            resourceId: null,
            changes: {
              operation: "RETENTION_PURGE",
              actor: RETENTION_ACTOR,
              before: { retentionDays: policies },
              after: { purged: pass, cutoffs },
              // W-17: the pass's bound, and the tables that filled it (more remain).
              batch: { size: batchSize, full },
            },
          },
          { transaction },
        );
      }
    });

    for (const [entity, n] of Object.entries(pass)) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `(results[entity] || 0) + n`
      results[entity] = (results[entity] || 0) + n;
    }
    pending = full;
    if (pending.length > 0 && deadline !== null && Date.now() >= deadline) {
      break;
    }
  }

  logger.info(`Purge completed for tenant ${tenantId}`, results);

  return { tenantId, purged: results, skipped: false, complete: pending.length === 0, anomalies };
};

/** The sweep's counts (runRetentionSweep). */
interface SweepSummary {
  tenants: number;
  purged: number;
  skipped: number;
  errors: number;
  incomplete: number;
  anomalies: number;
  exportsDeleted: number;
  exportErrors: number;
}

/**
 * Run the retention purge across every tenant — the scheduled job.
 *
 * W-12: each tenant's purge runs inside runForTenant(tenant), so the
 * isolation hooks confine every read and delete it makes to that tenant, on
 * top of the explicit predicates. The tenant list itself reads `tenants`,
 * which is not a tenant-scoped table.
 *
 * W-17: tenants are read in keyset pages, and every tenant gets at least one
 * bounded pass per run. Catch-up passes stop once `budgetMs` has passed; a
 * tenant left with rows is counted in `incomplete` and continues next run.
 *
 * Per-tenant failures are logged and counted, never fatal.
 *
 * W-16: `anomalies` counts retention values that could not be applied
 * (readRetentionPolicy); the scheduler reports a run with any as failed.
 *
 * W-15: after the tenants, expired GDPR export files are deleted
 * (gdpr.service#purgeExpiredExports) — the sweep, not an in-process timer, is
 * what enforces the export's expiry. One it could not delete is counted in
 * `exportErrors`, which the scheduler reports as a failed run.
 *
 * @param {object} [opts]
 * @param {number} [opts.pageSize]
 * @param {number} [opts.budgetMs]
 * @param {number} [opts.batchSize]
 * @returns {Promise<{tenants:number, purged:number, skipped:number, errors:number, incomplete:number, anomalies:number, exportsDeleted:number, exportErrors:number}>}
 */
const runRetentionSweep = async ({
  pageSize = SWEEP_TENANT_PAGE_SIZE,
  budgetMs = SWEEP_BUDGET_MS,
  batchSize = PURGE_BATCH_SIZE,
}: { pageSize?: number; budgetMs?: number; batchSize?: number } = {}): Promise<SweepSummary> => {
  const { Tenant } = loadModels();
  const deadline = Date.now() + budgetMs;
  const summary: SweepSummary = { tenants: 0, purged: 0, skipped: 0, errors: 0, incomplete: 0, anomalies: 0, exportsDeleted: 0, exportErrors: 0 };

  let afterId: TenantId | null = null;
  for (;;) {
    const tenants: TenantRow[] = await Tenant.findAll({
      attributes: ["id"],
      where: afterId ? { id: { [Op.gt]: afterId } } : {},
      order: [["id", "ASC"]],
      limit: pageSize,
    });

    for (const tenant of tenants) {
      summary.tenants += 1;
      try {
        const result = await runForTenant(tenant.id, () =>
          service.purgeExpiredRecords(tenant.id, { batchSize, deadline }),
        );
        if (result.skipped) {
          summary.skipped += 1;
        } else {
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a result with no `purged` counts as none
          summary.purged += Object.values(result.purged || {}).reduce(
            (sum, n) => sum + n,
            0,
          );
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- as built: only an explicit `false` counts as incomplete (a spied result may omit it)
          if (result.complete === false) {
            summary.incomplete += 1;
          }
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a result with no `anomalies` counts as none
          summary.anomalies += (result.anomalies || []).length;
        }
      } catch (err) {
        summary.errors += 1;
        logger.error(
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the message is interpolated as thrown
          `Retention sweep failed for tenant ${tenant.id}: ${(err as Thrown).message}`,
        );
      }
    }

    if (tenants.length < pageSize) {
      break;
    }
    afterId = (tenants[tenants.length - 1] as TenantRow).id;
  }

  // Required here, as the models are: gdpr.service loads the export stack.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: gdpr.service (still JavaScript) is loaded when the sweep runs, never at this module's load
  const exportsPurge = await (require("./gdpr.service") as GdprExportPurge).purgeExpiredExports();
  summary.exportsDeleted = exportsPurge.deleted;
  summary.exportErrors = exportsPurge.errors;

  logger.info("Retention sweep complete", summary);
  return summary;
};

/** What a masked personal-data value is replaced with. */
const PII_MASK = "[REDACTED]";

/** Where avatars are stored (user.service), and its "no photo" sentinel (A-180). */
const AVATAR_FOLDER = "uploads/public/profile";
const AVATAR_PLACEHOLDER = "default.svg";

/**
 * Keys that carry network identity (who connected from where). Masked inside
 * `changes` of every audit row the subject ACTED in.
 */
const NETWORK_KEYS = Object.freeze(["ipAddress", "ip", "ip_address", "userAgent", "user_agent"]);

/**
 * Keys that carry a person's identity. Masked inside `changes` of every audit
 * row ABOUT the subject (resourceType `User`, resourceId = the subject), where
 * before/after snapshots of the account record their name and contact details.
 * `userId`, `resourceId` and the ids inside `changes` are NOT masked: they are
 * the trail's "who did what to which record", which Q-12 keeps.
 */
const PERSONAL_KEYS = Object.freeze([
  "email",
  "username",
  "firstName",
  "lastName",
  "first_name",
  "last_name",
  "fullName",
  "name",
  "phone",
  "avatarUrl",
  ...NETWORK_KEYS,
]);

/**
 * Replace every value under one of `keys`, at any depth, with PII_MASK.
 * Returns a new value; the input is not modified.
 *
 * @param {*} value - a JSON value (an audit row's `changes`)
 * @param {ReadonlyArray<string>} keys - the keys whose values are masked
 * @returns {{ value: *, changed: boolean }}
 */
const maskKeys = (value: unknown, keys: readonly string[]): { value: unknown; changed: boolean } => {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item: unknown) => {
      const r = maskKeys(item, keys);
      changed = changed || r.changed;
      return r.value;
    });
    return { value: out, changed };
  }
  if (value === null || typeof value !== "object") {
    return { value, changed: false };
  }
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (keys.includes(key) && inner !== null && inner !== undefined && inner !== PII_MASK) {
      out[key] = PII_MASK;
      changed = true;
    } else {
      const r = maskKeys(inner, keys);
      out[key] = r.value;
      changed = changed || r.changed;
    }
  }
  return { value: out, changed };
};

/**
 * GDPR minimisation of the audit trail for a set of data subjects (A-135,
 * ADR-051 Q-12). Audit rows are NEVER deleted; their personal data is masked:
 *
 *  - rows the subject ACTED in (`userId`, or `impersonatorId` for a super
 *    admin behind an impersonation): `ipAddress` and `userAgent`, and any
 *    network-identity key inside `changes`;
 *  - rows ABOUT the subject (`resourceType` `User`, `resourceId` the subject):
 *    the identity keys inside `changes` (`PERSONAL_KEYS`). The row's own
 *    `ipAddress` there belongs to whoever made the change, not the subject,
 *    and is kept.
 *
 * `userId`, `action`, `resourceType`, `resourceId` and `createdAt` are never
 * touched. Every change and the audit row that records it are one transaction.
 *
 * @param {string} tenantId
 * @param {string[]} subjectIds - the data subjects' user ids
 * @param {object} actor - auditActor(req)
 * @returns {Promise<{masked: number, fields: string[]}>}
 */
const MASK_AUDIT_PAGE = 500;

const maskAuditTrail = async (
  tenantId: TenantId,
  subjectIds: string[],
  actor: RetentionActor,
): Promise<{ masked: number; fields: string[] }> => {
  const { AuditLog } = loadModels();
  const subjects = new Set(subjectIds.map(String));
  const fieldsMasked = new Set<string>();
  let masked = 0;

  await db.transaction(async (transaction) => {
    // D-24 (ADR-083): a data subject's whole audit history used to be read in
    // one statement. It is read by keyset on id, MASK_AUDIT_PAGE rows at a
    // time, still inside the one transaction — the masking stays all or
    // nothing. A masked row still matches the predicate, so the page after it
    // is found by id, never by offset.
    let after: string | null = null;
    for (;;) {
      const rows: AuditLogRow[] = await AuditLog.findAll({
        where: {
          // Explicit, as well as the tenant hooks: this runs for a super admin,
          // whose context may not be the tenant being masked.
          tenantId,
          ...(after ? { id: { [Op.gt]: after } } : {}),
          [Op.or]: [
            { userId: { [Op.in]: subjectIds } },
            { impersonatorId: { [Op.in]: subjectIds } },
            { resourceType: "User", resourceId: { [Op.in]: subjectIds } },
          ],
        },
        order: [["id", "ASC"]],
        limit: MASK_AUDIT_PAGE,
        transaction,
      });

      for (const row of rows) {
        const actedBySubject =
          subjects.has(String(row.userId)) || subjects.has(String(row.impersonatorId));
        const aboutSubject = row.resourceType === "User" && subjects.has(String(row.resourceId));
        const updates: { ipAddress?: string; userAgent?: string; changes?: unknown } = {};

        if (actedBySubject) {
          for (const field of ["ipAddress", "userAgent"]) {
            const key = field as "ipAddress" | "userAgent";
            if (row[key] && row[key] !== PII_MASK) {
              updates[key] = PII_MASK;
            }
          }
        }

        const keys = aboutSubject ? PERSONAL_KEYS : NETWORK_KEYS;
        const { value, changed } = maskKeys(row.changes, keys);
        if (changed) {
          updates.changes = value;
        }

        const fields = Object.keys(updates);
        if (fields.length === 0) {
          continue;
        }
        fields.forEach((f) => fieldsMasked.add(f));
        await row.update(updates as Parameters<AuditLogRow["update"]>[0], { transaction });
        masked += 1;
      }
      if (rows.length < MASK_AUDIT_PAGE) {
        break;
      }
      after = (rows[rows.length - 1] as AuditLogRow).id;
    }

    await auditService.logAction(
      {
        tenantId,
        // Always a request's user: masking is a super-admin route. logAction
        // refuses an entry with no actor, which rolls the masking back.
        userId: actor.userId,
        action: "UPDATE",
        resourceType: "AuditLog",
        resourceId: null,
        changes: {
          operation: "GDPR_MASK_AUDIT_PII",
          subjectIds: [...subjects],
          rowsMasked: masked,
          fields: [...fieldsMasked].sort(),
        },
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address reads as null
        ipAddress: actor.ipAddress || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty agent reads as null
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );
  });

  logger.info("PII masked in audit rows", { tenantId, subjects: subjects.size, rowsMasked: masked });

  return { masked, fields: [...fieldsMasked].sort() };
};

/**
 * Mask personal data for `entityType` (A-135).
 *
 * - `users`: `ids` are user ids. Each account's name, email, phone,
 *   username and avatar (A-180) are masked; the photo file is deleted after
 *   the commit. The email becomes a unique, syntactically valid address, because
 *   `users.email` is unique and validated: the single shared `[REDACTED]` the
 *   previous version wrote failed the model's `isEmail` validation on every
 *   call, and would have collided on the unique index from the second row on.
 * - `audit_logs`: `ids` are the DATA SUBJECTS' user ids, not audit row ids —
 *   see `maskAuditTrail`. The previous version looked up a model named
 *   `Audit_log`, which does not exist, so it had never masked a row.
 *
 * Refused while a legal hold is active: a hold preserves records as they are.
 * Transactional and audited in both cases.
 *
 * @param {string} tenantId
 * @param {string} entityType - `users` or `audit_logs`
 * @param {string[]} ids - see above
 * @param {object} [actor] - auditActor(req)
 * @returns {Promise<{masked: number, fields: string[]}>}
 */
const maskPII = async (
  tenantId: TenantId,
  entityType: string,
  ids: string[],
  actor: RetentionActor = {},
): Promise<{ masked: number; fields: string[] }> => {
  const onLegalHold = await service.isOnLegalHold(tenantId);

  if (onLegalHold) {
    throw new AppError(400, "Cannot mask PII while legal hold is active");
  }

  if (entityType === "audit_logs") {
    return maskAuditTrail(tenantId, ids, actor);
  }

  if (entityType !== "users") {
    throw new AppError(400, `Unknown entity type for PII masking: ${entityType}`);
  }

  const { User } = loadModels();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a barrel without the model is refused
  if (!User) {
    throw new AppError(400, `Model not found for entity type: ${entityType}`);
  }

  // A-180: `username` and `avatarUrl` are personal data too — a username is
  // usually the person's name, and the avatar is their photograph. Both were
  // left in place. The username becomes unique (`users.username` is a unique
  // index); the avatar reference becomes the "no photo" placeholder, and the
  // file itself is deleted after the commit, as gdpr.service's erasure does.
  const fields = ["email", "username", "firstName", "lastName", "phone", "avatarUrl"];
  let masked = 0;
  const avatarFiles: string[] = [];

  await db.transaction(async (transaction) => {
    const accounts = await User.findAll({
      where: { id: ids, tenantId },
      attributes: ["id", "avatarUrl"],
      transaction,
    });
    for (const account of accounts) {
      const stored = account.avatarUrl ? String(account.avatarUrl).split("/").pop() : null;
      if (stored && stored !== AVATAR_PLACEHOLDER) {
        avatarFiles.push(stored);
      }
    }

    for (const id of ids) {
      const [count] = await User.update(
        {
          email: `redacted_${id}@redacted.invalid`,
          username: `redacted_${id}`,
          firstName: PII_MASK,
          lastName: PII_MASK,
          phone: PII_MASK,
          avatarUrl: AVATAR_PLACEHOLDER,
        },
        { where: { id, tenantId }, transaction },
      );
      masked += count;
    }

    await auditService.logAction(
      {
        tenantId,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as no user
        userId: actor.userId || null,
        action: "UPDATE",
        resourceType: "User",
        resourceId: null,
        changes: { operation: "GDPR_MASK_PII", recordIds: ids, masked, fields },
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty address reads as null
        ipAddress: actor.ipAddress || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty agent reads as null
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );
  });

  // A-180: the photo files go AFTER the commit that stopped referencing them;
  // a file left behind is a storage leak to log, not a failed masking.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: upload.util is loaded after the commit, never at this module's load
  const { deleteUpload } = require("../utils/upload.util") as typeof UploadUtil;
  for (const file of avatarFiles) {
    try {
      await deleteUpload(file, AVATAR_FOLDER);
    } catch (err) {
      logger.warn("Failed to delete a masked user's avatar file", { tenantId, error: (err as Thrown).message });
    }
  }

  logger.info(`PII masked for ${entityType}`, { tenantId, masked, fields });

  return { masked, fields };
};

/**
 * Whole-dataset anonymisation is refused, for every entity type (A-152).
 *
 * It rewrote EVERY string column of EVERY row of the named model in the
 * tenant to `[ANONYMIZED]` — for `users` that is the password hash, username
 * and email of every account, locking the whole hospital out — with no
 * transaction (a failure part-way left a half-rewritten table) and no audit
 * row; `keepNumericIds: false` even rewrote primary keys. The model was chosen
 * from the caller's string, so any table could be named.
 *
 * There is no dataset whose every string column is safe to overwrite, and
 * GDPR minimisation is per data subject: `maskPII("users", ids)` masks named
 * accounts' personal fields, transactionally and audited, and
 * `maskPII("audit_logs", subjectIds)` their personal data in the trail. The
 * route stays, answering 400 with that pointer, so a caller learns where the
 * operation went instead of receiving a 404.
 *
 * @param {string} tenantId
 * @param {string} entityType
 * @returns {Promise<never>} always rejects with a 400 AppError
 */
// eslint-disable-next-line @typescript-eslint/require-await -- as built: an async function, so its refusal is a rejected promise, never a synchronous throw
const anonymizeDataset = async (_tenantId: TenantId, entityType: string): Promise<never> => {
  // Q-12: audit rows are never rewritten wholesale.
  if (entityType === "audit_logs") {
    throw new AppError(
      400,
      "Audit logs cannot be anonymized: they are kept as the audit trail. Mask a data subject's personal data with mask-pii instead.",
    );
  }

  throw new AppError(
    400,
    `Dataset anonymization is not available (${entityType}): it overwrote every text column of every row. Mask named data subjects with mask-pii instead.`,
  );
};

const service = {
  getRetentionPolicy,
  setRetentionPolicy,
  isOnLegalHold,
  enableLegalHold,
  disableLegalHold,
  purgeExpiredRecords,
  runRetentionSweep,
  maskPII,
  anonymizeDataset,
};

export = service;
