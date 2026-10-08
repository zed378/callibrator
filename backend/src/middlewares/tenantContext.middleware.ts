import { AsyncLocalStorage } from "async_hooks";
import type { NextFunction, Request, Response } from "express";
import type { ClientFacilityId, TenantId } from "../types/ids";
// N-01: the one super-admin predicate (both spellings).
import { isSuperAdminRoleName } from "../utils/role.util";
import { facilityRouteGate } from "./facilityRouteGate.middleware";

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
  /**
   * P21-09 (ADR-124 Am. 2 § 8; spec § 7.1) — the user principal, for the `own-user` rules of
   * FACILITY_READABLE. Null for an API key, a job, no principal. Absent reads as null.
   */
  userId?: string | null;
  /** The facility a bound principal is confined to — from the LOADED user row only (AM-2). */
  clientFacilityId?: ClientFacilityId | null;
  /**
   * Whether the principal is facility-bound: the row's `client_facility_id` is set (AM-3) —
   * never inferred from a role or a join. Absent reads as false (unbound: the facility
   * dimension does not apply), so every writer that is not a bound user's entry path
   * (jobs, the super admin's home-tenant context) is unchanged.
   */
  facilityBound?: boolean;
}

/** The principal fields the facility context is derived from (auth.middleware loaded them). */
interface FacilityPrincipal {
  readonly id?: unknown;
  readonly isApiKey?: unknown;
  readonly clientFacilityId?: unknown;
}

/**
 * P21-09 (spec § 7.1) — the facility half of the context, from the principal `auth` /
 * `optionalAuth` / `tryApiKeyAuth` (or the socket handshake) loaded: a user's own row, never a
 * header, body, query, path, cookie, claim or socket payload (FT-02, FT-06). An API key is
 * tenant-wide by design (FT-04): unbound, no user.
 *
 * @param principal - the loaded principal, if any
 * @returns `userId`, `clientFacilityId`, `facilityBound`
 */
export const facilityContextOf = (
  principal: FacilityPrincipal | null | undefined,
): { userId: string | null; clientFacilityId: ClientFacilityId | null; facilityBound: boolean } => {
  if (!principal || principal.isApiKey === true) {
    return { userId: null, clientFacilityId: null, facilityBound: false };
  }
  const userId = typeof principal.id === "string" && principal.id ? principal.id : null;
  const clientFacilityId =
    typeof principal.clientFacilityId === "string" && principal.clientFacilityId
      ? (principal.clientFacilityId as ClientFacilityId)
      : null;
  return { userId, clientFacilityId, facilityBound: clientFacilityId !== null };
};

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
export const tenantContextMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // req.tenantId is set by the auth middleware (and honours the SUPER_ADMIN
  // x-tenant-id / x-tenant-code overrides). `||`, not `??`: an empty id has
  // always meant "no tenant".
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as-built semantics (ADR-038 rule 3)
  const tenantId = req.tenantId || null;
  const roleName = req.user?.role?.name;
  const isSuperAdmin = isSuperAdminRoleName(roleName);
  // Reserved for background/system work that must span tenants.
  const isSystemTask = false;

  // P21-09: the facility dimension, from the same loaded principal (one writer — G-16).
  const facility = facilityContextOf(req.user);

  const context: TenantContextStore = { tenantId, isSuperAdmin, isSystemTask, ...facility };
  tenantStorage.run(context, () => {
    // P21-09 (spec § 7.7, AM-12): a facility-BOUND principal reaches only the
    // marked routes — refused here, before any parameter is read. Everyone
    // else passes straight to next().
    facilityRouteGate(context, req, res, next);
  });
};
