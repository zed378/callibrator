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
 *
 * P9-12 (ADR-087 Amendment 13): converted from userPermission.service.js with
 * no behaviour change. `export =` keeps the exact object `require()` returned.
 */

import type { InferCreationAttributes, Transaction } from "sequelize";

import models from "../models";
import redis from "./redis.service";
import { AppError } from "../utils/appError.util";
import auditService from "./audit.service";
import { db } from "../config";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const {
  User,
  Role,
  MenuGroup,
  RoleMenuPermission,
  UserMenuPermission,
} = models;
const { get, set, del, cacheKeys } = redis;

type MenuRow = ModelInstance<"MenuGroup">;
type RoleMenuPermissionRow = ModelInstance<"RoleMenuPermission">;

/** Who is acting, as the controllers pass it (every member may be absent). */
interface PermissionActor {
  /** P9-20: widened to what auditActor(req) returns (type-only; the value is only ever written to the audit row). */
  userId?: string | null;
  tenantId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | readonly string[] | null;
}

/**
 * A-41 — a per-user override grants or REVOKES access, so it writes its audit
 * row inside the same transaction as the change
 * (MEMORY/specs/A-41-audit-inside-transaction.md, rows 23-24). Recorded under
 * the target user's tenant, falling back to the actor's (BR-A41-4).
 */
const auditOverride = (
  transaction: Transaction,
  {
    userId,
    tenantId,
    actor,
    grantedBy,
    changes,
  }: {
    userId: UserId;
    tenantId: TenantId | null | undefined;
    actor: PermissionActor;
    grantedBy: string | null | undefined;
    changes: Record<string, unknown>;
  },
): Promise<unknown> =>
  auditService.logAction(
    {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
      tenantId: tenantId || actor.tenantId,
      userId: grantedBy,
      action: "UPDATE",
      resourceType: "User",
      resourceId: userId,
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    },
    { transaction },
  );

const CACHE_TTL_SECONDS = 300;

/** A menu group as the permission views show it. */
interface FormattedMenu {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  parentId: string | null;
}

const formatMenu = (menu: MenuRow | null | undefined): FormattedMenu | null =>
  menu
    ? {
      id: menu.id,
      name: menu.name,
      slug: menu.slug,
      icon: menu.icon,
      parentId: menu.parentId,
    }
    : null;

/** One menu group's resolved permission. */
interface EffectivePermission {
  menuGroupId: string;
  menu: FormattedMenu | null;
  /** "read" | "write" | null (no access) */
  permissionType: string | null;
  /** "role" | "custom" | null */
  source: "role" | "custom" | null;
  rolePermission: string | null;
  override: string | null;
}

/** getUserPermissions' response (the service's own envelope). */
interface UserPermissionsResponse {
  success: true;
  status: 200;
  message: string;
  data: {
    user: {
      id: string;
      username: string;
      firstName: string;
      lastName: string;
      email: string;
      tenantId: TenantId | null;
      role: { id: string; name: string; nameToShow: string | null } | null;
    };
    rolePermissions: { menuGroupId: string; menu: FormattedMenu | null; permissionType: string }[];
    overrides: { menuGroupId: string; menu: FormattedMenu | null; permissionType: string; notes: string | null }[];
    effective: EffectivePermission[];
  };
}

/**
 * Full permission picture for one user: role perms, custom overrides,
 * and the resolved effective list.
 */
