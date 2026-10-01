/**
 * N-01 / V-15 — the ONE super-admin predicate.
 *
 * The seeded platform role is named `ROLE_NAMES.SUPER_ADMIN` ("SUPERADMIN",
 * constants/roleConstants.ts, services/migration.service.js). Older code and
 * some deployments carry the underscored spelling "SUPER_ADMIN", so both
 * spellings are recognised — identically — everywhere.
 *
 * Before this module, about twenty call sites open-coded the comparison and
 * disagreed: session.controller compared only "SUPER_ADMIN", so behind its
 * rbac(["SUPERADMIN"]) gate no seeded super admin could revoke another user's
 * sessions (N-01); tenantHierarchy.route compared only "SUPERADMIN" (V-15).
 * Every role-NAME check for the super admin goes through this module; a
 * string comparison of either spelling elsewhere in backend/src is refused by
 * tests/guards/superAdminPredicate.n01.guard.test.ts.
 *
 * Named exports only (no `export =`), so both `.js` and `.ts` callers can
 * `require`/`import` it.
 */
import { ROLE_NAMES } from "../constants/roleConstants";

/** Every spelling under which the platform super admin is recognised. */
export const SUPER_ADMIN_ROLE_NAMES: ReadonlySet<string> = new Set<string>([
  ROLE_NAMES.SUPER_ADMIN,
  "SUPER_ADMIN",
]);

/** True when `name` is a spelling of the super-admin role name. */
export const isSuperAdminRoleName = (name: unknown): boolean =>
  typeof name === "string" && SUPER_ADMIN_ROLE_NAMES.has(name);

/** The principal shapes the codebase passes around: `req.user`, a socket user, a model row. */
export interface RoleBearer {
  readonly role?: { readonly name?: unknown } | null;
}

/** True when the principal's role is the super admin (by name, either spelling). */
export const isSuperAdmin = (principal: RoleBearer | null | undefined): boolean =>
  isSuperAdminRoleName(principal?.role?.name);
