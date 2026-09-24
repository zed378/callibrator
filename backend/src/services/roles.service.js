const { Role, RoleMenuPermission, MenuGroup, User } = require("../models");
const { Op } = require("sequelize");

/**
 * Roles Service - Simplified RBAC with Read/Write Permissions
 *
 * Architecture:
 * - Roles have read or write permissions on menu groups via RoleMenuPermission
 * - Users have a direct role_id foreign key (no ABAC)
 * - Permission check: hasPermission(userId, menuSlug, permissionType)
 * - All roles are global (not tenant-scoped)
 */
const { get, set, del, delPattern, cacheKeys } = require("./redis.service");
const { ROLE_LEVELS } = require("../constants");
const auditService = require("./audit.service");
const { db } = require("../config");

/**
 * A-41 — a role or grant change decides who may do what, so each one writes
 * its audit row inside the SAME transaction as the change
 * (MEMORY/specs/A-41-audit-inside-transaction.md, rows 16-22). A failed audit
 * insert is re-thrown by logAction and rolls the change back.
 *
 * BR-A41-4 — roles are global, but audit_logs.tenantId is NOT NULL: a change to
 * a role is recorded under the ACTOR's tenant; a change to a user's role under
 * that USER's tenant, falling back to the actor's. If neither resolves the
 * insert fails and the change is refused (fail-closed).
 *
 * Cache invalidation runs after the commit, never inside the transaction:
 * invalidating before the commit lets a concurrent request re-cache the old
 * matrix for the full TTL.
 *
 * @param {object} transaction
 * @param {object} actor - { userId, tenantId, ipAddress, userAgent }
 * @param {object} row - { tenantId?, action, resourceType, resourceId, changes }
 */
const auditAccessChange = (transaction, actor, { tenantId, action, resourceType, resourceId, changes }) =>
  auditService.logAction(
    {
      tenantId: tenantId || actor.tenantId,
      userId: actor.userId,
      action,
      resourceType,
      resourceId,
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    },
    { transaction },
  );

/**
 * The highest level a tenant-created role may hold (ADR-043).
 *
 * `rbac()` compares role levels, so a role created through this API is a
 * privilege grant. Capping at the TENANT_ADMIN tier (8) means no role minted at
 * runtime can ever reach the SUPER_ADMIN tier (10) — which bypasses both rbac()
 * and tenant scoping — no matter what a caller asks for.
 */
const MAX_TENANT_ROLE_LEVEL = ROLE_LEVELS.TENANT_ADMIN;

class RolesService {
  /**
   * Create a new role
   *
   * `roleLevel` is what every rbac() gate compares against, so it is persisted
   * here rather than left at the model default of 1 — a role with no level
   * fails every privileged gate silently. It is clamped to
   * [1, MAX_TENANT_ROLE_LEVEL]; a caller asking for the SUPER_ADMIN tier gets
   * the tenant-admin tier instead.
   *
   * @param {object} input - role fields
   * @param {string} input.name - role name
   * @param {string} [input.description] - description
   * @param {boolean} [input.is_system] - system role flag
   * @param {number} [input.roleLevel] - requested privilege level (1–8)
   * @param {object} [actor] - who, from where (A-41)
   * @returns {Promise<object>} the created role
   */
  static async createRole({ name, description, is_system = false, roleLevel }, actor = {}) {
    const requested = Number.isInteger(roleLevel) ? roleLevel : 1;
    const level = Math.min(Math.max(requested, 1), MAX_TENANT_ROLE_LEVEL);

    return db.transaction(async (transaction) => {
      const role = await Role.create(
        {
          name: name.trim(),
          description: description?.trim(),
          is_system,
          roleLevel: level,
          status: "active",
        },
        { transaction },
      );
      await auditAccessChange(transaction, actor, {
        action: "CREATE",
        resourceType: "Role",
        resourceId: role.id,
        changes: {
          operation: "CREATE_ROLE",
          before: {},
          after: { name: role.name, roleLevel: level, is_system, status: "active" },
        },
      });
      return role;
    });
  }

  /**
   * Get role by ID
   */
  static async getRoleById(id) {
    return Role.findByPk(id, {
      include: [
        {
          model: RoleMenuPermission,
          as: "permissions",
          include: [
            {
              model: MenuGroup,
              as: "menu",
              attributes: ["id", "name", "slug", "icon", "sort_order"],
            },
          ],
        },
      ],
    });
  }

