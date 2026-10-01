/**
 * Role-Based Access Control Middleware
 *
 * Gates a route to an allowlist of role names. With `allowHigher` (the default),
 * any user whose role level is >= the LOWEST-privileged listed role also passes,
 * so listing SUPER_ADMIN alongside a lower role does not raise the bar to level
 * 10. SUPER_ADMIN always bypasses. Levels come from ROLE_LEVELS; the
 * TENANT_ADMIN entry is a logical tier (see roleConstants), not a seeded role.
 *
 * P9-19 (ADR-087): converted from rbac.middleware.js with no behaviour change.
 * The constants are captured at load, as the .js destructured them. The three
 * factories stay plain `exports.*` properties (writable), which
 * routePermissionGuard.p604 and twoTenantRoutes.guard rely on when they wrap
 * `rbac` before any router loads.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ROLE_NAMES as CONSTANT_ROLE_NAMES, ROLE_LEVELS as CONSTANT_ROLE_LEVELS } from "../constants";
// N-01: the one super-admin predicate (both spellings).
import { isSuperAdmin, isSuperAdminRoleName } from "../utils/role.util";

const ROLE_NAMES = CONSTANT_ROLE_NAMES;
const ROLE_LEVELS = CONSTANT_ROLE_LEVELS;

/** What the global error handler receives from these gates. */
interface GateFailure {
  status: number;
  message: string;
  isOperational: true;
}

/** `rbac()`'s options. */
interface RbacOptions {
  /** Allow higher role levels too (default: true). */
  allowHigher?: boolean;
}

// Complete role NAME → numeric level map, built from the constants so there are
// no phantom/undefined entries (previously TENANT_ADMIN mapped to undefined).
const roleLevels = Object.entries(ROLE_NAMES).reduce<Record<string, number>>((acc, [key, name]) => {
  const level = (ROLE_LEVELS as Partial<Record<string, number>>)[key];
  if (level !== undefined) {
    acc[name] = level;
  }
  return acc;
}, {});

/** The message of whatever a gate caught, as the .js read it. */
const messageOf = (error: unknown): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message becomes the default
  (error as { message?: string }).message || "Internal Server Error";

/**
 * @param requiredRoles - Role names allowed to access the route
 * @param options.allowHigher - Allow higher role levels too (default: true)
 * @returns Express middleware
 */
export const rbac = (requiredRoles: string[] = [], options: RbacOptions = {}): RequestHandler => {
  const { allowHigher = true } = options;

  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      // 1. Ensure user exists (checked by auth middleware)
      if (!req.user) {
        throw new Error("Unauthorized: No user context found");
      }

      // 2. Safely extract role name and level
      const userRoleName = req.user.role?.name;
      const userRoleLevel =
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 or null level falls through
        req.user.role?.role_level || req.user.role?.roleLevel || 0;

      if (!userRoleName) {
        throw new Error("Unauthorized: User has no role assigned");
      }

      // 3. Super Admin bypass - has access to everything
      if (isSuperAdminRoleName(userRoleName)) {
        // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: `return next()`
        return next();
      }

      // 4. Resolve the access bar. With allowHigher, the bar is the LOWEST
      //    listed role's level (an OR over the allowed roles) — a user at or
      //    above it qualifies. If no listed role maps to a known level
      //    (including the empty `rbac()` = "any authenticated user" case), the
      //    bar is 0, preserving the original permissive contract.
      const requiredLevels = requiredRoles
        .map((role) => roleLevels[role])
        .filter((level): level is number => level !== undefined);
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
      const message = messageOf(error);

      // Determine status code based on message context
      let statusCode = 500;
      if (message.includes("Unauthorized")) {statusCode = 401;}
      if (message.includes("Forbidden")) {statusCode = 403;}

      // Send error to the global error handler
      const failure: GateFailure = {
        status: statusCode,
        message: message,
        isOperational: true,
      };
      next(failure);
    }
    return undefined;
  };
};

/**
 * Middleware to check if user has a minimum role level
 * @param minLevel - Minimum role level required
 * @returns Express middleware
 */
export const checkRoleLevel = (minLevel = 1): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `!req.user || !req.user.role`
      if (!req.user || !req.user.role) {
        throw new Error("Unauthorized: No user context found");
      }

      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 or null level falls through
      const userRoleLevel = req.user.role.roleLevel || 0;

      if (userRoleLevel < minLevel) {
        throw new Error("Forbidden: Insufficient role level");
      }

      next();
    } catch (error) {
      const message = messageOf(error);
      let statusCode = 500;
      if (message.includes("Unauthorized")) {statusCode = 401;}
      if (message.includes("Forbidden")) {statusCode = 403;}

      const failure: GateFailure = {
        status: statusCode,
        message: message,
        isOperational: true,
      };
      next(failure);
    }
  };
};

/**
 * Middleware to check if user is not a super admin
 * Used to ensure certain operations are only done by non-super-admin users
 * @returns Express middleware
 */
export const notSuperAdmin = (): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (isSuperAdmin(req.user)) {
        throw new Error("Forbidden: Super admin cannot perform this action");
      }
      next();
    } catch (error) {
      const message = messageOf(error);
      let statusCode = 500;
      if (message.includes("Forbidden")) {statusCode = 403;}

      const failure: GateFailure = {
        status: statusCode,
        message: message,
        isOperational: true,
      };
      next(failure);
    }
  };
};
