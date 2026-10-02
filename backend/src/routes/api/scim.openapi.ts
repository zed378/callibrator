/**
 * P9-21 / P9-25 (ADR-103) — the contract of `scim.route.ts`, code-first.
 *
 * SCIM 2.0 provisioning (RFC 7643/7644) for the caller's tenant. The router
 * rewrites a `Bearer <api key>` header to `ApiKey <key>` (scimAuthShim), then
 * `auth`, then its own `requireApiKeyOrAdmin`: an API key with the `scim`
 * scope (`scim:read` for GET, `scim:write` otherwise, A-250), or the super
 * admin. No gate factory is on the chain, so `permission` is `authenticated`
 * with that check as its reason. The tenant is the principal's, never a
 * request value. Bodies are checked in the controller against the shared
 * schemas (`@callibrator/contracts/scim`). Answers are the house envelope
 * around the SCIM resource (not bare SCIM). Examples are synthetic.
 */
import { z } from "zod";
import { scimGroupSchema, scimPatchSchema, scimUserSchema } from "../../validators/scim.validator";
import { ErrorEnvelope } from "../../docs/openapi/envelope";
import { defineRouteDocs } from "../../docs/openapi/operation";

const scimKey = {
  kind: "authenticated",
  reason: "an API key scoped scim:read (GET) or scim:write, or the super admin (this router's requireApiKeyOrAdmin, A-250)",
} as const;

const params = z.object({ id: z.string().meta({ description: "The resource's id (not shape-checked)", example: "8f7e6d5c-4b3a-4c2d-9e1f-0a9b8c7d6e5f" }) });

const listQuery = z.object({
  startIndex: z.string().optional().meta({ description: "1-based", example: "1" }),
  count: z.string().optional().meta({ example: "100" }),
  filter: z.string().optional().meta({ description: "A SCIM filter the service supports (else 400)", example: 'userName eq "a.user@hospital.example"' }),
});

const resourceMeta = z.object({ resourceType: z.string(), created: z.iso.datetime(), lastModified: z.iso.datetime() });

const scimUser = z
  .object({
    schemas: z.array(z.string()),
    id: z.guid(),
    userName: z.string(),
    name: z.object({ givenName: z.string(), familyName: z.string() }),
    emails: z.array(z.object({ primary: z.boolean(), value: z.string(), type: z.string() })),
    active: z.boolean(),
    meta: resourceMeta,
  })
  .meta({ id: "ScimUser", description: "A SCIM user (RFC 7643 §4.1)" });

const scimGroup = z
  .looseObject({
    schemas: z.array(z.string()),
    id: z.guid(),
    displayName: z.string(),
    members: z.array(z.object({ value: z.guid(), display: z.string() })),
    meta: resourceMeta,
  })
  .meta({
    id: "ScimGroup",
    description:
      "A SCIM group. Its extension key (the Callibrator group schema URN) states what membership grants: " +
      "`{ roleId, roleName, grantsAccess }` (A-39).",
  });

const listOf = (resource: z.ZodType) =>
  z.object({
    schemas: z.array(z.string()),
    totalResults: z.number().int(),
    startIndex: z.number().int(),
    itemsPerPage: z.number().int(),
    Resources: z.array(resource),
  });

/** The router's own refusal (requireApiKeyOrAdmin): a SCIM error, not the envelope. */
const scimRefusal = z.object({
  schemas: z.array(z.string()),
  detail: z.string(),
  status: z.literal("403"),
});
const forbidden = {
  403: {
    description:
      "A principal that is neither a `scim`-scoped API key nor the super admin (a SCIM error), or a role SCIM may not assign (the envelope)",
    body: z.union([scimRefusal, ErrorEnvelope]),
    example: {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "SCIM endpoints require an API key scoped scim:read (GET) or scim:write",
      status: "403",
    },
  },
} as const;

const USER_CONFLICT = "The address is already an account (a key's conflicts are budgeted: past the budget, 429 before any lookup).";

