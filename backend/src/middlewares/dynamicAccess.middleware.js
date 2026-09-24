const { User, Tenants } = require("../models");
const RolesService = require("../services/roles.service");
const { scopeAllows } = require("../services/apiKey.service");
const { logger } = require("./activityLog.middleware");
const { error: sendError } = require("../utils/response.util");

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
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} message - one of the two *_NOT_FOUND_MESSAGE constants
 * @param {Object} context - log-only detail, including `reason`
 */
const denyTenantIsolation = (req, res, message, context) => {
  // Guarded the same way as every other logging call in this file: the
  // activityLog module's `logger` export is absent in some test harnesses,
  // and a refusal must still be produced rather than a TypeError.
  if (typeof logger !== "undefined") {
    logger.warn("dynamicAccess: tenant isolation refusal", {
      requestId: req.requestId || "unknown",
      userId: req.user.id,
      method: req.method,
      url: req.originalUrl,
      ...context,
    });
  }

  return sendError(res, message, TENANT_REFUSAL_STATUS);
};

/**
 * A-63. The owner id the `checkSelf` bypass compares against the caller.
 *
 * PATH PARAMETERS ONLY — never `req.body` or `req.query`. A body or query value
 * is caller-chosen and says nothing about which row the handler will act on;
 * a path parameter is the resource the route addresses. Exported so the
 * "reads no body or query field" property can be tested directly.
 *
 * @param {import('express').Request} req
 * @returns {string|undefined}
 */
const selfOwnerIdFromPath = (req) => req.params?.userId || req.params?.id;
exports.selfOwnerIdFromPath = selfOwnerIdFromPath;

/**
 * The distinct, non-empty values of `field` in the path, body and query, in
 * that order. A-93: every one is checked; none can stand in for another.
 *
 * @param {import('express').Request} req
 * @param {string} field
 * @returns {string[]}
 */
const namedBy = (req, field) => {
  const seen = [];
  for (const source of [req.params, req.body, req.query]) {
    const value = source && typeof source === "object" ? source[field] : undefined;
    if (value !== undefined && value !== null && value !== "" && !seen.includes(String(value))) {
      seen.push(String(value));
    }
  }
  return seen;
};

/**
 * A-93. Every tenant id a request names — path first. Exported so the
 * "all of them are checked" property can be tested directly.
 *
 * @param {import('express').Request} req
 * @returns {string[]}
 */
const tenantIdsNamedBy = (req) => namedBy(req, "tenantId");
exports.tenantIdsNamedBy = tenantIdsNamedBy;

/**
 * A-93. Every user id a request names as the resource owner (`userId` in the
 * path, body or query). Checked for tenant membership independently of any
 * tenant id the request also carries.
 *
 * @param {import('express').Request} req
 * @returns {string[]}
 */
const ownerIdsNamedBy = (req) => namedBy(req, "userId");
exports.ownerIdsNamedBy = ownerIdsNamedBy;

/**
 * Dynamic RBAC Middleware
 *
 * Simplified RBAC middleware that checks role-based menu permissions.
 * Uses the role_menu_permissions table to determine read/write access.
 *
 * USAGE:
 *
 * // Simple permission check
 * router.get("/", auth, dynamicAccess("Home", "read"), controller);
 *
 * // Multiple actions (OR logic - user needs any one)
 * router.get("/", auth, dynamicAccess("Dashboard", ["read", "write"]), controller);
 *
 * // Multiple actions (AND logic - user needs all)
 * router.post("/bulk", auth, dynamicAccess("Report", ["read", "write"], { requireAll: true }), controller);
 *
 * @param {string|string[]} menuGroup - Menu group name(s) (e.g., 'Home', 'Dashboard', ['Account', 'Management'])
 * @param {string|string[]} permissionType - Permission type(s) (e.g., 'read', 'write', ['read', 'write'])
 * @param {Object} options - Additional options
 * @param {boolean} options.requireAll - Require all actions (AND logic) vs any action (OR logic, default)
 * @param {boolean} options.checkSelf - Allow the caller on a route whose PATH names them
 *   (`:userId` / `:id`) without the menu permission. Runs after checkTenant, never instead of it (A-63)
 * @param {boolean} options.checkTenant - Enforce multi-tenant isolation: every `tenantId` the
 *   request names (path, body, query) must be the caller's, AND every `userId` it names must be a
 *   user of the caller's tenant — both checks, independently (A-93). A mismatch is 404
 * @returns {Function} Express middleware
 */
