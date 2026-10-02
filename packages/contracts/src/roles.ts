/**
 * Role and menu request bodies.
 *
 * P9-11 (ADR-093): moved to Zod.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/roles.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for /api/v1/roles and menus (role, menu, assignment and permission bodies).
 */
import { z } from "zod";
import { PaginationMeta } from "./envelope";
import { numeric, optionalText, uuid } from "./fields";

// ADR-043 — `roleLevel` is the value every rbac() gate compares against, so a
// role created without one fails every privileged gate silently (the trap in
// CLAUDE.md, from the far end). The bound is `max(8)`, never 10: the
// SUPER_ADMIN tier bypasses rbac() AND tenant scoping, and must not be
// reachable through a tenant-facing create call. RolesService.createRole clamps
// again, so the cap holds for callers that never reach this schema.
//
// F-19 (ADR-105): the role dialog offers Display Name, Level and Active, and the
// API used to drop all three (Level on edit, Display Name and Active on both).
// They are accepted now: `nameToShow` is the model's display column (100), a
// new role may start `inactive`, and an edit may change `roleLevel` under the
// same 1–8 bound as a create. A system role's level is fixed (409, the service).
const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  nameToShow: optionalText(100),
  description: optionalText(500),
  roleLevel: numeric(z.number().int().min(1).max(8)).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  nameToShow: optionalText(100),
  description: optionalText(500),
  roleLevel: numeric(z.number().int().min(1).max(8)).optional(),
  status: z.enum(["active", "inactive", "deleted"]).optional(),
});

// The menu bodies were never declared (an open object before P9-11): every
// key passes through to roles.service, which picks the columns it writes.
// Kept as it was; declaring them is a change of its own (P9-11 record).
const createMenuSchema = z.looseObject({});

const updateMenuSchema = z.looseObject({});

const assignRoleSchema = z.object({
  userId: uuid(),
  roleId: uuid(),
});

const assignPermissionSchema = z.object({
  menuGroupId: uuid(),
  permissionType: z.enum(["read", "write"]),
});

export { createRoleSchema, updateRoleSchema, createMenuSchema, updateMenuSchema, assignRoleSchema, assignPermissionSchema };

// ==========================================
// RESPONSES (P9-20/21, ADR-103: what the API answers, published code-first)
// ==========================================
// roles.controller answers its OWN JSON shape — `{ success, data }` (plus a
// top-level `meta` on the two lists, `message` on a permission grant) — not the
// house envelope (no `status`, no `message`). Documented as it is.
// Component ids end in `Row` (RoleRow, MenuGroupRow, RoleMenuPermissionRow):
// the legacy JSDoc of other modules (menu-groups, users) still defines `Role`,
// `MenuGroup` and `RoleMenuPermission` for its own answers, and the builder
// refuses one id defined twice, differently.

const timestamp = z.iso.datetime();
const rowId = z.guid();

/** A role row (`Role.toJSON()`). */
const roleResponse = z
  .object({
    id: rowId,
    name: z.string(),
    nameToShow: z.string().nullable(),
    description: z.string().nullable(),
    isSystem: z.boolean().nullable(),
    status: z.string().nullable(),
    sortOrder: z.number().int().nullable(),
    roleLevel: z.number().int().nullable().meta({ description: "The level every rbac() gate compares against (ADR-043)" }),
    isDeleted: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: timestamp.nullable(),
  })
  .meta({
    id: "RoleRow",
    description: "A role.",
    example: {
      id: "6e5d4c3b-2a19-4f8e-9d7c-6b5a4f3e2d1c",
      name: "LAB TECHNICIAN",
      nameToShow: "Lab technician",
      description: "Performs calibrations",
      isSystem: false,
      status: "active",
      sortOrder: null,
      roleLevel: 5,
      isDeleted: false,
      createdAt: "2026-01-15T08:30:00.000Z",
      updatedAt: "2026-01-15T08:30:00.000Z",
      deletedAt: null,
    },
  });

