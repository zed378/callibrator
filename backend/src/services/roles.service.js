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

class RolesService {
  /**
   * Create a new role
   */
  static async createRole({ name, description, is_system = false }) {
    const role = await Role.create({
      name: name.trim(),
      description: description?.trim(),
      is_system,
      status: "active",
    });
    return role;
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
  static async updateRole(id, { name, description, status }) {
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

    await role.update(updates);
    return role;
  }

  /**
   * Delete role (or deactivate if system role)
   */
  static async deleteRole(id) {
    const role = await Role.findByPk(id);
    if (!role) {
      const error = new Error("Role not found");
      error.statusCode = 404;
      throw error;
    }

    if (role.is_system) {
      // Deactivate instead of delete for system roles
      await role.update({ status: "inactive" });
      await RoleMenuPermission.destroy({ where: { roleId: id } });
      return { message: "System role deactivated" };
    }

    await role.destroy();
    return { message: "Role deleted successfully" };
  }

  /**
   * Assign menu permission to role
   * @param {string} roleId - Role ID
   * @param {string} menuGroupId - Menu Group ID
   * @param {string} permissionType - "read" or "write"
   */
  static async assignMenuToRole(roleId, menuGroupId, permissionType = "read") {
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

    const [permission, created] = await RoleMenuPermission.findOrCreate({
      where: { roleId: roleId, menuGroupId: menuGroupId },
      defaults: { permissionType: permissionType },
    });

    if (!created) {
      await permission.update({ permissionType: permissionType });
    }

    // Invalidate role permissions cache
    await del(cacheKeys.permissions(roleId));

    return permission;
  }

  /**
   * Remove menu permission from role
   */
  static async removeMenuFromRole(roleId, menuGroupId) {
    await RoleMenuPermission.destroy({
      where: { roleId: roleId, menuGroupId: menuGroupId },
    });
    // Invalidate role permissions cache
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
   */
  static async getRolePermissionsMatrix(roleId) {
    const cacheKey = cacheKeys.permissions(roleId);
    const cached = await get(cacheKey);
    if (cached) {return cached;}

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
  static async assignRoleToUser(userId, roleId) {
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

    user.role_id = roleId;
    await user.save();

    return user;
  }

  /**
   * Remove role from user
   */
  static async removeRoleFromUser(userId) {
    const user = await User.findByPk(userId);
    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    user.role_id = null;
    await user.save();

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
    return MenuGroup.create({
      name: data.name.trim(),
      slug:
        data.slug?.trim() ||
        data.name.trim().toLowerCase().replace(/\s+/g, "-"),
      icon: data.icon,
      parent_id: data.parent_id,
      sort_order: data.sort_order || 0,
      is_active: data.is_active !== undefined ? data.is_active : true,
    });
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
