// src/services/menuGroup.service.ts
//
// Data-access + presentation logic for the Menu Groups domain, extracted from
// menuGroup.controller.ts so the controller only handles request/response and
// validation (consistent with the rest of the codebase, where each domain has a
// service). Behaviour is intentionally identical to the previous inline logic.
//
// NOTE ON AUTHORIZATION: role↔menu-permission wiring lives here for the
// menu-groups admin UI. The RBAC permission *matrix* (used by dynamicAccess/abac
// for request-time authorization) remains owned solely by roles.service.ts —
// deliberately not merged, to keep a single source of truth for access decisions.
//
// P9-18 (ADR-087): converted from menuGroup.service.js, behaviour unchanged.
// The export is the same object, its keys in the JavaScript's order
// (`exports.x = …`). What the JavaScript destructured at load is captured at
// load; audit.service stays the module object, read at call time;
// effectivePermission.service is still required lazily, per call.
import type { CreationAttributes, Transaction } from "sequelize";
import { AppError as LoadedAppError } from "../utils/appError.util";
import models from "../models";
import config from "../config";
import auditService from "./audit.service";
import redisService from "./redis.service";
import { PLATFORM_TENANT_ID as loadedPlatformTenantId } from "../constants/platformTenant";
import type * as EffectivePermissionModule from "./effectivePermission.service";
import type { PermissionPrincipal } from "./effectivePermission.service";
import type { AuditAction } from "../constants/auditActions";

const AppError = LoadedAppError;
const { Role, MenuGroup, RoleMenuPermission } = models;
const { db } = config;
const { del, delPattern, cacheKeys } = redisService;
const PLATFORM_TENANT_ID = loadedPlatformTenantId;

/** auditActor(req): who acted, from where. Every field may be missing (`actor = {}`). */
interface MenuActor {
  userId?: string | null;
  tenantId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | readonly string[] | null;
}

/** A menu-group row as these functions read it. */
interface MenuNode {
  id: string;
  name: string;
  slug: string;
  icon?: string | null;
  parentId?: string | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
  children?: MenuNode[];
}

/** A menu entry in the shape the frontend reads. */
interface MenuItem {
  id: string;
  label: string;
  icon: string | null | undefined;
  path: string;
  requiredPermission?: undefined;
  isAssigned?: boolean | undefined;
  sortOrder?: number | null | undefined;
  items?: MenuItem[];
}

/** The fields createMenuGroup and updateMenuGroup take (validated by the controller). */
interface MenuGroupInput {
  id?: string;
  name?: string;
  slug?: string;
  icon?: string | null;
  parentId?: string | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
  [key: string]: unknown;
}

/** req.user, as the menu functions read it. */
interface MenuRequester {
  id?: string | null;
  roleId?: string | null;
  role?: ({ id?: string | null; name?: string | null; roleLevel?: number | null } & Record<string, unknown>) | null;
}

type AssignedMap = Record<string, boolean> | null;

/**
 * A-173 — the second write path to the global menu tree (the first is
 * roles.service createMenu/updateMenu/deleteMenu, A-165). A menu group is what
 * every role grant points at, so creating, changing or deleting one is a
 * platform operation: each writes ONE audit row under the reserved PLATFORM
 * tenant, inside the SAME transaction as the change (A-41, ADR-051 Q-14). A
 * failed audit insert is re-thrown by logAction and rolls the change back.
 * The permissions cache is cleared after the commit, never inside it.
 *
 * @param transaction - the change's transaction
 * @param actor - auditActor(req): { userId, tenantId, ipAddress, userAgent }
 * @param row - { action, resourceId, changes }
 * @returns logAction's answer
 */
const auditMenuChange = (
  transaction: Transaction,
  actor: MenuActor,
  { action, resourceId, changes }: { action: AuditAction; resourceId: string; changes: Record<string, unknown> },
): Promise<unknown> =>
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

