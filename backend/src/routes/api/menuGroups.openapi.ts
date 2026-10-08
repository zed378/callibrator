/**
 * P9-18 / P9-25 (ADR-103) — the contract of `menuGroups.route.ts`, code-first.
 *
 * The router is mounted twice (`/api/v1/menu-groups` and
 * `/api/v1/menu-group-roles`); it is documented under the first. The menu tree
 * and its role assignments are platform-wide. Reading a menu is the caller's
 * own: a role's menu only for the caller's own role (403 otherwise), unless
 * the caller is a super admin. Everything that changes the tree or an
 * assignment is SUPERADMIN, and is audited. The bodies are the menu-group
 * contract's own schemas (`@callibrator/contracts/menuGroup`), which the
 * controller enforces (a 400 naming each failure). Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs, type DocumentedOperation, type Permission } from "../../docs/openapi/operation";
import {
  assignMenuGroupSchema,
  assignMenuItemSchema,
  bulkAssignMenuGroupsSchema,
  bulkRevokeMenuGroupsSchema,
  createMenuGroupSchema,
  getAssignmentsSchema,
  revokeMenuGroupSchema,
  revokeMenuItemSchema,
  updateMenuGroupSchema,
} from "../../validators/menuGroup.validator";
import { rolePermissionResponse, roleResponse } from "@callibrator/contracts/roles";

/** The contract's schemas, by the names the operations use. */
const v = { assignMenuGroupSchema, assignMenuItemSchema, bulkAssignMenuGroupsSchema, bulkRevokeMenuGroupsSchema, createMenuGroupSchema, getAssignmentsSchema, revokeMenuGroupSchema, revokeMenuItemSchema, updateMenuGroupSchema };

const superAdmin = { kind: "rbac", roles: ["SUPERADMIN"] } as const;
const OWN_ROLE: Permission = {
  kind: "authenticated",
  reason: "A role's menu is read only for the caller's own role (403 otherwise); a super admin reads any.",
};

/**
 * P9-25 item 11: a menu entry as menuGroup.service answers every tree read and
 * the create/update (`formatMenuGroup` / `formatMenuItem` / `buildNode`): the
 * frontend's shape — `label` (the group's name), `path` (from the slug) and
 * `items` (its children, recursively). It was published as the raw row
 * (`name`, `slug`, `parentId`, `isActive`, `children`), which no answer carries.
 */
interface MenuEntryShape {
  id: string;
  label: string;
  icon: string | null;
  path: string;
  sortOrder?: number | null | undefined;
  isAssigned?: boolean | undefined;
  items?: MenuEntryShape[] | undefined;
}
const MenuGroup: z.ZodType<MenuEntryShape> = z
  .object({
    id: z.guid(),
    label: z.string().meta({ description: "The menu group's name" }),
    icon: z.string().nullable(),
    path: z.string().meta({ description: "The page path, from the slug" }),
    sortOrder: z.number().int().nullable().optional(),
    isAssigned: z.boolean().optional().meta({ description: "With a role: whether the role holds it" }),
    get items(): z.ZodOptional<z.ZodArray<z.ZodType<MenuEntryShape>>> {
      return z.array(MenuGroup).optional().meta({ description: "The children, in the same shape" });
    },
  })
  .meta({
    id: "MenuGroupNode",
    example: {
      id: "6f7a8b9c-0d1e-4f2a-8b3c-4d5e6f7a8b9c",
      label: "Calibration",
      icon: "gauge",
      path: "/dashboard/calibration",
      sortOrder: 2,
      items: [],
    },
  });
const MenuTree = z.array(MenuGroup);
const roleQuery = z.object({ roleId: z.guid().optional().meta({ description: "The role whose assignments to mark (the caller's own, unless super admin)" }) });

const admin = (op: Omit<DocumentedOperation, "method" | "permission" | "audited">): DocumentedOperation => ({
  method: "post",
  permission: superAdmin,
  audited: true,
  ...op,
});

