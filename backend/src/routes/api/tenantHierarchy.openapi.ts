/**
 * P9-21 / P9-25 (ADR-103) — the contract of `tenantHierarchy.route.ts`, code-first.
 *
 * The reads carry `auth` and no gate factory: they read the CALLER's own
 * tenant (the tree) or, by id, only the caller's own tenant — the route's
 * `ownTenantOnly` guard answers 404 to any other id, never 403 (A-01); the
 * super admin reads any. So `permission` is `authenticated`. Re-parenting,
 * adding a child and the cross-tenant role read are platform operations:
 * JWT only (`denyApiKey`) and super admin only. The add-child body is checked
 * in the controller against `addChild` (`@callibrator/contracts/tenantHierarchy`);
 * the move body is read raw. Examples are synthetic.
 */
import { z } from "zod";
import { addChild } from "../../validators/tenantHierarchy.validator";
import { tenantIdParams, tenantRow } from "../../docs/openapi/tenantSchemas";
import { defineRouteDocs } from "../../docs/openapi/operation";

const ownTenant = {
  kind: "authenticated",
  reason: "the caller's own tenant: another tenant's id is a 404 (ownTenantOnly); the super admin reads any",
} as const;
const superAdmin = { kind: "superAdminOnly" } as const;

/** POST /:tenantId/children: the path's tenant is the PARENT of the one created. */
const parentParams = z.object({
  tenantId: z.guid().meta({ description: "The parent tenant's id", example: "2b7c9e41-5d3a-4f6e-8a1b-0c9d8e7f6a5b" }),
});

const treeChild = z.object({
  tenantId: z.guid(),
  code: z.string().nullable().optional(),
  name: z.string(),
  status: z.string().nullable(),
  depth: z.number().int(),
});

const tree = z.union([
  z.object({ isRoot: z.literal(true), children: z.array(z.never()).meta({ description: "Empty: the tenant has no hierarchy and no code" }) }),
  z.object({
    isRoot: z.boolean(),
    depth: z.number().int(),
    path: z.string().meta({ example: "/gh/gh-icu" }),
    tenant: tenantRow.optional(),
    children: z.array(treeChild),
  }),
]);

const moveResult = z.object({
  tenantId: z.guid(),
  parentId: z.guid().nullable(),
  path: z.string(),
  depth: z.number().int(),
  descendantsMoved: z.number().int(),
});

const MOVE_CONFLICT =
  "The tenant (or the new parent) has no code; the tenant is already a root, already under that parent, or would be " +
  "its own parent; or the move would exceed the maximum depth or create a cycle.";

export default defineRouteDocs({
  router: "api/tenantHierarchy.route",
  mount: "/api/v1/tenant-hierarchy",
  tag: "TenantHierarchy",
  tagDescription:
    "Parent tenants and their business units (sub-organizations). A hierarchy grants no reach into another tenant (ADR-084 Q-05).",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/tree",
      operationId: "getTenantTree",
      summary: "Get the caller's tenant tree",
      description: "The caller's tenant and its direct children. No query is read.",
      permission: ownTenant,
      audited: false,
      success: { status: 200, description: "The tree", data: tree },
    },
    {
      method: "get",
      path: "/:tenantId/children",
      operationId: "getTenantChildren",
      summary: "Get a tenant's direct children",
      permission: ownTenant,
      audited: false,
      params: tenantIdParams,
      success: { status: 200, description: "The children", data: z.object({ children: z.array(treeChild) }) },
    },
    {
      method: "get",
      path: "/:tenantId/parent",
      operationId: "getTenantParent",
      summary: "Get a tenant's parent",
      description: "`parent` is null for a root tenant.",
      permission: ownTenant,
      audited: false,
      params: tenantIdParams,
      success: { status: 200, description: "The parent", data: z.object({ parent: treeChild.nullable() }) },
    },
    {
      method: "get",
      path: "/:tenantId/descendants",
      operationId: "getTenantDescendants",
      summary: "Get a tenant's descendants",
      permission: ownTenant,
      audited: false,
      params: tenantIdParams,
      success: {
        status: 200,
        description: "Every descendant's id",
        data: z.object({ descendants: z.array(z.guid()) }),
      },
    },
    {
      method: "get",
      path: "/:tenantId/ancestors",
      operationId: "getTenantAncestors",
      summary: "Get a tenant's ancestors",
      description: "Root first; empty for a root tenant.",
      permission: ownTenant,
      audited: false,
      params: tenantIdParams,
      success: { status: 200, description: "The ancestors", data: z.object({ ancestors: z.array(treeChild) }) },
    },
    {
      method: "post",
      path: "/:tenantId/children",
      operationId: "addChildTenant",
      summary: "Add a sub-organization",
      description:
        "Creates a child tenant under an active parent; its code is derived from the parent's. With the hierarchy " +
        "disabled (HIERARCHY_ENABLED) the answer is a 400.",
      permission: superAdmin,
      audited: true,
      params: parentParams,
      body: addChild,
      success: {
        status: 201,
        description: "The new sub-organization",
        data: z.object({ tenantId: z.guid(), code: z.string(), path: z.string(), depth: z.number().int() }),
      },
      conflict:
        "The parent is not active, has no code, or is at the maximum depth; or a tenant with the derived code or subdomain exists.",
    },
    {
      method: "put",
      path: "/:tenantId/parent",
      operationId: "updateTenantParent",
      summary: "Move a tenant under another parent",
      description: "Moves the tenant and its descendants. `newParentId` must be a tenant id (else 400).",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      body: z.object({ newParentId: z.guid().meta({ description: "The new parent tenant" }) }),
      success: { status: 200, description: "Where the tenant now is", data: moveResult },
      conflict: MOVE_CONFLICT,
    },
    {
      method: "delete",
      path: "/:tenantId/parent",
      operationId: "removeTenantParent",
      summary: "Make a tenant a root tenant",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      success: { status: 200, description: "The tenant, now a root", data: moveResult.extend({ status: z.literal("root") }) },
      conflict: MOVE_CONFLICT,
    },
    {
      method: "get",
      path: "/cross-tenant-roles",
      operationId: "getCrossTenantRoles",
      summary: "Get a user's roles across tenants",
      description: "Without `userId`, `assignments` is empty.",
      permission: superAdmin,
      audited: false,
      query: z.object({ userId: z.string().optional().meta({ description: "The user" }) }),
      success: {
        status: 200,
        description: "The user's tenant roles",
        data: z.object({
          assignments: z.array(
            z.object({
              tenantId: z.guid(),
              tenantName: z.string().nullable(),
              tenantCode: z.string().nullable(),
              role: z.object({ id: z.guid(), name: z.string(), level: z.number().int().nullable() }).nullable(),
            }),
          ),
        }),
      },
    },
  ],
});
