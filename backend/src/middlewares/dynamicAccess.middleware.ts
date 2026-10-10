// P9-19 (ADR-087): converted from dynamicAccess.middleware.js under the four
// tenantContext gates, behaviour unchanged (its interim `.d.ts` is deleted with
// it). What the JavaScript destructured at load (`User`, `Tenants`,
// `scopeAllows`, `logger`, `sendError`, `isSuperAdmin`) is captured at load;
// `RolesService` stays the module object; `effectivePermission` is still
// required lazily, per call. The exports are `export =` of one object, in the
// JavaScript's key order: its properties are plain and writable (the gate
// guards replace `dynamicAccess`), and `require()` returns it as before.
//
// A-07 (the card's DoD): the resource a gate names is typed `SeededMenuSlug` —
// a slug the real seed creates — so a TypeScript route naming anything else
// ("AuditLogs", "Finance") does not compile.
/* eslint-disable @typescript-eslint/no-confusing-void-expression -- as built: `return next()` / `return sendError(…)` return what they return, as the JavaScript did */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import models from "../models";
import RolesService from "../services/roles.service";
import { scopeAllows as loadedScopeAllows } from "../services/apiKey.service";
import { logger as loadedLogger } from "./activityLog.middleware";
import { error as loadedSendError } from "../utils/response.util";
// N-01: the one super-admin predicate (both spellings).
import { isSuperAdmin as loadedIsSuperAdmin } from "../utils/role.util";
import type * as EffectivePermissionModule from "../services/effectivePermission.service";
import type { SeededMenuSlug } from "../constants/seededMenuSlugs";

const { User, Tenants } = models;
const scopeAllows = loadedScopeAllows;
const logger = loadedLogger;
const sendError = loadedSendError;
const isSuperAdmin = loadedIsSuperAdmin;

/** The principal as this gate reads it (`auth` set it). */
interface AccessPrincipal {
  id?: unknown;
  tenantId?: unknown;
  tenant?: { id?: unknown } | null;
  readonly role?: { readonly id?: unknown; readonly name?: unknown } | null;
  isApiKey?: boolean;
  apiKeyScopes?: unknown;
}

/** The request members this gate reads or sets beyond Express's own. */
interface AccessRequest {
  requestId?: string;
  dynamicAccessContext?: Record<string, unknown>;
  apiKeyAuthorized?: boolean;
}

/** The options a route passes. */
interface DynamicAccessOptions {
  /** Require every listed action (AND) instead of any (OR, the default). */
  requireAll?: boolean;
  /** Allow the caller on a route whose PATH names them (after checkTenant, A-63). */
  checkSelf?: boolean;
  /** Every tenant id and owner id the request names must be the caller's tenant's (A-93). */
  checkTenant?: boolean;
}

/** One menu group's decision. */
interface MenuResult {
  allowed: boolean;
  deniedTypes: string[];
  menuGroup: { name: string };
  permission: { permission_type: string } | null;
}

/**
 * AZ-04. The single status used for EVERY tenant-isolation refusal in this
 * middleware, and the two messages it can carry.
 *
 * `CLAUDE.md`: "Cross-tenant returns 404, never 403. [...] Non-existent,
 * soft-deleted and not-yours must be indistinguishable."
 *
 * Both tenant branches used to answer 404 for an id that matched nothing and
 * 403 "Access denied: resource belongs to a different tenant" for one that
 * matched another tenant's row — a tenant-membership oracle on the 50 routes
 * that pass `checkTenant: true`. Every branch now goes through
 * `denyTenantIsolation`, so a given branch has exactly ONE body and the
 * "missing" and "foreign" cases cannot drift apart.
 *
 * The messages differ only by WHICH lookup ran (tenant id vs resource owner
 * id), which the caller already knows from the request it sent; within either
 * branch the two outcomes are byte-identical.
 */
const TENANT_REFUSAL_STATUS = 404;
const TENANT_NOT_FOUND_MESSAGE = "Tenant not found";
const RESOURCE_NOT_FOUND_MESSAGE = "Resource not found";

/**
 * Refuse a tenant-isolation failure without telling the caller which kind it
 * was. The reason is logged against the request id; the response carries
 * nothing that separates "does not exist" from "not yours".
 *
 * @param req - the request
 * @param res - the response
 * @param message - one of the two *_NOT_FOUND_MESSAGE constants
 * @param context - log-only detail, including `reason`
 */