/**
 * A-226 — refuse a parent that would put a menu group inside its own subtree.
 *
 * `updateMenuGroup` (and roles.service#updateMenu, A-271) accepted any
 * `parentId`: the group itself, or one of its descendants. Either makes a
 * cycle — the group and its subtree fall out of the tree the sidebar builds
 * from the top-level groups (they are reachable from no root), and the grant
 * inheritance in roles.service#getRolePermissionsMatrix walks a loop. A
 * parent that does not exist was a foreign-key violation, reported as a 500.
 *
 * Walks up from the proposed parent through `parentId`, inside the caller's
 * transaction:
 *  - the proposed parent missing  -> 404, named;
 *  - reaching `menuId` on the way -> 409, the state explained;
 *  - a loop that does not pass through `menuId` (already in the data) stops
 *    the walk — this change does not make it worse, and refusing every edit
 *    under it would leave no way to repair it.
 *
 * `menuId` is null for a group being created (it has no subtree yet): only
 * the parent's existence is checked. A null or undefined `parentId` (top
 * level, or unchanged) needs no check.
 *
 * Two concurrent moves could each pass and together form a loop — the
 * read-then-write window ADR-056 accepts for menu edits, which are
 * SUPERADMIN-only.
 *
 * @param menuId - the group being moved, or null when creating
 * @param parentId - the proposed parent
 * @param transaction - the caller's transaction
 * @throws {AppError} 404 when the parent does not exist; 409 on a cycle
 */
const assertMenuParentAllowed = async (
  menuId: string | null,
  parentId: string | null | undefined,
  transaction?: Transaction | null,
): Promise<void> => {
  if (parentId === undefined || parentId === null) {
    return;
  }
  if (menuId && parentId === menuId) {
    throw new AppError(409, "A menu group cannot be its own parent. Choose another parent, or none for a top-level group.");
  }
  const parent = (await MenuGroup.findByPk(parentId, { attributes: ["id", "name", "parentId"], transaction: transaction as Transaction })) as unknown as MenuNode | null;
  if (!parent) {
    throw new AppError(404, "Parent menu group not found");
  }
  if (!menuId) {
    return;
  }
  const visited = new Set([parent.id]);
  let cursor = parent.parentId;
  while (cursor && !visited.has(cursor)) {
    if (cursor === menuId) {
      throw new AppError(
        409,
        `The menu group "${parent.name}" is inside the group being moved, so it cannot become its parent: ` +
          "that would make a loop. Move it out first, or choose a parent outside this group.",
      );
    }
    visited.add(cursor);
    const node = (await MenuGroup.findByPk(cursor, { attributes: ["id", "parentId"], transaction: transaction as Transaction })) as unknown as MenuNode | null;
    if (!node) {
      return; // a dangling ancestor ends the chain
    }
    cursor = node.parentId;
  }
};

// The menu-group fields an update may change, as the audit row records them.
const MENU_GROUP_FIELDS = ["name", "slug", "icon", "parentId", "sortOrder", "isActive"] as const;

