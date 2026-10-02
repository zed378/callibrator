/**
 * P9-21 / P9-25 (ADR-103) — the contract of `tenant.route.ts`, code-first.
 *
 * Listing, creating and deleting tenants are platform operations: super admin
 * only (A-76). Reading and editing one's own tenant, its settings and its logo
 * need the `management` menu with `checkTenant` (another tenant's id is a
 * 404). `GET /public` is the unauthenticated branding read for the sign-in
 * page. No route mounts a schema: the controller validates path, query and
 * body together with the shared schemas (`@callibrator/contracts/tenant`),
 * which are the bodies below; the tenant named is in the BODY on the POST
 * reads (`/detail`, `/settings`, `/user-count`). Create and edit also take
 * multipart/form-data with an optional `logo` file (the JSON fields as form
 * fields). Answers carry the tenant without the credentials mirrored into its
 * settings (A-150). Examples are synthetic.
 */
import { z } from "zod";
import {
  createTenantSchema,
  deleteTenantSchema,
  getAllTenantsQuery,
  getTenantSchema,
  tenantIdSchema,
  updateTenantSchema,
} from "../../validators/tenant.validator";
import { tenantIdParams, tenantRow } from "../../docs/openapi/tenantSchemas";
import { defineRouteDocs } from "../../docs/openapi/operation";

const superAdmin = { kind: "superAdminOnly" } as const;
const management = (action: "read" | "update" | "write") => ({ kind: "dynamicAccess", resource: "management", action }) as const;

const LOGO_RULE = "An image (JPEG, PNG, GIF or WebP; SVG is refused) of at most MAX_FILE_SIZE (5 MB by default).";

export default defineRouteDocs({
  router: "api/tenant.route",
  mount: "/api/v1/tenants",
  tag: "Tenants",
  tagDescription: "Tenants (organisations): the platform's list, create and delete; a tenant's own profile, settings and logo.",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/all",
      operationId: "listTenants",
      summary: "List every tenant",
      permission: superAdmin,
      audited: false,
      query: getAllTenantsQuery,
      success: { status: 200, description: "A page of tenants", list: tenantRow },
    },
    {
      method: "post",
      path: "/detail",
      operationId: "getTenant",
      summary: "Get a tenant",
      description: "The tenant is named in the body.",
      permission: management("read"),
      audited: false,
      body: getTenantSchema,
      success: { status: 200, description: "The tenant", data: tenantRow },
      errors: [404],
    },
    {
      method: "get",
      path: "/public",
      operationId: "getTenantPublicBranding",
      summary: "A tenant's public branding (no token)",
      description:
        "For the sign-in page: name, code, colour and logo of an ACTIVE tenant, named by the `X-Tenant-ID` header or the " +
        "`tenantId` query. Anything else, or a tenant that is not active, is a 404.",
      permission: null,
      audited: false,
      query: z.object({ tenantId: z.guid().optional().meta({ description: "When no X-Tenant-ID header is sent" }) }),
      success: {
        status: 200,
        description: "The branding",
        data: z.object({
          id: z.guid(),
          name: z.string(),
          code: z.string().nullable(),
          primaryColor: z.string().nullable(),
          logoBaseUrl: z.string().nullable(),
        }),
      },
      errors: [404],
    },
    {
      method: "post",
      path: "/create",
      operationId: "createTenant",
      summary: "Create a tenant",
      description:
        `Super admin only (A-76). JSON, or multipart/form-data with an optional \`logo\` file. ${LOGO_RULE} A \`logo\` ` +
        "field in the body is never stored (A-79). Rate-limited (`tenantCreate`).",
      permission: superAdmin,
      audited: true,
      body: createTenantSchema,
      success: { status: 201, description: "The new tenant", data: tenantRow },
      conflict: "A tenant with that code or name exists.",
    },
    {
      method: "patch",
      path: "/edit",
      operationId: "updateTenant",
      summary: "Edit a tenant",
      description:
        `The tenant is \`tenantId\` in the body. JSON, or multipart/form-data with an optional \`logo\` file. ${LOGO_RULE} ` +
        "Counts against the storage quota. For a multipart body the gate cannot read `tenantId`; tenant.service#updateTenant " +
        "enforces ownership (A-63). Rate-limited (`tenantUpload`).",
      permission: management("update"),
      audited: true,
      body: updateTenantSchema,
      success: { status: 200, description: "The tenant", data: tenantRow },
      conflict: "Another tenant has that code or name.",
      errors: [404],
    },
    {
      method: "delete",
      path: "/delete",
      operationId: "deleteTenant",
      summary: "Delete a tenant",
      description: "Super admin only (A-76). The tenant is `tenantId` in the query (or the body).",
      permission: superAdmin,
      audited: true,
      query: deleteTenantSchema,
      success: { status: 200, description: "Deleted", empty: true },
      errors: [404],
    },
    {
      method: "post",
      path: "/settings",
      operationId: "getTenantSettings",
      summary: "Get a tenant's settings",
      description: "The tenant is named in the body. Secret settings are masked.",
      permission: management("read"),
      audited: false,
      body: tenantIdSchema,
      success: {
        status: 200,
        description: "The tenant and its settings",
        data: z.object({ tenant: tenantRow, settings: z.record(z.string(), z.unknown()) }),
      },
      errors: [404],
    },
    {
      method: "patch",
      path: "/settings",
      operationId: "updateTenantSettings",
      summary: "Update a tenant's settings",
      // P9-25 item 11: tenant.service#settingEntries — `tenantId` is never a
      // setting, and a nested `settings` object is unwrapped (its keys win).
      description:
        "The settings to write: the keys of a nested `settings` object, and any other top-level key (`tenantId` excluded). " +
        "Each key must be on the tenant-admin allow-list and each value a scalar or null — else 400, nothing written (A-176). Audited (A-117).",
      permission: management("write"),
      audited: true,
      body: z
        .looseObject({
          tenantId: z.guid(),
          settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional().meta({ description: "The settings, by key" }),
        })
        .meta({ description: "The tenant, and the settings to write" }),
      success: { status: 200, description: "The settings, secrets masked", data: z.record(z.string(), z.unknown()) },
      errors: [404],
    },
    {
      method: "post",
      path: "/user-count",
      operationId: "getTenantUserCount",
      summary: "Count a tenant's users against its seats",
      description: "The tenant is named in the body.",
      permission: management("read"),
      audited: false,
      body: tenantIdSchema,
      success: {
        status: 200,
        description: "The count",
        data: z.object({
          tenantId: z.guid(),
          userCount: z.number().int(),
          limitSeats: z.number().int().nullable(),
          remainingSlots: z.number().int().nullable(),
          unlimited: z.boolean(),
        }),
      },
      errors: [404],
    },
    {
      method: "post",
      path: "/:tenantId/logo",
      operationId: "uploadTenantLogo",
      summary: "Upload a tenant's logo",
      description: `${LOGO_RULE} No file is a 400.`,
      permission: management("update"),
      audited: true,
      params: tenantIdParams,
      body: z.object({ file: z.file().meta({ description: "The logo" }) }).meta({ description: "multipart/form-data with a `file` field" }),
      bodyMediaType: "multipart/form-data",
      success: { status: 200, description: "The stored logo file name", data: z.object({ logo: z.string() }) },
    },
    {
      method: "delete",
      path: "/:tenantId/logo",
      operationId: "removeTenantLogo",
      summary: "Remove a tenant's logo",
      permission: management("update"),
      audited: true,
      params: tenantIdParams,
      success: { status: 200, description: "The logo is gone", data: z.object({ logo: z.null() }) },
    },
  ],
});