const denyTenantIsolation = (req: Request, res: Response, message: string, context: Record<string, unknown>): Response => {
  // Guarded the same way as every other logging call in this file: the
  // activityLog module's `logger` export is absent in some test harnesses,
  // and a refusal must still be produced rather than a TypeError.
  if (typeof logger !== "undefined") {
    logger.warn("dynamicAccess: tenant isolation refusal", {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty request id is "unknown"
      requestId: (req as Request & AccessRequest).requestId || "unknown",
      userId: (req.user as AccessPrincipal).id,
      method: req.method,
      url: req.originalUrl,
      ...context,
    });
  }

  return sendError(res, message, TENANT_REFUSAL_STATUS);
};

/** What `req.params` / `req.body` / `req.query` may carry (read raw). */
type Fields = Record<string, unknown>;

/**
 * A-63. The owner id the `checkSelf` bypass compares against the caller.
 *
 * PATH PARAMETERS ONLY — never `req.body` or `req.query`. A body or query value
 * is caller-chosen and says nothing about which row the handler will act on;
 * a path parameter is the resource the route addresses. Exported so the
 * "reads no body or query field" property can be tested directly.
 *
 * @param req - the request
 * @returns the path's `userId`, else its `id`
 */
// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `:userId`, else `:id`
const selfOwnerIdFromPath = (req: Request): unknown => (req.params as Fields | undefined)?.["userId"] || (req.params as Fields | undefined)?.["id"];

/**
 * The distinct, non-empty values of `field` in the path, body and query, in
 * that order. A-93: every one is checked; none can stand in for another.
 *
 * @param req - the request
 * @param field - the field name
 * @returns the distinct values, as strings
 */
const namedBy = (req: Request, field: string): string[] => {
  const seen: string[] = [];
  for (const source of [req.params, req.body, req.query] as unknown[]) {
    const value = source && typeof source === "object" ? (source as Fields)[field] : undefined;
    // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: values compared as strings
    if (value !== undefined && value !== null && value !== "" && !seen.includes(String(value))) {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: values kept as strings
      seen.push(String(value));
    }
  }
  return seen;
};

/**
 * A-93. Every tenant id a request names — path first. Exported so the
 * "all of them are checked" property can be tested directly.
 *
 * @param req - the request
 * @returns the tenant ids
 */
const tenantIdsNamedBy = (req: Request): string[] => namedBy(req, "tenantId");

/**
 * A-93. Every user id a request names as the resource owner (`userId` in the
 * path, body or query). Checked for tenant membership independently of any
 * tenant id the request also carries.
 *
 * @param req - the request
 * @returns the owner ids
 */
const ownerIdsNamedBy = (req: Request): string[] => namedBy(req, "userId");

/**
 * Dynamic RBAC Middleware
 *
 * Simplified RBAC middleware that checks role-based menu permissions.
 * Uses the role_menu_permissions table to determine read/write access.
 *
 * USAGE:
 *
 * // Simple permission check
 * router.get("/", auth, dynamicAccess("home", "read"), controller);
 *
 * // Multiple actions (OR logic - user needs any one)
 * router.get("/", auth, dynamicAccess("dashboard", ["read", "write"]), controller);
 *
 * // Multiple actions (AND logic - user needs all)
 * router.post("/bulk", auth, dynamicAccess("reports", ["read", "write"], { requireAll: true }), controller);
 *
 * @param menuGroup - Menu slug(s) the seed creates (A-07), e.g. 'home', ['users', 'management']
 * @param permissionType - Permission type(s) (e.g., 'read', 'write', ['read', 'write'])
 * @param options - `requireAll`: all actions (AND) vs any (OR, default); `checkSelf`: allow the
 *   caller on a route whose PATH names them (`:userId` / `:id`) without the menu permission,
 *   after checkTenant, never instead of it (A-63); `checkTenant`: every `tenantId` the request
 *   names (path, body, query) must be the caller's, AND every `userId` it names must be a user
 *   of the caller's tenant — both checks, independently (A-93). A mismatch is 404
 * @returns Express middleware
 */