// Maps a DB slug to its Next.js dashboard route.
const mapSlugToPath = (slug: string): string => {
  const customPaths: Record<string, string | undefined> = {
    // S7 / F6 (ADR-102): "Home" is the dashboard home, not the public landing
    // page — the menu never leaves the app. When Dashboard is also shown,
    // getRoleMenuAssignments keeps one entry per path.
    home: "/dashboard",
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

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 or missing sortOrder sorts as 0 */
// Formats one descendant node (sub-group or leaf item) into the frontend item
// shape. Recurses so a sub-group carries its own `items` (3-level menus).
const formatMenuItem = (node: MenuNode, isAssignedMap: AssignedMap): MenuItem => {
  const item: MenuItem = {
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
const formatMenuGroup = (group: MenuNode, isAssignedMap: AssignedMap = null): MenuItem => {
  const formatted: MenuItem = {
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
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

/** One level of the active-children include. */
interface ChildrenInclude {
  model: typeof MenuGroup;
  as: "children";
  where: { isActive: true };
  required: false;
  include?: ChildrenInclude[];
}

// Active-children include, reused at each nesting level.
const activeChildrenInclude = (nested?: ChildrenInclude): ChildrenInclude => {
  const include: ChildrenInclude = {
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
const fetchActiveParentGroups = (): Promise<MenuNode[]> =>
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

/** Load effectivePermission.service per call, as the JavaScript did. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required per call
const loadEffectivePermission = (): typeof EffectivePermissionModule => require("./effectivePermission.service") as typeof EffectivePermissionModule;

// ------------------------------------------------------------------
// LIST / FILTER MENU GROUPS (optionally annotated with role assignment)
// ------------------------------------------------------------------
const listMenuGroups = async (roleId?: string | null): Promise<MenuItem[]> => {
  let isAssignedMap: AssignedMap = null;
  if (roleId) {
    const assignments = (await RoleMenuPermission.findAll({ where: { roleId } })) as unknown as { menuGroupId: string }[];
    const map: Record<string, boolean> = {};
    assignments.forEach((a) => {
      map[a.menuGroupId] = true;
    });
    isAssignedMap = map;
  }

  const parentGroups = await fetchActiveParentGroups();
  return parentGroups.map((g) => formatMenuGroup(g, isAssignedMap));
};

// ------------------------------------------------------------------
// GET ROLE MENU ASSIGNMENTS (personalized menu for a role)
// ------------------------------------------------------------------
/**
 * ADR-102 — the sidebar shows an entry only when the API would serve its
 * page: the principal's EFFECTIVE permission (services/effectivePermission —
 * the function dynamicAccess checks: the role's grants inherited ONE level
 * down, replaced by the user's own overrides) grants `read` on the entry's
 * slug, and every gate its page's load call is behind passes
 * (constants/menuPageAccess). A group or sub-group is shown when at least one
 * entry below it is. Top-level entries that point at the same page (Home and
 * Dashboard) are shown once.
 *
 * This used to show a node when it OR ANY ANCESTOR was granted — a grant on
 * `management` showed every Management page, most of which the API refused —
 * and ignored per-user overrides (F1, F9 of docs/UI-UX/research/03).
 *
 * @param roleId - the role whose menu is resolved
 * @param requester - req.user. When it is a member of `roleId`, the menu is
 *   theirs (their overrides apply); otherwise (a super admin previewing
 *   another role) it is the role's own, without any user override.
 * @returns the menu tree
 */
const getRoleMenuAssignments = async (roleId: string, requester: MenuRequester | null = null): Promise<MenuItem[]> => {
  const effectivePermission = loadEffectivePermission();
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty roleId falls back to role.id
  const requesterRoleId = requester && (requester.roleId || requester.role?.id);
  let principal: PermissionPrincipal;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: ids compared as strings (a numeric id from a caller compares equal)
  if (requester && requesterRoleId && String(requesterRoleId) === String(roleId)) {
    principal = { id: requester.id, role: { ...requester.role, id: roleId } } as unknown as PermissionPrincipal;
  } else {
    const role = (await Role.findByPk(roleId, { attributes: ["id", "name", "roleLevel", "status"] })) as unknown as {
      id: string;
      name: string;
      roleLevel: number;
    } | null;
    if (!role) {
      return [];
    }
    principal = { role: { id: role.id, name: role.name, roleLevel: role.roleLevel } };
  }
  const sources = await effectivePermission.loadPermissionSources(principal);

  const parentGroups = await fetchActiveParentGroups();

  // A leaf is shown when its page is usable; a node with children when at
  // least one of them is shown.
  const buildNode = (node: MenuNode): MenuItem | null => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `node.children || []`
    const children = node.children || [];
    if (children.length === 0) {
      if (!effectivePermission.menuEntryVisible(principal, sources, node.slug)) {
        return null;
      }
      return {
        id: node.id,
        label: node.name,
        icon: node.icon,
        path: mapSlugToPath(node.slug),
        requiredPermission: undefined,
      };
    }

    const visibleChildren = children.map(buildNode).filter(Boolean) as MenuItem[];
    if (visibleChildren.length === 0) {
      return null;
    }
    return {
      id: node.id,
      label: node.name,
      icon: node.icon,
      path: mapSlugToPath(node.slug),
      requiredPermission: undefined,
      items: visibleChildren,
    };
  };

  const result: MenuItem[] = [];
  const topLevelPaths = new Set<string>();
  for (const group of parentGroups) {
    const built = buildNode(group);
    if (!built) {
      continue;
    }
    if (!built.items) {
      // A top-level link (Home, Dashboard, Warehouse, Stock): one per page.
      if (topLevelPaths.has(built.path)) {
        continue;
      }
      topLevelPaths.add(built.path);
    }

    result.push({
      id: group.id,
      label: group.name,
      icon: group.icon,
      path: mapSlugToPath(group.slug),
      sortOrder: group.sortOrder,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `built.items || []`
      items: built.items || [],
    });
  }

  return result;
};

/**
 * ADR-102 — the caller's effective permission on every active menu slug:
 * { superAdmin, permissions: { [slug]: "read" | "write" } }. The pages decide
 * their write actions from it (frontend usePermissions) — the same function
 * the API gate reads, never a list of role names.
 *
 * @param requester - req.user
 * @returns the caller's permissions
 */
const getMyPermissions = async (
  requester: MenuRequester,
): Promise<{ superAdmin: boolean; permissions: ReturnType<typeof EffectivePermissionModule.effectivePermissionMap> }> => {
  const effectivePermission = loadEffectivePermission();
  const principal = { id: requester.id, role: requester.role } as unknown as PermissionPrincipal;
  const sources = await effectivePermission.loadPermissionSources(principal);
  const menus = (await MenuGroup.findAll({ where: { isActive: true }, attributes: ["slug"] })) as unknown as { slug: string | null }[];
  const slugs = menus.map((m) => m.slug).filter(Boolean) as string[];
  return {
    superAdmin: sources.superAdmin,
    permissions: effectivePermission.effectivePermissionMap(sources, slugs),
  };
};

// ------------------------------------------------------------------
// ROLES FOR SELECTION
// ------------------------------------------------------------------
const getAvailableRoles = (): Promise<unknown[]> => Role.findAll({ order: [["sortOrder", "ASC"]] });

// ------------------------------------------------------------------
// CREATE MENU GROUP
// ------------------------------------------------------------------
const createMenuGroup = async (value: MenuGroupInput, actor: MenuActor = {}): Promise<MenuItem> => {
  const group = await db.transaction(async (transaction) => {
    // A-226: a parent that does not exist is 404, not a foreign-key 500.
    await assertMenuParentAllowed(null, value.parentId, transaction);
    const created = (await MenuGroup.create(
      {
        name: value.name,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty slug is derived from the name
        slug: value.slug || (value.name as string).toLowerCase().replace(/\s+/g, "-"),
        icon: value.icon,
        parentId: value.parentId,
        sortOrder: value.sortOrder,
        isActive: value.isActive,
      } as unknown as CreationAttributes<InstanceType<typeof MenuGroup>>,
      { transaction },
    )) as unknown as MenuNode;
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
const updateMenuGroup = async (value: MenuGroupInput, actor: MenuActor = {}): Promise<MenuItem> => {
  const group = (await MenuGroup.findByPk(value.id)) as unknown as
    | (MenuNode & Record<string, unknown> & { update(values: object, options: object): Promise<unknown> })
    | null;
  if (!group) {
    throw new AppError(404, "Menu group not found");
  }

  // Read before the update: the instance is mutated in place. The audit row
  // records the fields the caller sent, before and after.
  const sent = MENU_GROUP_FIELDS.filter((key) => value[key] !== undefined);
  const before = Object.fromEntries(sent.map((key) => [key, group[key] ?? null]));
  const after = Object.fromEntries(sent.map((key) => [key, value[key]]));

  await db.transaction(async (transaction) => {
    // A-226: never itself or one of its descendants.
    await assertMenuParentAllowed(group.id, value.parentId, transaction);
    await group.update(
      {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: only `undefined` keeps the stored value (a null is written)
        name: value.name !== undefined ? value.name : group.name,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: as above
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
 * @param menuGroupId - the group
 * @param actor - auditActor(req)
 * @throws {AppError} 404 when the group does not exist; 409 when it has children
 */
const deleteMenuGroup = async (menuGroupId: string, actor: MenuActor = {}): Promise<void> => {
  const group = (await MenuGroup.findByPk(menuGroupId)) as unknown as
    | (MenuNode & { destroy(options: object): Promise<unknown> })
    | null;
  if (!group) {
    throw new AppError(404, "Menu group not found");
  }

  // A-173: the grants and the group go in ONE transaction with the audit row
  // — before, each was its own autocommit, and a failure part-way left the
  // group in place with its grants already gone.
  await db.transaction(async (transaction) => {
    const children = (await MenuGroup.findAll({
      where: { parentId: menuGroupId },
      attributes: ["id", "name"],
      transaction,
    })) as unknown as { id: string; name: string }[];
    if (children.length > 0) {
      throw new AppError(
        409,
        `Menu group "${group.name}" still has ${String(children.length)} child menu(s) (${children
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
 * @param transaction - the change's transaction
 * @param actor - auditActor(req)
 * @param roleId - the role
 * @param changes - what changed
 * @returns logAction's answer
 */
const auditGrantChange = (transaction: Transaction, actor: MenuActor, roleId: string, changes: Record<string, unknown>): Promise<unknown> =>
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
 * @param params - `{ roleId, menuGroupId }`
 * @param actor - auditActor(req)
 * @returns the grant
 */
const assignMenuToRole = async (
  { roleId, menuGroupId }: { roleId: string; menuGroupId: string },
  actor: MenuActor = {},
): Promise<unknown> => {
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
      defaults: { permissionType: "read" } as unknown as CreationAttributes<InstanceType<typeof RoleMenuPermission>>,
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
const revokeMenuFromRole = async (
  { roleId, menuGroupId }: { roleId: string; menuGroupId: string },
  actor: MenuActor = {},
): Promise<void> => {
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
 * @param roleId - the role
 * @param menuGroupIds - the menus
 * @param actor - auditActor(req)
 * @returns what was granted, already granted, and not found
 */
const bulkAssign = async (
  roleId: string,
  menuGroupIds: readonly string[],
  actor: MenuActor = {},
): Promise<{ assigned: string[]; alreadyAssigned: string[]; failed: { menuGroupId: string; error: string }[] }> => {
  const role = await Role.findByPk(roleId);
  if (!role) {
    throw new AppError(404, "Role not found");
  }

  const existing = (await MenuGroup.findAll({
    where: { id: menuGroupIds },
    attributes: ["id"],
  })) as unknown as { id: string }[];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: ids compared as strings
  const existingIds = new Set(existing.map((group) => String(group.id)));

  const assigned: string[] = [];
  const alreadyAssigned: string[] = [];
  const failed: { menuGroupId: string; error: string }[] = [];

  await db.transaction(async (transaction) => {
    for (const menuGroupId of menuGroupIds) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: ids compared as strings
      if (!existingIds.has(String(menuGroupId))) {
        failed.push({ menuGroupId, error: "Menu group not found" });
        continue;
      }
      const [, created] = await RoleMenuPermission.findOrCreate({
        where: { roleId, menuGroupId },
        defaults: { permissionType: "read" } as unknown as CreationAttributes<InstanceType<typeof RoleMenuPermission>>,
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
 * @param roleId - the role
 * @param menuGroupIds - the menus
 * @param actor - auditActor(req)
 * @returns what was revoked and what was not granted
 */
const bulkRevoke = async (
  roleId: string,
  menuGroupIds: readonly string[],
  actor: MenuActor = {},
): Promise<{ revoked: string[]; notFound: string[] }> => {
  const revoked: string[] = [];
  const notFound: string[] = [];

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

// The exported object, its keys in the JavaScript's order (`exports.x = …`);
// mapSlugToPath and formatMenuGroup are exported for reuse/testing.
export = {
  assertMenuParentAllowed,
  listMenuGroups,
  getRoleMenuAssignments,
  getMyPermissions,
  getAvailableRoles,
  createMenuGroup,
  updateMenuGroup,
  deleteMenuGroup,
  assignMenuToRole,
  revokeMenuFromRole,
  bulkAssign,
  bulkRevoke,
  mapSlugToPath,
  formatMenuGroup,
};
