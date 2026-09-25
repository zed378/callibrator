const { Op, Transaction } = require('sequelize');
const { Tenant, TenantSettings, User, Subscription, Invoice } = require('../models');
const { AppError } = require('../utils/appError.util');
const { logger } = require('../middlewares/activityLog.middleware');
const { isEnabled } = require('./featureFlag.service');
const auditService = require('./audit.service');
const { SYSTEM_ACTORS } = require('../constants/systemActors');
const { db } = require('../config');
const { runForTenant } = require('../utils/jobContext.util');
const {
  isRedactedSettingKey,
  SECRET_SETTING_MASK,
} = require("../constants/tenantSecretSettings");

/**
 * The actor recorded on an audit row the scheduler writes: a job, not a user
 * (W-04). Since A-124 (ADR-051 Q-13) it is the row's first-class system
 * actor (`actor_type = 'system'`, `actor_name`), from the closed list in
 * constants/systemActors.js. `changes.actor` still carries it, so a reader of
 * rows from before and after migration 0033 finds it in the same place.
 */
const TENANT_LIFECYCLE_ACTOR = SYSTEM_ACTORS.TENANT_LIFECYCLE;

const GRACE_PERIOD_DAYS = parseInt(process.env.TENANT_GRACE_PERIOD_DAYS || '7', 10);
const OFFBOARD_RETENTION_DAYS = parseInt(process.env.TENANT_OFFBOARD_RETENTION_DAYS || '30', 10);

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

exports.suspendTenant = async (tenantId, reason, suspendedBy = null) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  if (tenant.status === 'suspended') {
    return tenant;
  }

  tenant.status = 'suspended';
  tenant.suspensionReason = reason;
  tenant.suspendedAt = new Date();
  tenant.suspendedBy = suspendedBy;
  await tenant.save();

  await logger.warn(`Tenant suspended: ${tenantId}`, { reason, suspendedBy });

  await TenantSettings.upsert({
    tenantId,
    key: 'lifecycle_status',
    value: 'SUSPENDED',
  });

  return tenant;
};

exports.resumeTenant = async (tenantId, resumedBy = null) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  if (tenant.status === 'active') {
    return tenant;
  }

  tenant.status = 'active';
  tenant.suspensionReason = null;
  tenant.suspendedAt = null;
  tenant.suspendedBy = null;
  // A grace period belongs to the suspension it was granted in. Left in place,
  // a stale (already past) deadline would offboard the tenant on the first
  // scheduler run after any LATER suspension, with no grace at all.
  tenant.gracePeriodExpiresAt = null;
  await tenant.save();

  await logger.info(`Tenant resumed: ${tenantId}`, { resumedBy });

  await TenantSettings.upsert({
    tenantId,
    key: 'lifecycle_status',
    value: 'ACTIVE',
  });

  return tenant;
};

exports.enterGracePeriod = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  const graceExpiresAt = new Date();
  graceExpiresAt.setDate(graceExpiresAt.getDate() + GRACE_PERIOD_DAYS);

  tenant.gracePeriodExpiresAt = graceExpiresAt;
  await tenant.save();

  await logger.info(`Tenant entered grace period: ${tenantId}`, {
    gracePeriodDays: GRACE_PERIOD_DAYS,
    expiresAt: graceExpiresAt,
  });

  return tenant;
};

exports.checkGracePeriodExpired = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant || !tenant.gracePeriodExpiresAt) {
    return false;
  }

  return new Date() > new Date(tenant.gracePeriodExpiresAt);
};

/**
 * Offboard a tenant: status -> 'deleted', a retention deadline, and the
 * OFFBOARDED lifecycle setting — and one audit row recording it, all in ONE
 * transaction (W-01 / W-04). A failed audit insert re-throws inside the
 * transaction (audit.service A-41), so the offboarding cannot commit
 * unrecorded; a failure part-way through leaves the tenant as it was.
 *
 * @param {string} tenantId
 * @param {boolean} [force=false] - re-offboard a tenant already 'deleted'
 * @param {object} [actor] - who did it (utils/auditActor.util.js shape)
 * @param {string|null} [actor.userId=null] - the operator; null means the
 *   scheduler, recorded as `changes.actor: "system:tenant-lifecycle"`
 * @param {string|null} [actor.ipAddress=null]
 * @param {string|null} [actor.userAgent=null]
 */
