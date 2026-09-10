// src/services/menuGroup.service.js
//
// Data-access + presentation logic for the Menu Groups domain, extracted from
// menuGroup.controller.js so the controller only handles request/response and
// validation (consistent with the rest of the codebase, where each domain has a
// service). Behaviour is intentionally identical to the previous inline logic.
//
// NOTE ON AUTHORIZATION: role↔menu-permission wiring lives here for the
// menu-groups admin UI. The RBAC permission *matrix* (used by dynamicAccess/abac
// for request-time authorization) remains owned solely by roles.service.js —
// deliberately not merged, to keep a single source of truth for access decisions.

const { AppError } = require("../utils/appError.util");
const { Role, MenuGroup, RoleMenuPermission } = require("../models");

// Maps a DB slug to its Next.js dashboard route.
const mapSlugToPath = (slug) => {
  const customPaths = {
    home: "/",
    dashboard: "/dashboard",
    "change-password": "/dashboard/change-password",
    "profile-page": "/dashboard/profile",
    "menu-groups": "/dashboard/menu-groups",
    tenants: "/dashboard/tenants",
    roles: "/dashboard/roles",
    users: "/dashboard/users",
    calibration: "/dashboard/devices",
    certificate: "/dashboard/calibration",
    permissions: "/dashboard/permissions",
    sessions: "/dashboard/session-management",
    warehouse: "/dashboard/warehouses",
    // Support desk pages are nested under /dashboard/tickets alongside the
    // shared ticket detail route (/dashboard/tickets/[ticketId]).
    "tickets-raise": "/dashboard/tickets/raise",
    "tickets-response": "/dashboard/tickets/response",
  };

  if (customPaths[slug]) {
    return customPaths[slug];
  }

  return `/dashboard/${slug}`;
};

// Formats one descendant node (sub-group or leaf item) into the frontend item
// shape. Recurses so a sub-group carries its own `items` (3-level menus).
const formatMenuItem = (node, isAssignedMap) => {
  const item = {
    id: node.id,
    label: node.name,
    icon: node.icon,
    path: mapSlugToPath(node.slug),
    requiredPermission: undefined,
    isAssigned: isAssignedMap ? !!isAssignedMap[node.id] : undefined,
    sortOrder: node.sortOrder,
  };

  if (node.children && node.children.length > 0) {
    item.items = node.children
      .map((child) => formatMenuItem(child, isAssignedMap))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }

  return item;
};

// Formats a MenuGroup Sequelize instance (with children) into the frontend shape.
const formatMenuGroup = (group, isAssignedMap = null) => {
  const formatted = {
    id: group.id,
    label: group.name,
    icon: group.icon,
    path: mapSlugToPath(group.slug),
    sortOrder: group.sortOrder,
    isAssigned: isAssignedMap ? !!isAssignedMap[group.id] : undefined,
  };

  if (group.children && group.children.length > 0) {
    formatted.items = group.children
      .map((child) => formatMenuItem(child, isAssignedMap))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  } else {
    formatted.items = [];
  }

  return formatted;
};

// Active-children include, reused at each nesting level.
const activeChildrenInclude = (nested) => {
  const include = {
    model: MenuGroup,
    as: "children",
    where: { isActive: true },
    required: false,
  };
  if (nested) {
    include.include = [nested];
  }
  return include;
};

// Fetches all active top-level groups with their active children AND
// grandchildren (Management → sub-group category → item), ordered by sortOrder
// at every level.
const fetchActiveParentGroups = () =>
  MenuGroup.findAll({
    where: { parentId: null, isActive: true },
    include: [activeChildrenInclude(activeChildrenInclude())],
    order: [
      ["sortOrder", "ASC"],
      [{ model: MenuGroup, as: "children" }, "sortOrder", "ASC"],
      [
        { model: MenuGroup, as: "children" },
        { model: MenuGroup, as: "children" },
        "sortOrder",
        "ASC",
      ],
    ],
  });

// ------------------------------------------------------------------
// LIST / FILTER MENU GROUPS (optionally annotated with role assignment)
// ------------------------------------------------------------------
exports.listMenuGroups = async (roleId) => {
  let isAssignedMap = null;
  if (roleId) {
    const assignments = await RoleMenuPermission.findAll({ where: { roleId } });
    isAssignedMap = {};
    assignments.forEach((a) => {
      isAssignedMap[a.menuGroupId] = true;
    });
  }

  const parentGroups = await fetchActiveParentGroups();
  return parentGroups.map((g) => formatMenuGroup(g, isAssignedMap));
};

// ------------------------------------------------------------------
// GET ROLE MENU ASSIGNMENTS (personalized menu for a role)
// ------------------------------------------------------------------
exports.getRoleMenuAssignments = async (roleId) => {
  const assignments = await RoleMenuPermission.findAll({ where: { roleId } });
  const assignedIds = new Set(assignments.map((a) => a.menuGroupId));

  const parentGroups = await fetchActiveParentGroups();

  // Walks a node at any depth. A node is visible when it is explicitly
  // assigned, when one of its ancestors is assigned (assignment cascades down),
  // or when at least one descendant survives the same test — so an explicitly
  // assigned leaf still surfaces through an unassigned sub-group, while a
  // sub-group that ends up empty and unassigned is dropped entirely.
  const buildNode = (node, ancestorAssigned) => {
    const isAssigned = ancestorAssigned || assignedIds.has(node.id);

    const visibleChildren = (node.children || [])
      .map((child) => buildNode(child, isAssigned))
      .filter(Boolean);

    if (!isAssigned && visibleChildren.length === 0) {
      return null;
    }

    const built = {
      id: node.id,
      label: node.name,
      icon: node.icon,
      path: mapSlugToPath(node.slug),
      requiredPermission: undefined,
    };

    // Only sub-groups carry an `items` array; leaves keep the flat item shape
    // the frontend has always received.
    if (visibleChildren.length > 0) {
      built.items = visibleChildren;
    }

    return built;
  };

  const result = [];
  for (const group of parentGroups) {
    const built = buildNode(group, false);
    if (!built) {
      continue;
    }

    result.push({
      id: group.id,
      label: group.name,
      icon: group.icon,
      path: mapSlugToPath(group.slug),
      sortOrder: group.sortOrder,
      items: built.items || [],
    });
  }

  return result;
};