const dynamicAccess = (
  menuGroup: SeededMenuSlug | readonly SeededMenuSlug[],
  permissionType: string | readonly string[],
  options: DynamicAccessOptions = {},
): RequestHandler => {
  const { requireAll = false } = options;

  // Normalize to arrays
  const menuGroups: readonly string[] = Array.isArray(menuGroup) ? menuGroup : [menuGroup as string];
  const permTypes: readonly string[] = Array.isArray(permissionType)
    ? permissionType
    : [permissionType as string];

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AccessPrincipal | null | undefined;

      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the two tests the JavaScript made
      if (!user || !user.role) {
        return sendError(res, "Unauthorized: No user context found", 401);
      }

      // SUPER_ADMIN bypass - has access to everything (no tenant check)
      if (isSuperAdmin(user)) {
        (req as Request & AccessRequest).dynamicAccessContext = {
          allowed: true,
          reason: "SUPER_ADMIN bypass",
          menuGroups,
          permissionTypes: permTypes,
        };
        return next();
      }

      // ---- Tenant isolation check (A-93) ----
      // Two INDEPENDENT checks, each applied to every place the request names
      // one. They used to be an if/else: a request carrying ANY tenantId equal
      // to the caller's own took the tenant branch, and the owner check never
      // ran — so `DELETE /users/<another tenant's user>/avatar` with
      // `?tenantId=<my tenant>` passed the gate on the global hooks alone.
      if (options.checkTenant) {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-optional-chain -- as built: `||` and `&&`
        const userTenantId = user.tenantId || (user.tenant && user.tenant.id);

        // 1. Every tenant id the request names must be the caller's own.
        //    The PATH parameter is the resource the route addresses; a body or
        //    query value is caller-chosen. Those are consulted ONLY to refuse
        //    (a mismatch is 404) — they can never widen what the path allows,
        //    and they never switch the owner check below off.
        for (const resourceTenantId of tenantIdsNamedBy(req)) {
          // Ensure resource belongs to user's tenant
          const tenant = await Tenants.findByPk(resourceTenantId, {
            attributes: ["id"],
          });

          // AZ-04: "no such tenant" and "someone else's tenant" answer with
          // the same status and the same body. Only the log says which.
          if (!tenant) {
            return denyTenantIsolation(req, res, TENANT_NOT_FOUND_MESSAGE, {
              reason: "no-such-tenant",
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: String() kept
              resourceTenantId: String(resourceTenantId),
            });
          }

          if (String(tenant.id) !== String(userTenantId)) {
            return denyTenantIsolation(req, res, TENANT_NOT_FOUND_MESSAGE, {
              reason: "cross-tenant",
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: String() kept
              resourceTenantId: String(resourceTenantId),
            });
          }
        }

        // 2. Every user the request names must belong to the caller's tenant,
        //    whether or not a tenant id was also supplied.
        for (const resourceOwnerId of ownerIdsNamedBy(req)) {
          const owner = await User.findByPk(resourceOwnerId, {
            attributes: ["tenantId"],
          });

          // AZ-04: same status, same body, whether the owner does not
          // exist or belongs to another tenant.
          if (!owner) {
            return denyTenantIsolation(req, res, RESOURCE_NOT_FOUND_MESSAGE, {
              reason: "no-such-owner",
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: String() kept
              resourceOwnerId: String(resourceOwnerId),
            });
          }

          if (String(owner.tenantId) !== String(userTenantId)) {
            return denyTenantIsolation(req, res, RESOURCE_NOT_FOUND_MESSAGE, {
              reason: "cross-tenant-owner",
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: String() kept
              resourceOwnerId: String(resourceOwnerId),
              ownerTenantId: String(owner.tenantId),
            });
          }
        }
      }

      // ---- Self-service bypass (A-63) ----
      // When checkSelf is enabled, a user acting on their OWN resource
      // (e.g. their own avatar) is allowed without the menu permission.
      //
      // Two rules, both load-bearing:
      //
      //  1. It runs AFTER the tenant-isolation check above, never before it.
      //     It used to run first and `return next()`, so a request that
      //     matched "self" skipped checkTenant entirely.
      //
      //  2. Ownership comes from the PATH only (`:userId` / `:id`). It used to
      //     fall back to `req.body.userId` and `req.query.userId`. A body field
      //     is whatever the caller types, and it need not be the id the
      //     handler then acts on: PATCH /tenants/edit took `userId: <self>`
      //     for the bypass and then updated `tenantId: <any tenant>`. A path
      //     parameter is the resource the route addresses, so "the path names
      //     me" means "this request acts on me" for every route that uses it.
      //
      // Routes whose target is not in the path (for example PATCH /users/edit)
      // therefore get no self bypass at all; the self-service path for a
      // profile is PATCH /users/:userId/profile.
      if (options.checkSelf) {
        const ownerId = selfOwnerIdFromPath(req);

        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: ids compared as strings
        if (ownerId && String(ownerId) === String(user.id)) {
          (req as Request & AccessRequest).dynamicAccessContext = {
            allowed: true,
            reason: "self",
            menuGroups,
            permissionTypes: permTypes,
          };
          return next();
        }
      }

      // Check permissions for each menu group
      const results: MenuResult[] = [];
      let allAllowed = true;

      for (const menuName of menuGroups) {
        // API-key principals authorize via their scopes, not the role matrix.
        const result = user.isApiKey
          ? checkApiKeyScope(menuName, permTypes, user.apiKeyScopes, requireAll)
          : await checkMenuPermission(menuName, permTypes, user, requireAll, req);

        results.push(result);
        if (!result.allowed) {
          allAllowed = false;
        }
      }

      // If requireAll is true, ALL menu groups must be allowed
      // If requireAll is false (default), ANY menu group being allowed is sufficient
      const finalAllowed = requireAll
        ? allAllowed
        : results.some((r) => r.allowed);

      if (!finalAllowed) {
        const deniedTypes = results
          .filter((r) => !r.allowed)
          // A-32: results come only from checkApiKeyScope / checkMenuPermission,
          // each of which always sets deniedTypes to an array; the `|| []`
          // fallback that sat here was unreachable and hidden from coverage.
          .flatMap((r) => r.deniedTypes);

        // 403 is CORRECT here and must NOT be flattened to 404: this is a
        // permission failure INSIDE the caller's own tenant and discloses
        // nothing about any other tenant. What was denied goes to the log —
        // the body keeps the house envelope ({ success, status, message,
        // data }) instead of the ad-hoc `required` / `menuGroups` keys.
        if (typeof logger !== "undefined") {
          logger.warn("dynamicAccess: permission refusal", {
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty request id is "unknown"
            requestId: (req as Request & AccessRequest).requestId || "unknown",
            userId: user.id,
            roleId: user.role.id,
            required: deniedTypes.length > 0 ? deniedTypes : permTypes,
            menuGroups,
            method: req.method,
            url: req.originalUrl,
          });
        }

        return sendError(res, "Forbidden: Insufficient permissions", 403);
      }

      // A-03: this gate has read the key's scopes and allowed it, so the
      // request is authorized for an API-key principal.
      if (user.isApiKey) {
        (req as Request & AccessRequest).apiKeyAuthorized = true;
      }

      // Attach permission context to request for controller use
      const allowedResult = results.find((r) => r.allowed);
      (req as Request & AccessRequest).dynamicAccessContext = {
        allowed: true,
        menuGroups,
        permissionTypes: permTypes,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `?.permission || null`
        permission: allowedResult?.permission || null,
      };

      next();
    } catch (error) {
      if (typeof logger !== "undefined") {
        // A-254: this logged `JSON.stringify(req.user)` — the whole Users row
        // auth.middleware loads (password hash, MFA secret, recovery codes),
        // pre-stringified into the message where the logger's key-based
        // redaction cannot see it. Identify the principal by id only.
        const principal = req.user as AccessPrincipal | null | undefined;
        logger.error("DynamicAccess Error", {
          error: (error as Error).message,
          stack: (error as Error).stack,
          userId: principal?.id ?? null,
          tenantId: principal?.tenantId ?? null,
          role: principal?.role?.name ?? null,
          isApiKey: !!principal?.isApiKey,
          menuGroup,
          permissionType,
          options,
        });
      }
      // A-13: do not hand-roll a 500 carrying `error.message` (a database or
      // service error names tables, hosts and internals). Hand the error to
      // the global error handler (index.js -> errorHandlers.middleware), which
      // logs it against the request id and, in production, replaces the
      // message with a generic one via fileValidation.util#sanitizeError —
      // the same path `abac` and every wrapped controller take.
      //
      // Anything that invokes this gate with its own `next` (the search
      // controller's per-type probe) MUST treat `next(err)` as a denial, not
      // as "allowed" — only a bare `next()` means the check passed.
      return next(error);
    }
  };
};

