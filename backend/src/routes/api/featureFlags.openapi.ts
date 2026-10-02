/**
 * P9-21 / P9-25 (ADR-103) — the contract of `featureFlags.route.ts`, code-first.
 *
 * `router.use(auth)` authenticates every route. The reads need
 * `feature-flags: read`; the tenant reads carry `checkTenant` (A-155), so a
 * tenant id that is not the caller's, in the path OR the query, answers 404
 * like one that does not exist. The writes are super admin only. No route
 * mounts a schema: the controller validates with the shared schemas
 * (`@callibrator/contracts/featureFlag`), which are the objects documented
 * here. Examples are synthetic.
 */
import { z } from "zod";
import { flagValueSchema, tenantFlagQuerySchema } from "../../validators/featureFlag.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

const canRead = { kind: "dynamicAccess", resource: "feature-flags", action: "read" } as const;
const superAdmin = { kind: "superAdminOnly" } as const;

/** One flag as the tenant has it: its definition merged with the tenant's override. */
const flagState = z.object({
  enabled: z.boolean(),
  category: z.string().meta({ example: "calibration" }),
  description: z.string(),
  defaultValue: z.boolean(),
  tenantOverride: z.boolean().meta({ description: "Whether the tenant overrides the default" }),
});

/** Every defined flag, keyed by flag key. */
const tenantFlags = z
  .record(z.string(), flagState)
  .meta({ id: "TenantFeatureFlags", description: "Every defined flag, keyed by its key (e.g. `enable_iot`)" });

/**
 * The path parameters, as `flagKeySchema` / `tenantFlagQuerySchema` check them
 * in the controller (a UUID shape; a non-empty key), with examples.
 */
const tenantParams = z.object({
  tenantId: z.guid().meta({ description: "The tenant's id", example: "2b7c9e41-5d3a-4f6e-8a1b-0c9d8e7f6a5b" }),
});
const flagParams = tenantParams.extend({
  flagKey: z.string().min(1).meta({ description: "The flag's key", example: "enable_iot" }),
});

/** POST /:tenantId/:flagKey — the body part of `flagValueSchema`. */
const setBody = flagValueSchema.pick({ enabled: true });

export default defineRouteDocs({
  router: "api/featureFlags.route",
  mount: "/api/v1/feature-flags",
  tag: "FeatureFlags",
  tagDescription: "Per-tenant feature flags: a catalogue of definitions with plan defaults, and per-tenant overrides.",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "getTenantFeatureFlags",
      summary: "Get a tenant's effective flags",
      description: "`tenantId` must be the caller's own (otherwise 404); the super admin may name any.",
      permission: canRead,
      audited: false,
      query: tenantFlagQuerySchema,
      success: { status: 200, description: "Every flag, with the tenant's value", data: tenantFlags },
      errors: [404],
    },
    {
      method: "get",
      path: "/definitions",
      operationId: "getFeatureFlagDefinitions",
      summary: "Get the flag definitions catalogue",
      permission: canRead,
      audited: false,
      success: {
        status: 200,
        description: "The definitions, keyed by flag key",
        data: z.record(z.string(), z.object({ category: z.string(), defaultValue: z.boolean(), description: z.string() })),
      },
    },
    {
      method: "get",
      path: "/:tenantId/:flagKey",
      operationId: "isFeatureFlagEnabled",
      summary: "Whether a flag is enabled for a tenant",
      description: "An unknown flag key is `enabled: false`, not an error.",
      permission: canRead,
      audited: false,
      params: flagParams,
      success: { status: 200, description: "The flag's state", data: z.object({ flagKey: z.string(), enabled: z.boolean() }) },
    },
    {
      method: "post",
      path: "/:tenantId/initialize",
      operationId: "initializeTenantFeatureFlags",
      summary: "Seed a tenant's default flags",
      permission: superAdmin,
      audited: true,
      params: tenantParams,
      success: { status: 200, description: "The tenant's flags after seeding", data: tenantFlags },
    },
    {
      method: "post",
      path: "/:tenantId/:flagKey",
      operationId: "setTenantFeatureFlag",
      summary: "Set a flag override",
      description: "An unknown flag key is a 400.",
      permission: superAdmin,
      audited: true,
      params: flagParams,
      body: setBody,
      success: {
        status: 200,
        description: "The stored override",
        data: z.object({
          flagKey: z.string(),
          enabled: z.boolean(),
          created: z.boolean().nullable().meta({ description: "Whether the override row was created (null where the database does not say)" }),
          setting: z.looseObject({ id: z.guid(), tenantId: z.guid(), key: z.string(), value: z.string() }),
        }),
      },
    },
    {
      method: "delete",
      path: "/:tenantId/:flagKey",
      operationId: "resetTenantFeatureFlag",
      summary: "Reset a flag to its default",
      description: "Idempotent: `reset` is false when there was no override (and nothing is audited).",
      permission: superAdmin,
      audited: true,
      params: flagParams,
      success: {
        status: 200,
        description: "The reset",
        data: z.object({ flagKey: z.string(), reset: z.boolean(), defaultValue: z.boolean() }),
      },
    },
  ],
});
