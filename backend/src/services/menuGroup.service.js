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
const { db } = require("../config");
const auditService = require("./audit.service");
const { del, delPattern, cacheKeys } = require("./redis.service");
const { PLATFORM_TENANT_ID } = require("../constants/platformTenant");

/**
 * A-173 — the second write path to the global menu tree (the first is
 * roles.service createMenu/updateMenu/deleteMenu, A-165). A menu group is what
 * every role grant points at, so creating, changing or deleting one is a
 * platform operation: each writes ONE audit row under the reserved PLATFORM
 * tenant, inside the SAME transaction as the change (A-41, ADR-051 Q-14). A
 * failed audit insert is re-thrown by logAction and rolls the change back.
 * The permissions cache is cleared after the commit, never inside it.
 *
 * @param {object} transaction
 * @param {object} actor - auditActor(req): { userId, tenantId, ipAddress, userAgent }
 * @param {object} row - { action, resourceId, changes }
 */
const auditMenuChange = (transaction, actor, { action, resourceId, changes }) =>
  auditService.logAction(
    {
      tenantId: PLATFORM_TENANT_ID, // A-173: a global menu is a platform operation
      userId: actor.userId,
      action,
      resourceType: "MenuGroup",
      resourceId,
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    },
    { transaction },
  );

// The menu-group fields an update may change, as the audit row records them.
const MENU_GROUP_FIELDS = ["name", "slug", "icon", "parentId", "sortOrder", "isActive"];

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
exports.createMenuGroup = async (value, actor = {}) => {
  const group = await db.transaction(async (transaction) => {
    const created = await MenuGroup.create(
      {
        name: value.name,
        slug: value.slug || value.name.toLowerCase().replace(/\s+/g, "-"),
        icon: value.icon,
        parentId: value.parentId,
        sortOrder: value.sortOrder,
        isActive: value.isActive,
      },
      { transaction },
    );
    await auditMenuChange(transaction, actor, {
      action: "CREATE",
      resourceId: created.id,
      changes: {
        operation: "CREATE_MENU",
        before: {},
        after: {
          name: created.name,
          slug: created.slug,
          parentId: created.parentId ?? null,
          isActive: created.isActive ?? null,
        },
      },
    });
    return created;
  });

  // A child menu inherits its parent's grant (roles.service
  // getRolePermissionsMatrix), so a new child of a granted parent changes
  // what those roles grant (as roles.service#createMenu, A-165).
  if (value.parentId) {
    await delPattern("permissions:role:*");
  }
  return formatMenuGroup(group);
};

// ------------------------------------------------------------------
// UPDATE MENU GROUP
// ------------------------------------------------------------------
exports.updateMenuGroup = async (value, actor = {}) => {
  const group = await MenuGroup.findByPk(value.id);
  if (!group) {
    throw new AppError(404, "Menu group not found");
  }

  // Read before the update: the instance is mutated in place. The audit row
  // records the fields the caller sent, before and after.
  const sent = MENU_GROUP_FIELDS.filter((key) => value[key] !== undefined);
  const before = Object.fromEntries(sent.map((key) => [key, group[key] ?? null]));
  const after = Object.fromEntries(sent.map((key) => [key, value[key]]));

  await db.transaction(async (transaction) => {
    await group.update(
      {
        name: value.name !== undefined ? value.name : group.name,
        slug: value.slug !== undefined ? value.slug : group.slug,
        icon: value.icon !== undefined ? value.icon : group.icon,
        parentId: value.parentId !== undefined ? value.parentId : group.parentId,
        sortOrder:
          value.sortOrder !== undefined ? value.sortOrder : group.sortOrder,
        isActive: value.isActive !== undefined ? value.isActive : group.isActive,
      },
      { transaction },
    );
    await auditMenuChange(transaction, actor, {
      action: "UPDATE",
      resourceId: group.id,
      changes: { operation: "UPDATE_MENU", before, after },
    });
  });

  // A menu's parent or active flag decides what a role's grant reaches.
  await delPattern("permissions:role:*");

  return formatMenuGroup(group);
};

