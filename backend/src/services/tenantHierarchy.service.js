/**
 * Tenant Hierarchy Service
 *
 * Manages parent-tenant → child business unit relationships and data
 * visibility rules.
 *
 * There is no role cascade (A-134). Roles are global, not tenant-scoped
 * (role.model.js: no tenantId, `name` unique across the platform), so every
 * role and its menu permissions already apply in a child tenant; there is
 * nothing to copy. The former `cascadeRoles` (HIERARCHY_CASCADE_ROLES) could
 * never run — an alias-less `include: [Role]`, a `level` attribute and a
 * `tenantId` on Role that do not exist — and its throw was logged as
 * "non-fatal". It was removed rather than fixed, and HIERARCHY_CASCADE_ROLES
 * is no longer read.
 *
 * Usage:
 *   const { createSubOrganization, getTenantTree } = require('./services/tenantHierarchy.service');
 *   await createSubOrganization(parentTenantId, { name: 'Branch A' });
 */

const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { db } = require("../config");

// ==========================================
// CONFIGURATION
// ==========================================

const HIERARCHY_ENABLED = process.env.HIERARCHY_ENABLED === "true";
const MAX_DEPTH = parseInt(process.env.HIERARCHY_MAX_DEPTH) || 5;

// ==========================================
// SUB-ORGANIZATION MANAGEMENT
// ==========================================

/**
 * Create a sub-organization (child tenant) under a parent
 * @param {string} parentTenantId - Parent tenant ID
 * @param {Object} data - Sub-org data
 * @returns {Promise<{tenantId: string, path: string}>}
 */
exports.createSubOrganization = async (parentTenantId, data) => {
  if (!HIERARCHY_ENABLED) {
    throw new AppError(400, "Tenant hierarchy is disabled");
  }

  const { Tenant, TenantHierarchy } = require("../models");

  const parent = await Tenant.findByPk(parentTenantId);
  if (!parent) {
    throw new AppError(404, "Parent tenant not found");
  }

  if (parent.status !== "active") {
    throw new AppError(400, "Parent tenant must be active");
  }

  try {
    // Get parent's hierarchy path
    let parentPath = `/${parent.code.toLowerCase()}`;
    const parentHierarchy = await TenantHierarchy.findOne({
      where: { tenantCode: parent.code },
    });

    if (parentHierarchy) {
      parentPath = parentHierarchy.path;
    }

    // Generate child code
    const childCount = await TenantHierarchy.count({
      where: { parentCode: parent.code },
    });
    const childCode = `${parent.code}_${String(childCount + 1).padStart(3, "0")}`;

    // Create tenant
    const tenant = await Tenant.create({
      name: data.name,
      code: childCode,
      status: "active",
      parentId: parentTenantId,
      plan: parent.plan,
    });

    // Create hierarchy record
    const hierarchy = await TenantHierarchy.create({
      tenantId: tenant.id,
      tenantCode: childCode,
      parentCode: parent.code,
      path: `${parentPath}/${childCode.toLowerCase()}`,
      depth: (parentHierarchy ? parentHierarchy.depth : 0) + 1,
    });

    // Validate depth
    if (hierarchy.depth > MAX_DEPTH) {
      await tenant.destroy();
      await hierarchy.destroy();
      throw new AppError(
        400,
        `Maximum hierarchy depth (${MAX_DEPTH}) exceeded`,
      );
    }

    logger.info("Sub-organization created", {
      parentTenantId,
      childTenantId: tenant.id,
      childCode,
      path: hierarchy.path,
    });

    return {
      tenantId: tenant.id,
      code: childCode,
      path: hierarchy.path,
      depth: hierarchy.depth,
    };
  } catch (err) {
    logger.error("Failed to create sub-organization", {
      parentTenantId,
      error: err.message,
    });
    throw new AppError(500, "Failed to create sub-organization");
  }
};

// ==========================================
// HIERARCHY QUERIES
// ==========================================

/**
 * Get the full hierarchy tree for a tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Hierarchy tree
 */