exports.offboardTenant = async (
  tenantId,
  force = false,
  { userId = null, ipAddress = null, userAgent = null } = {},
) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  if (tenant.status === 'deleted' && !force) {
    return tenant;
  }

  // W-17 (ADR-073): no export is built here. The one this used to build was
  // taken before the transaction, returned to the operator's screen (which
  // ignored it) and discarded by the scheduler. Offboarding deletes nothing:
  // the data stays readable through GET /tenants/:tenantId/export until the
  // hard delete, which refuses while regulated records remain (D-23).
  const before = {
    status: tenant.status,
    gracePeriodExpiresAt: tenant.gracePeriodExpiresAt || null,
    offboardedAt: tenant.offboardedAt || null,
  };
  const offboardedAt = new Date();
  const retentionExpiresAt = new Date(offboardedAt);
  retentionExpiresAt.setDate(retentionExpiresAt.getDate() + OFFBOARD_RETENTION_DAYS);

  await db.transaction(async (transaction) => {
    tenant.status = 'deleted';
    tenant.offboardedAt = offboardedAt;
    tenant.offboardRetentionExpiresAt = retentionExpiresAt;
    await tenant.save({ transaction });

    // tenant.status uses the enum's terminal 'deleted'; the granular lifecycle
    // state lives in the lifecycle_status setting that getStatus surfaces.
    await TenantSettings.upsert(
      {
        tenantId,
        key: 'lifecycle_status',
        value: 'OFFBOARDED',
      },
      { transaction },
    );

    await auditService.logAction(
      {
        tenantId,
        // A-124: exactly one actor — the operator, or else the scheduler.
        ...(userId ? { userId } : { systemActor: TENANT_LIFECYCLE_ACTOR }),
        action: 'DELETE',
        resourceType: 'Tenant',
        resourceId: tenantId,
        ipAddress,
        userAgent,
        changes: {
          operation: 'TENANT_OFFBOARD',
          ...(userId ? {} : { actor: TENANT_LIFECYCLE_ACTOR }),
          force: Boolean(force),
          before,
          after: {
            status: 'deleted',
            lifecycleStatus: 'OFFBOARDED',
            offboardedAt: offboardedAt.toISOString(),
            offboardRetentionExpiresAt: retentionExpiresAt.toISOString(),
            retentionDays: OFFBOARD_RETENTION_DAYS,
          },
        },
      },
      { transaction },
    );
  });

  await logger.warn(`Tenant offboarded: ${tenantId}`, {
    retentionDays: OFFBOARD_RETENTION_DAYS,
    expiresAt: tenant.offboardRetentionExpiresAt,
  });

  return { tenant };
};

exports.cancelOffboarding = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  if (tenant.status !== 'deleted') {
    throw new AppError(400, 'Tenant is not offboarded');
  }

  tenant.status = 'active';
  tenant.offboardedAt = null;
  tenant.offboardRetentionExpiresAt = null;
  // As in resumeTenant: an expired deadline must not survive into a later
  // suspension and offboard the tenant again with no grace.
  tenant.gracePeriodExpiresAt = null;
  await tenant.save();

  await logger.info(`Offboarding cancelled for tenant: ${tenantId}`);

  return tenant;
};

/**
 * The tenant-scoped tables a hard delete removes itself, in this order, once
 * nothing retained is left (D-23): configuration, accounts, billing plan.
 * Everything on 0030's TENANT_FK_CASCADE list goes with the tenant row.
 */
