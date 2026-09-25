/**
 * Tenant Hierarchy Controller
 *
 * Handles parent-tenant to child business unit relationships.
 */

// The service exports its functions at the top level (exports.fn), so it must be
// imported as the module object — NOT destructured as `{ tenantHierarchyService }`
// (which was undefined and made every endpoint throw at runtime).
const tenantHierarchyService = require("../services/tenantHierarchy.service");
const { success } = require("../utils/response.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { AppError, formatErrors } = require("../utils/appError.util");
const { addChild: addChildValidator } = require("../validators/tenantHierarchy.validator");
const { auditActor } = require("../utils/auditActor.util");

// A-255 (ADR-065) — seven handlers here were never routed: createSubOrganization
// (addChildTenant is the routed one), getDescendants, getAncestors,
// getDataVisibilityScope, assignRoleAcrossHierarchy, getUserRolesAcrossTenants
// and getStatus. They were removed rather than left for the next route file
// to import: assignRoleAcrossHierarchy wrote a user's role, unaudited and with
// no privilege check, and the others duplicated routed handlers with the
// wrong response shapes. The routed surface is exactly what
// routes/api/tenantHierarchy.route.js imports.

/**
 * Get tenant hierarchy tree
 */
exports.getTenantTree = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const tree = await tenantHierarchyService.getTenantTree(tenantId);

  return success(res, tree, "Tenant tree retrieved");
});

// -------------------------------------------------------
// Route-facing aliases (consumed by src/routes/api/tenantHierarchy.js)
// -------------------------------------------------------

/**
 * Get child tenants of a given tenant
 */
exports.getTenantChildren = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;

  const tree = await tenantHierarchyService.getTenantTree(tenantId);

  return success(res, { children: tree.children || [] }, "Child tenants retrieved");
});

/**
 * Get parent tenant of a given tenant
 */
exports.getTenantParent = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;

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
exports.getTenantDescendants = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;

  const descendants =
    await tenantHierarchyService.getDescendantTenants(tenantId);

  return success(res, { descendants }, "Descendants retrieved");
});

/**
 * Get all ancestor tenants
 */
exports.getTenantAncestors = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;

  const ancestors = await tenantHierarchyService.getAncestorTenants(tenantId);

  return success(res, { ancestors }, "Ancestors retrieved");
});

/**
 * Add a child tenant under a parent
 */
exports.addChildTenant = asyncHandler(async (req, res) => {
  const { parentId } = req.params;

  // Validated here rather than as route middleware: the exported `addChild`
  // is a Joi schema, and passing its `.validate` to express threw on every
  // request. stripUnknown/abortEarly come from the schema's own options.
  // A-09: Joi treats `undefined` as valid against a non-required object
  // schema, so a bodyless POST passed this gate with `value === undefined` and
  // the service then threw. `|| {}` makes the required-field rules fire.
  const { error, value } = addChildValidator.validate(req.body || {});
  if (error) {
    throw new AppError(400, formatErrors(error.details) || "Validation failed");
  }

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
exports.updateTenantParent = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { newParentId } = req.body || {};

  const result = await tenantHierarchyService.updateTenantParent(tenantId, newParentId, auditActor(req));

  return success(res, result, null, "Parent tenant updated successfully");
});

/**
 * Remove a tenant's parent (make it a root tenant).
 *
 * A-224: "already a root" is a state conflict (409), not a 404.
 */
exports.removeTenantParent = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;

  const result = await tenantHierarchyService.removeTenantParent(tenantId, auditActor(req));

  return success(res, { ...result, status: "root" }, null, "Parent relationship removed successfully");
});

/**
 * Get cross-tenant role assignments
 */
exports.getCrossTenantRoles = asyncHandler(async (req, res) => {
  const { userId } = req.query;

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
