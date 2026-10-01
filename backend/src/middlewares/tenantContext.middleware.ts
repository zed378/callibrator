import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { TenantId } from "../types/ids";
// N-01: the one super-admin predicate (both spellings).
import { isSuperAdminRoleName } from "../utils/role.util";

/**
 * What every tenant-scoped query reads (utils/tenantScope.util.js#resolveScope).
 *
 * P9-05a (ADR-087): the store is a named type. Its no-tenant value stays
 * `null`, as it always was — tenantScope.util turns a missing tenant into
 * NO_TENANT_UUID (deny) when it builds the predicate. Returning the sentinel
 * from here instead, as the P9-05a card suggests, would change what the store
 * holds, which a conversion does not do (ADR-038 rule 3).
 */
export interface TenantContextStore {
  /** The tenant a query is scoped to; `null` scopes to no tenant (deny) unless a flag below skips scoping. */
  tenantId: TenantId | null;
  /** The platform operator: queries are not tenant-scoped. */
  isSuperAdmin: boolean;
  /** Background work that must span tenants (utils/jobContext.util.js). */
  isSystemTask: boolean;
  /** Why a system task spans tenants (jobContext.util#runAsSystem). */
  systemReason?: string;
}

// Global CLS namespace carrying the per-request tenant context. This is the
// single source of truth for tenant isolation: utils/tenantScope.util.js reads
// it inside global Sequelize hooks and injects a mandatory tenant predicate on
// every query touching a tenant-scoped model.
export const tenantStorage = new AsyncLocalStorage<TenantContextStore>();

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
export const tenantContextMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  // req.tenantId is set by the auth middleware (and honours the SUPER_ADMIN
  // x-tenant-id / x-tenant-code overrides). `||`, not `??`: an empty id has
  // always meant "no tenant".
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as-built semantics (ADR-038 rule 3)
  const tenantId = req.tenantId || null;
  const roleName = req.user?.role?.name;
  const isSuperAdmin = isSuperAdminRoleName(roleName);
  // Reserved for background/system work that must span tenants.
  const isSystemTask = false;

  tenantStorage.run({ tenantId, isSuperAdmin, isSystemTask }, () => {
    next();
  });
};