const DELETED_WITH_TENANT = Object.freeze(["tenant_settings", "users", "subscriptions"]);

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
exports.hardDeleteOffboardedTenant = async (tenantId, { userId = null, ipAddress = null, userAgent = null } = {}) => {
  const models = require("../models");
  const { TENANT_FK_CASCADE } = require("../migrations/0030-tenant-foreign-keys-restrict");
  const { PLATFORM_TENANT_ID } = require("../constants/platformTenant");

  return db.transaction(async (transaction) => {
    const tenant = await Tenant.findByPk(tenantId, { transaction, lock: Transaction.LOCK.UPDATE });
    if (!tenant) {
      throw new AppError(404, "Tenant not found");
    }
    if (tenant.status !== "deleted") {
      throw new AppError(409, `This tenant is "${tenant.status}", not offboarded: offboard it before it can be deleted`);
    }
    if (tenant.offboardRetentionExpiresAt && new Date() < new Date(tenant.offboardRetentionExpiresAt)) {
      throw new AppError(
        409,
        `The offboarded tenant's retention period runs until ${new Date(tenant.offboardRetentionExpiresAt).toISOString()}; it cannot be deleted before then`,
      );
    }

    const scoped = [...new Set(Object.values(models.sequelize.models))]
      .map((model) => ({ model, attribute: model.rawAttributes.tenantId ? "tenantId" : model.rawAttributes.tenant_id ? "tenant_id" : null }))
      .filter(({ model, attribute }) => attribute && model.name !== "Tenant");
    const count = ({ model, attribute }) =>
      model.unscoped().count({ where: { [attribute]: tenantId }, paranoid: false, skipTenantScope: true, transaction });

    const retained = [];
    for (const entry of scoped) {
      const table = entry.model.tableName;
      if (TENANT_FK_CASCADE.includes(table) || DELETED_WITH_TENANT.includes(table)) {continue;}
      const n = await count(entry);
      if (n > 0) {retained.push(`${table} (${n})`);}
    }
    if (retained.length) {
      throw new AppError(
        409,
        `This tenant still holds records that are retained after offboarding: ${retained.sort().join(", ")}. ` +
          "Nothing was deleted. Removing retained records is an archival decision, not part of this operation.",
      );
    }

    const deleted = {};
    for (const table of DELETED_WITH_TENANT) {
      const entry = scoped.find(({ model }) => model.tableName === table);
      deleted[table] = await entry.model.unscoped().destroy({
        where: { [entry.attribute]: tenantId },
        force: true,
        skipTenantScope: true,
        transaction,
      });
    }
    await tenant.destroy({ force: true, transaction });

    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
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
]);

/**
 * Copy the allow-listed fields of a row (nulls kept). A second line of defence
 * behind the SELECT list: whatever the row object carries — getters included
 * — only allow-listed keys leave.
 *
 * @param {object} row - a model instance
 * @param {ReadonlyArray<string>} fields - the allow-list
 * @returns {object} the projected plain object
 */
const project = (row, fields) => {
  const plain = row.toJSON();
  const out = {};
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
const exportedSetting = (setting) => {
  const plain = setting.toJSON();
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
const exportedTenant = (tenant) => {
  const plain = tenant.toJSON();
  const { settings } = plain;
  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    plain.settings = Object.fromEntries(
      Object.entries(settings).filter(([key]) => !isRedactedSettingKey(key)),
    );
  }
  return plain;
};

exports.EXPORTED_USER_ATTRIBUTES = EXPORTED_USER_ATTRIBUTES;

exports.exportTenantData = async (tenantId) => {
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

exports.getTenantLifecycleStatus = async (tenantId) => {
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, 'Tenant not found');
  }

  const lifecycleSetting = await TenantSettings.findOne({
    where: {
      tenantId,
      key: 'lifecycle_status',
    },
  });

  const gracePeriodExpired = await exports.checkGracePeriodExpired(tenantId);

  return {
    status: tenant.status,
    lifecycleStatus: lifecycleSetting?.value || tenant.status,
    gracePeriodExpiresAt: tenant.gracePeriodExpiresAt,
    gracePeriodExpired,
    offboardedAt: tenant.offboardedAt,
    offboardRetentionExpiresAt: tenant.offboardRetentionExpiresAt,
  };
};

/** Tenants read per page by the lifecycle processor (W-17). */
const LIFECYCLE_PAGE_SIZE = Number(process.env.TENANT_LIFECYCLE_PAGE_SIZE) || 50;

/**
 * The scheduled job (middlewares/tenantLifecycleScheduler.middleware.js):
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
exports.processExpiredGracePeriods = async ({ pageSize = LIFECYCLE_PAGE_SIZE } = {}) => {
  const now = new Date();
  const results = [];

  // W-17: keyset pages of ids, never the whole table's rows at once.
  let afterId = null;
  for (;;) {
    // The ENUM's own lowercase value — PostgreSQL does not coerce, and
    // 'SUSPENDED' raised `invalid input value for enum enum_tenants_status`.
    const where = {
      status: 'suspended',
      gracePeriodExpiresAt: { [Op.lte]: now },
    };
    if (afterId) {
      where.id = { [Op.gt]: afterId };
    }
    const tenants = await Tenant.findAll({
      where,
      attributes: ['id'],
      order: [['id', 'ASC']],
      limit: pageSize,
    });

    for (const tenant of tenants) {
      try {
        // W-12: the job helper, so every job's context is declared the same way.
        await runForTenant(tenant.id, () => exports.offboardTenant(tenant.id));
        results.push({ tenantId: tenant.id, action: 'offboarded' });
      } catch (err) {
        results.push({ tenantId: tenant.id, action: 'failed', error: err.message });
        logger.error(`Tenant lifecycle: offboarding ${tenant.id} failed`, {
          tenantId: tenant.id,
          error: err.message,
        });
      }
    }

    if (tenants.length < pageSize) {
      break;
    }
    afterId = tenants[tenants.length - 1].id;
  }

  logger.info(`Processed ${results.length} expired grace period(s)`, { results });

  return results;
};
