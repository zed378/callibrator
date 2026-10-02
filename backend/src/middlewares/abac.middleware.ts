// P9-19 (ADR-087): converted from abac.middleware.js under the four
// tenantContext gates, behaviour unchanged (its interim `.d.ts` is deleted
// with it). `tenantService` and `RolesService` stay module objects, read at
// call time as before; what the JavaScript destructured at load (`logger`,
// `sendError`, `isSuperAdmin`) is captured at load. `abac` stays a plain,
// writable `exports.abac` (the gate guards tag the factory).
/* eslint-disable @typescript-eslint/no-confusing-void-expression -- as built: `return next()` / `return sendError(…)` return what they return, as the JavaScript did */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import tenantService from "../services/tenant.service";
import RolesService from "../services/roles.service";
import { logger as loadedLogger } from "./activityLog.middleware";
import { error as loadedSendError } from "../utils/response.util";
import { isSuperAdmin as loadedIsSuperAdmin, type RoleBearer } from "../utils/role.util";

const logger = loadedLogger;
const sendError = loadedSendError;
const isSuperAdmin = loadedIsSuperAdmin;

/** The options a route passes. */
interface AbacOptions {
  checkTenant?: boolean;
  checkSelf?: boolean;
}

/** The principal as this middleware reads it (after `auth`). */
interface AbacPrincipal extends RoleBearer {
  id: unknown;
  tenantId: unknown;
  readonly role?: { readonly id: unknown; readonly name?: unknown } | null;
}

/** The request members this middleware reads or sets beyond Express's own. */
interface AbacRequest {
  requestId?: string;
  abacContext?: Record<string, unknown>;
}

/** What `req.params` / `req.body` / `req.query` may carry here (read raw). */
interface TenantKeyed {
  tenantId?: unknown;
  userId?: unknown;
  id?: unknown;
}

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
 * @param req - the request
 * @param res - the response
 * @param reason - log-only discriminator ("no-such-tenant" | "cross-tenant")
 * @param resourceTenantId - the id the caller asked for
 */
const denyTenantIsolation = (req: Request, res: Response, reason: string, resourceTenantId: unknown): Response => {
  logger.warn("abac: tenant isolation refusal", {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty request id is "unknown"
    requestId: (req as Request & AbacRequest).requestId || "unknown",
    reason,
    resourceTenantId: String(resourceTenantId),
    // Only reached after the 401 guard, so req.user is always present here.
    callerTenantId: (req.user as AbacPrincipal).tenantId,
    userId: (req.user as AbacPrincipal).id,
    method: req.method,
    url: req.originalUrl,
  });

  return sendError(res, TENANT_REFUSAL_MESSAGE, TENANT_REFUSAL_STATUS);
};

/**
 * Map ABAC permission strings (e.g. "tenant:read", "tenant:update") to the
 * stored read/write vocabulary. Only "*:read" requires read; every mutating
 * permission requires write.
 *
 * @param permissions - one permission or a list
 * @returns "write" if any permission is not a read
 */
function requiredMenuAction(permissions: unknown): "read" | "write" {
  const list: unknown[] = Array.isArray(permissions) ? permissions : [permissions];
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
 * @param permissions - Required permission(s)
 * @param options - `checkTenant`: enforce multi-tenant isolation; `checkSelf`:
 *   allow the caller when the path (`:userId` / `:id`) names them
 * @returns Express middleware
 */
export const abac = (permissions: readonly string[] | string, options: AbacOptions = {}): RequestHandler => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as AbacPrincipal | null | undefined;

      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the two tests the JavaScript made
      if (!user || !user.role) {
        return sendError(res, "Unauthorized: No user context found", 401);
      }

      // SUPER_ADMIN bypass — has all permissions
      if (isSuperAdmin(user)) {
        (req as Request & AbacRequest).abacContext = {
          allowed: true,
          reason: "SUPER_ADMIN bypass",
          permissions,
        };
        return next();
      }

      // ---- Tenant isolation check ----
      if (options.checkTenant) {
        const resourceTenantId =
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: the first truthy of path, body and query
          (req.params as TenantKeyed | undefined)?.tenantId || (req.body as TenantKeyed | undefined)?.tenantId || (req.query as TenantKeyed | undefined)?.tenantId;

        if (resourceTenantId) {
          const tenant =
            await tenantService.getTenantByIdForMiddleware(resourceTenantId as Parameters<typeof tenantService.getTenantByIdForMiddleware>[0]);

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
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `:userId`, else `:id`
        const resourceOwnerId = (req.params as TenantKeyed | undefined)?.userId || (req.params as TenantKeyed | undefined)?.id;

        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: ids compared as strings
        if (resourceOwnerId && String(user.id) === String(resourceOwnerId)) {
          (req as Request & AbacRequest).abacContext = {
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
      const matrix = await RolesService.getRolePermissionsMatrix(user.role.id as Parameters<typeof RolesService.getRolePermissionsMatrix>[0]);
      const menuPerms: readonly string[] =
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||` across the two spellings
        (matrix as Record<string, readonly string[] | undefined>)[TENANT_ADMIN_MENU] || (matrix as Record<string, readonly string[] | undefined>)["Management"] || [];

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
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty request id is "unknown"
          requestId: (req as Request & AbacRequest).requestId || "unknown",
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
      (req as Request & AbacRequest).abacContext = {
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