exports.getTenantTree = async (tenantId) => {
  const { Tenant, TenantHierarchy } = require("../models");

  try {
    // The Tenant includes in this function and in getAncestorTenants are INNER on
    // purpose (A-90): Tenant's defaultScope makes them required, and a
    // soft-deleted tenant is meant to drop out of the tree — the children
    // mapping below reads `c.tenant.id` unguarded.
    const hierarchy = await TenantHierarchy.findOne({
      where: { tenantId },
      include: [
        {
          model: Tenant,
          as: "tenant",
          attributes: ["id", "name", "code", "status", "plan"],
        },
      ],
    });

    if (!hierarchy) {
      return { isRoot: true, children: [] };
    }

    const children = await TenantHierarchy.findAll({
      where: { parentCode: hierarchy.tenantCode },
      include: [
        {
          model: Tenant,
          as: "tenant",
          attributes: ["id", "name", "code", "status", "plan"],
        },
      ],
    });

    return {
      isRoot: hierarchy.depth === 0,
      depth: hierarchy.depth,
      path: hierarchy.path,
      tenant: hierarchy.tenant,
      children: children.map((c) => ({
        tenantId: c.tenant.id,
        code: c.tenant.code,
        name: c.tenant.name,
        status: c.tenant.status,
        depth: c.depth,
      })),
    };
  } catch (err) {
    logger.error("Failed to get tenant tree", {
      tenantId,
      error: err.message,
    });
    return { isRoot: true, children: [] };
  }
};

/**
 * Get all descendant tenant IDs
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Array>} List of descendant tenant IDs
 */
exports.getDescendantTenants = async (tenantId) => {
  const { TenantHierarchy } = require("../models");

  try {
    const hierarchy = await TenantHierarchy.findOne({
      where: { tenantId },
    });

    if (!hierarchy) {
      return [];
    }

    const descendants = await TenantHierarchy.findAll({
      where: {
        path: {
          [db.Sequelize.Op.like]: `${hierarchy.path}/%`,
        },
      },
      attributes: ["tenantId"],
    });

    return descendants.map((d) => d.tenantId);
  } catch (err) {
    logger.error("Failed to get descendants", {
      tenantId,
      error: err.message,
    });
    return [];
  }
};

/**
 * Get ancestor tenants (parent, grandparent, etc.)
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Array>} List of ancestor tenant objects
 */
exports.getAncestorTenants = async (tenantId) => {
  const { TenantHierarchy, Tenant } = require("../models");

  try {
    const hierarchy = await TenantHierarchy.findOne({
      where: { tenantId },
    });

    if (!hierarchy) {
      return [];
    }

    const pathParts = hierarchy.path.split("/").filter((p) => p);
    const ancestors = [];

    for (let i = 0; i < pathParts.length - 1; i++) {
      const partialPath = "/" + pathParts.slice(0, i + 1).join("/");
      const ancestor = await TenantHierarchy.findOne({
        where: { path: partialPath },
        // INNER on purpose (A-90): a soft-deleted ancestor is skipped.
        include: [
          {
            model: Tenant,
            as: "tenant",
            attributes: ["id", "name", "code", "status"],
          },
        ],
      });

      if (ancestor && ancestor.tenant) {
        ancestors.push({
          tenantId: ancestor.tenant.id,
          code: ancestor.tenant.code,
          name: ancestor.tenant.name,
          status: ancestor.tenant.status,
          depth: ancestor.depth,
        });
      }
    }

    return ancestors;
  } catch (err) {
    logger.error("Failed to get ancestors", {
      tenantId,
      error: err.message,
    });
    return [];
  }
};

// ==========================================
// DATA VISIBILITY
// ==========================================

/**
 * Get data visibility scope for a tenant
 * @param {string} tenantId - Tenant ID
 * @param {string} scope - Data scope (self, subtree, all)
 * @returns {Promise<{tenantIds: Array, scope: string}>}
 */
exports.getDataVisibilityScope = async (tenantId, scope = "self") => {
  if (scope === "self") {
    return { tenantIds: [tenantId], scope: "self" };
  }

  if (scope === "subtree") {
    const descendants = await exports.getDescendantTenants(tenantId);
    return {
      tenantIds: [tenantId, ...descendants],
      scope: "subtree",
    };
  }

  if (scope === "all") {
    const ancestors = await exports.getAncestorTenants(tenantId);
    const rootCode = ancestors.length > 0 ? ancestors[0].code : null;

    if (rootCode) {
      const { Tenant } = require("../models");
      const allTenants = await Tenant.findAll({
        where: {
          [db.Sequelize.Op.or]: [
            { code: rootCode },
            { code: { [db.Sequelize.Op.like]: `${rootCode}_%` } },
          ],
        },
        attributes: ["id"],
      });
      return {
        tenantIds: allTenants.map((t) => t.id),
        scope: "all",
      };
    }
  }

  return { tenantIds: [tenantId], scope: "self" };
};

