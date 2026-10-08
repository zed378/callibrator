/**
 * P9-21 / P9-25 (ADR-103) — the contract of `user.route.ts`, code-first.
 *
 * Every route needs `auth` and `dynamicAccess("users", <action>)` with
 * `checkTenant` (a user of another tenant is a 404); the profile and avatar
 * routes add `checkSelf` (a user may act on their own account without the
 * permission). The three admin-assisted resets also need TENANT_ADMIN (an
 * `rbac` AFTER the published gate). No route mounts a schema: the controller
 * checks the shared schemas (`@callibrator/contracts/user`), which are the
 * bodies and filters below; the tenant is the principal's, never a request
 * value (the super admin's list may name one). Users are answered without
 * their credentials, second-factor secrets or lockout counters
 * (user.service#safeUserAttributes). Examples are synthetic.
 */
import { z } from "zod";
import {
  createUserSchema,
  getAllUsersQuery,
  updateProfileSchema,
  updateRoleSchema,
  updateUserSchema,
  userParamSchema,
  usernameCheckSchema,
} from "../../validators/user.validator";
import { ErrorEnvelope } from "../../docs/openapi/envelope";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { userFacilityBinding } from "@callibrator/contracts/clientFacilities";

const users = (action: "read" | "create" | "update" | "delete") => ({ kind: "dynamicAccess", resource: "users", action }) as const;

const userParams = z.object({
  userId: z.guid().meta({ description: "The user's id", example: "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f" }),
});

/** A user as user.service answers one: the row without its secrets, the role, and `avatarUrl`. */
const user = z
  .looseObject({
    id: z.guid(),
    tenantId: z.guid().nullable(),
    roleId: z.guid().nullable(),
    username: z.string(),
    email: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    status: z.string().meta({ example: "ACTIVE" }),
    avatarUrl: z.string().nullable(),
    mfaEnabled: z.boolean().optional(),
    webauthnEnabled: z.boolean().optional(),
    // P9-25 item 11: columns and getters the reads carry (safeUserAttributes
    // excludes only secrets) and the users page reads.
    isEmailVerified: z.boolean().nullable().optional(),
    mustChangePassword: z.boolean().optional().meta({ description: "A-123: an administrator set the password; it must be changed at sign-in" }),
    picture: z.string().nullable().optional().meta({ description: "The avatar's URL (the model's getter); null without one" }),
    first_name: z.string().nullable().optional().meta({ description: "Legacy alias of `firstName` (the model's getter)" }),
    last_name: z.string().nullable().optional().meta({ description: "Legacy alias of `lastName` (the model's getter)" }),
    role: z
      .looseObject({ id: z.guid(), name: z.string(), nameToShow: z.string().nullable(), description: z.string().nullable().optional() })
      .nullable()
      .optional(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "User", description: "A user, without credentials, second-factor secrets or lockout counters" });

/** The controller's own 400 on the list and delete filters: `errors`, no `data`. */
const filterProblem = z.object({
  success: z.literal(false),
  status: z.literal(400),
  message: z.string(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })),
});
const filterBodies = (example: string) =>
  ({
    400: {
      description: "A filter that does not validate (the controller's own shape: `errors`, no `data`)",
      body: z.union([filterProblem, ErrorEnvelope]),
      example: { success: false, status: 400, message: example, errors: [{ field: "userId", message: "Invalid UUID" }] },
    },
  }) as const;

const listAnswer = z.object({
  success: z.literal(true),
  status: z.literal(200),
  message: z.string(),
  data: z.array(user),
  meta: z.object({
    total: z.number().int(),
    statusCounts: z.record(z.string(), z.number().int()).meta({ description: "Users per status (ACTIVE, INACTIVE, LOCKED, SUSPENDED)" }),
    page: z.number().int(),
    limit: z.number().int(),
    totalPages: z.number().int(),
    hasNextPage: z.boolean(),
    hasPrevPage: z.boolean(),
  }),
});

const IDENTITY_CONFLICT = "The username or email is already an account (a caller's conflicts are budgeted: past the budget, 429).";
const resetGate = "Also needs TENANT_ADMIN (an rbac after the users gate), and a target below the caller's role level.";

