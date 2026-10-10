/**
 * P9-21 / P9-25 (ADR-103) — the contract of `roles.route.ts`, code-first.
 *
 * Every route is super admin only (`rbac(["SUPERADMIN"])`). Request bodies:
 * role create and update are the objects `validate()` mounts
 * (`validators/roles.validator` → `@callibrator/contracts/roles`); the menu
 * create mounts `createMenuSchema`, an open object (P9-11 kept it so); the menu
 * update, role assignment and permission grant bodies are read RAW by the
 * handler (no schema on the chain) and documented as the handler reads them.
 *
 * Answers: since 2026-10-11 (ADR-137) roles.controller answers the house
 * envelope `{ success, status, message, data }` (a top-level `meta` on the two
 * lists; `data: null` on a removal and on the not-found of GET `/:id` and
 * GET `/menus/:id`). It was `{ success, data }` and `{ success, message }`;
 * every success `data` is unchanged. Examples are synthetic.
 */
import { z } from "zod";
import { createMenuSchema, createRoleSchema, updateRoleSchema } from "../../validators/roles.validator";
import {
  menuGroupResponse,
  menuGroupWithChildrenResponse,
  roleDetailResponse,
  rolePermissionResponse,
  roleResponse,
  rolesAnswer,
  rolesListAnswer,
  rolesMessageAnswer,
  rolesNotFoundAnswer,
} from "@callibrator/contracts/roles";
import { defineRouteDocs } from "../../docs/openapi/operation";

const superAdmin = { kind: "rbac", roles: ["SUPERADMIN"] } as const;
const ROLE_ID = "6e5d4c3b-2a19-4f8e-9d7c-6b5a4f3e2d1c";
const MENU_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const USER_ID = "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f";

/** `:id`, checked by `validateUuid` (the SHAPE: `z.guid()`). */
const idParams = (what: string, example: string): z.ZodObject<{ id: z.ZodGUID }> =>
  z.object({ id: z.guid().meta({ description: `The ${what}'s id`, example }) });

/** Parameters the permission and assignment routes read UNCHECKED (no `validateUuid`): an unknown id is the service's 404. */
const rawId = (what: string, example: string): z.ZodString =>
  z.string().meta({ description: `The ${what}'s id (not shape-checked on this route)`, example });

/** The two lists' raw filters (no schema): `limit` and `page` fall back to 20 and 1 when absent or not numbers. */
const listQuery = z.object({
  page: z.string().optional().meta({ description: "1-based page; anything not a number reads as 1", example: "1" }),
  limit: z.string().optional().meta({ description: "Rows per page; anything not a number reads as 20", example: "20" }),
  search: z.string().optional().meta({ description: "Substring of the name or description" }),
});

/** PATCH /menus/:id — read raw; the service writes the columns it knows. */
const menuUpdateBody = z.looseObject({
  name: z.string().optional(),
  slug: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  sort_order: z.number().optional(),
  is_active: z.boolean().optional(),
});

/** POST /assign — read raw (no schema on the route). */
const assignBody = z.object({ userId: z.string(), roleId: z.string() });

/** POST /:roleId/permissions — read raw; an absent or empty `permissionType` is `read`. */
const grantBody = z.object({ menuGroupId: z.string(), permissionType: z.string().optional() });

/**
 * The user as `rolesService.assignRoleToUser` answers it: a projection of
 * exactly these fields since A-331 (before it, the whole user row, credential
 * columns included).
 */
