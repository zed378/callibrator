const { Tenants } = require("../models");
const { AppError } = require("../utils/appError.util");
const { db } = require("../config");
const auditService = require("./audit.service");
const { PLATFORM_TENANT_ID } = require("../constants/platformTenant");
const {
  isRedactedSettingKey,
  SECRET_SETTING_MASK,
} = require("../constants/tenantSecretSettings");
const { del, delPattern, cacheKeys } = require("./redis.service");
const { tenantFlagsProblem } = require("../validators/admin.validator");

/**
 * A-175 — tenant.service caches a tenant's row for 600 s (fetchSpecificTenant,
 * `cacheKeys.tenant` and `cacheKeys.tenantByCode`), its public branding for
 * 300 s (active tenants only), and the tenant list pages under `tenants:*`. A
 * status or flag change here left all of them showing the old row. Called
 * AFTER the transaction commits: invalidating inside it lets a concurrent read
 * re-cache the old row for the full TTL. `del` and `delPattern` swallow a
 * Redis failure, so a cache outage never fails the committed change.
 *
 * @param {object} tenant - the committed tenant
 * @returns {Promise<object>} the same tenant
 */
const invalidateTenantCache = async (tenant) => {
  await del(cacheKeys.tenant(tenant.id));
  await del(cacheKeys.tenantByCode(tenant.code));
  await del(`tenant:branding:${tenant.id}`);
  await delPattern("tenants:*");
  return tenant;
};

// ==========================================
// GET ALL TENANTS (SUPER ADMIN)
// ==========================================

exports.getAllTenants = async (page = 1, limit = 10, search = "") => {
  const offset = (page - 1) * limit;

  const where = {};
  if (search) {
    const { Op } = require("sequelize");
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { code: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const { count, rows } = await Tenants.findAndCountAll({
    where,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / limit),
    tenants: rows,
  };
};

// ==========================================
// AUDIT OF A PLATFORM ACTION ON ONE TENANT
// ==========================================

/**
 * A-165 (ADR-051 Q-14, A-41). A super admin changing ONE tenant's status or
 * feature flags writes TWO audit rows, both inside the change's transaction —
 * a failed insert is re-thrown by logAction and the change rolls back:
 *
 *  - under the reserved PLATFORM tenant: it is a platform operation, and the
 *    platform's own trail must hold every suspension and flag change in one
 *    place — including for a tenant later offboarded, whose own trail goes
 *    with it (F-7);
 *  - under the AFFECTED tenant: it changes that tenant's data and its
 *    availability, which Q-14 records "in that tenant". Its admins and
 *    auditors must be able to see why they were suspended or why a feature
 *    appeared or vanished, and they cannot read the PLATFORM trail. The actor
 *    is not a member of that tenant, so the viewer shows "Platform operator"
 *    (ADR-051 Q-17) — the tenant learns what happened, not who operates the
 *    platform.
 *
 * Both rows name the same actor and carry identical `changes`.
 *
 * @param {object} transaction
 * @param {{userId?: (string|null), ipAddress?: (string|null), userAgent?: (string|null)}} actor - auditActor(req)
 * @param {string} affectedTenantId
 * @param {object} changes - { operation, before, after }
 * @returns {Promise<void>}
 */
const auditPlatformActionOnTenant = async (transaction, actor, affectedTenantId, changes) => {
  const entry = {
    userId: actor.userId || null,
    action: "UPDATE",
    resourceType: "Tenant",
    resourceId: affectedTenantId,
    changes,
    ipAddress: actor.ipAddress || null,
    userAgent: actor.userAgent || null,
  };
  await auditService.logAction({ ...entry, tenantId: PLATFORM_TENANT_ID }, { transaction });
  await auditService.logAction({ ...entry, tenantId: affectedTenantId }, { transaction });
};

// ==========================================
// UPDATE TENANT STATUS
// ==========================================

const VALID_STATUSES = Object.freeze(["active", "suspended", "deleted"]);

/**
 * Set a tenant's status (super admin). Audited under PLATFORM and under the
 * tenant, inside the transaction (A-165). Setting the status it already has
 * changes nothing and writes no audit row.
 *
 * The PLATFORM tenant is hidden by the Tenant model's hooks, so it answers
 * 404 here like an id that does not exist.
 *
 * @param {string} tenantId
 * @param {string} status - active | suspended | deleted
 * @param {object} [actor] - auditActor(req)
 * @returns {Promise<object>} the tenant
 */
exports.updateTenantStatus = async (tenantId, status, actor = {}) =>
  db.transaction(async (transaction) => {
    const tenant = await Tenants.findByPk(tenantId, { transaction });
    if (!tenant) {throw new AppError(404, "Tenant not found");}

    if (!VALID_STATUSES.includes(status)) {
      throw new AppError(400, "Invalid status");
    }

    const previous = tenant.status;
    if (previous === status) {return tenant;}

    tenant.status = status;
    await tenant.save({ transaction });

    await auditPlatformActionOnTenant(transaction, actor, tenant.id, {
      operation: "UPDATE_TENANT_STATUS",
      before: { status: previous },
      after: { status },
    });

    return tenant;
  }).then(invalidateTenantCache); // A-175: after the commit

// ==========================================
// UPDATE TENANT FLAGS
// ==========================================

/** A flag value as the audit row records it: a secret-named key is masked (A-150). */
const auditValue = (key, value) => (isRedactedSettingKey(key) ? SECRET_SETTING_MASK : value);

/**
 * A-174 — the flags to merge. No flags (undefined/null) merges nothing;
 * anything tenantFlagsProblem refuses is a 400 naming the key.
 * @param {*} flags - the request's `flags`
 * @returns {object} a copy to merge
 */
const flagsToMerge = (flags) => {
  if (flags === undefined || flags === null) {return {};}
  const problem = tenantFlagsProblem(flags);
  if (problem) {throw new AppError(400, problem);}
  return { ...flags };
};

/**
 * Merge feature flags into a tenant's `settings` (super admin). Audited under
 * PLATFORM and under the tenant, inside the transaction (A-165); the row
 * records only the keys whose value changed, before and after. A merge that
 * changes nothing writes nothing and no audit row.
 *
 * @param {string} tenantId
 * @param {object} flags - keys to set
 * @param {object} [actor] - auditActor(req)
 * @returns {Promise<object>} the tenant
 */
exports.updateTenantFlags = async (tenantId, flags, actor = {}) =>
  db.transaction(async (transaction) => {
    const tenant = await Tenants.findByPk(tenantId, { transaction });
    if (!tenant) {throw new AppError(404, "Tenant not found");}

    const current = tenant.settings || {};
    // A-174: a plain object of scalar flags, never a secret-named key — a
    // string used to be spread key by key, and a secret landed in plaintext.
    const incoming = flagsToMerge(flags);
    const changedKeys = Object.keys(incoming).filter(
      (key) =>
        !Object.prototype.hasOwnProperty.call(current, key) ||
        JSON.stringify(current[key]) !== JSON.stringify(incoming[key]),
    );
    if (changedKeys.length === 0) {return tenant;}

    const before = {};
    const after = {};
    for (const key of changedKeys) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        before[key] = auditValue(key, current[key]);
      }
      after[key] = auditValue(key, incoming[key]);
    }

    tenant.settings = { ...current, ...incoming };
    tenant.changed("settings", true);
    await tenant.save({ transaction });

    await auditPlatformActionOnTenant(transaction, actor, tenant.id, {
      operation: "UPDATE_TENANT_FLAGS",
      before,
      after,
    });

    return tenant;
  }).then(invalidateTenantCache); // A-175: after the commit
