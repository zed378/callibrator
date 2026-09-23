/**
 * Application-level tenant isolation (replaces Postgres RLS).
 *
 * Postgres RLS cannot be the isolation mechanism once the platform must run on
 * multiple database engines, so isolation lives here: global Sequelize hooks
 * inject a mandatory tenant predicate into every query touching a
 * tenant-scoped model.
 *
 * DENY BY DEFAULT is the whole point. The previous inline implementation
 * returned early (i.e. applied NO filter) whenever the request had no
 * `tenantId` — so an authenticated principal without a tenant saw EVERY
 * tenant's rows. That is the same fail-open hole the RLS policy had via its
 * `app.current_tenant = ''` branch. Here, that case resolves to a predicate
 * that can never match.
 *
 * Resolution order:
 *   options.skipTenantScope  -> skip   (explicit, greppable, auditable opt-out)
 *   no CLS context           -> skip   (pre-auth login/register, public
 *                                       endpoints, migrations, schedulers —
 *                                       these are not user-tenant requests)
 *   context.isSystemTask     -> skip   (background/system work)
 *   context.isSuperAdmin     -> skip   (cross-tenant operator, by design)
 *   context.tenantId         -> filter by that tenant
 *   otherwise                -> DENY   (authenticated, no tenant => sees nothing)
 *
 * Nine hooks are registered. Read/bulk-write verbs get a predicate; create-shaped
 * verbs get a stamp. `bulkCreate` and `upsert` (D-01) were outside the hooks
 * entirely until 2026-09-23 — see `applyTenantAssignmentBulk` and
 * `assertUpsertTenant` for why those two REFUSE a mismatched row instead of
 * silently re-scoping it.
 */

const { tenantStorage } = require("../middlewares/tenantContext.middleware");

/**
 * A syntactically valid UUID that no real tenant will ever own. Used instead of
 * a sentinel like "__no_tenant__" because tenant columns are UUID typed —
 * a non-UUID literal makes Postgres raise a type error instead of returning
 * zero rows, which would turn a denial into a 500.
 */
const NO_TENANT_UUID = "00000000-0000-0000-0000-000000000000";

/** The tenant column for a model, or null when the model is not tenant-scoped. */
const tenantKeyOf = (model) => {
  const attrs = model && model.rawAttributes;
  if (!attrs) {return null;}
  if (attrs.tenantId) {return "tenantId";}
  if (attrs.tenant_id) {return "tenant_id";}
  return null;
};

/**
 * Decide how the active context scopes a query.
 * @returns {{mode: "skip"}|{mode: "filter", tenantId: string}|{mode: "deny"}}
 */
const resolveScope = (options) => {
  if (options && options.skipTenantScope) {return { mode: "skip" };}

  const ctx = tenantStorage.getStore();
  if (!ctx) {return { mode: "skip" };}
  if (ctx.isSystemTask) {return { mode: "skip" };}
  if (ctx.isSuperAdmin) {return { mode: "skip" };}
  if (ctx.tenantId) {return { mode: "filter", tenantId: ctx.tenantId };}

  return { mode: "deny" };
};

/** Inject the mandatory tenant predicate into a read/bulk-write query. */
const applyTenantWhere = (options, model) => {
  const key = tenantKeyOf(model);
  if (!key) {return;}

  const scope = resolveScope(options);
  if (scope.mode === "skip") {return;}

  // Isolation is FORCED: a caller asking for another tenant simply gets nothing.
  const value = scope.mode === "deny" ? NO_TENANT_UUID : scope.tenantId;
  options.where = { ...(options.where || {}), [key]: value };
};

/** Stamp the active tenant onto a row being created/updated. */
const applyTenantAssignment = (instance, model, options) => {
  const key = tenantKeyOf(model);
  if (!key) {return;}

  const scope = resolveScope(options);
  // Only stamp when there is a real tenant to stamp.
  if (scope.mode !== "filter") {return;}

  instance[key] = scope.tenantId;
};

/**
 * Stamp — or refuse — every row of a `bulkCreate`.
 *
 * `bulkCreate` is a create-shaped operation with no `where`, so there is no
 * predicate to inject; the isolation lever is the tenant column on each row.
 * Sequelize v6 builds the INSERT from `instance.dataValues` *after* this hook
 * runs (`sequelize/lib/model.js`, `recursiveBulkCreate`: `beforeBulkCreate` at
 * :1596, `records = instances.map(...)` at :1652), so mutating the instances
 * here does reach the statement.
 *
 * DECISION — a row carrying a tenant id that is not the caller's is REFUSED,
 * not stamped over. Three reasons:
 *   1. Deny-by-default. Stamping over is a silent rewrite of caller data; the
 *      caller asked for something the isolation model forbids and gets told so.
 *   2. It matches `assertSameTenant` (beforeDestroy), which already throws
 *      rather than quietly narrowing, so the two write-side guards agree.
 *   3. The one call site that takes its tenant from *data* rather than from an
 *      argument is the tenant-backup restore (D-02). Stamping there would
 *      silently re-own another tenant's users into the caller's tenant and the
 *      restore would report success. Refusing surfaces the bug.
 * A row with NO tenant id is stamped — that is the ordinary create path, and
 * it matches `applyTenantAssignment`.
 *
 * @param {Array<object>} instances - The built (unsaved) instances
 * @param {object} model - The model the hook fired for
 * @param {object} options - The bulkCreate options
 */