/**
 * Normalize an action verb to the stored permission vocabulary.
 *
 * The role-permission matrix only stores `read` / `write`. Routes, however,
 * express intent with richer verbs (create, update, delete, generate,
 * approve, sign, ...). Every mutating verb requires `write`; only `read`
 * maps to `read`. Without this normalization any non-read/write verb would
 * silently fail to match and deny every non-super-admin.
 *
 * @param permType - the route's verb
 * @returns "read" or "write"
 */
function normalizePermission(permType: unknown): "read" | "write" {
  return String(permType).toLowerCase() === "read" ? "read" : "write";
}

/**
 * Authorize an API-key principal for a menu group via its scopes.
 * Returns the same shape as checkMenuPermission.
 *
 * @param menuName - the menu slug
 * @param permTypes - the actions
 * @param scopes - the key's scopes
 * @param requireAll - AND instead of OR
 * @returns the decision
 */
function checkApiKeyScope(menuName: string, permTypes: readonly string[], scopes: unknown, requireAll: boolean): MenuResult {
  const typeResults = permTypes.map((permType) => ({
    permissionType: permType,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy scopes is no scopes
    allowed: scopeAllows(scopes || [], menuName, permType),
  }));

  const allowed = requireAll
    ? typeResults.every((r) => r.allowed)
    : typeResults.some((r) => r.allowed);

  const allowedResult = typeResults.find((r) => r.allowed);

  return {
    allowed,
    deniedTypes: typeResults.filter((r) => !r.allowed).map((r) => r.permissionType),
    menuGroup: { name: menuName },
    permission: allowedResult
      ? { permission_type: allowedResult.permissionType }
      : null,
  };
}