export default defineRouteDocs({
  router: "api/scim.route",
  mount: "/api/v1/scim/v2",
  tag: "SCIM",
  tagDescription:
    "SCIM 2.0 user and group provisioning for an identity provider, with a `scim`-scoped API key sent as `Authorization: Bearer <key>`.",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/Users",
      operationId: "scimListUsers",
      summary: "List users",
      permission: scimKey,
      audited: false,
      query: listQuery,
      success: { status: 200, description: "A SCIM list response", data: listOf(scimUser) },
      errorBodies: forbidden,
    },
    {
      method: "get",
      path: "/Users/:id",
      operationId: "scimGetUser",
      summary: "Get a user",
      permission: scimKey,
      audited: false,
      params,
      success: { status: 200, description: "The user", data: scimUser },
      errorBodies: forbidden,
    },
    {
      method: "post",
      path: "/Users",
      operationId: "scimCreateUser",
      summary: "Provision a user",
      description: "SCIM may never assign SUPERADMIN or a system role (A-27).",
      permission: scimKey,
      audited: true,
      body: scimUserSchema,
      success: { status: 201, description: "The new user", data: scimUser },
      conflict: USER_CONFLICT,
      errorBodies: forbidden,
    },
    {
      method: "put",
      path: "/Users/:id",
      operationId: "scimReplaceUser",
      summary: "Replace a user",
      permission: scimKey,
      audited: true,
      params,
      body: scimUserSchema,
      success: { status: 200, description: "The user", data: scimUser },
      conflict: USER_CONFLICT,
      errorBodies: forbidden,
    },
    {
      method: "patch",
      path: "/Users/:id",
      operationId: "scimPatchUser",
      summary: "Patch a user (e.g. deactivate)",
      description: "RFC 7644 §3.5.2 operations; an unsupported op or path is a 400, never a silent no-op (A-33).",
      permission: scimKey,
      audited: true,
      params,
      body: scimPatchSchema,
      success: { status: 200, description: "The user", data: scimUser },
      errorBodies: forbidden,
    },
    {
      method: "delete",
      path: "/Users/:id",
      operationId: "scimDeleteUser",
      summary: "De-provision a user",
      permission: scimKey,
      audited: true,
      params,
      success: { status: 204, description: "De-provisioned (no body)", noContent: true },
      errorBodies: forbidden,
    },
    {
      method: "get",
      path: "/Groups",
      operationId: "scimListGroups",
      summary: "List groups",
      permission: scimKey,
      audited: false,
      query: listQuery,
      success: { status: 200, description: "A SCIM list response", data: listOf(scimGroup) },
      errorBodies: forbidden,
    },
    {
      method: "get",
      path: "/Groups/:id",
      operationId: "scimGetGroup",
      summary: "Get a group",
      permission: scimKey,
      audited: false,
      params,
      success: { status: 200, description: "The group", data: scimGroup },
      errorBodies: forbidden,
    },
    {
      method: "post",
      path: "/Groups",
      operationId: "scimCreateGroup",
      summary: "Provision a group",
      description: "An unmapped group (no `roleId`) grants nothing and refuses members until it is mapped (ADR-053).",
      permission: scimKey,
      audited: true,
      body: scimGroupSchema,
      success: { status: 201, description: "The new group", data: scimGroup },
      conflict: "A group with that display name exists in the tenant.",
      errorBodies: forbidden,
    },
    {
      method: "put",
      path: "/Groups/:id",
      operationId: "scimReplaceGroup",
      summary: "Replace a group",
      permission: scimKey,
      audited: true,
      params,
      body: scimGroupSchema,
      success: { status: 200, description: "The group", data: scimGroup },
      conflict: "A group with that display name exists in the tenant.",
      errorBodies: forbidden,
    },
    {
      method: "patch",
      path: "/Groups/:id",
      operationId: "scimPatchGroup",
      summary: "Patch a group (e.g. add or remove members)",
      permission: scimKey,
      audited: true,
      params,
      body: scimPatchSchema,
      success: { status: 200, description: "The group", data: scimGroup },
      errorBodies: forbidden,
    },
    {
      method: "delete",
      path: "/Groups/:id",
      operationId: "scimDeleteGroup",
      summary: "De-provision a group",
      permission: scimKey,
      audited: true,
      params,
      success: { status: 204, description: "De-provisioned (no body)", noContent: true },
      errorBodies: forbidden,
    },
  ],
});