  /**
   * Get role by name
   */
  static async getRoleByName(name) {
    return Role.findOne({ where: { name } });
  }

  /**
   * Get all roles with optional filtering
   */
  static async getAllRoles({
    status = "all",
    is_system = null,
    limit = 100,
    offset = 0,
    search = "",
  } = {}) {
    const where = {};

    if (status !== "all") {
      where.status = status;
    }

    if (is_system !== null) {
      where.is_system = is_system;
    }

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const result = await Role.findAndCountAll({
      where,
      order: [
        ["sort_order", "ASC"],
        ["created_at", "ASC"],
      ],
      limit,
      offset,
    });

    return {
      data: result.rows,
      count: result.count,
      page: Math.floor(offset / limit) + 1,
      limit,
    };
  }

  /**
   * Update role
   */
  static async updateRole(id, { name, description, status }, actor = {}) {
    const role = await Role.findByPk(id);
    if (!role) {
      const error = new Error("Role not found");
      error.statusCode = 404;
      throw error;
    }

    if (role.is_system && status === "deleted") {
      const error = new Error("System roles cannot be deleted");
      error.statusCode = 403;
      throw error;
    }

    const updates = {};
    if (name !== undefined) {updates.name = name.trim();}
    if (description !== undefined) {updates.description = description?.trim();}
    if (status !== undefined) {updates.status = status;}

    const before = Object.fromEntries(Object.keys(updates).map((key) => [key, role[key]]));
    await db.transaction(async (transaction) => {
      await role.update(updates, { transaction });
      await auditAccessChange(transaction, actor, {
        action: "UPDATE",
        resourceType: "Role",
        resourceId: id,
        changes: { operation: "UPDATE_ROLE", before, after: updates },
      });
    });

    // A status change decides whether the role grants anything at all
    // (getRolePermissionsMatrix returns {} for a non-active role), so the
    // cached matrix must go with it (W-11). Name/description do not change a
    // grant — the matrix is keyed by menu, not by role name.
    if (status !== undefined) {
      await del(cacheKeys.permissions(id));
    }
    return role;
  }

  /**
   * Delete role (or deactivate if system role)
   */
  static async deleteRole(id, actor = {}) {
    const role = await Role.findByPk(id);
    if (!role) {
      const error = new Error("Role not found");
      error.statusCode = 404;
      throw error;
    }

    // Both branches revoke everything the role granted, so both drop the
    // cached matrix that dynamicAccess and abac read on every gated request.
    // Without this a deleted or deactivated role kept granting for the rest
    // of the 3600 s TTL, on every replica (W-11).
    if (role.is_system) {
      // Deactivate instead of delete for system roles
      await db.transaction(async (transaction) => {
        await role.update({ status: "inactive" }, { transaction });
        const revokedGrants = await RoleMenuPermission.destroy({
          where: { roleId: id },
          transaction,
        });
        await auditAccessChange(transaction, actor, {
          action: "DELETE",
          resourceType: "Role",
          resourceId: id,
          changes: {
            operation: "DEACTIVATE_SYSTEM_ROLE",
            before: { name: role.name, status: "active" },
            after: { status: "inactive", revokedGrants },
          },
        });
      });
      await del(cacheKeys.permissions(id));
      return { message: "System role deactivated" };
    }

    await db.transaction(async (transaction) => {
      await role.destroy({ transaction });
      await auditAccessChange(transaction, actor, {
        action: "DELETE",
        resourceType: "Role",
        resourceId: id,
        changes: {
          operation: "DELETE_ROLE",
          before: { name: role.name, status: role.status },
          after: { deleted: true },
        },
      });
    });
    await del(cacheKeys.permissions(id));
    return { message: "Role deleted successfully" };
  }

