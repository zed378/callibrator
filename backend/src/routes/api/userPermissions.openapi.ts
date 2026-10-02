/**
 * P9-21 / P9-25 (ADR-103) — the contract of `userPermissions.route.ts`, code-first.
 *
 * Per-user permission overrides on menu groups. Every route is super admin
 * only (`rbac(["SUPERADMIN"])`), and `validateUuid` runs BEFORE `auth` here: a
 * malformed id is a 400 even without a token. No route mounts a schema: the
 * POST body is read RAW, documented as the handler reads it; a missing
 * `menuGroupId` or `permissionType` is answered by the controller in its own
 * shape (no `data`), a bad `permissionType` by the service (the envelope).
 * Examples are synthetic.
 */
import { z } from "zod";
import { ErrorEnvelope } from "../../docs/openapi/envelope";
import { defineRouteDocs } from "../../docs/openapi/operation";

const superAdmin = { kind: "rbac", roles: ["SUPERADMIN"] } as const;
const USER_ID = "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f";
const MENU_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const userParams = z.object({
  userId: z.guid().meta({ description: "The user's id", example: USER_ID }),
});
const overrideParams = userParams.extend({
  menuGroupId: z.guid().meta({ description: "The menu group's id", example: MENU_ID }),
});

const PERMISSION_TYPES = ["read", "write", "none"] as const;

/** POST /:userId — read raw. `none` denies the menu even when the role grants it. */
const setBody = z.object({
  menuGroupId: z.string().meta({ description: "The menu group (an unknown id is a 404)", example: MENU_ID }),
  permissionType: z.enum(PERMISSION_TYPES),
  notes: z.string().optional().meta({ description: "Why; an empty value is stored as null" }),
});

const menu = z
  .object({
    id: z.guid(),
    name: z.string(),
    slug: z.string().nullable(),
    icon: z.string().nullable(),
    parentId: z.guid().nullable(),
  })
  .nullable();

const permissionPicture = z.object({
  user: z.object({
    id: z.guid(),
    username: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    tenantId: z.guid().nullable(),
    role: z.object({ id: z.guid(), name: z.string(), nameToShow: z.string().nullable() }).nullable(),
  }),
  // role_menu_permissions.permission_type: isIn read/write (the model's validator).
  rolePermissions: z.array(z.object({ menuGroupId: z.guid(), menu, permissionType: z.enum(["read", "write"]) })),
  overrides: z.array(z.object({ menuGroupId: z.guid(), menu, permissionType: z.enum(PERMISSION_TYPES), notes: z.string().nullable() })),
  effective: z.array(
    z.object({
      menuGroupId: z.guid(),
      menu,
      permissionType: z.enum(["read", "write"]).nullable().meta({ description: "null: no access" }),
      source: z.enum(["role", "custom"]).nullable(),
      rolePermission: z.enum(["read", "write"]).nullable(),
      override: z.enum(PERMISSION_TYPES).nullable(),
    }),
  ),
});

/** The override row (`user_menu_permissions`) as JSON. */
const overrideRow = z.object({
  id: z.guid(),
  userId: z.guid(),
  menuGroupId: z.guid(),
  permissionType: z.enum(PERMISSION_TYPES),
  grantedBy: z.guid().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** The controller's own 400 (missing field): no `data`. */
const missingField = z.object({ success: z.literal(false), status: z.literal(400), message: z.string() });

export default defineRouteDocs({
  router: "api/userPermissions.route",
  mount: "/api/v1/user-permissions",
  tag: "UserPermissions",
  tagDescription: "Per-user permission overrides (role inheritance plus custom grants and denies). Super admin only.",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/:userId",
      operationId: "getUserPermissions",
      summary: "Get a user's permission picture",
      description: "The user's role permissions, custom overrides, and the resolved effective permission per menu group (every menu).",
      permission: superAdmin,
      audited: false,
      params: userParams,
      success: { status: 200, description: "The permission picture", data: permissionPicture },
    },
    {
      method: "post",
      path: "/:userId",
      operationId: "setUserPermission",
      summary: "Assign or update a custom permission",
      description:
        "Upserts the override on a menu group. Answers **201** when it created the override and **200** when it updated one. " +
        "An unknown user or menu group is a 404.",
      permission: superAdmin,
      audited: true,
      params: userParams,
      body: setBody,
      success: { status: 200, description: "The override (201 when created)", data: overrideRow },
      errorBodies: {
        400: {
          description: "A malformed id or `permissionType` (the envelope), or a missing field (the controller's own shape, no `data`)",
          body: z.union([ErrorEnvelope, missingField]),
          example: { success: false, status: 400, message: "menuGroupId and permissionType are required" },
        },
      },
    },
    {
      method: "delete",
      path: "/:userId/:menuGroupId",
      operationId: "removeUserPermission",
      summary: "Remove a custom permission override",
      description:
        "The user falls back to role inheritance for that menu group. Idempotent: a 200 also when there was no override " +
        "(then nothing is audited). The user is not looked up: an unknown user is a 200 too.",
      permission: superAdmin,
      audited: true,
      params: overrideParams,
      success: { status: 200, description: "The override was removed", empty: true },
    },
  ],
});
