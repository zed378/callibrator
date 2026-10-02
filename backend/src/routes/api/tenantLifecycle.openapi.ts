/**
 * P9-21 / P9-25 (ADR-103) — the contract of `tenantLifecycle.route.ts`, code-first.
 *
 * Mounted on `/api/v1/tenants` beside tenant.route and dataRetention.route.
 * `router.use(auth)` authenticates every route. The status read needs
 * `tenant-lifecycle: read` with `checkTenant` (A-155: another tenant's id is a
 * 404); every transition and the export are super admin only. No route
 * mounts a schema: the controller validates with the shared schemas
 * (`@callibrator/contracts/tenantLifecycle`). A transition the tenant's state
 * does not allow is a 409 that names the state (A-279, W-21). Answers carry
 * the tenant without the credentials mirrored into its settings (A-263).
 * Examples are synthetic.
 *
 * A-338 (fixed 2026-10-01): POST /:tenantId/offboard reads an optional body
 * `force` (`offboardTenantSchema`), as the module reference specifies.
 */
import { z } from "zod";
import { offboardTenantSchema, suspendTenantSchema } from "../../validators/tenantLifecycle.validator";
import { tenantIdParams, tenantRow, TENANT_STATUSES } from "../../docs/openapi/tenantSchemas";
import { defineRouteDocs } from "../../docs/openapi/operation";

const superAdmin = { kind: "superAdminOnly" } as const;

export default defineRouteDocs({
  router: "api/tenantLifecycle.route",
  mount: "/api/v1/tenants",
  tag: "TenantLifecycle",
  tagDescription:
    "A tenant's lifecycle: suspension, the grace period of a suspended tenant, offboarding (status `deleted`, data kept " +
    "for the retention period) and its cancellation, and the full data export.",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/:tenantId/status",
      operationId: "getTenantLifecycleStatus",
      summary: "Get a tenant's lifecycle status",
      permission: { kind: "dynamicAccess", resource: "tenant-lifecycle", action: "read" },
      audited: false,
      params: tenantIdParams,
      success: {
        status: 200,
        description: "The lifecycle state",
        data: z.object({
          status: z.enum(TENANT_STATUSES).nullable(),
          lifecycleStatus: z.string().nullable().meta({ description: "The granular state (e.g. `OFFBOARDED`); the status when none is stored" }),
          gracePeriodExpiresAt: z.iso.datetime().nullable(),
          gracePeriodExpired: z.boolean(),
          offboardedAt: z.iso.datetime().nullable(),
          offboardRetentionExpiresAt: z.iso.datetime().nullable(),
        }),
      },
    },
    {
      method: "post",
      path: "/:tenantId/suspend",
      operationId: "suspendTenant",
      summary: "Suspend a tenant",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      body: suspendTenantSchema.pick({ reason: true }),
      success: { status: 200, description: "The suspended tenant", data: tenantRow },
      conflict: "The tenant is offboarded: cancel the offboarding first.",
    },
    {
      method: "post",
      path: "/:tenantId/resume",
      operationId: "resumeTenant",
      summary: "Resume a tenant",
      description: "An active tenant is answered as it is.",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      success: { status: 200, description: "The active tenant", data: tenantRow },
      conflict: "The tenant is offboarded: cancel the offboarding first.",
    },
    {
      method: "post",
      path: "/:tenantId/grace-period",
      operationId: "enterTenantGracePeriod",
      summary: "Start a suspended tenant's grace period",
      description: "The deadline after which the scheduler offboards the tenant.",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      success: { status: 200, description: "The tenant, with its grace period", data: tenantRow },
      conflict: "The tenant is not suspended: a grace period can only be set on a suspended tenant.",
    },
    {
      method: "post",
      path: "/:tenantId/offboard",
      operationId: "offboardTenant",
      summary: "Offboard a tenant",
      description:
        "Sets the status `deleted` and the retention deadline; nothing is deleted. Idempotent unless `force`: a tenant " +
        "already offboarded is answered as it is (the tenant itself, not `{ tenant }`) and nothing is audited; with `force` " +
        "it is offboarded again — a new `offboardedAt` and retention deadline (never shorter), audited with `force: true` (A-338).",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      body: offboardTenantSchema.omit({ tenantId: true }),
      success: {
        status: 200,
        description: "The offboarded tenant",
        data: z.union([z.object({ tenant: tenantRow }), tenantRow]),
      },
    },
    {
      method: "post",
      path: "/:tenantId/offboard/cancel",
      operationId: "cancelTenantOffboarding",
      summary: "Cancel a tenant's offboarding",
      description: "Returns the tenant to active.",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      success: { status: 200, description: "The active tenant", data: tenantRow },
      conflict: "The tenant is not offboarded: there is no offboarding to cancel.",
    },
    {
      method: "get",
      path: "/:tenantId/export",
      operationId: "exportTenantData",
      summary: "Export a tenant's data",
      description:
        "The tenant (settings without credentials), its users (allow-listed columns only, A-179), settings (credential " +
        "values masked), subscriptions and invoices.",
      permission: superAdmin,
      audited: false,
      params: tenantIdParams,
      success: {
        status: 200,
        description: "The export",
        data: z.object({
          tenant: tenantRow,
          users: z.array(
            z.object({
              id: z.guid(),
              tenantId: z.guid().nullable(),
              roleId: z.guid().nullable(),
              username: z.string(),
              email: z.string(),
              firstName: z.string().nullable(),
              lastName: z.string().nullable(),
              phone: z.string().nullable(),
              avatarUrl: z.string().nullable(),
              isActive: z.boolean().nullable(),
              status: z.string().nullable(),
              isEmailVerified: z.boolean().nullable(),
              lastLoginAt: z.iso.datetime().nullable(),
              createdAt: z.iso.datetime(),
              updatedAt: z.iso.datetime(),
            }),
          ),
          settings: z.array(z.looseObject({ key: z.string(), value: z.unknown() })),
          subscriptions: z.array(z.looseObject({})),
          invoices: z.array(z.looseObject({})),
          exportedAt: z.iso.datetime(),
        }),
      },
    },
  ],
});
