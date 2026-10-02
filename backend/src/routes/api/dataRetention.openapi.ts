/**
 * P9-21 / P9-25 (ADR-103) — the contract of `dataRetention.route.ts`, code-first.
 *
 * Mounted on `/api/v1/tenants` beside tenant.route and tenantLifecycle.route.
 * `router.use(auth)` authenticates every route. The two reads need
 * `data-retention: read` with `checkTenant` (A-136: another tenant's id is a
 * 404); the writes are super admin only. No route mounts a schema: the
 * controller validates path and body together with the shared schemas
 * (`@callibrator/contracts/dataRetention`); the bodies below are their body
 * parts. Examples are synthetic.
 */
import { z } from "zod";
import { legalHoldSchema, retentionPolicySchema } from "../../validators/dataRetention.validator";
import { tenantIdParams } from "../../docs/openapi/tenantSchemas";
import { defineRouteDocs } from "../../docs/openapi/operation";

const canRead = { kind: "dynamicAccess", resource: "data-retention", action: "read" } as const;
const superAdmin = { kind: "superAdminOnly" } as const;

/** The purgeable entities and their retention in days (0: kept forever). */
const policies = z
  .object({
    notifications: z.number().int().min(0),
    sessions: z.number().int().min(0),
    iot_readings: z.number().int().min(0),
  })
  .meta({ description: "Retention in days per purgeable entity; 0 keeps forever", example: { notifications: 90, sessions: 30, iot_readings: 0 } });

const anomaly = z.object({
  entity: z.string(),
  source: z.enum(["environment", "tenant_settings"]),
  value: z.unknown(),
  appliedDays: z.number().int().nullable(),
});

/**
 * POST /:tenantId/mask-pii — the body part of `piiMaskSchema`. For
 * `audit_logs` the data subjects' user ids go in `subjectIds` (A-135) and
 * `recordIds` is refused; for `users`, the reverse.
 */
const maskBody = z.object({
  entityType: z.enum(["users", "audit_logs"]).meta({ description: "Any other value passes validation and is a 400 from the service" }),
  recordIds: z.array(z.guid()).min(1).optional().meta({ description: "The users to mask (entityType `users`)" }),
  subjectIds: z.array(z.guid()).min(1).optional().meta({ description: "The data subjects whose audit rows are masked (entityType `audit_logs`)" }),
});

/** POST /:tenantId/anonymize — the body part of `anonymizeSchema` (always refused). */
const anonymizeBody = z.object({
  entityType: z.string().min(1),
  options: z.object({ keepDates: z.boolean().optional(), keepNumericIds: z.boolean().optional() }).optional(),
});

export default defineRouteDocs({
  router: "api/dataRetention.route",
  mount: "/api/v1/tenants",
  tag: "DataRetention",
  tagDescription:
    "Per-tenant retention periods, the purge they drive, legal hold (which stops purge and masking), and PII masking " +
    "of named data subjects. Audit rows are never purged.",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/:tenantId/policy",
      operationId: "getRetentionPolicy",
      summary: "Get a tenant's retention policy",
      description: "The platform defaults overlaid with the tenant's valid overrides (an invalid stored override is not applied, W-16).",
      permission: canRead,
      audited: false,
      params: tenantIdParams,
      success: { status: 200, description: "Retention in days per entity", data: policies },
    },
    {
      method: "put",
      path: "/:tenantId/policy",
      operationId: "setRetentionPolicy",
      summary: "Set one retention period",
      description:
        "`policyKey` is a purgeable entity (`notifications`, `sessions`, `iot_readings`); `audit_logs` is refused. " +
        "`days` is 0 (keep forever) or at least the entity's floor.",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      body: retentionPolicySchema.omit({ tenantId: true }),
      success: {
        status: 200,
        description: "The stored period",
        data: z.object({ policyKey: z.enum(["notifications", "sessions", "iot_readings"]), days: z.number().int().min(0) }),
      },
    },
    {
      method: "get",
      path: "/:tenantId/legal-hold",
      operationId: "getLegalHold",
      summary: "Whether a tenant is on legal hold",
      permission: canRead,
      audited: false,
      params: tenantIdParams,
      success: { status: 200, description: "The legal-hold state", data: z.object({ tenantId: z.guid(), onLegalHold: z.boolean() }) },
    },
    {
      method: "post",
      path: "/:tenantId/legal-hold",
      operationId: "enableLegalHold",
      summary: "Put a tenant on legal hold",
      description: "Purge and PII masking stop for the tenant until the hold is lifted.",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      body: legalHoldSchema.omit({ tenantId: true }),
      success: {
        status: 200,
        description: "The hold",
        data: z.object({ tenantId: z.guid(), enabled: z.literal(true), reason: z.string().nullable().optional(), enabledBy: z.string().nullable().optional() }),
      },
    },
    {
      method: "delete",
      path: "/:tenantId/legal-hold",
      operationId: "disableLegalHold",
      summary: "Lift a tenant's legal hold",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      success: {
        status: 200,
        description: "The hold, lifted",
        data: z.object({ tenantId: z.guid(), enabled: z.literal(false), disabledBy: z.string().nullable().optional() }),
      },
    },
    {
      method: "post",
      path: "/:tenantId/purge",
      operationId: "purgeExpiredRecords",
      summary: "Purge a tenant's expired records",
      description: "Deletes expired notifications, sessions and (when a period is set) IoT readings, in bounded passes. Skipped under legal hold.",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      success: {
        status: 200,
        description: "What was purged, or why nothing was",
        data: z.union([
          z.object({ skipped: z.literal(true), reason: z.literal("legal_hold") }),
          z.object({
            tenantId: z.guid(),
            purged: z.record(z.string(), z.number().int()),
            skipped: z.literal(false),
            complete: z.boolean().meta({ description: "false: the time budget ran out; the next run continues" }),
            anomalies: z.array(anomaly),
          }),
        ]),
      },
    },
    {
      method: "post",
      path: "/:tenantId/mask-pii",
      operationId: "maskPii",
      summary: "Mask named data subjects' personal data",
      description: "Refused (400) while the tenant is on legal hold.",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      body: maskBody,
      success: {
        status: 200,
        description: "How many rows were masked, and which fields",
        data: z.object({ masked: z.number().int(), fields: z.array(z.string()) }),
      },
    },
    {
      method: "post",
      path: "/:tenantId/anonymize",
      operationId: "anonymizeDataset",
      summary: "Anonymize a dataset (refused)",
      description:
        "A-152: refused with a 400 for every entity type, after the body is validated. It overwrote every text column of " +
        "every row with no transaction or audit row. Mask named data subjects with `mask-pii` instead. The 200 below is " +
        "never answered.",
      permission: superAdmin,
      audited: false,
      params: tenantIdParams,
      body: anonymizeBody,
      success: { status: 200, description: "Never answered (the route always refuses)", empty: true },
    },
  ],
});
