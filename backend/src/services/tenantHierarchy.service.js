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
const auditService = require("./audit.service");
const { PLATFORM_TENANT_ID } = require("../constants/platformTenant");

// ==========================================
// CONFIGURATION
// ==========================================

const HIERARCHY_ENABLED = process.env.HIERARCHY_ENABLED === "true";
const MAX_DEPTH = parseInt(process.env.HIERARCHY_MAX_DEPTH) || 5;

// ==========================================
// SUB-ORGANIZATION MANAGEMENT
// ==========================================

/**
 * A tenant subdomain derived from a code, the way tenant.service#createTenant
 * derives one: lower-cased, every character the model's pattern refuses
 * (`^[a-z0-9][a-z0-9-]*[a-z0-9]$`) turned into `-`, trimmed, at most 63.
 *
 * @param {string} code
 * @returns {string}
 */
const subdomainFromCode = (code) =>
  String(code)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 63)
    .replace(/^-+|-+$/g, "");

/**
 * Create a sub-organization (child tenant) under a parent.
 *
 * A-187 — this never worked on the real models. `tenants.subdomain` and
 * `tenants.email` are NOT NULL and it set neither, so every call failed
 * validation and the catch reported a 500. The depth check ran AFTER both
 * rows were inserted and undid them with two more autocommits; and nothing
 * was audited.
 *
 * Now:
 *  - the child's `subdomain` is derived from its code (as createTenant does)
 *    and its `email` is the parent's — the parent organisation administers
 *    the sub-organisation until someone gives it its own contact address;
 *  - the depth limit and the parent's state are checked BEFORE any write;
 *  - the tenant, its hierarchy row and ONE audit row commit together, the row
 *    under the PLATFORM tenant (a tenant's creation is a platform operation —
 *    the route is SUPERADMIN-only, as createTenant, A-95/A-125);
 *  - a code or subdomain already in use is 409, not 500.
 *
 * @param {string} parentTenantId - Parent tenant ID
 * @param {{name: string, code?: string}} data - Sub-org data (validated)
 * @param {object} [actor] - auditActor(req)
 * @returns {Promise<{tenantId: string, code: string, path: string, depth: number}>}
 * @throws {AppError} 400 when disabled; 404 when the parent does not exist;
 *   409 when the parent is not active, has no code, the depth limit is
 *   reached, or the code/subdomain is taken
 */
exports.createSubOrganization = async (parentTenantId, data, actor = {}) => {
  if (!HIERARCHY_ENABLED) {
    throw new AppError(400, "Tenant hierarchy is disabled");
  }

  const { Tenant, TenantHierarchy } = require("../models");

  const parent = await Tenant.findByPk(parentTenantId);
  if (!parent) {
    throw new AppError(404, "Parent tenant not found");
  }

  // State conflicts, explained (409) — not malformed requests.
  if (parent.status !== "active") {
    throw new AppError(409, `Parent tenant is ${parent.status}; a sub-organization can be created only under an active tenant`);
  }
  if (!parent.code) {
    throw new AppError(409, "Parent tenant has no code; set one before creating a sub-organization (the child's code is derived from it)");
  }

  const parentHierarchy = await TenantHierarchy.findOne({
    where: { tenantCode: parent.code },
  });
  const parentPath = parentHierarchy ? parentHierarchy.path : `/${parent.code.toLowerCase()}`;
  const depth = (parentHierarchy ? parentHierarchy.depth : 0) + 1;
  if (depth > MAX_DEPTH) {
    throw new AppError(409, `Maximum hierarchy depth (${MAX_DEPTH}) reached: "${parent.name}" cannot have sub-organizations`);
  }

  let childCode = data.code;
  if (!childCode) {
    const childCount = await TenantHierarchy.count({
      where: { parentCode: parent.code },
    });
    childCode = `${parent.code}_${String(childCount + 1).padStart(3, "0")}`;
  }
  const subdomain = subdomainFromCode(childCode);
  const path = `${parentPath}/${childCode.toLowerCase()}`;

  try {
    const tenant = await db.transaction(async (transaction) => {
      const created = await Tenant.create(
        {
          name: data.name,
          code: childCode,
          subdomain,
          email: parent.email,
          status: "active",
          parentId: parentTenantId,
          plan: parent.plan,
        },
        { transaction },
      );

      await TenantHierarchy.create(
        {
          tenantId: created.id,
          tenantCode: childCode,
          parentCode: parent.code,
          path,
          depth,
        },
        { transaction },
      );

      await auditService.logAction(
        {
          tenantId: PLATFORM_TENANT_ID,
          userId: actor.userId,
          action: "CREATE",
          resourceType: "Tenant",
          resourceId: created.id,
          changes: {
            operation: "CREATE_SUB_ORGANIZATION",
            before: {},
            after: { name: data.name, code: childCode, subdomain, parentId: parentTenantId, path, depth },
          },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        },
        { transaction },
      );
      return created;
    });

    logger.info("Sub-organization created", {
      parentTenantId,
      childTenantId: tenant.id,
      childCode,
      path,
    });

    return { tenantId: tenant.id, code: childCode, path, depth };
  } catch (err) {
    if (err && err.name === "SequelizeUniqueConstraintError") {
      throw new AppError(409, `A tenant with code "${childCode}" or subdomain "${subdomain}" already exists`);
    }
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
          required: true, // D-12: stated, not inherited from the defaultScope
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
          required: true, // D-12: stated, not inherited from the defaultScope
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
            required: true, // D-12: stated, not inherited from the defaultScope
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
