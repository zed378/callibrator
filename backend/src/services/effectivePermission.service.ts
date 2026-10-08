/**
 * ADR-102 — the principal's EFFECTIVE menu permission: the one function the
 * API gate (dynamicAccess.middleware#checkMenuPermission), the sidebar
 * (menuGroup.service#getRoleMenuAssignments) and the page write buttons
 * (GET /menu-groups/my-permissions → frontend usePermissions) all read.
 *
 * Before ADR-102 the sidebar cascaded a grant to EVERY descendant and ignored
 * per-user overrides, while the API inherits a grant ONE level down and
 * honours overrides (A-35) — so the sidebar showed pages that 403 and hid
 * pages a user had been granted. Pages decided their write buttons from
 * hard-coded role names. There is now one rule:
 *
 *  1. the role's matrix — roles.service#getRolePermissionsMatrix: the role's
 *     grants plus each granted menu's direct children, keyed by name and slug;
 *     an inactive or missing role grants nothing;
 *  2. a per-user override on the same key REPLACES it (userPermission.service
 *     #getUserOverrideMatrix): `read` / `write`, or `none`, a revocation;
 *  3. `write` implies `read`; any verb but `read` (`approve`, `sign`,
 *     `generate`, `update`, …) needs `write` (normalizePermission);
 *  4. the super admin passes every menu gate (dynamicAccess "SUPER_ADMIN bypass");
 *  5. P21-09c (P18-03 § 5): a facility-BOUND principal (its loaded row's `clientFacilityId` is
 *     set, AM-3) is capped by the bound menu ceiling (constants/facilityAccess
 *     BOUND_MENU_CEILING): min(1 ⊕ 2, ceiling[role][slug]); a slug absent from its role's
 *     ceiling is none — an override cannot lift a bound user above it. Unbound principals are
 *     untouched.
 *
 * API-key principals are not handled here: their scopes are checked by
 * apiKey.service#scopeAllows and they have no menu.
 */
import RolesService from "./roles.service";
import userPermissionService from "./userPermission.service";
import { ROLE_LEVELS, ROLE_NAMES } from "../constants/roleConstants";
import type { PageGate } from "../constants/menuPageAccess";
import { MENU_PAGE_GATES } from "../constants/menuPageAccess";
import { BOUND_MENU_CEILING } from "../constants/facilityAccess";
import type { CeilingAccess } from "../constants/facilityAccess";
import type { UserId } from "../types/ids";
import { isSuperAdminRoleName } from "../utils/role.util";

/** What the effective permission reads of a principal. */
export interface PermissionPrincipal {
  /**
   * The user; absent when a role's own menu is resolved (no per-user override).
   * `req.user.id` from the JavaScript callers; `toUserId` from TypeScript.
   */
  readonly id?: UserId | null;
  readonly role?: {
    readonly id?: string | null;
    readonly name?: string | null;
    readonly roleLevel?: number | null;
    readonly role_level?: number | null;
  } | null;
  /** The loaded user row's facility (AM-3): set ⇒ bound. Never from a request. */
  readonly clientFacilityId?: string | null;
  /** An API-key principal is never bound (FT-04). */
  readonly isApiKey?: boolean | null;
}

/** A menu's effective access for a principal, or nothing. */
export type Access = "read" | "write";

/** The role matrix and the user's overrides, loaded once and read per menu. */
export interface PermissionSources {
  readonly superAdmin: boolean;
  readonly matrix: Readonly<Record<string, readonly (string | undefined)[]>>;
  readonly overrides: Readonly<Record<string, string>>;
  /** P21-09c: the bound menu ceiling of a bound principal; absent (or null) for an unbound one. */
  readonly ceiling?: Readonly<Record<string, CeilingAccess>> | null;
}

/** Whether the principal is facility-bound: its loaded row names a facility (AM-3); never an API key. */
export const isBound = (principal: PermissionPrincipal | null | undefined): boolean =>
  principal?.isApiKey !== true && typeof principal?.clientFacilityId === "string" && principal.clientFacilityId !== "";

/** The ceiling of a bound principal's role — the empty ceiling for a role outside the bound set (fail closed). */
const ceilingOf = (principal: PermissionPrincipal): Readonly<Record<string, CeilingAccess>> =>
  (BOUND_MENU_CEILING as Readonly<Record<string, Readonly<Record<string, CeilingAccess>> | undefined>>)[principal.role?.name ?? ""] ?? {};

/** Called when the per-user override lookup fails; the role grants are then used alone (as built). */
export type OverrideErrorHandler = (error: Error) => void;

/** The names under which the super admin is recognised, as dynamicAccess and rbac do. */
export const isSuperAdmin = (principal: PermissionPrincipal | null | undefined): boolean => {
  // N-01: delegates to the one super-admin predicate (utils/role.util.ts).
  return isSuperAdminRoleName(principal?.role?.name);
};

/** Any verb but `read` needs `write` (dynamicAccess.middleware#normalizePermission). */
export const normalizePermission = (permType: string): Access =>
  permType.toLowerCase() === "read" ? "read" : "write";

/**
 * Load what the effective permission is computed from. The super admin needs
 * neither: it passes every menu gate.
 */
