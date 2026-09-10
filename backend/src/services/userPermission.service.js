/**
 * User Permission Service
 *
 * Per-user permission overrides on top of role inheritance.
 *
 * Resolution model (per menu group):
 *   1. If the user has a UserMenuPermission row for the menu → it wins:
 *      "read" / "write" grant that access, "none" explicitly denies.
 *   2. Otherwise the user's role permission (RoleMenuPermission) applies.
 *
 * The override matrix is cached per user (cacheKeys.userPermissions) and
 * invalidated on every mutation.
 */

const {
  User,
  Role,
  MenuGroup,
  RoleMenuPermission,
  UserMenuPermission,
} = require("../models");
const { get, set, del, cacheKeys } = require("./redis.service");
const { AppError } = require("../utils/appError.util");

const CACHE_TTL_SECONDS = 300;

const formatMenu = (menu) =>
  menu
    ? {
        id: menu.id,
        name: menu.name,
        slug: menu.slug,
        icon: menu.icon,
        parentId: menu.parentId,
      }
    : null;

/**
 * Full permission picture for one user: role perms, custom overrides,
 * and the resolved effective list.
 */
exports.getUserPermissions = async (userId) => {
  const user = await User.findByPk(userId, {
    attributes: ["id", "username", "firstName", "lastName", "email", "tenantId"],
    include: [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name", "nameToShow", "status"],
      },
    ],
  });
  if (!user) {
    throw new AppError(404, "User not found");
  }

  const [rolePerms, overrides, menus] = await Promise.all([
    user.role
      ? RoleMenuPermission.findAll({
          where: { roleId: user.role.id },
          include: [{ model: MenuGroup, as: "menu" }],
        })
      : Promise.resolve([]),
    UserMenuPermission.findAll({
      where: { userId },
      include: [{ model: MenuGroup, as: "menu" }],
    }),
    MenuGroup.findAll({ order: [["sortOrder", "ASC"]] }),
  ]);

  const roleMap = new Map(
    rolePerms
      .filter((p) => p.menu)
      .map((p) => [p.menuGroupId, p.permissionType]),
  );
  const overrideMap = new Map(overrides.map((p) => [p.menuGroupId, p.permissionType]));

  // Effective permission per menu group across ALL menus
  const effective = menus.map((menu) => {
    const override = overrideMap.get(menu.id);
    const fromRole = roleMap.get(menu.id) || null;
    let permissionType = fromRole;
    let source = fromRole ? "role" : null;
    if (override !== undefined) {
      permissionType = override === "none" ? null : override;
      source = "custom";
    }
    return {
      menuGroupId: menu.id,
      menu: formatMenu(menu),
      permissionType, // "read" | "write" | null (no access)
      source, // "role" | "custom" | null
      rolePermission: fromRole,
      override: override ?? null,
    };
  });

  return {
    success: true,
    status: 200,
    message: "User permissions fetched successfully",
    data: {
      user: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        tenantId: user.tenantId,
        role: user.role
          ? {
              id: user.role.id,
              name: user.role.name,
              nameToShow: user.role.nameToShow,
            }
          : null,
      },
      rolePermissions: rolePerms
        .filter((p) => p.menu)
        .map((p) => ({
          menuGroupId: p.menuGroupId,
          menu: formatMenu(p.menu),
          permissionType: p.permissionType,
        })),
      overrides: overrides.map((p) => ({
        menuGroupId: p.menuGroupId,
        menu: formatMenu(p.menu),
        permissionType: p.permissionType,
        notes: p.notes,
      })),
      effective,
    },
  };
};

/**
 * Upsert a custom permission override for a user.
 * permissionType: "read" | "write" | "none" (explicit deny).
 */
exports.setUserPermission = async (
  userId,
  menuGroupId,
  permissionType,
  grantedBy = null,
  notes = null,
) => {
  if (!["read", "write", "none"].includes(permissionType)) {
    throw new AppError(
      400,
      "permissionType must be one of: read, write, none",
    );
  }

  const user = await User.findByPk(userId, { attributes: ["id"] });
  if (!user) {
    throw new AppError(404, "User not found");
  }
  const menu = await MenuGroup.findByPk(menuGroupId, { attributes: ["id"] });
  if (!menu) {
    throw new AppError(404, "Menu group not found");
  }

  const [perm, created] = await UserMenuPermission.findOrCreate({
    where: { userId, menuGroupId },
    defaults: { permissionType, grantedBy, notes },
  });
  if (!created) {
    await perm.update({ permissionType, grantedBy, notes });
  }

  await del(cacheKeys.userPermissions(userId));

  return {
    success: true,
    status: created ? 201 : 200,
    message: created
      ? "Custom permission assigned successfully"
      : "Custom permission updated successfully",
    data: perm,
  };
};

/**
 * Remove a custom override — the user falls back to role inheritance.
 */
exports.removeUserPermission = async (userId, menuGroupId) => {
  await UserMenuPermission.destroy({ where: { userId, menuGroupId } });
  await del(cacheKeys.userPermissions(userId));
  return {
    success: true,
    status: 200,
    message: "Custom permission removed — role inheritance restored",
    data: null,
  };
};

/**
 * Cached override matrix for request-time checks:
 *   { [menuName]: "read" | "write" | "none" }
 * Used by the dynamicAccess middleware.
 */
exports.getUserOverrideMatrix = async (userId) => {
  const cacheKey = cacheKeys.userPermissions(userId);
  const cached = await get(cacheKey);
  if (cached) {
    return cached;
  }

  const overrides = await UserMenuPermission.findAll({
    where: { userId },
    include: [{ model: MenuGroup, as: "menu", attributes: ["name"] }],
  });

  const matrix = {};
  for (const p of overrides) {
    if (p.menu?.name) {
      matrix[p.menu.name] = p.permissionType;
    }
  }

  await set(cacheKey, matrix, CACHE_TTL_SECONDS);
  return matrix;
};
