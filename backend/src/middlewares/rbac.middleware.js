/**
 * Role-Based Access Control Middleware
 *
 * Gates a route to an allowlist of role names. With `allowHigher` (the default),
 * any user whose role level is >= the LOWEST-privileged listed role also passes,
 * so listing SUPER_ADMIN alongside a lower role does not raise the bar to level
 * 10. SUPER_ADMIN always bypasses. Levels come from ROLE_LEVELS; the
 * TENANT_ADMIN entry is a logical tier (see roleConstants), not a seeded role.
 *
 * @param {string[]} requiredRoles - Role names allowed to access the route
 * @param {Object} options
 * @param {boolean} options.allowHigher - Allow higher role levels too (default: true)
 * @returns {Function} Express middleware
 */
const { ROLE_NAMES, ROLE_LEVELS } = require("../constants");

// Complete role NAME → numeric level map, built from the constants so there are
// no phantom/undefined entries (previously TENANT_ADMIN mapped to undefined).
const roleLevels = Object.entries(ROLE_NAMES).reduce((acc, [key, name]) => {
  if (ROLE_LEVELS[key] !== undefined) {
    acc[name] = ROLE_LEVELS[key];
  }
  return acc;
}, {});

exports.rbac = (requiredRoles = [], options = {}) => {
  const { allowHigher = true } = options;

  return (req, res, next) => {
    try {
      // 1. Ensure user exists (checked by auth middleware)
      if (!req.user) {
        throw new Error("Unauthorized: No user context found");
      }

      // 2. Safely extract role name and level
      const userRoleName = req.user.role?.name;
      const userRoleLevel =
        req.user.role?.role_level || req.user.role?.roleLevel || 0;

      if (!userRoleName) {
        throw new Error("Unauthorized: User has no role assigned");
      }

      // 3. Super Admin bypass - has access to everything
      if (userRoleName === "SUPER_ADMIN" || userRoleName === "SUPERADMIN") {
        return next();
      }

      // 4. Resolve the access bar. With allowHigher, the bar is the LOWEST
      //    listed role's level (an OR over the allowed roles) — a user at or
      //    above it qualifies. If no listed role maps to a known level
      //    (including the empty `rbac()` = "any authenticated user" case), the
      //    bar is 0, preserving the original permissive contract.
      const requiredLevels = requiredRoles
        .map((role) => roleLevels[role])
        .filter((level) => level !== undefined);
      const minRequiredLevel = requiredLevels.length
        ? Math.min(...requiredLevels)
        : 0;

      // 5. Grant if the user's role name is explicitly listed, or (allowHigher)
      //    their role level meets the bar.
      if (!requiredRoles.includes(userRoleName)) {
        if (!allowHigher || userRoleLevel < minRequiredLevel) {
          throw new Error("Forbidden: Insufficient permissions");
        }
      }

      // 6. Permission granted
      next();
    } catch (error) {
      const message = error.message || "Internal Server Error";

      // Determine status code based on message context
      let statusCode = 500;
      if (message.includes("Unauthorized")) {statusCode = 401;}
      if (message.includes("Forbidden")) {statusCode = 403;}

      // Send error to the global error handler
      next({
        status: statusCode,
        message: message,
        isOperational: true,
      });
    }
  };
};

/**
 * Middleware to check if user has a minimum role level
 * @param {number} minLevel - Minimum role level required
 * @returns {Function} Express middleware
 */
exports.checkRoleLevel = (minLevel = 1) => {
  return (req, res, next) => {
    try {
      if (!req.user || !req.user.role) {
        throw new Error("Unauthorized: No user context found");
      }

      const userRoleLevel = req.user.role.roleLevel || 0;

      if (userRoleLevel < minLevel) {
        throw new Error("Forbidden: Insufficient role level");
      }

      next();
    } catch (error) {
      const message = error.message || "Internal Server Error";
      let statusCode = 500;
      if (message.includes("Unauthorized")) {statusCode = 401;}
      if (message.includes("Forbidden")) {statusCode = 403;}

      next({
        status: statusCode,
        message: message,
        isOperational: true,
      });
    }
  };
};

/**
 * Middleware to check if user is not a super admin
 * Used to ensure certain operations are only done by non-super-admin users
 * @returns {Function} Express middleware
 */
exports.notSuperAdmin = () => {
  return (req, res, next) => {
    try {
      if (req.user && req.user.role && (req.user.role.name === "SUPER_ADMIN" || req.user.role.name === "SUPERADMIN")) {
        throw new Error("Forbidden: Super admin cannot perform this action");
      }
      next();
    } catch (error) {
      const message = error.message || "Internal Server Error";
      let statusCode = 500;
      if (message.includes("Forbidden")) {statusCode = 403;}

      next({
        status: statusCode,
        message: message,
        isOperational: true,
      });
    }
  };
};
