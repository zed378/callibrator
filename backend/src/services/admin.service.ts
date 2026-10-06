// P9-13 (ADR-087, Stage C leaves): converted from admin.service.js with no
// behaviour change. `export =` keeps the exact object `require()` returned (the
// same keys, in the same order). Every load-time destructure is kept as a
// capture at load (`Tenants`, `AppError`, `db`, the platform id, the secret-key
// helpers, the Redis helpers, `tenantFlagsProblem`); `auditService` is the
// module object. `Op` is a named import: the `.js` required `sequelize` inside
// getAllTenants, and both read the same `Op` (the barrel has loaded sequelize).
import { Op, type Transaction, type WhereOptions } from "sequelize";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { db as loadedDb } from "../config";
import auditService from "./audit.service";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import {
  isRedactedSettingKey as loadedIsRedactedSettingKey,
  SECRET_SETTING_MASK as LOADED_SECRET_SETTING_MASK,
} from "../constants/tenantSecretSettings";
import redis from "./redis.service";
import { tenantFlagsProblem as loadedTenantFlagsProblem } from "../validators/admin.validator";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";
import { TENANT_LIFECYCLE_STATUSES } from "@callibrator/contracts/states";

const { Tenants } = models;
const AppError = LoadedAppError;
const db = loadedDb;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;
const isRedactedSettingKey = loadedIsRedactedSettingKey;
const SECRET_SETTING_MASK = LOADED_SECRET_SETTING_MASK;
const { del, delPattern, cacheKeys } = redis;
const tenantFlagsProblem = loadedTenantFlagsProblem;

type TenantRow = ModelInstance<"Tenant">;

/** Who acted (auditActor(req)). */
interface AdminActor {
  /** P9-20: widened to what auditActor(req) returns (type-only; the value is only ever written to the audit row). */
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | readonly string[] | null;
}

/** One page of tenants. */
interface TenantPage {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  tenants: TenantRow[];
}

/**
 * A-175 — tenant.service caches a tenant's row for 600 s (fetchSpecificTenant,
 * `cacheKeys.tenant` and `cacheKeys.tenantByCode`), its public branding for
 * 300 s (active tenants only), and the tenant list pages under `tenants:*`. A
 * status or flag change here left all of them showing the old row. Called
 * AFTER the transaction commits: invalidating inside it lets a concurrent read
 * re-cache the old row for the full TTL. `del` and `delPattern` swallow a
 * Redis failure, so a cache outage never fails the committed change.
 *
 * @param tenant - the committed tenant
 * @returns the same tenant
 */
const invalidateTenantCache = async (tenant: TenantRow): Promise<TenantRow> => {
  await del(cacheKeys.tenant(tenant.id));
  await del(cacheKeys.tenantByCode(tenant.code));
  await del(`tenant:branding:${tenant.id}`);
  await delPattern("tenants:*");
  return tenant;
};

// ==========================================
// GET ALL TENANTS (SUPER ADMIN)
// ==========================================

