/**
 * Roles Service - Simplified RBAC with Read/Write Permissions
 *
 * Architecture:
 * - Roles have read or write permissions on menu groups via RoleMenuPermission
 * - Users have a direct role_id foreign key (no ABAC)
 * - Permission check: hasPermission(userId, menuSlug, permissionType)
 * - All roles are global (not tenant-scoped)
 *
 * P9-12 (ADR-087 Amendment 13): converted from roles.service.js with no
 * behaviour change. `export =` keeps `require()` returning the class itself.
 * The compiler exposed three defects (A-285 `role.is_system`, A-286 `is_system`
 * on create, A-287 `sort_order` / `is_active` on menus). They were kept as
 * built by the conversion (ADR-038 rule 3) and fixed in their own change,
 * with roles.attributes.a285.test.ts proving each on the real models.
 */
import { Op, type InferAttributes, type InferCreationAttributes, type Transaction, type WhereOptions } from "sequelize";

import models from "../models";
import redis from "./redis.service";
import { ROLE_LEVELS } from "../constants";
import auditService from "./audit.service";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { db } from "../config";
// A-132: status-carrying errors are AppErrors, so production shows their
// message (fileValidation.util#isExposableError). `statusCode` is kept too.
import { AppError } from "../utils/appError.util";
import type { AuditAction } from "../constants/auditActions";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { Role, RoleMenuPermission, MenuGroup, User } = models;
const { get, set, del, delPattern, cacheKeys } = redis;

type RoleRow = ModelInstance<"Role">;
type MenuRow = ModelInstance<"MenuGroup">;
type RoleMenuPermissionRow = ModelInstance<"RoleMenuPermission">;
type UserRow = ModelInstance<"User">;

/** An AppError that also carries the legacy `statusCode` (kept, A-132). */
type StatusError = AppError & { statusCode?: number };

/** Who is acting, as the controllers pass it (utils/auditActor; every member may be absent). */
interface AccessActor {
  userId?: string | null;
  /** F-19 (ADR-105): the caller's own level — a role change may not grant above it. */
  roleLevel?: number | null;
  tenantId?: TenantId | string | null;
  ipAddress?: string | null;
  // `string[]`: auditActor reads the raw user-agent header, which Node types as
  // possibly repeated (P9-20: a type-only widening; nothing emitted changes).
  userAgent?: string | string[] | null;
}

/** The row auditAccessChange writes, beside the actor. */
interface AccessChange {
  tenantId: TenantId | string | null | undefined;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  changes: Record<string, unknown>;
}

/**
 * A-41 — a role or grant change decides who may do what, so each one writes
 * its audit row inside the SAME transaction as the change
 * (MEMORY/specs/A-41-audit-inside-transaction.md, rows 16-22). A failed audit
 * insert is re-thrown by logAction and rolls the change back.
 *
 * BR-A41-4, as amended by A-125 (ADR-051 Q-14, F-7) — roles are global, but
 * audit_logs.tenantId is NOT NULL: a change to a role or its grants is a
 * platform operation, and each such call passes `tenantId: PLATFORM_TENANT_ID`
 * — the reserved PLATFORM tenant — no longer the ACTOR's home tenant, which for the
 * seeded super admin is a hospital whose admins could read it. A change to a
 * user's role is recorded under that USER's tenant, falling back to the
 * actor's. If neither resolves the insert fails and the change is refused
 * (fail-closed).
 *
 * Cache invalidation runs after the commit, never inside the transaction:
 * invalidating before the commit lets a concurrent request re-cache the old
 * matrix for the full TTL.
 *
 * @param transaction - the change's transaction
 * @param actor - { userId, tenantId, ipAddress, userAgent }
 * @param row - { tenantId?, action, resourceType, resourceId, changes }
 * @returns logAction's result
 */
