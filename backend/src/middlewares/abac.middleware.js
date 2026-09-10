const tenantService = require("../services/tenant.service");
const RolesService = require("../services/roles.service");

/**
 * Menu group that governs tenant administration (the "Tenants" node lives
 * under the "management" menu). ABAC tenant permissions are enforced against
 * this menu in the role-permission matrix.
 */
const TENANT_ADMIN_MENU = "management";

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
 * // Self-check (resource belongs to user)
 * router.post('/profile', auth, abac(['user:update'], { checkSelf: true }), controller);
 *
 * @param {string[]} permissions - Required permission(s)
 * @param {Object} options - Additional options
 * @param {boolean} options.checkTenant - Enforce multi-tenant isolation
 * @param {boolean} options.checkSelf - Check if the resource belongs to the requesting user
 * @returns {Function} Express middleware
 */

exports.abac = (permissions, options = {}) => {
  return async (req, res, next) => {
    try {
      const user = req.user;

      if (!user || !user.role) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized: No user context found",
        });
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
          const tenant = await tenantService.getTenantByIdForMiddleware(resourceTenantId);

          if (!tenant) {
            return res.status(404).json({
              success: false,
              message: "Tenant not found",
            });
          }

          if (String(tenant.id) !== String(user.tenantId)) {
            return res.status(403).json({
              success: false,
              message:
                "Access denied: resource belongs to a different tenant",
            });
          }
        }
      }

      // ---- Self-check ----
      // A user acting on their OWN resource is allowed without the permission
      // check (matched against the authenticated user id only).
      if (options.checkSelf) {
        const resourceOwnerId =
          req.params?.userId ||
          req.body?.userId ||
          req.params?.id ||
          req.query?.userId;

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
        return res.status(403).json({
          success: false,
          message: "Forbidden: Insufficient permissions",
          required: permissions,
        });
      }

      // Attach context to request
      req.abacContext = {
        allowed: true,
        permissions,
        tenantId: user.tenantId,
      };

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  };
};
