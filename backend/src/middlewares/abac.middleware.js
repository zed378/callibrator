const tenantService = require("../services/tenant.service");
const RolesService = require("../services/roles.service");
const { logger } = require("./activityLog.middleware");
const { error: sendError } = require("../utils/response.util");

/**
 * Menu group that governs tenant administration (the "Tenants" node lives
 * under the "management" menu). ABAC tenant permissions are enforced against
 * this menu in the role-permission matrix.
 */
const TENANT_ADMIN_MENU = "management";

/**
 * AZ-04. The single status and message used for EVERY tenant-isolation
 * refusal in this middleware.
 *
 * `CLAUDE.md`: "Cross-tenant returns 404, never 403. [...] Non-existent,
 * soft-deleted and not-yours must be indistinguishable."
 *
 * This middleware used to answer 404 "Tenant not found" for an id that
 * matched no tenant and 403 "Access denied: resource belongs to a different
 * tenant" for one that matched somebody else. That pair is a tenant
 * membership oracle: on the 50 routes that pass `checkTenant: true` a caller
 * could enumerate tenant ids and learn which exist. Both branches now go
 * through `denyTenantIsolation` below, so there is exactly ONE place that can
 * produce the body and the two cases cannot drift apart.
 */
const TENANT_REFUSAL_STATUS = 404;
const TENANT_REFUSAL_MESSAGE = "Tenant not found";

/**
 * Refuse a tenant-isolation failure without telling the caller which kind it
 * was. The reason goes to the log, keyed by request id (the same key the
 * global error handler and the activity logger use); the response carries
 * nothing that separates "no such tenant" from "not your tenant".
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {string} reason - log-only discriminator ("no-such-tenant" | "cross-tenant")
 * @param {string} resourceTenantId - the id the caller asked for
 */
const denyTenantIsolation = (req, res, reason, resourceTenantId) => {
  logger.warn("abac: tenant isolation refusal", {
    requestId: req.requestId || "unknown",
    reason,
    resourceTenantId: String(resourceTenantId),
    // Only reached after the 401 guard, so req.user is always present here.
    callerTenantId: req.user.tenantId,
    userId: req.user.id,
    method: req.method,
    url: req.originalUrl,
  });

  return sendError(res, TENANT_REFUSAL_MESSAGE, TENANT_REFUSAL_STATUS);
};

/**
 * Map ABAC permission strings (e.g. "tenant:read", "tenant:update") to the
 * stored read/write vocabulary. Only "*:read" requires read; every mutating
 * permission requires write.
 */
function requiredMenuAction(permissions) {
  const list = Array.isArray(permissions) ? permissions : [permissions];
  const needsWrite = list.some((p) => !/:read$/i.test(String(p)));
  return needsWrite ? "write" : "read";
}

/**
 * ABAC (Attribute-Based Access Control) Middleware
 *
 * Checks if a user has a specific attribute permission on a resource,
 * typically at the tenant level. Used alongside RBAC for fine-grained
 * access control.
 *
 * USAGE:
 *
 * // Tenant-level permission check
 * router.post('/backup', auth, rbac(['SUPER_ADMIN']), abac(['tenant:update'], { checkTenant: true }), controller);
 *
 * // Self-check (the PATH names the caller — never a body/query field, A-63)
 * router.post('/:userId/profile', auth, abac(['user:update'], { checkSelf: true }), controller);
 *
 * @param {string[]} permissions - Required permission(s)
 * @param {Object} options - Additional options
 * @param {boolean} options.checkTenant - Enforce multi-tenant isolation
 * @param {boolean} options.checkSelf - Allow the caller when the path (`:userId` / `:id`) names them
 * @returns {Function} Express middleware
 */

exports.abac = (permissions, options = {}) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      if (!user || !user.role) {
        return sendError(res, "Unauthorized: No user context found", 401);
      }

      // SUPER_ADMIN bypass — has all permissions
      if (user.role.name === "SUPER_ADMIN" || user.role.name === "SUPERADMIN") {
        req.abacContext = {
          allowed: true,
          reason: "SUPER_ADMIN bypass",
          permissions,
        };
        return next();
      }

      // ---- Tenant isolation check ----
      if (options.checkTenant) {
        const resourceTenantId =
          req.params?.tenantId || req.body?.tenantId || req.query?.tenantId;

        if (resourceTenantId) {
          const tenant =
            await tenantService.getTenantByIdForMiddleware(resourceTenantId);

          // AZ-04: "does not exist" and "belongs to someone else" answer with
          // the same status and the same body. Only the log says which.
          if (!tenant) {
            return denyTenantIsolation(
              req,
              res,
              "no-such-tenant",
              resourceTenantId,
            );
          }

          if (String(tenant.id) !== String(user.tenantId)) {
            return denyTenantIsolation(
              req,
              res,
              "cross-tenant",
              resourceTenantId,
            );
          }
        }
      }

      // ---- Self-check ----
      // A user acting on their OWN resource is allowed without the permission
      // check (matched against the authenticated user id only). It runs after
      // the tenant check above, and — A-63, as in dynamicAccess — ownership
      // comes from the PATH only: a body or query `userId` is caller-chosen
      // and need not be the row the handler acts on.
      if (options.checkSelf) {
        const resourceOwnerId = req.params?.userId || req.params?.id;

        if (resourceOwnerId && String(user.id) === String(resourceOwnerId)) {
          req.abacContext = {
            allowed: true,
            reason: "self",
            permissions,
            tenantId: user.tenantId,
          };
          return next();
        }
      }

      // ---- Permission enforcement (fail-closed) ----
      // Verify the user's role actually holds the required capability via the
      // role-permission matrix. Previously this middleware fell through to
      // next() unconditionally, which meant it enforced nothing.
      const requiredAction = requiredMenuAction(permissions);
      const matrix = await RolesService.getRolePermissionsMatrix(user.role.id);
      const menuPerms =
        matrix[TENANT_ADMIN_MENU] || matrix["Management"] || [];

      const hasPermission =
        menuPerms.includes(requiredAction) ||
        (requiredAction === "read" && menuPerms.includes("write"));

      if (!hasPermission) {
        // 403 is CORRECT here and must NOT be flattened to 404: this is a
        // permission failure INSIDE the caller's own tenant, and it discloses
        // nothing about any other tenant. The required capability goes to the
        // log rather than into the body, so the response keeps the house
        // envelope ({ success, status, message, data }).
        logger.warn("abac: permission refusal", {
          requestId: req.requestId || "unknown",
          required: Array.isArray(permissions) ? permissions : [permissions],
          requiredAction,
          userId: user.id,
          roleId: user.role.id,
          method: req.method,
          url: req.originalUrl,
        });
        return sendError(res, "Forbidden: Insufficient permissions", 403);
      }

      // Attach context to request
      req.abacContext = {
        allowed: true,
        permissions,
        tenantId: user.tenantId,
      };

      next();
    } catch (error) {
      // A-13: do not hand-roll a 500 carrying `error.message`. Hand the error
      // to the global error handler (index.js -> errorHandlers.middleware),
      // which logs it against the request id and sanitizes the message in
      // production — the same path every wrapped controller takes.
      return next(error);
    }
  };
};