// ------------------------------------------------------------------
// ROLES FOR SELECTION
// ------------------------------------------------------------------
exports.getAvailableRoles = () =>
  Role.findAll({ order: [["sortOrder", "ASC"]] });

// ------------------------------------------------------------------
// CREATE MENU GROUP
// ------------------------------------------------------------------
exports.createMenuGroup = async (value) => {
  const group = await MenuGroup.create({
    name: value.name,
    slug: value.slug || value.name.toLowerCase().replace(/\s+/g, "-"),
    icon: value.icon,
    parentId: value.parentId,
    sortOrder: value.sortOrder,
    isActive: value.isActive,
  });
  return formatMenuGroup(group);
};

// ------------------------------------------------------------------
// UPDATE MENU GROUP
// ------------------------------------------------------------------
exports.updateMenuGroup = async (value) => {
  const group = await MenuGroup.findByPk(value.id);
  if (!group) {
    throw new AppError(404, "Menu group not found");
  }

  await group.update({
    name: value.name !== undefined ? value.name : group.name,
    slug: value.slug !== undefined ? value.slug : group.slug,
    icon: value.icon !== undefined ? value.icon : group.icon,
    parentId: value.parentId !== undefined ? value.parentId : group.parentId,
    sortOrder:
      value.sortOrder !== undefined ? value.sortOrder : group.sortOrder,
    isActive: value.isActive !== undefined ? value.isActive : group.isActive,
  });

  return formatMenuGroup(group);
};

// ------------------------------------------------------------------
// DELETE MENU GROUP (+ cleanup nested associations)
// ------------------------------------------------------------------
exports.deleteMenuGroup = async (menuGroupId) => {
  const group = await MenuGroup.findByPk(menuGroupId);
  if (!group) {
    throw new AppError(404, "Menu group not found");
  }

  await RoleMenuPermission.destroy({ where: { menuGroupId } });
  await MenuGroup.destroy({ where: { parentId: menuGroupId } });
  await group.destroy();
};

// ------------------------------------------------------------------
// ASSIGN MENU (GROUP OR ITEM) TO ROLE
// ------------------------------------------------------------------
exports.assignMenuToRole = async ({ roleId, menuGroupId }) => {
  const role = await Role.findByPk(roleId);
  if (!role) {
    throw new AppError(404, "Role not found");
  }

  const group = await MenuGroup.findByPk(menuGroupId);
  if (!group) {
    throw new AppError(404, "Menu group or item not found");
  }

  const [perm] = await RoleMenuPermission.findOrCreate({
    where: { roleId, menuGroupId },
    defaults: { permissionType: "read" },
  });

  return perm;
};

// ------------------------------------------------------------------
// REVOKE MENU (GROUP OR ITEM) FROM ROLE
// ------------------------------------------------------------------
exports.revokeMenuFromRole = async ({ roleId, menuGroupId }) => {
  await RoleMenuPermission.destroy({ where: { roleId, menuGroupId } });
};

// ------------------------------------------------------------------
// BULK ASSIGN
// ------------------------------------------------------------------
exports.bulkAssign = async (roleId, menuGroupIds) => {
  const role = await Role.findByPk(roleId);
  if (!role) {
    throw new AppError(404, "Role not found");
  }

  const assigned = [];
  const alreadyAssigned = [];
  const failed = [];

  for (const menuGroupId of menuGroupIds) {
    try {
      const group = await MenuGroup.findByPk(menuGroupId);
      if (!group) {
        failed.push({ menuGroupId, error: "Menu group not found" });
        continue;
      }

      const [, created] = await RoleMenuPermission.findOrCreate({
        where: { roleId, menuGroupId },
        defaults: { permissionType: "read" },
      });

      if (created) {
        assigned.push(menuGroupId);
      } else {
        alreadyAssigned.push(menuGroupId);
      }
    } catch (err) {
      failed.push({ menuGroupId, error: err.message });
    }
  }

  return { assigned, alreadyAssigned, failed };
};

// ------------------------------------------------------------------
// BULK REVOKE
// ------------------------------------------------------------------
exports.bulkRevoke = async (roleId, menuGroupIds) => {
  const revoked = [];
  const notFound = [];

  for (const menuGroupId of menuGroupIds) {
    const deleted = await RoleMenuPermission.destroy({
      where: { roleId, menuGroupId },
    });

    if (deleted > 0) {
      revoked.push(menuGroupId);
    } else {
      notFound.push(menuGroupId);
    }
  }

  return { revoked, notFound };
};

// Exported for reuse/testing.
exports.mapSlugToPath = mapSlugToPath;
exports.formatMenuGroup = formatMenuGroup;