/**
 * Build tenant-scoped query filter
 * @param {string} tenantId - Tenant ID
 * @param {string} scope - Visibility scope
 * @returns {Promise<Object>} Sequelize where clause
 */
exports.buildTenantFilter = async (tenantId, scope = "self") => {
  const visibility = await exports.getDataVisibilityScope(tenantId, scope);
  return { tenantId: { [db.Sequelize.Op.in]: visibility.tenantIds } };
};

// ==========================================
// PERMISSIONS & ROLES
// ==========================================

/**
 * Assign a role to a user across all tenants in hierarchy
 * @param {string} userId - User ID
 * @param {string} roleId - Role ID
 * @param {string} scope - Scope (self, subtree)
 */
exports.assignRoleToUserAcrossHierarchy = async (
  userId,
  roleId,
  scope = "subtree",
) => {
  const { User } = require("../models");

  const visibility = await exports.getDataVisibilityScope(userId, scope);

  try {
    for (const tenantId of visibility.tenantIds) {
      await User.update({ roleId }, { where: { id: userId, tenantId } });
    }

    logger.info("Role assigned across hierarchy", {
      userId,
      roleId,
      scope,
      tenantCount: visibility.tenantIds.length,
    });

    return { success: true, tenantCount: visibility.tenantIds.length };
  } catch (err) {
    logger.error("Failed to assign role across hierarchy", {
      userId,
      roleId,
      error: err.message,
    });
    throw new AppError(500, "Failed to assign role");
  }
};

/**
 * Get user's roles across all tenants
 * @param {string} userId - User ID
 * @returns {Promise<Array>} User's roles per tenant
 */
exports.getUserRolesAcrossTenants = async (userId) => {
  const { User, Role, Tenant } = require("../models");

  try {
    // A-110: the associations are `role` and `tenant` (user.model.js). The
    // former "Role"/"Tenant" aliases made every call throw an eager-loading
    // error, which the catch below turned into [] — the endpoint answered
    // "no roles" for every user and nothing ever reported why.
    //
    // LEFT JOINs (A-90): Role and Tenant have a defaultScope `where`, so an
    // include without `required: false` is INNER and drops the user whose role
    // or tenant was soft-deleted. The mapping reads a missing one as null.
    //
    // The Role attribute is `roleLevel` (column role_level): "level" is not a
    // column, and asking for it would fail in PostgreSQL the moment the alias
    // fix let the query run. The answer keeps its `level` key.
    //
    // Only the columns the answer needs: the default selected every user
    // column, password hash and MFA secret included.
    const users = await User.findAll({
      where: { id: userId },
      attributes: ["id", "tenantId"],
      include: [
        {
          model: Role,
          as: "role",
          attributes: ["id", "name", "roleLevel"],
          required: false,
        },
        {
          model: Tenant,
          as: "tenant",
          attributes: ["id", "name", "code"],
          required: false,
        },
      ],
    });

    return users.map((u) => ({
      tenantId: u.tenantId,
      tenantName: u.tenant?.name ?? null,
      tenantCode: u.tenant?.code ?? null,
      role: u.role
        ? { id: u.role.id, name: u.role.name, level: u.role.roleLevel }
        : null,
    }));
  } catch (err) {
    // A failure is a failure, not an empty result: log it and answer 500, as
    // this file's other role operations do (assignRoleToUserAcrossHierarchy).
    logger.error("Failed to get user roles", {
      userId,
      error: err.message,
    });
    throw new AppError(500, "Failed to get user roles");
  }
};

// ==========================================
// UTILITIES
// ==========================================

/**
 * Get service status
 */
exports.getStatus = () => {
  return {
    enabled: HIERARCHY_ENABLED,
    maxDepth: MAX_DEPTH,
  };
};

/**
 * Export constants
 */
exports.HIERARCHY_SCOPE = {
  SELF: "self",
  SUBTREE: "subtree",
  ALL: "all",
};
