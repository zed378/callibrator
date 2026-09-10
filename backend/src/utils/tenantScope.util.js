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
  db.addHook("beforeUpdate", function (instance, options) {
    applyTenantAssignment(instance, this, options);
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
  assertSameTenant,
  register,
};
