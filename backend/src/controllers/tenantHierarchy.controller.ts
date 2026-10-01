/**
 * Tenant Hierarchy Controller
 *
 * Handles parent-tenant to child business unit relationships.
 *
 * P9-20 (ADR-087): converted from tenantHierarchy.controller.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order). The service is the module object; every other
 * load-time destructure is kept as a capture at load. Request data is read
 * through typed views of the request, so the emitted expressions (and the
 * TypeError a request without a user throws) are the `.js` ones.
 */

// The service exports its functions at the top level (exports.fn), so it must be
// imported as the module object — NOT destructured as `{ tenantHierarchyService }`
// (which was undefined and made every endpoint throw at runtime).
import type { Request, Response } from "express";

import tenantHierarchyService from "../services/tenantHierarchy.service";
import { success as loadedSuccess } from "../utils/response.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { AppError as LoadedAppError, formatErrors as loadedFormatErrors } from "../utils/appError.util";
import { addChild as loadedAddChildValidator } from "../validators/tenantHierarchy.validator";
import { checkInput as loadedCheckInput } from "../validators/input";
import { auditActor as loadedAuditActor } from "../utils/auditActor.util";
import type { TenantId } from "../types/ids";

const success = loadedSuccess;
const asyncHandler = loadedAsyncHandler;
const AppError = LoadedAppError;
const formatErrors = loadedFormatErrors;
const addChildValidator = loadedAddChildValidator;
const checkInput = loadedCheckInput;
const auditActor = loadedAuditActor;

/** The principal `auth` put on the request. */
interface Caller {
  tenantId: TenantId;
}

/** The path parameters these routes name (`validateUuid`). */
interface HierarchyParams extends Record<string, string> {
  tenantId: TenantId;
  parentId: TenantId;
}

/** A move's body; the service checks `newParentId` itself (400 when it is not a UUID or null). */
interface MoveBody {
  newParentId?: TenantId | null;
}

// A-255 (ADR-065) — seven handlers here were never routed: createSubOrganization
// (addChildTenant is the routed one), getDescendants, getAncestors,
// getDataVisibilityScope, assignRoleAcrossHierarchy, getUserRolesAcrossTenants
// and getStatus. They were removed rather than left for the next route file
// to import: assignRoleAcrossHierarchy wrote a user's role, unaudited and with
// no privilege check, and the others duplicated routed handlers with the
// wrong response shapes. The routed surface is exactly what
// routes/api/tenantHierarchy.route imports.

/**
 * Get tenant hierarchy tree
 */
const getTenantTree = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Caller;

  const tree = await tenantHierarchyService.getTenantTree(tenantId);

  return success(res, tree, "Tenant tree retrieved");
});

// -------------------------------------------------------
// Route-facing aliases (consumed by src/routes/api/tenantHierarchy.js)
// -------------------------------------------------------

/**
 * Get child tenants of a given tenant
 */
const getTenantChildren = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.params as HierarchyParams;

  const tree = await tenantHierarchyService.getTenantTree(tenantId);

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `tree.children || []`
  return success(res, { children: tree.children || [] }, "Child tenants retrieved");
});

/**
 * Get parent tenant of a given tenant
 */
const getTenantParent = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.params as HierarchyParams;

  const ancestors = await tenantHierarchyService.getAncestorTenants(tenantId);
  const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;

  if (!parent) {
    return success(res, { parent: null }, "Tenant is a root tenant (no parent)");
  }

  return success(res, { parent }, "Parent tenant retrieved");
});

/**
 * Get all descendant tenants
 */
const getTenantDescendants = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.params as HierarchyParams;

  const descendants =
    await tenantHierarchyService.getDescendantTenants(tenantId);

  return success(res, { descendants }, "Descendants retrieved");
});

/**
 * Get all ancestor tenants
 */
const getTenantAncestors = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.params as HierarchyParams;

  const ancestors = await tenantHierarchyService.getAncestorTenants(tenantId);

  return success(res, { ancestors }, "Ancestors retrieved");
});

/**
 * Add a child tenant under a parent
 */
const addChildTenant = asyncHandler(async (req: Request, res: Response) => {
  const { parentId } = req.params as HierarchyParams;

  // Validated here, and a failure is a 400 whose message lists the problems.
  // A-09: a bodyless POST is checked as {} (checkInput), so the required-field
  // rules fire instead of the service throwing on an undefined body.
  const checked = checkInput(req.body, addChildValidator);
  if (!checked.ok) {
    // As built: an empty message falls back (`||`).
    throw new AppError(400, formatErrors(checked.errors) || "Validation failed");
  }
  const { value } = checked;

  // A-187: the creation is audited under the acting super admin.
  const result = await tenantHierarchyService.createSubOrganization(
    parentId,
    value,
    auditActor(req),
  );

  // success(res, data, meta, message, statusCode) — passing 201 as the third
  // arg put it in `meta` and left the status at 200.
  return success(res, result, null, "Child tenant created", 201);
});

/**
 * Update a tenant's parent.
 *
 * A-224: the move — the tenant, its hierarchy row, every descendant's path and
 * one audit row, in one transaction, with the cycle and depth checks — is
 * tenantHierarchy.service#updateTenantParent. A malformed or missing
 * `newParentId` is 400; a conflict is 409 with its explanation.
 */
const updateTenantParent = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.params as HierarchyParams;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { newParentId } = (req.body as MoveBody | undefined) || {};

  const result = await tenantHierarchyService.updateTenantParent(tenantId, newParentId, auditActor(req));

  return success(res, result, null, "Parent tenant updated successfully");
});

/**
 * Remove a tenant's parent (make it a root tenant).
 *
 * A-224: "already a root" is a state conflict (409), not a 404.
 */
const removeTenantParent = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.params as HierarchyParams;

  const result = await tenantHierarchyService.removeTenantParent(tenantId, auditActor(req));

  return success(res, { ...result, status: "root" }, null, "Parent relationship removed successfully");
});

/**
 * Get cross-tenant role assignments
 */
const getCrossTenantRoles = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };

  if (userId) {
    const roles =
      await tenantHierarchyService.getUserRolesAcrossTenants(userId);
    return success(res, { assignments: roles }, "Cross-tenant roles retrieved");
  }

  // If no userId filter, return empty (requires filter for security)
  return success(
    res,
    { assignments: [] },
    "Provide userId query param to filter cross-tenant roles",
  );
});

const controller = {
  getTenantTree,
  getTenantChildren,
  getTenantParent,
  getTenantDescendants,
  getTenantAncestors,
  addChildTenant,
  updateTenantParent,
  removeTenantParent,
  getCrossTenantRoles,
};

export = controller;