/**
 * U-06b (ADR-120) — the permission sources one request has loaded, by request.
 *
 * `loadPermissionSources` reads the role matrix and the user's overrides (two
 * Redis GETs and two JSON parses of the whole matrix). It ran once per menu a
 * gate names, and once per gate: GET /search ran it six times (its route gate
 * names three menus, then the controller probes each of three types through
 * this same gate), which was about 8% of the backend's CPU under search load.
 * Within ONE request the principal and its permissions are fixed (`auth` loads
 * `req.user` afresh for every request), so the first load is shared by every
 * gate and probe of that request. Keyed by the request object, so nothing
 * outlives it: the next request loads again, and a changed grant applies as
 * before (W-11's cache deletion, then the next request).
 */
const sourcesByRequest = new WeakMap<
  object,
  { readonly principal: AccessPrincipal; readonly sources: Promise<EffectivePermissionModule.PermissionSources> }
>();

/**
 * Check permission for a specific menu group using cached matrix.
 *
 * Resolution order:
 *   1. Per-user override (user_menu_permissions): "read"/"write" replace the
 *      role permission for this menu; "none" explicitly denies it.
 *   2. Otherwise the role permission matrix (role_menu_permissions) applies.
 *
 * @param menuName - the menu slug
 * @param permTypes - the actions
 * @param user - the principal
 * @param requireAll - AND instead of OR
 * @returns the decision
 */
async function checkMenuPermission(
  menuName: string,
  permTypes: readonly string[],
  user: AccessPrincipal,
  requireAll: boolean,
  req?: Request,
): Promise<MenuResult> {
  // ADR-102 — the role matrix (1) and the per-user override (2, `none`
  // denies) are read through services/effectivePermission, the ONE function
  // the sidebar and the page write buttons read too. Lazy require to avoid a
  // circular dependency at module load time (as the override lookup was).
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required per call (a load-time cycle otherwise)
  const effectivePermission = require("../services/effectivePermission.service") as typeof EffectivePermissionModule;
  const load = (): Promise<EffectivePermissionModule.PermissionSources> =>
    effectivePermission.loadPermissionSources(user as EffectivePermissionModule.PermissionPrincipal, (err) => {
      // Overrides are additive hardening — never let a lookup failure block
      // the request path; fall back to plain role permissions.
      if (typeof logger !== "undefined") {
        logger.error(`UserPermission override lookup failed: ${err.message}`);
      }
    });
  // U-06b: one load per request (sourcesByRequest above); a call with no
  // request (principalHasMenuPermission) loads as before.
  // The entry is used only for the same principal object it was loaded for.
  const memo = req ? sourcesByRequest.get(req) : undefined;
  let pending = memo?.principal === user ? memo.sources : undefined;
  if (!pending) {
    pending = load();
    if (req) {
      sourcesByRequest.set(req, { principal: user, sources: pending });
    }
  }
  const sources = await pending;
  const rolePermsForMenu = effectivePermission.permissionsForMenu(sources, menuName);

  const typeResults: { permissionType: string; allowed: boolean }[] = [];
  for (const permType of permTypes) {
    const normalized = normalizePermission(permType);
    // `write` implicitly satisfies `read`.
    let hasPerm = rolePermsForMenu.includes(normalized);
    if (!hasPerm && normalized === "read" && rolePermsForMenu.includes("write")) {
      hasPerm = true;
    }
    typeResults.push({
      permissionType: permType,
      allowed: hasPerm,
    });
  }

  const allowed = requireAll
    ? typeResults.every((r) => r.allowed)
    : typeResults.some((r) => r.allowed);

  const deniedTypes = typeResults
    .filter((r) => !r.allowed)
    .map((r) => r.permissionType);

  const allowedResult = typeResults.find((r) => r.allowed);

  return {
    allowed,
    deniedTypes,
    menuGroup: { name: menuName }, // Mock structure
    permission: allowedResult
      ? { permission_type: allowedResult.permissionType }
      : null,
  };
}