export default defineRouteDocs({
  router: "api/menuGroups.route",
  mount: "/api/v1/menu-groups",
  alsoMountedAt: [{ mount: "/api/v1/menu-group-roles", operationIdSuffix: "ViaMenuGroupRoles" }],
  tag: "Menu Groups",
  tenantScoped: false,
  operations: [
    {
      method: "post",
      path: "/filter",
      operationId: "filterMenuGroups",
      summary: "The menu tree, marked with a role's assignments",
      permission: OWN_ROLE,
      audited: false,
      body: z.object({ roleId: z.guid().optional() }).meta({ description: "`roleId` may also come in the query." }),
      success: { status: 200, description: "The tree", data: MenuTree },
    },
    {
      method: "post",
      path: "/get-assignments",
      operationId: "getRoleMenuAssignments",
      summary: "A role's personalized menu (with the caller's own overrides when it is their role; ADR-102)",
      permission: OWN_ROLE,
      audited: false,
      body: v.getAssignmentsSchema,
      success: { status: 200, description: "The menu", data: MenuTree },
    },
    {
      method: "get",
      path: "/my-permissions",
      operationId: "getMyMenuPermissions",
      summary: "The caller's effective menu permissions (ADR-102)",
      permission: { kind: "authenticated", reason: "The caller's own permissions." },
      audited: false,
      success: {
        status: 200,
        description: "Whether the caller is a super admin, and their permission per menu",
        data: z.object({
          superAdmin: z.boolean(),
          facilityBound: z.boolean().meta({ description: "P21-09c: the caller is bound to a client facility — its permissions are capped by the bound menu ceiling and unmarked routes refuse it" }),
          permissions: z.record(z.string(), z.enum(["read", "write"])),
        }),
      },
    },
    {
      method: "get",
      path: "/menu-groups",
      operationId: "listMenuGroupTree",
      summary: "The menu tree for the caller",
      permission: OWN_ROLE,
      audited: false,
      query: roleQuery,
      success: { status: 200, description: "The tree", data: MenuTree },
    },
    {
      method: "get",
      path: "/menu-groups/admin",
      operationId: "listMenuGroupsAdmin",
      summary: "The whole menu tree (admin view)",
      permission: superAdmin,
      audited: false,
      query: roleQuery,
      success: { status: 200, description: "The tree", data: MenuTree },
    },
    {
      method: "get",
      path: "/roles",
      operationId: "listMenuAssignableRoles",
      summary: "The roles menus can be assigned to",
      permission: superAdmin,
      audited: false,
      // P9-25 item 11: `Role.findAll` — whole role rows (menuGroup.service#getAvailableRoles).
      success: { status: 200, description: "The roles", data: z.array(roleResponse) },
    },
    admin({
      path: "/create",
      operationId: "createMenuGroupNode",
      summary: "Create a menu group",
      description: "An unknown parent is a 404 (A-226).",
      body: v.createMenuGroupSchema,
      success: { status: 201, description: "The menu group", data: MenuGroup },
    }),
    admin({
      path: "/update",
      operationId: "updateMenuGroupNode",
      summary: "Update a menu group",
      body: v.updateMenuGroupSchema,
      success: { status: 200, description: "The menu group", data: MenuGroup },
    }),
    admin({
      path: "/delete",
      operationId: "deleteMenuGroupNode",
      summary: "Delete a menu group",
      body: z.object({ menuGroupId: z.guid() }).meta({ description: "Read by the controller (400 without it)." }),
      success: { status: 200, description: "Deleted", empty: true },
    }),
    admin({
      path: "/assign",
      operationId: "assignMenuGroupToRole",
      summary: "Assign a menu group to a role",
      description: "A body with `menuItemId` is read as an item assignment (as /assign-item).",
      body: v.assignMenuGroupSchema,
      // P9-25 item 11: the RoleMenuPermission row found or created (menuGroup.service#assignMenuToRole).
      success: { status: 200, description: "The assignment", data: rolePermissionResponse },
    }),
    admin({
      path: "/revoke",
      operationId: "revokeMenuGroupFromRole",
      summary: "Revoke a menu group from a role",
      description: "A body with `menuItemId` is read as an item revocation (as /revoke-item).",
      body: v.revokeMenuGroupSchema,
      success: { status: 200, description: "Revoked", empty: true },
    }),
    admin({
      path: "/assign-item",
      operationId: "assignMenuItemToRole",
      summary: "Assign an individual menu item to a role",
      body: v.assignMenuItemSchema,
      // P9-25 item 11: the RoleMenuPermission row found or created (menuGroup.service#assignMenuToRole).
      success: { status: 200, description: "The assignment", data: rolePermissionResponse },
    }),
    admin({
      path: "/revoke-item",
      operationId: "revokeMenuItemFromRole",
      summary: "Revoke an individual menu item from a role",
      body: v.revokeMenuItemSchema,
      success: { status: 200, description: "Revoked", empty: true },
    }),
    admin({
      path: "/bulk-assign",
      operationId: "bulkAssignMenuGroups",
      summary: "Assign several menu groups to a role",
      body: v.bulkAssignMenuGroupsSchema,
      success: {
        status: 200,
        description: "What was assigned, what already was, and what failed",
        data: z.object({
          assigned: z.array(z.guid()),
          alreadyAssigned: z.array(z.guid()),
          failed: z.array(z.object({ menuGroupId: z.guid(), error: z.string() })),
        }),
      },
    }),
    admin({
      path: "/bulk-revoke",
      operationId: "bulkRevokeMenuGroups",
      summary: "Revoke several menu groups from a role",
      body: v.bulkRevokeMenuGroupsSchema,
      // P9-25 item 11: menuGroup.service#bulkRevoke's answer.
      success: { status: 200, description: "What was revoked", data: z.object({ revoked: z.array(z.guid()), notFound: z.array(z.guid()) }) },
    }),
  ],
});