export const loadPermissionSources = async (
  principal: PermissionPrincipal,
  onOverrideError?: OverrideErrorHandler,
): Promise<PermissionSources> => {
  if (isSuperAdmin(principal)) {
    return { superAdmin: true, matrix: {}, overrides: {} };
  }
  const roleId = principal.role?.id;
  const matrix = roleId ? await RolesService.getRolePermissionsMatrix(roleId) : {};
  let overrides: Record<string, string> = {};
  if (principal.id) {
    try {
      overrides = await userPermissionService.getUserOverrideMatrix(principal.id);
    } catch (err) {
      // As built (dynamicAccess): a failed override lookup falls back to the
      // role's grants; the caller logs it.
      if (onOverrideError) {
        onOverrideError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
  return { superAdmin: false, matrix, overrides, ceiling: isBound(principal) ? ceilingOf(principal) : null };
};

/**
 * P21-09c — `held` capped by one ceiling cell: none ⇒ nothing; read ⇒ read when anything is held;
 * write ⇒ unchanged (the ceiling never adds a grant).
 *
 * @param held - the permission types the role and override give
 * @param cell - the ceiling cell, or undefined (none)
 * @returns the capped permission types
 */
const capped = (held: (string | undefined)[], cell: CeilingAccess | undefined): (string | undefined)[] => {
  if (cell === undefined) {
    return [];
  }
  if (cell === "write") {
    return held;
  }
  return held.some((p) => p === "read" || p === "write") ? ["read"] : [];
};

/**
 * The permission types a principal holds on one menu (name or slug): the
 * role's, replaced by the user's override when there is one (`none` → none).
 */
export const permissionsForMenu = (sources: PermissionSources, menuName: string): (string | undefined)[] => {
  let held: (string | undefined)[];
  if (Object.prototype.hasOwnProperty.call(sources.overrides, menuName)) {
    const override = sources.overrides[menuName];
    held = override === "none" ? [] : [override];
  } else {
    held = [...(sources.matrix[menuName] ?? [])];
  }
  return sources.ceiling ? capped(held, Object.hasOwn(sources.ceiling, menuName) ? sources.ceiling[menuName] : undefined) : held;
};

/** Whether `held` grants `permType` (`write` implies `read`). */
export const holdsPermission = (held: readonly (string | undefined)[], permType: string): boolean => {
  const normalized = normalizePermission(permType);
  if (held.includes(normalized)) {
    return true;
  }
  return normalized === "read" && held.includes("write");
};

/** Whether the principal may `permType` on `menuName` — the API's menu gate. */
export const allows = (sources: PermissionSources, menuName: string, permType: string): boolean =>
  sources.superAdmin || holdsPermission(permissionsForMenu(sources, menuName), permType);

/** The strongest access the principal holds on `menuName`, or null. */
export const accessOf = (sources: PermissionSources, menuName: string): Access | null => {
  if (allows(sources, menuName, "write")) {
    return "write";
  }
  return allows(sources, menuName, "read") ? "read" : null;
};

/** rbac.middleware's level table: role NAME → level. */
const LEVEL_BY_ROLE_NAME: Readonly<Partial<Record<string, number>>> = Object.freeze(
  Object.fromEntries(
    Object.entries(ROLE_NAMES).map(([key, name]) => [name, (ROLE_LEVELS as Record<string, number>)[key]]),
  ),
);

/**
 * rbac(requiredRoles) with its default `allowHigher`, as a predicate: the super
 * admin passes; a listed role name passes; otherwise the principal's
 * `role_level || roleLevel || 0` must reach the lowest listed level.
 * rbacParity.adr102.test.ts runs this against rbac() itself.
 */
export const rbacAllows = (principal: PermissionPrincipal, requiredRoles: readonly string[]): boolean => {
  const role = principal.role;
  const name = role?.name;
  if (!role || !name) {
    return false;
  }
  if (isSuperAdmin(principal)) {
    return true;
  }
  if (requiredRoles.includes(name)) {
    return true;
  }
  const levels = requiredRoles.map((role) => LEVEL_BY_ROLE_NAME[role]).filter((l): l is number => l !== undefined);
  const minRequired = levels.length ? Math.min(...levels) : 0;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as rbac.middleware: a 0 level falls through
  const level = role.role_level || role.roleLevel || 0;
  return level >= minRequired;
};

/** Whether one page gate (constants/menuPageAccess) passes. */
export const gatePasses = (principal: PermissionPrincipal, sources: PermissionSources, gate: PageGate): boolean => {
  switch (gate.kind) {
    case "menu":
      return allows(sources, gate.slug, "read");
    case "rbac":
      return rbacAllows(principal, gate.roles);
    case "notSuperAdmin":
      return !sources.superAdmin;
  }
};

/**
 * ADR-102 — whether the menu entry `slug` is shown: `read` on the slug itself
 * AND every gate its page's load call is behind (constants/menuPageAccess).
 */
export const menuEntryVisible = (principal: PermissionPrincipal, sources: PermissionSources, slug: string): boolean =>
  allows(sources, slug, "read") && (MENU_PAGE_GATES[slug] ?? []).every((gate) => gatePasses(principal, sources, gate));

/**
 * The principal's effective access on each of `slugs` (the ones it holds).
 * GET /menu-groups/my-permissions answers with this.
 */
export const effectivePermissionMap = (sources: PermissionSources, slugs: readonly string[]): Record<string, Access> => {
  const map: Record<string, Access> = {};
  for (const slug of slugs) {
    const access = accessOf(sources, slug);
    if (access) {
      map[slug] = access;
    }
  }
  return map;
};