const auditAccessChange = (
  transaction: Transaction,
  actor: AccessActor,
  { tenantId, action, resourceType, resourceId, changes }: AccessChange,
): Promise<unknown> =>
  auditService.logAction(
    {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
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

/**
 * A grant's permission type. `permission_type` is not a RoleMenuPermission
 * attribute (the attribute is `permissionType`), so the fallback never has a
 * value on a model row; it is kept as built.
 */
const permissionTypeOf = (p: RoleMenuPermissionRow): string | undefined =>
  p.permissionType || (p as { permission_type?: string }).permission_type;

/** A menu grant as getRoleMenus / getUserMenus report it. */
interface MenuGrant {
  menu: MenuRow | undefined;
  permissionType: string | undefined;
  permission_type: string | undefined;
}

/** The fields createRole takes (`| undefined`: the controller passes each as it has it; P9-20, type-only). */
interface CreateRoleInput {
  name: string;
  nameToShow?: string | null | undefined;
  description?: string | null | undefined;
  is_system?: boolean | undefined;
  roleLevel?: unknown;
  status?: string | undefined;
}

/** The fields updateRole changes. */
interface UpdateRoleInput {
  name?: string | undefined;
  nameToShow?: string | null | undefined;
  description?: string | null | undefined;
  roleLevel?: unknown;
  status?: string | undefined;
}

/** F-19: a display name trimmed, and blank stored as no display name. */
const blankToNull = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * F-19 (ADR-105): the highest level `actor` may give a role — the tenant-admin
 * cap (ADR-043), and never above the caller's own level when it is known.
 */
const levelCeiling = (actor: AccessActor): number =>
  typeof actor.roleLevel === "number" && actor.roleLevel > 0
    ? Math.min(MAX_TENANT_ROLE_LEVEL, actor.roleLevel)
    : MAX_TENANT_ROLE_LEVEL;

/** The filters getAllRoles / getAllMenus take. */
interface ListFilters {
  status?: string;
  is_system?: boolean | null;
  is_active?: boolean | null;
  limit?: number;
  offset?: number;
  search?: string;
}

/** A page of rows, as getAllRoles / getAllMenus return it. */
interface ListPage<Row> {
  data: Row[];
  count: number;
  page: number;
  limit: number;
}

/** The fields createMenu / updateMenu take (the API names). */
interface MenuInput {
  name: string;
  slug?: string | null;
  icon?: string | null;
  parent_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

/** menuGroup.service's parent check (loaded lazily, as the JavaScript did). */
interface MenuGroupParentCheck {
  assertMenuParentAllowed: (
    menuId: string | null,
    parentId: string | null | undefined,
    transaction: Transaction,
  ) => Promise<void>;
}

/** Load menuGroup.service when it is first needed, as the JavaScript did. */
const menuGroupService = (): MenuGroupParentCheck =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: a lazy require
  require("./menuGroup.service") as MenuGroupParentCheck;

/** Adds `permType` under `key` once (the matrix lists each type once per key). */
const grant = (matrix: Record<string, (string | undefined)[]>, key: string, permType: string | undefined): void => {
  let list = matrix[key];
  if (!list) {
    list = [];
    matrix[key] = list;
  }
  if (!list.includes(permType)) {
    list.push(permType);
  }
};

/** A-331 (ADR-100 Amendment 4): what POST /roles/assign answers — no credential attribute. */
interface AssignedUser {
  id: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tenantId: string | null;
  roleId: string | null;
  status: string | null;
  isActive: boolean | null;
}

/** The named projection of a user row that a role assignment answers with. */
const assignedUserView = (user: UserRow): AssignedUser => ({
  id: user.id,
  username: user.username,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  tenantId: user.tenantId ?? null,
  roleId: user.roleId,
  status: user.status,
  isActive: user.isActive ?? null,
});

// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- as built: `require()` returns this class and callers use its statics
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
   * @param input - role fields
   * @param actor - who, from where (A-41)
   * @returns the created role
   */
  static async createRole(
    { name, nameToShow, description, is_system = false, roleLevel, status = "active" }: CreateRoleInput,
    actor: AccessActor = {},
  ): Promise<RoleRow> {
    const requested = Number.isInteger(roleLevel) ? (roleLevel as number) : 1;
    const level = Math.min(Math.max(requested, 1), levelCeiling(actor));

    return db.transaction(async (transaction) => {
      const values = {
        name: name.trim(),
        // F-19 (ADR-105): the display name and the starting status the dialog offers.
        nameToShow: blankToNull(nameToShow),
        description: description?.trim(),
        // A-286: the attribute (it was `is_system`, which Sequelize dropped).
        isSystem: is_system,
        roleLevel: level,
        status,
      };
      // As built: `description` is undefined when none is given.
      const role = await Role.create(values as InferCreationAttributes<RoleRow>, { transaction });
      await auditAccessChange(transaction, actor, {
        tenantId: PLATFORM_TENANT_ID, // A-125: a global role is a platform operation
        action: "CREATE",
        resourceType: "Role",
        resourceId: role.id,
        changes: {
          operation: "CREATE_ROLE",
          before: {},
          after: { name: role.name, nameToShow: values.nameToShow, roleLevel: level, is_system, status },
        },
      });
      return role;
    });
  }

  /**
   * Get role by ID
   */
  static async getRoleById(id: string): Promise<RoleRow | null> {
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
  static async getRoleByName(name: string): Promise<RoleRow | null> {
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
  }: ListFilters = {}): Promise<ListPage<RoleRow>> {
    // Keys are attribute or column names (`is_system` is the column), as built.
    const where: Record<string | symbol, unknown> = {};

    if (status !== "all") {
      where["status"] = status;
    }

    if (is_system !== null) {
      where["is_system"] = is_system;
    }

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const result = await Role.findAndCountAll({
      where: where as WhereOptions<InferAttributes<RoleRow>>,
      order: [
        ["sort_order", "ASC"],
        ["created_at", "ASC"],
        ["id", "ASC"],
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
  static async updateRole(
    id: string,
    { name, nameToShow, description, roleLevel, status }: UpdateRoleInput,
    actor: AccessActor = {},
  ): Promise<RoleRow> {
    const role = await Role.findByPk(id);
    if (!role) {
      const error: StatusError = new AppError(404, "Role not found");
      error.statusCode = 404;
      throw error;
    }

    // A-285: the attribute (it read `is_system`, always undefined, so this never fired).
    if (role.isSystem && status === "deleted") {
      const error: StatusError = new AppError(403, "System roles cannot be deleted");
      error.statusCode = 403;
      throw error;
    }

    // F-19 (ADR-105): a level change is a privilege change. A system role's level
    // is what the seeded gates were built around, so it is fixed (409, a state,
    // not a permission); any other role stays within [1, ceiling] — the
    // validator already refuses above 8, this refuses above the caller.
    if (roleLevel !== undefined && roleLevel !== null) {
      const requested = Number(roleLevel);
      if (role.isSystem && requested !== role.roleLevel) {
        throw new AppError(
          409,
          `"${role.name}" is a system role; its level (${String(role.roleLevel)}) is fixed and cannot be changed`,
        );
      }
      if (!Number.isInteger(requested) || requested < 1 || requested > levelCeiling(actor)) {
        throw new AppError(403, `A role's level may not exceed ${String(levelCeiling(actor))}`);
      }
    }

    const updates: { name?: string; nameToShow?: string | null; description?: string | undefined; roleLevel?: number; status?: string } = {};
    if (name !== undefined) {updates.name = name.trim();}
    if (nameToShow !== undefined) {updates.nameToShow = blankToNull(nameToShow);}
    if (description !== undefined) {updates.description = description?.trim();}
    if (roleLevel !== undefined && roleLevel !== null && Number(roleLevel) !== role.roleLevel) {
      updates.roleLevel = Number(roleLevel);
    }
    if (status !== undefined) {updates.status = status;}

    const before = Object.fromEntries(
      (Object.keys(updates) as (keyof typeof updates)[]).map((key) => [key, role[key]]),
    );
    await db.transaction(async (transaction) => {
      // As built: `description` may be undefined (a null description trims to nothing).
      await role.update(updates as Partial<InferAttributes<RoleRow>>, { transaction });
      await auditAccessChange(transaction, actor, {
        tenantId: PLATFORM_TENANT_ID, // A-125: a global role is a platform operation
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
  static async deleteRole(id: string, actor: AccessActor = {}): Promise<{ message: string }> {
    const role = await Role.findByPk(id);
    if (!role) {
      const error: StatusError = new AppError(404, "Role not found");
      error.statusCode = 404;
      throw error;
    }

    // Both branches revoke everything the role granted, so both drop the
    // cached matrix that dynamicAccess and abac read on every gated request.
    // Without this a deleted or deactivated role kept granting for the rest
    // of the 3600 s TTL, on every replica (W-11).
    // A-285: the attribute (it read `is_system`, so a system role was destroyed below).
    if (role.isSystem) {
      // Deactivate instead of delete for system roles
      await db.transaction(async (transaction) => {
        await role.update({ status: "inactive" }, { transaction });
        const revokedGrants = await RoleMenuPermission.destroy({
          where: { roleId: id },
          transaction,
        });
        await auditAccessChange(transaction, actor, {
          tenantId: PLATFORM_TENANT_ID, // A-125: a global role is a platform operation
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
        tenantId: PLATFORM_TENANT_ID, // A-125: a global role is a platform operation
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
   * @param roleId - Role ID
   * @param menuGroupId - Menu Group ID
   * @param permissionType - "read" or "write"
   * @param actor - who, from where (A-41)
   * @returns the grant
   */
  static async assignMenuToRole(
    roleId: string,
    menuGroupId: string,
    permissionType = "read",
    actor: AccessActor = {},
  ): Promise<RoleMenuPermissionRow> {
    const role = await Role.findByPk(roleId);
    if (!role) {
      const error: StatusError = new AppError(404, "Role not found");
      error.statusCode = 404;
      throw error;
    }

    const menu = await MenuGroup.findByPk(menuGroupId);
    if (!menu) {
      const error: StatusError = new AppError(404, "Menu group not found");
      error.statusCode = 404;
      throw error;
    }

    const permission = await db.transaction(async (transaction) => {
      const defaults = { permissionType: permissionType };
      const [grantRow, created] = await RoleMenuPermission.findOrCreate({
        where: { roleId: roleId, menuGroupId: menuGroupId },
        // Sequelize fills roleId and menuGroupId from `where` when it creates; its typings want them here too.
        defaults: defaults as InferCreationAttributes<RoleMenuPermissionRow>,
        transaction,
      });
      const previous = created ? null : grantRow.permissionType;

      if (!created) {
        await grantRow.update({ permissionType: permissionType }, { transaction });
      }

      await auditAccessChange(transaction, actor, {
        tenantId: PLATFORM_TENANT_ID, // A-125: a global role is a platform operation
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
      return grantRow;
    });

    // Invalidate role permissions cache (after the commit)
    await del(cacheKeys.permissions(roleId));

    return permission;
  }

  /**
   * Remove menu permission from role
   */
  static async removeMenuFromRole(
    roleId: string,
    menuGroupId: string,
    actor: AccessActor = {},
  ): Promise<{ message: string }> {
    await db.transaction(async (transaction) => {
      const removed = await RoleMenuPermission.destroy({
        where: { roleId: roleId, menuGroupId: menuGroupId },
        transaction,
      });
      // Nothing removed, nothing changed — and nothing to attribute.
      if (removed > 0) {
        await auditAccessChange(transaction, actor, {
          tenantId: PLATFORM_TENANT_ID, // A-125: a global role is a platform operation
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
  static async getRoleMenus(roleId: string): Promise<MenuGrant[]> {
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
      permissionType: permissionTypeOf(p),
      permission_type: permissionTypeOf(p),
    }));
  }

  /**
   * Check if user has specific permission on a menu
   *
   * @param userId - User ID
   * @param menuSlug - Menu slug to check
   * @param permissionType - "read" or "write"
   * @returns True if user has the permission
   */
  static async hasPermission(userId: string, menuSlug: string, permissionType = "read"): Promise<boolean> {
    const slugsToCheck = [menuSlug];
    try {
      const targetMenu = await MenuGroup.findOne({ where: { slug: menuSlug } });
      // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `targetMenu && targetMenu.parentId`
      if (targetMenu && targetMenu.parentId) {
        const parent = await MenuGroup.findByPk(targetMenu.parentId);
        // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `parent && parent.slug`
        if (parent && parent.slug) {
          slugsToCheck.push(parent.slug);
        }
      }
    } catch {
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
          required: true, // D-12: stated, not inherited from the defaultScope
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

    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `!user || !user.role`
    if (!user || !user.role || user.role.status !== "active") {
      return false;
    }

    const perm = user.role.permissions?.[0];
    if (!perm) {
      return false;
    }

    const type = permissionTypeOf(perm);
    if (permissionType === "write") {
      return type === "write";
    }

    // For read permission, both read and write roles qualify
    return (["read", "write"] as (string | undefined)[]).includes(type);
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
   * @param roleId - the role
   * @returns menu name/slug → permission types
   */
  static async getRolePermissionsMatrix(roleId: string): Promise<Record<string, (string | undefined)[]>> {
    const cacheKey = cacheKeys.permissions(roleId);
    const cached = await get(cacheKey);
    // What this function cached below: the matrix.
    if (cached) {return cached as Record<string, (string | undefined)[]>;}

    const role = await Role.findByPk(roleId, { attributes: ["id", "status"] });
    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `!role || role.status`
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

    const matrix: Record<string, (string | undefined)[]> = {};
    for (const p of permissions) {
      if (!p.menu) {continue;}
      const name = p.menu.name;
      const slug = p.menu.slug;
      const permType = permissionTypeOf(p);

      grant(matrix, name, permType);

      if (slug) {
        grant(matrix, slug, permType);
      }

      // Inherit permission to all children if parent is assigned
      if (p.menu.children && p.menu.children.length > 0) {
        for (const child of p.menu.children) {
          const childName = child.name;
          const childSlug = child.slug;

          grant(matrix, childName, permType);

          if (childSlug) {
            grant(matrix, childSlug, permType);
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
  static async getUserMenus(userId: string): Promise<MenuGrant[]> {
    const user = await User.findByPk(userId, {
      include: [
        // INNER JOIN on purpose (A-90): a user whose role is soft-deleted has
        // no menus. `!user || !user.role` below returns [] either way.
        {
          model: Role,
          as: "role",
          attributes: [],
          required: true, // D-12: stated, not inherited from the defaultScope
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

    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `!user || !user.role`
    if (!user || !user.role) {
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
    const permissions = user.role.permissions || [];

    return permissions
      .filter((p) => p.menu)
      .map((p) => ({
        menu: p.menu,
        permissionType: permissionTypeOf(p),
        permission_type: permissionTypeOf(p),
      }));
  }

  /**
   * Assign role to user
   */
  static async assignRoleToUser(userId: string, roleId: string, actor: AccessActor = {}): Promise<AssignedUser> {
    const user = await User.findByPk(userId);
    if (!user) {
      const error: StatusError = new AppError(404, "User not found");
      error.statusCode = 404;
      throw error;
    }

    const role = await Role.findByPk(roleId);
    if (!role) {
      const error: StatusError = new AppError(404, "Role not found");
      error.statusCode = 404;
      throw error;
    }

    if (role.status !== "active") {
      const error: StatusError = new AppError(400, "Cannot assign inactive role");
      error.statusCode = 400;
      throw error;
    }

    // The ATTRIBUTE (A-148): `role_id` was a duplicate attribute the Role
    // association added; it is gone, and assigning to it would save nothing.
    const previousRoleId = user.roleId;
    await db.transaction(async (transaction) => {
      user.roleId = roleId;
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

    // A-331 (ADR-100 Amendment 4): the answer is a named projection, never the
    // row. `return user` serialised the whole User — the bcrypt hash, the MFA
    // seed envelopes, the recovery codes, the OTP and the WebAuthn columns.
    return assignedUserView(user);
  }

  /**
   * Remove role from user
   */
  static async removeRoleFromUser(userId: string, actor: AccessActor = {}): Promise<{ message: string }> {
    const user = await User.findByPk(userId);
    if (!user) {
      const error: StatusError = new AppError(404, "User not found");
      error.statusCode = 404;
      throw error;
    }

    const previousRoleId = user.roleId;
    await db.transaction(async (transaction) => {
      user.roleId = null;
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
    // `status` is accepted and unused, as built.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- as built: destructured, never read
    status: _status = "all",
    is_active = null,
    limit = 100,
    offset = 0,
    search = "",
  }: ListFilters = {}): Promise<ListPage<MenuRow>> {
    // Keys are attribute or column names (`is_active` is the column), as built.
    const where: Record<string | symbol, unknown> = {};

    if (is_active !== null) {
      where["is_active"] = is_active;
    }

    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { slug: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const result = await MenuGroup.findAndCountAll({
      where: where as WhereOptions<InferAttributes<MenuRow>>,
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
        ["id", "ASC"],
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
  static async getMenuById(id: string): Promise<MenuRow | null> {
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
   * A-165 — a menu group is global (no tenant), and it is what every role
   * grant points at: creating a child inherits its parent's grants, and
   * deleting one revokes every grant on it. Each change is a platform
   * operation, so it writes its audit row under the reserved PLATFORM tenant
   * inside the SAME transaction as the change (A-41, ADR-051 Q-14). A failed
   * audit insert is re-thrown by logAction and rolls the change back. Cache
   * invalidation runs after the commit.
   */

  /**
   * Create menu group
   * @param data - menu fields
   * @param actor - who, from where (A-41)
   * @returns the created menu group
   */
  static async createMenu(data: MenuInput, actor: AccessActor = {}): Promise<MenuRow> {
    const menu = await db.transaction(async (transaction) => {
      // A-271: a parent that does not exist is 404, not a foreign-key 500.
      await menuGroupService().assertMenuParentAllowed(null, data.parent_id, transaction);
      const values = {
        name: data.name.trim(),
        slug:
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
            data.slug?.trim() ||
            data.name.trim().toLowerCase().replace(/\s+/g, "-"),
        icon: data.icon,
        // The ATTRIBUTE (A-148): `parent_id` is no longer an attribute of
        // MenuGroup, and Sequelize would drop it. The API field stays
        // `parent_id`.
        parentId: data.parent_id,
        // A-287: the attributes (it wrote `sort_order` / `is_active`, which Sequelize dropped).
        /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: `||`, and a null is_active kept (not `??`) */
        sortOrder: data.sort_order || 0,
        isActive: data.is_active !== undefined ? data.is_active : true,
        /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      };
      // As built: `icon` and `parentId` are undefined when not given.
      const created = await MenuGroup.create(values as InferCreationAttributes<MenuRow>, { transaction });
      await auditAccessChange(transaction, actor, {
        tenantId: PLATFORM_TENANT_ID, // A-165: a global menu is a platform operation
        action: "CREATE",
        resourceType: "MenuGroup",
        resourceId: created.id,
        changes: {
          operation: "CREATE_MENU",
          before: {},
          after: {
            name: created.name,
            slug: created.slug,
            parent_id: created.parentId ?? null,
            is_active: created.isActive, // A-287: the attribute (it read `is_active`, always undefined)
          },
        },
      });
      return created;
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
   * @param id - the menu group
   * @param data - fields to change
   * @param actor - who, from where (A-41)
   * @returns the updated menu group
   */
  static async updateMenu(id: string, data: Partial<MenuInput>, actor: AccessActor = {}): Promise<MenuRow> {
    const menu = await MenuGroup.findByPk(id);
    if (!menu) {
      const error: StatusError = new AppError(404, "Menu group not found");
      error.statusCode = 404;
      throw error;
    }

    const updates: {
      name?: string;
      slug?: string | undefined;
      icon?: string | null | undefined;
      parentId?: string | null | undefined;
      sortOrder?: number | undefined;
      isActive?: boolean | undefined;
    } = {};
    if (data.name !== undefined) {updates.name = data.name.trim();}
    if (data.slug !== undefined)
    {updates.slug =
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
        data.slug?.trim() ||
        data.name?.trim().toLowerCase().replace(/\s+/g, "-");}
    if (data.icon !== undefined) {updates.icon = data.icon;}
    if (data.parent_id !== undefined) {updates.parentId = data.parent_id;} // the attribute (A-148)
    // A-287: the attributes (it wrote `sort_order` / `is_active`, which the update dropped).
    if (data.sort_order !== undefined) {updates.sortOrder = data.sort_order;}
    if (data.is_active !== undefined) {updates.isActive = data.is_active;}

    // Read before the update: the instance is mutated in place.
    const before = Object.fromEntries(
      Object.keys(updates).map((key) => [key, (Reflect.get(menu, key) as unknown) ?? null]),
    );

    await db.transaction(async (transaction) => {
      // A-271 (A-226's twin): never itself or one of its descendants; a
      // parent that does not exist is 404, not a foreign-key 500.
      await menuGroupService().assertMenuParentAllowed(menu.id, updates.parentId, transaction);
      // The optional keys may hold undefined, as built.
      await menu.update(updates as Partial<InferAttributes<MenuRow>>, { transaction });
      await auditAccessChange(transaction, actor, {
        tenantId: PLATFORM_TENANT_ID, // A-165: a global menu is a platform operation
        action: "UPDATE",
        resourceType: "MenuGroup",
        resourceId: id,
        changes: { operation: "UPDATE_MENU", before, after: updates },
      });
    });

    // Invalidate all role permissions since menu name/status might have changed
    await delPattern("permissions:role:*");

    return menu;
  }

  /**
   * Delete menu group, and every role grant on it
   * @param id - the menu group
   * @param actor - who, from where (A-41)
   * @returns a confirmation message
   */
  static async deleteMenu(id: string, actor: AccessActor = {}): Promise<{ message: string }> {
    const menu = await MenuGroup.findByPk(id);
    if (!menu) {
      const error: StatusError = new AppError(404, "Menu group not found");
      error.statusCode = 404;
      throw error;
    }

    await db.transaction(async (transaction) => {
      // A-181 (ADR-056): a menu with children is refused, as on
      // menuGroup.service#deleteMenuGroup. The parent_id FK is SET NULL, so a
      // delete here promoted every child to the top level with its grants.
      const children = await MenuGroup.count({ where: { parentId: id }, transaction });
      if (children > 0) {
        throw new AppError(
          409,
          `Menu "${menu.name}" still has ${String(children)} child menu(s). Delete or move them first; a menu is deleted only when it is empty.`,
        );
      }
      // Delete associated role permissions
      const revokedGrants = await RoleMenuPermission.destroy({
        where: { menuGroupId: id },
        transaction,
      });
      await menu.destroy({ transaction });
      await auditAccessChange(transaction, actor, {
        tenantId: PLATFORM_TENANT_ID, // A-165: a global menu is a platform operation
        action: "DELETE",
        resourceType: "MenuGroup",
        resourceId: id,
        changes: {
          operation: "DELETE_MENU",
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `?? null`
          before: { name: menu.name ?? null, slug: menu.slug ?? null },
          after: { deleted: true, revokedGrants },
        },
      });
    });

    // Invalidate all role permissions cache
    await delPattern("permissions:role:*");

    return { message: "Menu group deleted successfully" };
  }
}

export = RolesService;