// ------------------------------------------------------------------
// DELETE MENU GROUP
// ------------------------------------------------------------------
/**
 * Delete a menu group that has no child menus, with every grant on it.
 *
 * A-181 (ADR-056): a group WITH children is refused, 409. The
 * foreign key on `menu_groups.parent_id` is ON DELETE SET NULL, so until
 * 2026-09-24 deleting a group removed its direct children here and silently
 * promoted its GRANDCHILDREN to the top level — pages a role could reach only
 * through the removed branch reappeared as top-level entries, with their
 * explicit grants intact. Re-parenting them to the deleted group's parent
 * instead was rejected: the permission matrix inherits a grant ONE level down
 * (roles.service#getRolePermissionsMatrix), so a role granted that parent
 * would silently gain every re-parented page. Deleting the whole subtree was
 * rejected too: route gates name slugs, and a cascade would take routes away
 * from every role holding them with one click. The caller deletes (or moves)
 * the children first; each of those deletes is its own audited operation.
 *
 * The children are read inside the transaction. A child created by another
 * request between that read and the commit would still be SET NULL — the
 * ordinary read-then-write window, accepted: menu edits are SUPERADMIN-only.
 *
 * @param {string} menuGroupId
 * @param {object} actor - auditActor(req)
 * @throws {AppError} 404 when the group does not exist; 409 when it has children
 */
exports.deleteMenuGroup = async (menuGroupId, actor = {}) => {
  const group = await MenuGroup.findByPk(menuGroupId);
  if (!group) {
    throw new AppError(404, "Menu group not found");
  }

  // A-173: the grants and the group go in ONE transaction with the audit row
  // — before, each was its own autocommit, and a failure part-way left the
  // group in place with its grants already gone.
  await db.transaction(async (transaction) => {
    const children = await MenuGroup.findAll({
      where: { parentId: menuGroupId },
      attributes: ["id", "name"],
      transaction,
    });
    if (children.length > 0) {
      throw new AppError(
        409,
        `Menu group "${group.name}" still has ${children.length} child menu(s) (${children
          .map((child) => child.name)
          .join(", ")}). Delete or move them first; a group is deleted only when it is empty.`,
      );
    }
    const revokedGrants = await RoleMenuPermission.destroy({
      where: { menuGroupId },
      transaction,
    });
    await group.destroy({ transaction });
    await auditMenuChange(transaction, actor, {
      action: "DELETE",
      resourceId: menuGroupId,
      changes: {
        operation: "DELETE_MENU",
        before: { name: group.name, slug: group.slug },
        after: { deleted: true, revokedGrants },
      },
    });
  });

  await delPattern("permissions:role:*");
};

/**
 * A-181 — a role↔menu grant change on this path, recorded as roles.service
 * records its own (A-125): ONE row under the PLATFORM tenant (a role is
 * global), resource the role, `GRANT_MENU` / `REVOKE_MENU`, inside the
 * change's transaction. A failed insert is re-thrown by logAction and rolls
 * the grant back.
 *
 * @param {object} transaction
 * @param {object} actor - auditActor(req)
 * @param {string} roleId
 * @param {object} changes
 */
const auditGrantChange = (transaction, actor, roleId, changes) =>
  auditService.logAction(
    {
      tenantId: PLATFORM_TENANT_ID,
      userId: actor.userId,
      action: "UPDATE",
      resourceType: "Role",
      resourceId: roleId,
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    },
    { transaction },
  );

// ------------------------------------------------------------------
// ASSIGN MENU (GROUP OR ITEM) TO ROLE
// ------------------------------------------------------------------
/**
 * Grant a menu to a role (`read`). An existing grant is left as it is and is
 * not recorded — nothing changed.
 *
 * @param {{roleId: string, menuGroupId: string}} params
 * @param {object} actor - auditActor(req)
 */
exports.assignMenuToRole = async ({ roleId, menuGroupId }, actor = {}) => {
  const role = await Role.findByPk(roleId);
  if (!role) {
    throw new AppError(404, "Role not found");
  }

  const group = await MenuGroup.findByPk(menuGroupId);
  if (!group) {
    throw new AppError(404, "Menu group or item not found");
  }

  const { perm, created } = await db.transaction(async (transaction) => {
    const [grant, wasCreated] = await RoleMenuPermission.findOrCreate({
      where: { roleId, menuGroupId },
      defaults: { permissionType: "read" },
      transaction,
    });
    if (wasCreated) {
      await auditGrantChange(transaction, actor, roleId, {
        operation: "GRANT_MENU",
        menuGroupId,
        before: { permissionType: null },
        after: { permissionType: "read" },
      });
    }
    return { perm: grant, created: wasCreated };
  });

  // After the commit (A-181): the role's cached matrix no longer holds.
  if (created) {
    await del(cacheKeys.permissions(roleId));
  }
  return perm;
};