exports.dynamicAccess = (menuGroup, permissionType, options = {}) => {
  const { requireAll = false } = options;

  // Normalize to arrays
  const menuGroups = Array.isArray(menuGroup) ? menuGroup : [menuGroup];
  const permTypes = Array.isArray(permissionType)
    ? permissionType
    : [permissionType];

  return async (req, res, next) => {
    try {
      const user = req.user;

      if (!user || !user.role) {
        return sendError(res, "Unauthorized: No user context found", 401);
      }

      // SUPER_ADMIN bypass - has access to everything (no tenant check)
      if (user.role.name === "SUPER_ADMIN" || user.role.name === "SUPERADMIN") {
        req.dynamicAccessContext = {
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
              resourceTenantId: String(resourceTenantId),
            });
          }

          if (String(tenant.id) !== String(userTenantId)) {
            return denyTenantIsolation(req, res, TENANT_NOT_FOUND_MESSAGE, {
              reason: "cross-tenant",
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
              resourceOwnerId: String(resourceOwnerId),
            });
          }

          if (String(owner.tenantId) !== String(userTenantId)) {
            return denyTenantIsolation(req, res, RESOURCE_NOT_FOUND_MESSAGE, {
              reason: "cross-tenant-owner",
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

        if (ownerId && String(ownerId) === String(user.id)) {
          req.dynamicAccessContext = {
            allowed: true,
            reason: "self",
            menuGroups,
            permissionTypes: permTypes,
          };
          return next();
        }
      }

      // Check permissions for each menu group
      const results = [];
      let allAllowed = true;

      for (const menuName of menuGroups) {
        // API-key principals authorize via their scopes, not the role matrix.
        const result = user.isApiKey
          ? checkApiKeyScope(menuName, permTypes, user.apiKeyScopes, requireAll)
          : await checkMenuPermission(menuName, permTypes, user, requireAll);

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
          // `|| []` is an unreachable defensive guard: results come only from
          // checkApiKeyScope / checkMenuPermission, each of which has a single
          // return that always sets deniedTypes to an array (possibly empty,
          // which is still truthy).
          .flatMap((r) => /* istanbul ignore next */ r.deniedTypes || []);

        // 403 is CORRECT here and must NOT be flattened to 404: this is a
        // permission failure INSIDE the caller's own tenant and discloses
        // nothing about any other tenant. What was denied goes to the log —
        // the body keeps the house envelope ({ success, status, message,
        // data }) instead of the ad-hoc `required` / `menuGroups` keys.
        if (typeof logger !== "undefined") {
          logger.warn("dynamicAccess: permission refusal", {
            requestId: req.requestId || "unknown",
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
        req.apiKeyAuthorized = true;
      }

      // Attach permission context to request for controller use
      const allowedResult = results.find((r) => r.allowed);
      req.dynamicAccessContext = {
        allowed: true,
        menuGroups,
        permissionTypes: permTypes,
        permission: allowedResult?.permission || null,
      };

      next();
    } catch (error) {
      if (typeof logger !== "undefined") {
        logger.error(`DynamicAccess Error: ${error.message}`, error.stack);
        logger.error(`User: ${JSON.stringify(req.user)}`);
        logger.error(`Req user.tenant: ${JSON.stringify(req.user?.tenant)}`);
        logger.error(`Req user.tenantId: ${req.user?.tenantId}`);
        logger.error(`Options: ${JSON.stringify(options)}`);
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
 */
function normalizePermission(permType) {
  return String(permType).toLowerCase() === "read" ? "read" : "write";
}

/**
 * Authorize an API-key principal for a menu group via its scopes.
 * Returns the same shape as checkMenuPermission.
 */
function checkApiKeyScope(menuName, permTypes, scopes, requireAll) {
  const typeResults = permTypes.map((permType) => ({
    permissionType: permType,
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
 * Check permission for a specific menu group using cached matrix.
 *
 * Resolution order:
 *   1. Per-user override (user_menu_permissions): "read"/"write" replace the
 *      role permission for this menu; "none" explicitly denies it.
 *   2. Otherwise the role permission matrix (role_menu_permissions) applies.
 */
async function checkMenuPermission(menuName, permTypes, user, requireAll) {
  // 1. Get cached permissions matrix
  const matrix = await RolesService.getRolePermissionsMatrix(user.role.id);

  // 2. See if the menu exists in the user's role permissions
  let rolePermsForMenu = matrix[menuName] || [];

  // 3. Apply per-user override if one exists for this menu
  try {
    // Lazy require to avoid circular dependency at module load time.
    const userPermissionService = require("../services/userPermission.service");
    const overrides = await userPermissionService.getUserOverrideMatrix(
      user.id,
    );
    if (Object.prototype.hasOwnProperty.call(overrides, menuName)) {
      const override = overrides[menuName];
      rolePermsForMenu = override === "none" ? [] : [override];
    }
  } catch (err) {
    // Overrides are additive hardening — never let a lookup failure block
    // the request path; fall back to plain role permissions.
    if (typeof logger !== "undefined") {
      logger.error(`UserPermission override lookup failed: ${err.message}`);
    }
  }

  const typeResults = [];
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

/**
 * Middleware to check if user has permission for a specific action
 * Returns the permission details without blocking access
 * Useful for conditional UI rendering
 */
exports.hasDynamicPermission = async (req, res, next) => {
  try {
    const { menuGroup, permissionType } = req.body || {};

    if (!menuGroup || !permissionType) {
      return res.status(400).json({
        success: false,
        message: "menuGroup and permissionType are required",
      });
    }

    if (!req.user || !req.user.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const matrix = await RolesService.getRolePermissionsMatrix(
      req.user.role.id,
    );
    const rolePermsForMenu = matrix[menuGroup] || [];

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
      logger.error(`hasDynamicPermission Error: ${error.message}`);
    }
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};