const applyTenantAssignmentBulk = (instances, model, options) => {
  const key = tenantKeyOf(model);
  if (!key) {return;}

  const scope = resolveScope(options);
  if (scope.mode === "skip") {return;}

  // No resolvable tenant => write NOTHING. There is no `where` to poison with
  // NO_TENANT_UUID here, and stamping the sentinel would create real rows owned
  // by a tenant that does not exist. Refusal is the only fail-closed answer.
  if (scope.mode === "deny") {
    throw new Error(
      "Security Violation: Attempted to bulkCreate with no resolvable tenant",
    );
  }

  for (const instance of instances || []) {
    if (!instance) {continue;}
    const owner = instance[key];
    if (
      owner !== undefined &&
      owner !== null &&
      String(owner) !== String(scope.tenantId)
    ) {
      throw new Error(
        "Security Violation: Attempted to bulkCreate a cross-tenant record",
      );
    }
    instance[key] = scope.tenantId;
  }

  // `options.fields` is snapshotted before this hook and decides the INSERT
  // column list. A caller that passed an explicit `fields` omitting the tenant
  // column would drop the stamp on the floor; put it back.
  if (options && Array.isArray(options.fields) && !options.fields.includes(key)) {
    options.fields.push(key);
  }
};

/**
 * Refuse an `upsert` that would touch a row outside the caller's tenant.
 *
 * `beforeUpsert` CANNOT stamp. Sequelize v6 computes `insertValues` and
 * `updateValues` from the built instance *before* it runs the hook
 * (`sequelize/lib/model.js`: instance built :1502, values snapshotted
 * :1512-1513, `beforeUpsert` :1531, statement built from those snapshots
 * :1533). Mutating `values` here changes nothing that reaches the database, so
 * a stamp would be a lie that looks like a fix. Refusal is what a hook can
 * actually enforce — and it is also the deny-by-default answer.
 *
 * The conflict target is not ours to pick either: `queryInterface.upsert`
 * derives it from the updated fields (`query-interface.js:318-339`) and falls
 * back to the primary key. On `tenant_settings` it resolves to the unique index
 * `(tenant_id, key)`, so a wrong tenant id does not collide — it UPDATEs the
 * other tenant's row. On a model whose conflict target does not include the
 * tenant column it is worse: `DO UPDATE SET tenant_id = EXCLUDED.tenant_id`
 * would re-own the conflicting row. Both are refused here.
 *
 * A missing tenant id is refused too, rather than stamped: we cannot stamp, and
 * letting it through writes a NULL-tenant row that every scoped read ignores.
 *
 * @param {object} values - The values passed to `Model.upsert`
 * @param {object} model - The model the hook fired for
 * @param {object} options - The upsert options
 */
const assertUpsertTenant = (values, model, options) => {
  const key = tenantKeyOf(model);
  if (!key) {return;}

  const scope = resolveScope(options);
  if (scope.mode === "skip") {return;}

  if (scope.mode === "deny") {
    throw new Error(
      "Security Violation: Attempted to upsert with no resolvable tenant",
    );
  }

  const owner = values && values[key];
  if (owner === undefined || owner === null) {
    throw new Error(
      "Security Violation: Attempted to upsert a row with no tenant",
    );
  }
  if (String(owner) !== String(scope.tenantId)) {
    throw new Error(
      "Security Violation: Attempted to upsert a cross-tenant record",
    );
  }
};

/** Refuse to destroy a row belonging to another tenant. */
const assertSameTenant = (instance, model, options) => {
  const key = tenantKeyOf(model);
  if (!key) {return;}

  const scope = resolveScope(options);
  if (scope.mode !== "filter") {return;}

  const owner = instance && instance[key];
  if (owner && String(owner) !== String(scope.tenantId)) {
    throw new Error(
      "Security Violation: Attempted to destroy cross-tenant record",
    );
  }
};

/** Register the isolation hooks on a Sequelize instance. */
const register = (db) => {
  db.addHook("beforeFind", function (options) {
    applyTenantWhere(options, this);
  });
  db.addHook("beforeCount", function (options) {
    applyTenantWhere(options, this);
  });
  db.addHook("beforeBulkUpdate", function (options) {
    applyTenantWhere(options, this);
  });
  db.addHook("beforeBulkDestroy", function (options) {
    applyTenantWhere(options, this);
  });
  db.addHook("beforeCreate", function (instance, options) {
    applyTenantAssignment(instance, this, options);
  });
  db.addHook("beforeBulkCreate", function (instances, options) {
    applyTenantAssignmentBulk(instances, this, options);
  });
  db.addHook("beforeUpdate", function (instance, options) {
    applyTenantAssignment(instance, this, options);
  });
  db.addHook("beforeUpsert", function (values, options) {
    assertUpsertTenant(values, this, options);
  });
  db.addHook("beforeDestroy", function (instance, options) {
    assertSameTenant(instance, this, options);
  });
};

module.exports = {
  NO_TENANT_UUID,
  tenantKeyOf,
  resolveScope,
  applyTenantWhere,
  applyTenantAssignment,
  applyTenantAssignmentBulk,
  assertUpsertTenant,
  assertSameTenant,
  register,
};