/** A principal `principalHasMenuPermission` can decide for: `req.user`, or a user row shaped like it. */
interface MenuPrincipal {
  id?: string;
  role?: { id?: string; name?: string } | null;
  isApiKey?: boolean;
  apiKeyScopes?: string[];
  [field: string]: unknown;
}

/**
 * A-129 — the gate's own decision, for code that must ask it about a
 * principal outside a route: whether a named signer holds `esignature:write`
 * (ADR-051 Q-19), or whether the caller of GET /esignature/history holds
 * `qms:read` (F-9). The same resolution as `dynamicAccess`, with no second
 * copy to drift: the SUPER_ADMIN bypass, API-key scopes, then the role matrix
 * with the per-user override.
 *
 * @param principal - `req.user`, or a user row shaped like it
 * @param menuName - a menu slug (A-07)
 * @param permissionType - "read" or "write"
 * @returns whether the principal holds it
 */
const principalHasMenuPermission = async (
  principal: MenuPrincipal | null | undefined,
  menuName: SeededMenuSlug,
  permissionType: string,
): Promise<boolean> => {
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the two tests the JavaScript made
  if (!principal || !principal.role) {
    return false;
  }
  if (isSuperAdmin(principal)) {
    return true;
  }
  const result = principal.isApiKey
    ? checkApiKeyScope(menuName, [permissionType], principal.apiKeyScopes, false)
    : await checkMenuPermission(menuName, [permissionType], principal, false);
  return result.allowed;
};

/** The probe's body, read with `|| {}`. */
interface ProbeBody {
  menuGroup?: unknown;
  permissionType?: unknown;
}

/**
 * Middleware to check if user has permission for a specific action
 * Returns the permission details without blocking access
 * Useful for conditional UI rendering
 *
 * @param req - the request
 * @param res - the response
 * @returns the response
 */
const hasDynamicPermission = async (req: Request, res: Response): Promise<Response> => {
  try {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
    const { menuGroup, permissionType } = (req.body as ProbeBody | undefined) || {};

    if (!menuGroup || !permissionType) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: "menuGroup and permissionType are required",
        data: null,
      });
    }

    const user = req.user as AccessPrincipal | null | undefined;
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the two tests the JavaScript made
    if (!user || !user.role) {
      return res.status(401).json({
        success: false,
        status: 401,
        message: "Unauthorized",
        data: null,
      });
    }

    const matrix = await RolesService.getRolePermissionsMatrix(
      user.role.id as string,
    );
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `|| []`
    const rolePermsForMenu = matrix[menuGroup as string] || [];

    const normalized = normalizePermission(permissionType);
    let hasPerm = rolePermsForMenu.includes(normalized);
    if (
      !hasPerm &&
      normalized === "read" &&
      rolePermsForMenu.includes("write")
    ) {
      hasPerm = true;
    }

    return res.status(200).json({
      success: true,
      data: {
        allowed: hasPerm,
        permission: hasPerm ? { permission_type: permissionType } : null,
      },
    });
  } catch (error) {
    if (typeof logger !== "undefined") {
      logger.error(`hasDynamicPermission Error: ${(error as Error).message}`);
    }
    return res.status(500).json({
      success: false,
      status: 500,
      message: "Internal Server Error",
      data: null,
    });
  }
};

export = {
  selfOwnerIdFromPath,
  tenantIdsNamedBy,
  ownerIdsNamedBy,
  dynamicAccess,
  principalHasMenuPermission,
  hasDynamicPermission,
};
