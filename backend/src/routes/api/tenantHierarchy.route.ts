/**
 * Tenant Hierarchy Routes
 *
 * Routes for parent-tenant to child business unit hierarchy management.
 * Mounted at /api/v1/tenant-hierarchy
 *
 * P9-21 (ADR-087): converted from tenantHierarchy.route.js. Every route, gate
 * and middleware is in the same order as before, and the inline
 * `ownTenantGuard` has the same body (checked against the mounted route
 * table, the guard by its compiled source). The contract is code-first:
 * tenantHierarchy.openapi.ts (P9-25, ADR-103); the `@swagger` JSDoc this file
 * carried is gone.
 */
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { auth, superAdminOnly, denyApiKey } from "../../middlewares/auth.middleware";
import { getTenantTree, getTenantChildren, getTenantParent, getTenantDescendants, getTenantAncestors, addChildTenant, updateTenantParent, removeTenantParent, getCrossTenantRoles } from "../../controllers/tenantHierarchy.controller";
// The `.js` required `addChild` here and never used it (the controller checks
// the body against it, and loads the validator itself); the binding is gone.
import { validateUuid } from "../../middlewares/validateUuid.middleware";
// V-15 / N-01: the one super-admin predicate — both spellings, as every other gate.
import { isSuperAdmin as loadedIsSuperAdmin } from "../../utils/role.util";

// A load-time capture, as the `.js` destructured it: the guard below calls
// this binding, not a property read at call time (ADR-087 Amendment 13).
const isSuperAdmin = loadedIsSuperAdmin;

// `Router` is `express.Router` (the same function).
const router = Router();

// ---------------------------------------------------------------------------
// A-01. The Tenant model has no `tenantId` attribute, so the global tenant
// hooks do NOT scope it: `Tenant.findByPk(req.params.tenantId)` reads, and
// `Tenant.update(..., { where: { id } })` WRITES, any tenant in the platform.
// Until 2026-09-23 every route here carried `auth` and nothing else, so any
// authenticated user could re-parent another hospital's tenant.
//
// Reads of a named tenant are limited to the caller's own tenant; a
// cross-tenant id is 404, never 403 — a 403 would confirm the tenant exists.
// Re-parenting is a platform operation: SUPERADMIN, and never an API key.
/* eslint-disable @typescript-eslint/no-confusing-void-expression -- as built: the guard returns what next() and res.json() return, as the `.js` did (Express ignores it) */
const ownTenantOnly = (param: string) =>
  function ownTenantGuard(req: Request, res: Response, next: NextFunction) {
    if (isSuperAdmin(req.user)) {
      return next();
    }
    if (req.params[param] !== req.user?.tenantId) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: "Tenant not found",
        data: null,
      });
    }
    return next();
  };
/* eslint-enable @typescript-eslint/no-confusing-void-expression */

const platformOnly = [auth, denyApiKey, superAdminOnly];

router.get("/tree", auth, getTenantTree);

router.get(
  "/:tenantId/children",
  auth,
  validateUuid("tenantId"),
  ownTenantOnly("tenantId"),
  getTenantChildren,
);

router.get(
  "/:tenantId/parent",
  auth,
  validateUuid("tenantId"),
  ownTenantOnly("tenantId"),
  getTenantParent,
);

router.get(
  "/:tenantId/descendants",
  auth,
  validateUuid("tenantId"),
  ownTenantOnly("tenantId"),
  getTenantDescendants,
);

router.get(
  "/:tenantId/ancestors",
  auth,
  validateUuid("tenantId"),
  ownTenantOnly("tenantId"),
  getTenantAncestors,
);

// The body is validated inside addChildTenant against the `addChild` schema
// (a schema's own method, once passed here as middleware, was called with
// (req, res, next) and 500'd every request).
// A-187: a malformed id is 400 here, not a database error (500) in the service.
// P9-18 (2026-10-02): the parent is named `:tenantId`, as on GET /:tenantId/children
// (same path, same parameter; it was `:parentId`, which OpenAPI reads as a second,
// equivalent path). The URL and the answer are unchanged.
router.post("/:tenantId/children", ...platformOnly, validateUuid("tenantId"), addChildTenant);

router.put(
  "/:tenantId/parent",
  ...platformOnly,
  validateUuid("tenantId"),
  updateTenantParent,
);

router.delete(
  "/:tenantId/parent",
  ...platformOnly,
  validateUuid("tenantId"),
  removeTenantParent,
);

router.get("/cross-tenant-roles", ...platformOnly, getCrossTenantRoles);

export = router;