const getUserPermissions = async (userId: UserId): Promise<UserPermissionsResponse> => {
  const user = await User.findByPk(userId, {
    attributes: ["id", "username", "firstName", "lastName", "email", "tenantId"],
    include: [
      {
        model: Role,
        as: "role",
        attributes: ["id", "name", "nameToShow", "status"],
        // LEFT JOIN (A-90): a user with no role, or a soft-deleted one, is
        // still a user — `user.role` is read as optional below. Without this
        // Role's defaultScope made the join INNER and the user a 404.
        required: false,
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
      : Promise.resolve<RoleMenuPermissionRow[]>([]),
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
  const effective = menus.map((menu): EffectivePermission => {
    const override = overrideMap.get(menu.id);
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
    const fromRole = roleMap.get(menu.id) || null;
    let permissionType: string | null = fromRole;
    let source: "role" | "custom" | null = fromRole ? "role" : null;
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

/** setUserPermission's response. */
interface SetPermissionResponse {
  success: true;
  status: 200 | 201;
  message: string;
  data: ModelInstance<"UserMenuPermission">;
}

/**
 * Upsert a custom permission override for a user.
 * permissionType: "read" | "write" | "none" (explicit deny).
 */
const setUserPermission = async (
  userId: UserId,
  menuGroupId: string,
  permissionType: string,
  grantedBy: UserId | null = null,
  notes: string | null = null,
  actor: PermissionActor = {},
): Promise<SetPermissionResponse> => {
  if (!["read", "write", "none"].includes(permissionType)) {
    throw new AppError(
      400,
      "permissionType must be one of: read, write, none",
    );
  }

  const user = await User.findByPk(userId, { attributes: ["id", "tenantId"] });
  if (!user) {
    throw new AppError(404, "User not found");
  }
  const menu = await MenuGroup.findByPk(menuGroupId, { attributes: ["id"] });
  if (!menu) {
    throw new AppError(404, "Menu group not found");
  }

  const { perm, created } = await db.transaction(async (transaction) => {
    const defaults = { permissionType, grantedBy, notes };
    const [override, wasCreated] = await UserMenuPermission.findOrCreate({
      where: { userId, menuGroupId },
      // Sequelize fills userId and menuGroupId from `where` when it creates; its typings want them here too.
      defaults: defaults as InferCreationAttributes<ModelInstance<"UserMenuPermission">>,
      transaction,
    });
    const previous = wasCreated ? null : override.permissionType;
    if (!wasCreated) {
      await override.update({ permissionType, grantedBy, notes }, { transaction });
    }
    await auditOverride(transaction, {
      userId,
      tenantId: user.tenantId,
      actor,
      grantedBy,
      changes: {
        operation: "SET_PERMISSION_OVERRIDE",
        menuGroupId,
        before: { permissionType: previous },
        after: { permissionType, notes },
      },
    });
    return { perm: override, created: wasCreated };
  });

  // After the commit (see roles.service.js#auditAccessChange).
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
const removeUserPermission = async (
  userId: UserId,
  menuGroupId: string,
  actor: PermissionActor = {},
): Promise<{ success: true; status: 200; message: string; data: null }> => {
  const user = await User.findByPk(userId, { attributes: ["id", "tenantId"] });
  await db.transaction(async (transaction) => {
    const removed = await UserMenuPermission.destroy({
      where: { userId, menuGroupId },
      transaction,
    });
    // Nothing removed, nothing changed — and nothing to attribute.
    if (removed > 0) {
      await auditOverride(transaction, {
        userId,
        // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `user && user.tenantId`
        tenantId: user && user.tenantId,
        actor,
        grantedBy: actor.userId,
        changes: {
          operation: "REMOVE_PERMISSION_OVERRIDE",
          menuGroupId,
          before: { overridden: true },
          after: { overridden: false },
        },
      });
    }
  });
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
 *   { [menuName]: "read" | "write" | "none", [menuSlug]: same }
 * Used by the dynamicAccess middleware.
 *
 * A-35. This used to be keyed by menu NAME only — `matrix[p.menu.name]`, e.g.
 * "Warehouse" — while `dynamicAccess` looks the override up by whatever the
 * route passed, which is always a lowercase SLUG ("warehouse"). The lookup
 * therefore never matched and every per-user override silently did nothing,
 * including a `none` override, which is a REVOCATION: an administrator who
 * revoked a user's access to a menu was told it worked, and it did not.
 *
 * roles.service.js#getRolePermissionsMatrix already indexes by both name and
 * slug; this now does the same, so either key resolves.
 */
const getUserOverrideMatrix = async (userId: UserId): Promise<Record<string, string>> => {
  const cacheKey = cacheKeys.userPermissions(userId);
  const cached = await get(cacheKey);
  if (cached) {
    // What this function cached below: the matrix.
    return cached as Record<string, string>;
  }

  const overrides = await UserMenuPermission.findAll({
    where: { userId },
    include: [{ model: MenuGroup, as: "menu", attributes: ["name", "slug"] }],
  });

  const matrix: Record<string, string> = {};
  for (const p of overrides) {
    if (p.menu?.name) {
      matrix[p.menu.name] = p.permissionType;
    }
    if (p.menu?.slug) {
      matrix[p.menu.slug] = p.permissionType;
    }
  }

  await set(cacheKey, matrix, CACHE_TTL_SECONDS);
  return matrix;
};

export = {
  getUserPermissions,
  setUserPermission,
  removeUserPermission,
  getUserOverrideMatrix,
};
