const { Op } = require('sequelize');
const { Notification, Session, TenantSettings } = require('../models');
const { AppError } = require('../utils/appError.util');
const { logger } = require('../middlewares/activityLog.middleware');
const auditService = require('./audit.service');
const { db } = require('../config');

/** The actor recorded on the purge's audit row: a job, not a user (W-04). */
const RETENTION_ACTOR = 'system:retention-purge';

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
  notifications: parseInt(process.env.NOTIFICATION_RETENTION_DAYS || '90', 10),
  sessions: parseInt(process.env.SESSION_RETENTION_DAYS || '30', 10),
};

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
});

const isPurgeable = (entity) =>
  Object.prototype.hasOwnProperty.call(DEFAULT_RETENTION_DAYS, entity);

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
 * @param {string} tenantId
 * @returns {Promise<Record<string, number>>}
 */
exports.getRetentionPolicy = async (tenantId) => {
  const policies = await TenantSettings.findAll({
    where: {
      tenantId,
      key: { [Op.like]: 'retention_policy_%' },
    },
  });

  const result = { ...DEFAULT_RETENTION_DAYS };
  policies.forEach((p) => {
    const key = p.key.replace('retention_policy_', '');
    if (isPurgeable(key)) {
      result[key] = parseInt(p.value, 10);
    }
  });

  return result;
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
 * @param {string} tenantId
 * @param {string} policyKey
 * @param {number} days
 * @returns {Promise<{policyKey: string, days: number}>}
 */
exports.setRetentionPolicy = async (tenantId, policyKey, days) => {
  if (!tenantId) {
    throw new AppError(
      400,
      'Retention policies are set per tenant. The platform default is set by NOTIFICATION_RETENTION_DAYS and SESSION_RETENTION_DAYS.',
    );
  }

  if (policyKey === 'audit_logs') {
    throw new AppError(
      400,
      'Audit logs are not subject to retention purge: audit rows are kept, never deleted.',
    );
  }

  if (!isPurgeable(policyKey)) {
    throw new AppError(400, `Unknown retention policy: ${policyKey}`);
  }

  if (days < 0) {
    throw new AppError(400, 'Retention days must be non-negative');
  }

  const floor = MIN_RETENTION_DAYS[policyKey];
  if (days > 0 && days < floor) {
    throw new AppError(
      400,
      `Retention for ${policyKey} must be at least ${floor} days, or 0 to keep forever.`,
    );
  }

  await TenantSettings.upsert({
    tenantId,
    key: `retention_policy_${policyKey}`,
    value: String(days),
  });

  return { policyKey, days };
};

exports.isOnLegalHold = async (tenantId) => {
  const setting = await TenantSettings.findOne({
    where: {
      tenantId,
      key: 'legal_hold_enabled',
    },
  });

  return setting?.value === 'true';
};

exports.enableLegalHold = async (tenantId, enabledBy, reason) => {
  await TenantSettings.upsert({
    tenantId,
    key: 'legal_hold_enabled',
    value: 'true',
  });

  await TenantSettings.upsert({
    tenantId,
    key: 'legal_hold_reason',
    value: reason || 'Legal hold enabled',
  });

  await TenantSettings.upsert({
    tenantId,
    key: 'legal_hold_enabled_by',
    value: enabledBy,
  });

  logger.warn(`Legal hold enabled for tenant ${tenantId}`, { reason, enabledBy });

  return { tenantId, enabled: true, reason, enabledBy };
};

exports.disableLegalHold = async (tenantId, disabledBy) => {
  await TenantSettings.destroy({
    where: {
      tenantId,
      key: ['legal_hold_enabled', 'legal_hold_reason', 'legal_hold_enabled_by'],
    },
  });

  logger.info(`Legal hold disabled for tenant ${tenantId}`, { disabledBy });

  return { tenantId, enabled: false, disabledBy };
};

exports.purgeExpiredRecords = async (tenantId) => {
  const onLegalHold = await exports.isOnLegalHold(tenantId);

  if (onLegalHold) {
    logger.info(`Purge skipped for tenant ${tenantId}: legal hold active`);
    return { skipped: true, reason: 'legal_hold' };
  }

  const policies = await exports.getRetentionPolicy(tenantId);
  const results = {};
  const cutoffs = {};

  // W-04 / W-16 — the deletes and the audit row that records them are ONE
  // transaction: a purge whose record cannot be written does not happen
  // (logAction re-throws inside a transaction), and a failure part-way through
  // rolls every table back instead of leaving a tenant half-purged.
  //
  // A-121 (ADR-051 Q-12): audit_logs is not a purgeable entity. There is no
  // case for it below and getRetentionPolicy never reports it.
  await db.transaction(async (transaction) => {
    for (const [entity, configuredDays] of Object.entries(policies)) {
      // 0 (or a stored value that does not parse) means keep forever.
      if (!Number.isFinite(configuredDays) || configuredDays <= 0) {
        continue;
      }
      // An override stored before the floor existed cannot purge sooner.
      const retentionDays = Math.max(configuredDays, MIN_RETENTION_DAYS[entity]);

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);
      cutoffs[entity] = cutoff.toISOString();

      let deletedCount = 0;

      switch (entity) {
        case 'notifications':
          deletedCount = await Notification.destroy({
            where: {
              tenantId,
              createdAt: { [Op.lt]: cutoff },
            },
            transaction,
          });
          break;

        case 'sessions':
          deletedCount = await Session.destroy({
            where: {
              // The Session model names this attribute `tenant_id` (not tenantId),
              // so querying by `tenantId` throws "column tenantId does not exist".
              tenant_id: tenantId,
              createdAt: { [Op.lt]: cutoff },
            },
            transaction,
          });
          break;
      }

      if (deletedCount > 0) {
        results[entity] = deletedCount;
      }
    }

    // Nothing destroyed, nothing to record.
    if (Object.keys(results).length > 0) {
      await auditService.logAction(
        {
          tenantId,
          systemActor: RETENTION_ACTOR, // A-124: a job, from constants/systemActors.js
          action: 'DELETE',
          resourceType: 'DataRetention',
          resourceId: null,
          changes: {
            operation: 'RETENTION_PURGE',
            actor: RETENTION_ACTOR,
            before: { retentionDays: policies },
            after: { purged: results, cutoffs },
          },
        },
        { transaction },
      );
    }
  });

  logger.info(`Purge completed for tenant ${tenantId}`, results);

  return { tenantId, purged: results, skipped: false };
};