  /**
   * Assign menu permission to role
   * @param {string} roleId - Role ID
   * @param {string} menuGroupId - Menu Group ID
   * @param {string} permissionType - "read" or "write"
   */
  static async assignMenuToRole(roleId, menuGroupId, permissionType = "read", actor = {}) {
    const role = await Role.findByPk(roleId);
    if (!role) {
      const error = new Error("Role not found");
      error.statusCode = 404;
      throw error;
    }

    const menu = await MenuGroup.findByPk(menuGroupId);
    if (!menu) {
      const error = new Error("Menu group not found");
      error.statusCode = 404;
      throw error;
    }

    const permission = await db.transaction(async (transaction) => {
      const [grant, created] = await RoleMenuPermission.findOrCreate({
        where: { roleId: roleId, menuGroupId: menuGroupId },
        defaults: { permissionType: permissionType },
        transaction,
      });
      const previous = created ? null : grant.permissionType;

      if (!created) {
        await grant.update({ permissionType: permissionType }, { transaction });
      }

      await auditAccessChange(transaction, actor, {
        action: "UPDATE",
        resourceType: "Role",
        resourceId: roleId,
        changes: {
          operation: "GRANT_MENU",
          menuGroupId,
          before: { permissionType: previous },
          after: { permissionType },
        },
      });
      return grant;
    });

    // Invalidate role permissions cache (after the commit)
    await del(cacheKeys.permissions(roleId));

    return permission;
  }

  /**
   * Remove menu permission from role
   */
  static async removeMenuFromRole(roleId, menuGroupId, actor = {}) {
    await db.transaction(async (transaction) => {
      const removed = await RoleMenuPermission.destroy({
        where: { roleId: roleId, menuGroupId: menuGroupId },
        transaction,
      });
      // Nothing removed, nothing changed — and nothing to attribute.
      if (removed > 0) {
        await auditAccessChange(transaction, actor, {
          action: "UPDATE",
          resourceType: "Role",
          resourceId: roleId,
          changes: {
            operation: "REVOKE_MENU",
            menuGroupId,
            before: { granted: true },
            after: { granted: false },
          },
        });
      }
    });
    // Invalidate role permissions cache (after the commit)
    await del(cacheKeys.permissions(roleId));
    return { message: "Menu permission removed" };
  }

  /**
   * Get all menus accessible by role with permission types
   */
  static async getRoleMenus(roleId) {
    const permissions = await RoleMenuPermission.findAll({
      where: { roleId },
      include: [
        {
          model: MenuGroup,
          as: "menu",
          attributes: ["id", "name", "slug", "icon", "sortOrder"],
        },
      ],
    });

    return permissions.map((p) => ({
      menu: p.menu,
      permissionType: p.permissionType || p.permission_type,
      permission_type: p.permissionType || p.permission_type,
    }));
  }

  /**
   * Check if user has specific permission on a menu
   *
   * @param {string} userId - User ID
   * @param {string} menuSlug - Menu slug to check
   * @param {string} permissionType - "read" or "write"
   * @returns {boolean} True if user has the permission
   */
  static async hasPermission(userId, menuSlug, permissionType = "read") {
    const slugsToCheck = [menuSlug];
    try {
      const targetMenu = await MenuGroup.findOne({ where: { slug: menuSlug } });
      if (targetMenu && targetMenu.parentId) {
        const parent = await MenuGroup.findByPk(targetMenu.parentId);
        if (parent && parent.slug) {
          slugsToCheck.push(parent.slug);
        }
      }
    } catch (err) {
      // safe fallback in case models are mocked or DB unavailable in tests
    }

    const user = await User.findByPk(userId, {
      include: [
        // INNER JOIN on purpose (A-90): Role's defaultScope makes this include
        // required, and the role is a filter — a user whose role is
        // soft-deleted has no permission. The `!user || !user.role` check
        // below denies either way; the join type states it.
        {
          model: Role,
          as: "role",
          attributes: ["id", "status"],
          include: [
            {
              model: RoleMenuPermission,
              as: "permissions",
              attributes: ["permissionType", "menuGroupId"],
              include: [
                {
                  model: MenuGroup,
                  as: "menu",
                  attributes: ["slug"],
                  where: { slug: { [Op.in]: slugsToCheck } },
                  required: true,
                },
              ],
            },
          ],
        },
      ],
    });

    if (!user || !user.role || user.role.status !== "active") {
      return false;
    }

    const perm = user.role.permissions?.[0];
    if (!perm) {
      return false;
    }

    const type = perm.permissionType || perm.permission_type;
    if (permissionType === "write") {
      return type === "write";
    }

    // For read permission, both read and write roles qualify
    return ["read", "write"].includes(type);
  }

