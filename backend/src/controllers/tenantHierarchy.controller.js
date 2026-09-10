/**
 * Tenant Hierarchy Controller
 *
 * Handles parent-tenant to child business unit relationships.
 */

// The service exports its functions at the top level (exports.fn), so it must be
// imported as the module object — NOT destructured as `{ tenantHierarchyService }`
// (which was undefined and made every endpoint throw at runtime).
const tenantHierarchyService = require("../services/tenantHierarchy.service");
const { success, error } = require("../utils/response.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { AppError, formatErrors } = require("../utils/appError.util");
const { addChild: addChildValidator } = require("../validators/tenantHierarchy.validator");
const { logger } = require("../middlewares/activityLog.middleware");

/**
 * Create a sub-organization
 */
exports.createSubOrganization = asyncHandler(async (req, res) => {
  const { parentTenantId } = req.params;
  const { name } = req.body;

  const result = await tenantHierarchyService.createSubOrganization(
    parentTenantId,
    { name },
  );

  return success(res, result, 201, "Sub-organization created");
});

/**
 * Get tenant hierarchy tree
 */
exports.getTenantTree = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const tree = await tenantHierarchyService.getTenantTree(tenantId);

  return success(res, tree, "Tenant tree retrieved");
});

/**
 * Get descendant tenants
 */
exports.getDescendants = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const descendants =
    await tenantHierarchyService.getDescendantTenants(tenantId);

  return success(res, descendants, "Descendants retrieved");
});

/**
 * Get ancestor tenants
 */
exports.getAncestors = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const ancestors = await tenantHierarchyService.getAncestorTenants(tenantId);

  return success(res, ancestors, "Ancestors retrieved");
});

/**
 * Get data visibility scope
 */
exports.getDataVisibilityScope = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { scope = "self" } = req.query;

  const visibility = await tenantHierarchyService.getDataVisibilityScope(
    tenantId,
    scope,
  );

  return success(res, visibility, "Visibility scope retrieved");
});

/**
 * Assign role across hierarchy
 */
exports.assignRoleAcrossHierarchy = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { roleId, scope = "subtree" } = req.body;

  const result = await tenantHierarchyService.assignRoleToUserAcrossHierarchy(
    userId,
    roleId,
    scope,
  );

  return success(res, result, "Role assigned across hierarchy");
});

/**
 * Get user roles across tenants
 */
exports.getUserRolesAcrossTenants = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  const roles = await tenantHierarchyService.getUserRolesAcrossTenants(userId);

  return success(res, roles, "User roles retrieved");
});

/**
 * Get service status
 */
exports.getStatus = asyncHandler(async (req, res) => {
  const status = tenantHierarchyService.getStatus();

  return success(res, status, "Service status retrieved");
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
  const { error, value } = addChildValidator.validate(req.body);
  if (error) {
    throw new AppError(400, formatErrors(error.details) || "Validation failed");
  }

  const result = await tenantHierarchyService.createSubOrganization(
    parentId,
    value,
  );

  // success(res, data, meta, message, statusCode) — passing 201 as the third
  // arg put it in `meta` and left the status at 200.
  return success(res, result, null, "Child tenant created", 201);
});

/**
 * Update a tenant's parent
 */
exports.updateTenantParent = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;
  const { newParentId } = req.body;

  const { Tenant, TenantHierarchy } = require("../models");

  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    return error(res, "Tenant not found", 404);
  }

  const newParent = await Tenant.findByPk(newParentId);
  if (!newParent) {
    return error(res, "New parent tenant not found", 404);
  }

  await Tenant.update({ parentId: newParentId }, { where: { id: tenantId } });

  // Update hierarchy record
  const hierarchy = await TenantHierarchy.findOne({ where: { tenantId } });
  if (hierarchy) {
    const parentHierarchy = await TenantHierarchy.findOne({
      where: { tenantCode: newParent.code },
    });
    const parentPath = parentHierarchy
      ? parentHierarchy.path
      : `/${newParent.code.toLowerCase()}`;
    await hierarchy.update({
      parentCode: newParent.code,
      path: `${parentPath}/${hierarchy.tenantCode.toLowerCase()}`,
      depth: (parentHierarchy ? parentHierarchy.depth : 0) + 1,
    });
  }

  logger.info("Tenant parent updated", { tenantId, newParentId });

  return success(
    res,
    { tenantId, newParentId },
    "Parent tenant updated successfully",
  );
});

/**
 * Remove a tenant's parent (make it a root tenant)
 */
exports.removeTenantParent = asyncHandler(async (req, res) => {
  const { tenantId } = req.params;

  const { Tenant, TenantHierarchy } = require("../models");

  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    return error(res, "Tenant not found", 404);
  }

  if (!tenant.parentId) {
    return error(res, "Tenant is already a root tenant", 404);
  }

  await Tenant.update({ parentId: null }, { where: { id: tenantId } });

  // Update hierarchy record
  const hierarchy = await TenantHierarchy.findOne({ where: { tenantId } });
  if (hierarchy) {
    await hierarchy.update({
      parentCode: null,
      path: `/${hierarchy.tenantCode.toLowerCase()}`,
      depth: 0,
    });
  }

  logger.info("Tenant parent removed", { tenantId });

  return success(
    res,
    { tenantId, status: "root" },
    "Parent relationship removed successfully",
  );
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