/**
 * Run the retention purge across every tenant. Intended for the scheduled job:
 * it has no request/tenant CLS context, so the isolation hooks run unscoped and
 * each purgeExpiredRecords call confines itself with its explicit tenantId
 * predicate. Per-tenant failures are logged and counted, never fatal.
 *
 * @returns {Promise<{tenants:number, purged:number, skipped:number, errors:number}>}
 */
exports.runRetentionSweep = async () => {
  const { Tenant } = require('../models');
  const tenants = await Tenant.findAll({ attributes: ['id'] });

  const summary = { tenants: tenants.length, purged: 0, skipped: 0, errors: 0 };

  for (const tenant of tenants) {
    try {
      const result = await exports.purgeExpiredRecords(tenant.id);
      if (result.skipped) {
        summary.skipped += 1;
      } else {
        summary.purged += Object.values(result.purged || {}).reduce(
          (sum, n) => sum + n,
          0,
        );
      }
    } catch (err) {
      summary.errors += 1;
      logger.error(
        `Retention sweep failed for tenant ${tenant.id}: ${err.message}`,
      );
    }
  }

  logger.info('Retention sweep complete', summary);
  return summary;
};

/** What a masked personal-data value is replaced with. */
const PII_MASK = "[REDACTED]";

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
const maskKeys = (value, keys) => {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((item) => {
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
  const out = {};
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
const maskAuditTrail = async (tenantId, subjectIds, actor) => {
  const { AuditLog } = require("../models");
  const subjects = new Set(subjectIds.map(String));
  const fieldsMasked = new Set();
  let masked = 0;

  await db.transaction(async (transaction) => {
    const rows = await AuditLog.findAll({
      where: {
        // Explicit, as well as the tenant hooks: this runs for a super admin,
        // whose context may not be the tenant being masked.
        tenantId,
        [Op.or]: [
          { userId: { [Op.in]: subjectIds } },
          { impersonatorId: { [Op.in]: subjectIds } },
          { resourceType: "User", resourceId: { [Op.in]: subjectIds } },
        ],
      },
      transaction,
    });

    for (const row of rows) {
      const actedBySubject =
        subjects.has(String(row.userId)) || subjects.has(String(row.impersonatorId));
      const aboutSubject = row.resourceType === "User" && subjects.has(String(row.resourceId));
      const updates = {};

      if (actedBySubject) {
        for (const field of ["ipAddress", "userAgent"]) {
          if (row[field] && row[field] !== PII_MASK) {
            updates[field] = PII_MASK;
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
      await row.update(updates, { transaction });
      masked += 1;
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
        ipAddress: actor.ipAddress || null,
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
 * - `users`: `ids` are user ids. Each account's name, email and phone are
 *   masked. The email becomes a unique, syntactically valid address, because
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
exports.maskPII = async (tenantId, entityType, ids, actor = {}) => {
  const onLegalHold = await exports.isOnLegalHold(tenantId);

  if (onLegalHold) {
    throw new AppError(400, "Cannot mask PII while legal hold is active");
  }

  if (entityType === "audit_logs") {
    return maskAuditTrail(tenantId, ids, actor);
  }

  if (entityType !== "users") {
    throw new AppError(400, `Unknown entity type for PII masking: ${entityType}`);
  }

  const { User } = require("../models");
  if (!User) {
    throw new AppError(400, `Model not found for entity type: ${entityType}`);
  }

  const fields = ["email", "firstName", "lastName", "phone"];
  let masked = 0;

  await db.transaction(async (transaction) => {
    for (const id of ids) {
      const [count] = await User.update(
        {
          email: `redacted_${id}@redacted.invalid`,
          firstName: PII_MASK,
          lastName: PII_MASK,
          phone: PII_MASK,
        },
        { where: { id, tenantId }, transaction },
      );
      masked += count;
    }

    await auditService.logAction(
      {
        tenantId,
        userId: actor.userId || null,
        action: "UPDATE",
        resourceType: "User",
        resourceId: null,
        changes: { operation: "GDPR_MASK_PII", recordIds: ids, masked, fields },
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );
  });

  logger.info(`PII masked for ${entityType}`, { tenantId, masked, fields });

  return { masked, fields };
};

exports.anonymizeDataset = async (tenantId, entityType, options = {}) => {
  // Q-12: audit rows are never rewritten wholesale. GDPR minimisation of the
  // trail is per subject, through maskPII("audit_logs").
  if (entityType === "audit_logs") {
    throw new AppError(
      400,
      "Audit logs cannot be anonymized: they are kept as the audit trail. Mask a data subject's personal data with mask-pii instead.",
    );
  }

  const onLegalHold = await exports.isOnLegalHold(tenantId);

  if (onLegalHold) {
    throw new AppError(400, 'Cannot anonymize dataset while legal hold is active');
  }

  const { keepDates = true, keepNumericIds = true } = options;

  const Model = require('../models')[entityType.charAt(0).toUpperCase() + entityType.slice(1, -1)];
  if (!Model) {
    throw new AppError(400, `Model not found for entity type: ${entityType}`);
  }

  const records = await Model.findAll({ where: { tenantId } });
  const updates = {};

  for (const record of records) {
    const recordUpdates = {};

    for (const attr of Object.values(Model.rawAttributes)) {
      if (attr.type.key === 'STRING' && attr.fieldName !== 'id') {
        recordUpdates[attr.fieldName] = '[ANONYMIZED]';
      } else if (!keepDates && attr.type.key === 'DATE') {
        recordUpdates[attr.fieldName] = new Date('1970-01-01');
      }
    }

    if (!keepNumericIds) {
      recordUpdates.id = require('crypto').randomUUID();
    }

    await record.update(recordUpdates);
  }

  logger.info(`Dataset anonymized for ${entityType}`, { tenantId, count: records.length });

  return { anonymized: records.length, entityType };
};