  /**
   * Get cached role permissions matrix for fast middleware checks
   *
   * A role that no longer exists (destroyed — `Role` is paranoid, so its
   * RoleMenuPermission rows survive the soft delete) or is not `active`
   * grants nothing: the same rule `hasPermission` applies. Without it,
   * `updateRole(id, { status: "inactive" })` left the role's rows in place
   * and the matrix rebuilt from them kept granting (W-11). That denial is
   * not cached, so a reactivated or restored role is honoured at once.
   *
   * @param {string} roleId
   * @returns {Promise<Record<string, string[]>>} menu name/slug → permission types
   */
  static async getRolePermissionsMatrix(roleId) {
    const cacheKey = cacheKeys.permissions(roleId);
    const cached = await get(cacheKey);
    if (cached) {return cached;}

    const role = await Role.findByPk(roleId, { attributes: ["id", "status"] });
    if (!role || role.status !== "active") {
      return {};
    }

    const permissions = await RoleMenuPermission.findAll({
      where: { roleId },
      include: [
        {
          model: MenuGroup,
          as: "menu",
          attributes: ["id", "name", "slug"],
          include: [
            {
              model: MenuGroup,
              as: "children",
              attributes: ["name", "slug"],
              required: false,
            },
          ],
        },
      ],
    });

    const matrix = {};
    for (const p of permissions) {
      if (!p.menu) {continue;}
      const name = p.menu.name;
      const slug = p.menu.slug;
      const permType = p.permissionType || p.permission_type;

      if (!matrix[name]) {matrix[name] = [];}
      if (!matrix[name].includes(permType)) {
        matrix[name].push(permType);
      }

      if (slug) {
        if (!matrix[slug]) {matrix[slug] = [];}
        if (!matrix[slug].includes(permType)) {
          matrix[slug].push(permType);
        }
      }

      // Inherit permission to all children if parent is assigned
      if (p.menu.children && p.menu.children.length > 0) {
        for (const child of p.menu.children) {
          const childName = child.name;
          const childSlug = child.slug;

          if (!matrix[childName]) {matrix[childName] = [];}
          if (!matrix[childName].includes(permType)) {
            matrix[childName].push(permType);
          }

          if (childSlug) {
            if (!matrix[childSlug]) {matrix[childSlug] = [];}
            if (!matrix[childSlug].includes(permType)) {
              matrix[childSlug].push(permType);
            }
          }
        }
      }
    }

    await set(cacheKey, matrix, 3600); // 1 hour
    return matrix;
  }

  /**
   * Get user's accessible menus with permission types
   */
  static async getUserMenus(userId) {
    const user = await User.findByPk(userId, {
      include: [
        // INNER JOIN on purpose (A-90): a user whose role is soft-deleted has
        // no menus. `!user || !user.role` below returns [] either way.
        {
          model: Role,
          as: "role",
          attributes: [],
          include: [
            {
              model: RoleMenuPermission,
              as: "permissions",
              attributes: ["permissionType", "menuGroupId"],
              include: [
                {
                  model: MenuGroup,
                  as: "menu",
                  attributes: ["id", "name", "slug", "icon", "sortOrder"],
                },
              ],
            },
          ],
        },
      ],
    });

    if (!user || !user.role) {
      return [];
    }

    const permissions = user.role.permissions || [];

    return permissions
      .filter((p) => p.menu)
      .map((p) => ({
        menu: p.menu,
        permissionType: p.permissionType || p.permission_type,
        permission_type: p.permissionType || p.permission_type,
      }));
  }

  /**
   * Assign role to user
   */
  static async assignRoleToUser(userId, roleId, actor = {}) {
    const user = await User.findByPk(userId);
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    const role = await Role.findByPk(roleId);
    if (!role) {
      const error = new Error("Role not found");
      error.statusCode = 404;
      throw error;
    }

    if (role.status !== "active") {
      const error = new Error("Cannot assign inactive role");
      error.statusCode = 400;
      throw error;
    }

    const previousRoleId = user.role_id;
    await db.transaction(async (transaction) => {
      user.role_id = roleId;
      await user.save({ transaction });
      await auditAccessChange(transaction, actor, {
        tenantId: user.tenantId,
        action: "UPDATE",
        resourceType: "User",
        resourceId: userId,
        changes: {
          operation: "ASSIGN_ROLE",
          before: { roleId: previousRoleId },
          after: { roleId },
        },
      });
    });

    return user;
  }