const assignedUser = z
  .object({
    id: z.guid(),
    username: z.string(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    tenantId: z.guid().nullable(),
    roleId: z.guid().nullable(),
    status: z.string(),
    isActive: z.boolean().nullable(),
  })
  .meta({ id: "RoleAssignedUser", description: "The user the role was assigned to: these fields only (A-331)." });

const notFound = (message: string) => ({
  404: {
    description: "Not found — `{ success: false, status: 404, message, data: null }`",
    body: rolesNotFoundAnswer,
    example: { success: false, status: 404, message, data: null },
  },
});

export default defineRouteDocs({
  router: "api/roles.route",
  mount: "/api/v1/roles",
  tag: "Roles",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listRoles",
      summary: "List roles",
      permission: superAdmin,
      audited: false,
      query: listQuery,
      success: { status: 200, description: "`{ success, status, message, data, meta }` — a page of roles", body: rolesListAnswer(roleResponse) },
    },
    {
      method: "get",
      path: "/menus",
      operationId: "listMenuGroups",
      summary: "List menu groups",
      permission: superAdmin,
      audited: false,
      query: listQuery,
      success: {
        status: 200,
        description: "`{ success, status, message, data, meta }` — a page of menu groups, each with its direct children",
        body: rolesListAnswer(menuGroupWithChildrenResponse),
      },
    },
    {
      method: "get",
      path: "/:id",
      operationId: "getRole",
      summary: "Get a role",
      permission: superAdmin,
      audited: false,
      params: idParams("role", ROLE_ID),
      success: { status: 200, description: "`{ success, status, message, data }` — the role with its permissions", body: rolesAnswer(roleDetailResponse) },
      errorBodies: notFound("Role not found"),
    },
    {
      method: "post",
      path: "/",
      operationId: "createRole",
      summary: "Create a role",
      description:
        "`roleLevel` (1–8) is clamped to the tenant-admin cap and to the caller's own level (ADR-043, F-19 / ADR-105).",
      permission: superAdmin,
      audited: true,
      body: createRoleSchema,
      success: { status: 201, description: "`{ success, status, message, data }` — the created role with its permissions", body: rolesAnswer(roleDetailResponse) },
    },
    {
      method: "patch",
      path: "/:id",
      operationId: "updateRole",
      summary: "Update a role",
      description: "`roleLevel` is clamped as on create. A system role's name cannot change.",
      permission: superAdmin,
      audited: true,
      params: idParams("role", ROLE_ID),
      body: updateRoleSchema,
      success: { status: 200, description: "`{ success, status, message, data }` — the updated role", body: rolesAnswer(roleResponse) },
    },
    {
      method: "delete",
      path: "/:id",
      operationId: "deleteRole",
      summary: "Delete a role",
      permission: superAdmin,
      audited: true,
      params: idParams("role", ROLE_ID),
      success: { status: 200, description: "`{ success, status, message, data: null }`", body: rolesMessageAnswer },
    },
    {
      method: "get",
      path: "/menus/:id",
      operationId: "getMenuGroup",
      summary: "Get a menu group",
      permission: superAdmin,
      audited: false,
      params: idParams("menu group", MENU_ID),
      success: {
        status: 200,
        description: "`{ success, status, message, data }` — the menu group with its direct children",
        body: rolesAnswer(menuGroupWithChildrenResponse),
      },
      errorBodies: notFound("Menu group not found"),
    },
    {
      method: "post",
      path: "/menus",
      operationId: "createMenuGroup",
      summary: "Create a menu group",
      description: "The body is an open object (no declared fields); the service writes the columns it knows.",
      permission: superAdmin,
      audited: true,
      body: createMenuSchema,
      success: { status: 201, description: "`{ success, status, message, data }` — the created menu group", body: rolesAnswer(menuGroupResponse) },
    },
    {
      method: "patch",
      path: "/menus/:id",
      operationId: "updateMenuGroup",
      summary: "Update a menu group",
      description: "The body is read without a schema; the service writes the columns it knows.",
      permission: superAdmin,
      audited: true,
      params: idParams("menu group", MENU_ID),
      body: menuUpdateBody,
      success: { status: 200, description: "`{ success, status, message, data }` — the updated menu group", body: rolesAnswer(menuGroupResponse) },
    },
    {
      method: "delete",
      path: "/menus/:id",
      operationId: "deleteMenuGroup",
      summary: "Delete a menu group",
      permission: superAdmin,
      audited: true,
      params: idParams("menu group", MENU_ID),
      success: { status: 200, description: "`{ success, status, message, data: null }`", body: rolesMessageAnswer },
    },
    {
      method: "post",
      path: "/:roleId/permissions",
      operationId: "grantRolePermission",
      summary: "Grant a role a menu permission",
      description: "The body is read without a schema; an absent or empty `permissionType` grants `read`.",
      permission: superAdmin,
      audited: true,
      params: z.object({ roleId: rawId("role", ROLE_ID) }),
      body: grantBody,
      success: {
        status: 201,
        description: "`{ success, status, message, data }` — the permission row",
        body: rolesAnswer(rolePermissionResponse),
      },
    },
    {
      method: "delete",
      path: "/:roleId/permissions/:menuGroupId",
      operationId: "revokeRolePermission",
      summary: "Revoke a role's menu permission",
      permission: superAdmin,
      audited: true,
      params: z.object({ roleId: rawId("role", ROLE_ID), menuGroupId: rawId("menu group", MENU_ID) }),
      success: { status: 200, description: "`{ success, status, message, data: null }`", body: rolesMessageAnswer },
    },
    {
      method: "post",
      path: "/assign",
      operationId: "assignRoleToUser",
      summary: "Assign a role to a user",
      description:
        "The body is read without a schema. The answer is the user's id, names, email, tenant, role and status " +
        "only (A-331: it used to be the whole user row, credential columns included).",
      permission: superAdmin,
      audited: true,
      body: assignBody,
      success: { status: 200, description: "`{ success, status, message, data }` — the user", body: rolesAnswer(assignedUser) },
    },
    {
      method: "delete",
      path: "/assign/:userId",
      operationId: "removeRoleFromUser",
      summary: "Remove a user's role",
      permission: superAdmin,
      audited: true,
      params: z.object({ userId: rawId("user", USER_ID) }),
      success: { status: 200, description: "`{ success, status, message, data: null }`", body: rolesMessageAnswer },
    },
  ],
});
