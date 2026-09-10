const { AsyncLocalStorage } = require("async_hooks");

// Global CLS namespace carrying the per-request tenant context. This is the
// single source of truth for tenant isolation: utils/tenantScope.util.js reads
// it inside global Sequelize hooks and injects a mandatory tenant predicate on
// every query touching a tenant-scoped model.
const tenantStorage = new AsyncLocalStorage();

/**
 * Establish the tenant context for the current request.
 *
 * Historically this also opened a transaction per request and pushed the tenant
 * into a Postgres GUC (`set_config('app.current_tenant', …)`) so ROW LEVEL
 * SECURITY policies could enforce isolation in the database. RLS has been
 * removed: it is Postgres-only and therefore incompatible with running on
 * multiple database engines, and its policy carried a fail-open branch
 * (`app.current_tenant = ''` matched every row). Isolation is now enforced in
 * the ORM layer, deny-by-default, for every dialect.
 *
 * Dropping the GUC also removes two round-trips and a wrapping transaction
 * from every authenticated request.
 */
const tenantContextMiddleware = (req, res, next) => {
  // req.tenantId is set by the auth middleware (and honours the SUPER_ADMIN
  // x-tenant-id / x-tenant-code overrides).
  const tenantId = req.tenantId || null;
  const roleName = req.user && req.user.role && req.user.role.name;
  const isSuperAdmin = roleName === "SUPER_ADMIN" || roleName === "SUPERADMIN";
  // Reserved for background/system work that must span tenants.
  const isSystemTask = false;

  tenantStorage.run({ tenantId, isSuperAdmin, isSystemTask }, () => {
    next();
  });
};

module.exports = {
  tenantStorage,
  tenantContextMiddleware,
};