const getAllTenants = async (
  page: number | string = 1,
  limit: number | string = 10,
  search: string | null = "",
): Promise<TenantPage> => {
  // As built: a page or limit from the query string is used with JavaScript's own coercion.
  const offset = ((page as number) - 1) * (limit as number);

  const where: { [Op.or]?: unknown[] } = {};
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { code: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const { count, rows } = await Tenants.findAndCountAll({
    where: where as WhereOptions,
    limit: limit as number,
    offset,
    order: [["createdAt", "DESC"], ["id", "DESC"]],
  });

  return {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / (limit as number)),
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
 * @param transaction - the change's transaction
 * @param actor - auditActor(req)
 * @param affectedTenantId - the tenant changed
 * @param changes - { operation, before, after }
 */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value also records null */
const auditPlatformActionOnTenant = async (
  transaction: Transaction,
  actor: AdminActor,
  affectedTenantId: string,
  changes: Record<string, unknown>,
): Promise<void> => {
  const entry = {
    userId: actor.userId || null,
    action: "UPDATE" as const,
    resourceType: "Tenant",
    resourceId: affectedTenantId,
    changes,
    ipAddress: actor.ipAddress || null,
    userAgent: actor.userAgent || null,
  };
  await auditService.logAction({ ...entry, tenantId: PLATFORM_TENANT_ID }, { transaction });
  await auditService.logAction({ ...entry, tenantId: affectedTenantId }, { transaction });
};
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

// ==========================================
// UPDATE TENANT STATUS
// ==========================================

const VALID_STATUSES: readonly string[] = TENANT_LIFECYCLE_STATUSES; // P9-05: the one (frozen) list

/**
 * Set a tenant's status (super admin). Audited under PLATFORM and under the
 * tenant, inside the transaction (A-165). Setting the status it already has
 * changes nothing and writes no audit row.
 *
 * The PLATFORM tenant is hidden by the Tenant model's hooks, so it answers
 * 404 here like an id that does not exist.
 *
 * @param tenantId - the tenant
 * @param status - active | suspended | deleted
 * @param actor - auditActor(req)
 * @returns the tenant
 */
const updateTenantStatus = async (tenantId: TenantId, status: string, actor: AdminActor = {}): Promise<TenantRow> =>
  db.transaction(async (transaction: Transaction): Promise<TenantRow> => {
    const tenant = await Tenants.findByPk(tenantId, { transaction });
    if (!tenant) {throw new AppError(404, "Tenant not found");}

    if (!VALID_STATUSES.includes(status)) {
      throw new AppError(400, "Invalid status");
    }

    const previous = tenant.status;
    if (previous === status) {return tenant;}

    // status is one of VALID_STATUSES here, checked above.
    tenant.status = status as TenantRow["status"];
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
const auditValue = (key: string, value: unknown): unknown => (isRedactedSettingKey(key) ? SECRET_SETTING_MASK : value);

/**
 * A-174 — the flags to merge. No flags (undefined/null) merges nothing;
 * anything tenantFlagsProblem refuses is a 400 naming the key.
 * @param flags - the request's `flags`
 * @returns a copy to merge
 */
const flagsToMerge = (flags: unknown): Record<string, unknown> => {
  if (flags === undefined || flags === null) {return {};}
  const problem = tenantFlagsProblem(flags);
  if (problem) {throw new AppError(400, problem);}
  // tenantFlagsProblem accepted it: a plain object of scalar flags.
  return { ...(flags as Record<string, unknown>) };
};

/**
 * Merge feature flags into a tenant's `settings` (super admin). Audited under
 * PLATFORM and under the tenant, inside the transaction (A-165); the row
 * records only the keys whose value changed, before and after. A merge that
 * changes nothing writes nothing and no audit row.
 *
 * @param tenantId - the tenant
 * @param flags - keys to set
 * @param actor - auditActor(req)
 * @returns the tenant
 */
const updateTenantFlags = async (tenantId: TenantId, flags: unknown, actor: AdminActor = {}): Promise<TenantRow> =>
  db.transaction(async (transaction: Transaction): Promise<TenantRow> => {
    const tenant = await Tenants.findByPk(tenantId, { transaction });
    if (!tenant) {throw new AppError(404, "Tenant not found");}

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `|| {}`
    const current: Record<string, unknown> = tenant.settings || {};
    // A-174: a plain object of scalar flags, never a secret-named key — a
    // string used to be spread key by key, and a secret landed in plaintext.
    const incoming = flagsToMerge(flags);
    const changedKeys = Object.keys(incoming).filter(
      (key) =>
        !Object.prototype.hasOwnProperty.call(current, key) ||
        JSON.stringify(current[key]) !== JSON.stringify(incoming[key]),
    );
    if (changedKeys.length === 0) {return tenant;}

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of changedKeys) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        before[key] = auditValue(key, current[key]);
      }
      after[key] = auditValue(key, incoming[key]);
    }

    // As built: the merged flags are stored as the settings JSON.
    const merged = { ...current, ...incoming };
    tenant.settings = merged as TenantRow["settings"];
    tenant.changed("settings", true);
    await tenant.save({ transaction });

    await auditPlatformActionOnTenant(transaction, actor, tenant.id, {
      operation: "UPDATE_TENANT_FLAGS",
      before,
      after,
    });

    return tenant;
  }).then(invalidateTenantCache); // A-175: after the commit

export = { getAllTenants, updateTenantStatus, updateTenantFlags };