  /**
   * Remove role from user
   */
  static async removeRoleFromUser(userId, actor = {}) {
    const user = await User.findByPk(userId);
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    const previousRoleId = user.role_id;
    await db.transaction(async (transaction) => {
      user.role_id = null;
      await user.save({ transaction });
      await auditAccessChange(transaction, actor, {
        tenantId: user.tenantId,
        action: "UPDATE",
        resourceType: "User",
        resourceId: userId,
        changes: {
          operation: "REMOVE_ROLE",
          before: { roleId: previousRoleId },
          after: { roleId: null },
        },
      });
    });

    return { message: "Role removed from user" };
  }

  // ==========================================
  //                     MENU GROUPS
  // ==========================================

  /**
   * Get all menu groups
   */
  static async getAllMenus({
    status = "all",
    is_active = null,
    limit = 100,
    offset = 0,
    search = "",
  } = {}) {
    const where = {};

    if (is_active !== null) {
      where.is_active = is_active;
    }

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { slug: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const result = await MenuGroup.findAndCountAll({
      where,
      include: [
        {
          model: MenuGroup,
          as: "children",
          attributes: ["id", "name", "slug", "icon", "sort_order"],
        },
      ],
      limit,
      offset,
      order: [
        ["sort_order", "ASC"],
        ["created_at", "ASC"],
      ],
    });

    return {
      data: result.rows,
      count: result.count,
      page: Math.floor(offset / limit) + 1,
      limit,
    };
  }

  /**
   * Get menu group by ID
   */
  static async getMenuById(id) {
    return MenuGroup.findByPk(id, {
      include: [
        {
          model: MenuGroup,
          as: "children",
          attributes: ["id", "name", "slug", "icon", "sort_order"],
        },
      ],
    });
  }

  /**
   * Create menu group
   */
  static async createMenu(data) {
    const menu = await MenuGroup.create({
      name: data.name.trim(),
      slug:
        data.slug?.trim() ||
        data.name.trim().toLowerCase().replace(/\s+/g, "-"),
      icon: data.icon,
      parent_id: data.parent_id,
      sort_order: data.sort_order || 0,
      is_active: data.is_active !== undefined ? data.is_active : true,
    });

    // A child menu inherits its parent's grant (getRolePermissionsMatrix
    // copies a parent's permission to its children), so a new child of a
    // granted parent changes what those roles grant.
    if (data.parent_id) {
      await delPattern("permissions:role:*");
    }
    return menu;
  }

  /**
   * Update menu group
   */
  static async updateMenu(id, data) {
    const menu = await MenuGroup.findByPk(id);
    if (!menu) {
      const error = new Error("Menu group not found");
      error.statusCode = 404;
      throw error;
    }

    const updates = {};
    if (data.name !== undefined) {updates.name = data.name.trim();}
    if (data.slug !== undefined)
    {updates.slug =
        data.slug?.trim() ||
        data.name?.trim().toLowerCase().replace(/\s+/g, "-");}
    if (data.icon !== undefined) {updates.icon = data.icon;}
    if (data.parent_id !== undefined) {updates.parent_id = data.parent_id;}
    if (data.sort_order !== undefined) {updates.sort_order = data.sort_order;}
    if (data.is_active !== undefined) {updates.is_active = data.is_active;}

    await menu.update(updates);

    // Invalidate all role permissions since menu name/status might have changed
    await delPattern("permissions:role:*");

    return menu;
  }

  /**
   * Delete menu group
   */
  static async deleteMenu(id) {
    const menu = await MenuGroup.findByPk(id);
    if (!menu) {
      const error = new Error("Menu group not found");
      error.statusCode = 404;
      throw error;
    }

    // Delete associated role permissions
    await RoleMenuPermission.destroy({ where: { menuGroupId: id } });
    await menu.destroy();

    // Invalidate all role permissions cache
    await delPattern("permissions:role:*");

    return { message: "Menu group deleted successfully" };
  }
}

module.exports = RolesService;