// ------------------------------------------------------------------
// REVOKE MENU (GROUP OR ITEM) FROM ROLE
// ------------------------------------------------------------------
exports.revokeMenuFromRole = async ({ roleId, menuGroupId }, actor = {}) => {
  const removed = await db.transaction(async (transaction) => {
    const count = await RoleMenuPermission.destroy({
      where: { roleId, menuGroupId },
      transaction,
    });
    // Nothing removed, nothing changed — and nothing to attribute.
    if (count > 0) {
      await auditGrantChange(transaction, actor, roleId, {
        operation: "REVOKE_MENU",
        menuGroupId,
        before: { granted: true },
        after: { granted: false },
      });
    }
    return count;
  });

  if (removed > 0) {
    await del(cacheKeys.permissions(roleId));
  }
};

// ------------------------------------------------------------------
// BULK ASSIGN
// ------------------------------------------------------------------
/**
 * Grant several menus to a role, all or nothing, with ONE audit row naming
 * every menu actually granted (A-181). An id that names no menu group is
 * reported in `failed` and skipped; any other failure rolls the whole batch
 * back — a PostgreSQL transaction cannot carry on past a failed statement, so
 * the old per-item catch could only ever have reported a batch that was
 * already lost.
 *
 * @param {string} roleId
 * @param {string[]} menuGroupIds
 * @param {object} actor - auditActor(req)
 */
exports.bulkAssign = async (roleId, menuGroupIds, actor = {}) => {
  const role = await Role.findByPk(roleId);
  if (!role) {
    throw new AppError(404, "Role not found");
  }

  const existing = await MenuGroup.findAll({
    where: { id: menuGroupIds },
    attributes: ["id"],
  });
  const existingIds = new Set(existing.map((group) => String(group.id)));

  const assigned = [];
  const alreadyAssigned = [];
  const failed = [];

  await db.transaction(async (transaction) => {
    for (const menuGroupId of menuGroupIds) {
      if (!existingIds.has(String(menuGroupId))) {
        failed.push({ menuGroupId, error: "Menu group not found" });
        continue;
      }
      const [, created] = await RoleMenuPermission.findOrCreate({
        where: { roleId, menuGroupId },
        defaults: { permissionType: "read" },
        transaction,
      });
      (created ? assigned : alreadyAssigned).push(menuGroupId);
    }
    if (assigned.length > 0) {
      await auditGrantChange(transaction, actor, roleId, {
        operation: "GRANT_MENU",
        menuGroupIds: assigned,
        before: { permissionType: null },
        after: { permissionType: "read" },
      });
    }
  });

  if (assigned.length > 0) {
    await del(cacheKeys.permissions(roleId));
  }
  return { assigned, alreadyAssigned, failed };
};

// ------------------------------------------------------------------
// BULK REVOKE
// ------------------------------------------------------------------
/**
 * Revoke several menus from a role, all or nothing, with ONE audit row naming
 * every grant actually removed (A-181).
 *
 * @param {string} roleId
 * @param {string[]} menuGroupIds
 * @param {object} actor - auditActor(req)
 */
exports.bulkRevoke = async (roleId, menuGroupIds, actor = {}) => {
  const revoked = [];
  const notFound = [];

  await db.transaction(async (transaction) => {
    for (const menuGroupId of menuGroupIds) {
      const deleted = await RoleMenuPermission.destroy({
        where: { roleId, menuGroupId },
        transaction,
      });
      (deleted > 0 ? revoked : notFound).push(menuGroupId);
    }
    if (revoked.length > 0) {
      await auditGrantChange(transaction, actor, roleId, {
        operation: "REVOKE_MENU",
        menuGroupIds: revoked,
        before: { granted: true },
        after: { granted: false },
      });
    }
  });

  if (revoked.length > 0) {
    await del(cacheKeys.permissions(roleId));
  }
  return { revoked, notFound };
};

// Exported for reuse/testing.
exports.mapSlugToPath = mapSlugToPath;
exports.formatMenuGroup = formatMenuGroup;