/** A role-menu permission row (`RoleMenuPermission.toJSON()`). */
const permissionFields = {
  id: rowId,
  roleId: rowId,
  menuGroupId: rowId,
  permissionType: z.string().meta({ description: "`read` or `write`" }),
  createdAt: timestamp,
  updatedAt: timestamp,
};
const rolePermissionResponse = z.object(permissionFields).meta({ id: "RoleMenuPermissionRow", description: "A role's permission on one menu group." });

/** A menu included in a role's permissions: the attributes the service selects. */
const menuRef = z
  .looseObject({ id: rowId, name: z.string(), slug: z.string(), icon: z.string().nullable() })
  .nullable();

/** A role with its permissions and each permission's menu (GET /roles/:id, and the answer to a create). */
const roleDetailResponse = z
  .object({
    ...roleResponse.shape,
    permissions: z.array(z.object({ ...permissionFields, menu: menuRef })),
  })
  .meta({ id: "RoleDetail", description: "A role with its menu permissions." });

/** A menu group row (`MenuGroup.toJSON()`), with its direct children. */
const menuGroupFields = {
  id: rowId,
  name: z.string(),
  slug: z.string(),
  icon: z.string().nullable(),
  parentId: rowId.nullable(),
  sortOrder: z.number().int().nullable(),
  isActive: z.boolean().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
};
const menuGroupResponse = z.object(menuGroupFields).meta({ id: "MenuGroupRow", description: "A menu group (a navigation entry and a permission resource)." });
const menuGroupWithChildrenResponse = z
  .object({
    ...menuGroupFields,
    children: z.array(z.looseObject({ id: rowId, name: z.string(), slug: z.string(), icon: z.string().nullable() })),
  })
  .meta({ id: "MenuGroupWithChildren", description: "A menu group with its direct children (id, name, slug, icon, order)." });

/** `{ success: true, data }` — the roles controller's own success shape. */
const rolesAnswer = <T extends z.ZodType>(data: T): z.ZodObject<{ success: z.ZodLiteral<true>; data: T }> =>
  z.object({ success: z.literal(true), data });

/** A list: `{ success: true, data: [...], meta }`, `meta` a top-level sibling. */
const rolesListAnswer = <T extends z.ZodType>(
  row: T,
): z.ZodObject<{ success: z.ZodLiteral<true>; data: z.ZodArray<T>; meta: typeof PaginationMeta }> =>
  z.object({ success: z.literal(true), data: z.array(row), meta: PaginationMeta });

/** A delete / removal: `{ success: true, message }` (the service's `{ message }`, spread). */
const rolesMessageAnswer = z.object({ success: z.literal(true), message: z.string() });

/** The not-found answer of GET /roles/:id and GET /roles/menus/:id: `{ success: false, message }`. */
const rolesNotFoundAnswer = z.object({ success: z.literal(false), message: z.string() });

export {
  roleResponse,
  roleDetailResponse,
  rolePermissionResponse,
  menuGroupResponse,
  menuGroupWithChildrenResponse,
  rolesAnswer,
  rolesListAnswer,
  rolesMessageAnswer,
  rolesNotFoundAnswer,
};

// The client-side (input) and handler-side (output) types of each schema.
export type CreateRoleInput = z.input<typeof createRoleSchema>;
export type CreateRoleBody = z.output<typeof createRoleSchema>;
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;
export type UpdateRoleBody = z.output<typeof updateRoleSchema>;
export type CreateMenuInput = z.input<typeof createMenuSchema>;
export type CreateMenuBody = z.output<typeof createMenuSchema>;
export type UpdateMenuInput = z.input<typeof updateMenuSchema>;
export type UpdateMenuBody = z.output<typeof updateMenuSchema>;
export type AssignRoleInput = z.input<typeof assignRoleSchema>;
export type AssignRoleBody = z.output<typeof assignRoleSchema>;
export type AssignPermissionInput = z.input<typeof assignPermissionSchema>;
export type AssignPermissionBody = z.output<typeof assignPermissionSchema>;