export default defineRouteDocs({
  router: "api/user.route",
  mount: "/api/v1/users",
  tag: "Users",
  tagDescription: "A tenant's users: list, create, edit, roles, avatars, and the administrator-assisted second-factor and password resets.",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/all",
      operationId: "listUsers",
      summary: "List users",
      description: "Paginated and searchable; the caller's tenant (the super admin may name one with `tenantId`).",
      permission: users("read"),
      audited: false,
      query: getAllUsersQuery,
      success: { status: 200, description: "A page of users, with per-status counts in `meta`", body: listAnswer },
      errorBodies: filterBodies("Validation failed"),
    },
    {
      method: "post",
      path: "/detail",
      operationId: "getUser",
      summary: "Get a user",
      description: "The user is named in the body (`userId`, read raw).",
      permission: users("read"),
      audited: false,
      body: z.object({ userId: z.guid() }),
      success: { status: 200, description: "The user", data: user },
      errors: [404],
    },
    {
      method: "post",
      path: "/username-check",
      operationId: "checkUsernameAvailability",
      summary: "Whether a username is free",
      description: "Needs what creating a user needs (P6-04), so no account can enumerate usernames.",
      permission: users("create"),
      audited: false,
      body: usernameCheckSchema,
      success: { status: 200, description: "The answer", data: z.looseObject({ available: z.boolean() }) },
    },
    {
      method: "post",
      path: "/role-update",
      operationId: "updateUserRole",
      summary: "Change a user's role",
      description: "Never to SUPERADMIN or an inactive role. Audited in the service's transaction (A-77).",
      permission: users("update"),
      audited: true,
      body: updateRoleSchema,
      success: { status: 200, description: "The change", data: z.looseObject({}) },
      conflict: "The user already has this role.",
      errors: [404],
    },
    {
      method: "post",
      path: "/create",
      operationId: "createUser",
      summary: "Create a user",
      description: "Never a SUPERADMIN account. Counts against the plan's seats (enforceSeatQuota). Audited (A-77).",
      permission: users("create"),
      audited: true,
      body: createUserSchema,
      success: { status: 201, description: "The new user", data: user },
      conflict: IDENTITY_CONFLICT,
      errors: [404],
    },
    {
      method: "patch",
      path: "/edit",
      operationId: "editUser",
      summary: "Edit a user",
      description: "The target is `userId` in the body; no self bypass here (A-63).",
      permission: users("update"),
      audited: true,
      body: updateUserSchema,
      success: { status: 200, description: "The user", data: user },
      conflict: IDENTITY_CONFLICT,
      errors: [404],
    },
    {
      method: "patch",
      path: "/:userId/profile",
      operationId: "updateOwnProfile",
      summary: "Edit a profile",
      description: "A-63: the PATH user; the user may edit their own without the permission (`checkSelf`). Only username and names.",
      permission: users("update"),
      audited: true,
      params: userParams,
      body: updateProfileSchema.omit({ userId: true }),
      success: { status: 200, description: "The user", data: user },
      conflict: IDENTITY_CONFLICT,
    },
    {
      method: "delete",
      path: "/delete",
      operationId: "deleteUser",
      summary: "Delete a user",
      description:
        "The target is `userId` in the QUERY. Never the default system administrator, a SUPERADMIN, or the caller. Audited (A-77).",
      permission: users("delete"),
      audited: true,
      query: userParamSchema,
      success: { status: 200, description: "Deleted", data: z.looseObject({}) },
      errors: [404],
      errorBodies: filterBodies("Validation failed - userId is required and must be a valid UUID"),
    },
    {
      method: "post",
      path: "/:userId/avatar",
      operationId: "uploadUserAvatar",
      summary: "Upload an avatar",
      description:
        "A JPEG, PNG, GIF or WebP of at most 2 MB, in a multipart `file` field; counts against the storage quota. " +
        "The user may change their own (`checkSelf`). No file is a 400.",
      permission: users("update"),
      audited: true,
      params: userParams,
      body: z.object({ file: z.file().meta({ description: "The image" }) }).meta({ description: "multipart/form-data with a `file` field" }),
      bodyMediaType: "multipart/form-data",
      success: { status: 200, description: "The stored file name", data: z.object({ avatar: z.string() }) },
    },
    {
      method: "delete",
      path: "/:userId/avatar",
      operationId: "removeUserAvatar",
      summary: "Remove an avatar",
      description: "Back to the placeholder. The user may remove their own (`checkSelf`).",
      permission: users("update"),
      audited: true,
      params: userParams,
      success: { status: 200, description: "The placeholder", data: z.object({ avatar: z.string() }) },
    },
    {
      method: "post",
      path: "/:userId/mfa/reset",
      operationId: "resetUserMfa",
      summary: "Reset a user's MFA (administrator-assisted)",
      description: `A-141: turns MFA off and revokes the user's sessions. ${resetGate}`,
      permission: users("update"),
      audited: true,
      params: userParams,
      success: {
        status: 200,
        description: "MFA is off",
        data: z.object({ id: z.guid(), mfaEnabled: z.literal(false), sessionsRevoked: z.number().int() }),
      },
      conflict: "MFA is not enabled for this user.",
    },
    {
      method: "delete",
      path: "/:userId/webauthn",
      operationId: "resetUserPasskey",
      summary: "Remove a user's passkeys (administrator-assisted)",
      description: `A-262: removes every passkey and revokes the user's sessions. ${resetGate}`,
      permission: users("update"),
      audited: true,
      params: userParams,
      success: {
        status: 200,
        description: "Passkeys removed",
        data: z.object({ id: z.guid(), webauthnEnabled: z.literal(false), sessionsRevoked: z.number().int() }),
      },
      conflict: "This user has no passkey to remove.",
    },
    {
      method: "post",
      path: "/:userId/password/reset",
      operationId: "resetUserPassword",
      summary: "Reset a user's password (administrator-assisted)",
      description: `A-162: a temporary password, shown once (\`Cache-Control: no-store\`). ${resetGate}`,
      permission: users("update"),
      audited: true,
      params: userParams,
      success: {
        status: 200,
        description: "The temporary password",
        // P9-25 item 11: exactly what user.service#resetUserPassword answers.
        data: z.object({
          id: z.guid(),
          temporaryPassword: z.string(),
          mustChangePassword: z.literal(true),
          temporaryPasswordExpiresAt: z.iso.datetime(),
          sessionsRevoked: z.number().int().meta({ description: "The user's sessions signed out" }),
        }),
      },
    },
    {
      method: "put",
      path: "/:userId/client-facility",
      operationId: "setUserClientFacility",
      summary: "Bind a user to a client facility, or unbind it",
      description:
        "P21-09 (ADR-124 Am. 2 § 6): the one way a user's facility changes. `clientFacilityId` binds (a facility of the tenant, " +
        "not its own, active; the role must be HEALTHCARE ADMIN, HEALTHCARE TECHNICIAN, FACILITY MAINTENANCE or ROOM USER); null " +
        "unbinds and needs `roleId` — the role across every facility. Tenant administrators who are not bound themselves; never on " +
        "oneself (400). Every session of the user is revoked. One audit row per affected facility. Not available to facility " +
        "accounts (403). Refused (409) while FACILITY_BINDING_ENABLED is off — the pre-invitation gate.",
      permission: users("update"),
      audited: true,
      params: userParams,
      body: userFacilityBinding.omit({ userId: true }),
      success: {
        status: 200,
        description: "The binding after the change",
        data: z.object({
          userId: z.guid(),
          clientFacilityId: z.guid().nullable(),
          roleId: z.guid().nullable(),
          operation: z.enum(["BIND_FACILITY", "UNBIND_FACILITY", "REBIND_FACILITY", "CONFIRM_UNBOUND"]),
          sessionsRevoked: z.number().int().min(0),
        }),
      },
      conflict:
        "Facility-bound accounts are not enabled yet; the facility is the tenant's own or not active; the user is already bound " +
        "this way, or not bound at all.",
    },
  ],
});
