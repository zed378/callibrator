/**
 * P9-21 / P9-25 (ADR-103) — the contract of `networkSecurity.route.ts`, code-first.
 *
 * `router.use(auth)` authenticates every route. The home-tenant routes act on
 * the caller's OWN tenant: reads (and the evaluate dry run, A-179) need
 * `network-security: read`, writes `network-security: write` and a JWT
 * (`denyApiKey`), all with `checkTenant` (another tenant named in the request
 * is a 404). The `/tenants/:tenantId/...` routes are the platform operator's
 * (A-280), super admin only. No route mounts a schema: the controller
 * validates the body with validators/networkSecurity.validator, whose schemas
 * are the bodies below. Examples are synthetic (RFC 5737 addresses).
 */
import { z } from "zod";
import { evaluateLoginSchema, geofenceSchema, ipAllowlistSchema } from "../../validators/networkSecurity.validator";
import { tenantIdParams } from "../../docs/openapi/tenantSchemas";
import { defineRouteDocs } from "../../docs/openapi/operation";

const canRead = { kind: "dynamicAccess", resource: "network-security", action: "read" } as const;
const canWrite = { kind: "dynamicAccess", resource: "network-security", action: "write" } as const;
const superAdmin = { kind: "superAdminOnly" } as const;

const geofence = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusKm: z.number().positive().meta({ description: "50 when not given" }),
  })
  .meta({ id: "Geofence", example: { latitude: -6.2, longitude: 106.8, radiusKm: 50 } });

const allowlist = z
  .array(z.string())
  .meta({ description: "Normalised addresses and CIDRs; empty: no restriction", example: ["192.0.2.0/24", "198.51.100.7"] });

/**
 * PUT /geofence — `geofenceSchema`, plus the caller's own `currentLocation`,
 * read by the self-lockout guard (a platform operator is exempt).
 */
const homeGeofenceBody = geofenceSchema.extend({
  currentLocation: z
    .object({ latitude: z.number(), longitude: z.number() })
    .optional()
    .meta({ description: "Where the caller is; must be inside the new fence, else 409 SELF_LOCKOUT" }),
});

const lockout =
  "SELF_LOCKOUT (the body carries `code: \"SELF_LOCKOUT\"`): the change would refuse the caller's own next sign-in. " +
  "A platform operator is exempt.";

export default defineRouteDocs({
  router: "api/networkSecurity.route",
  mount: "/api/v1/network-security",
  tag: "NetworkSecurity",
  tagDescription:
    "A tenant's sign-in restrictions: the IP allowlist (every sign-in, A-288) and the geofence (password, MFA and passkey " +
    "sign-ins from a device-reported location).",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/ip-allowlist",
      operationId: "getIpAllowlist",
      summary: "Get the caller's tenant's IP allowlist",
      permission: canRead,
      audited: false,
      success: { status: 200, description: "The allowlist", data: z.object({ allowlist }) },
    },
    {
      method: "put",
      path: "/ip-allowlist",
      operationId: "setIpAllowlist",
      summary: "Set the caller's tenant's IP allowlist",
      description: "Replaces the list. A tenant administrator since Q-38 (ADR-100). API keys are refused.",
      permission: canWrite,
      audited: true,
      body: ipAllowlistSchema,
      success: { status: 200, description: "The stored allowlist", data: z.object({ tenantId: z.guid(), allowlist }) },
      conflict: lockout,
    },
    {
      method: "get",
      path: "/geofence",
      operationId: "getGeofence",
      summary: "Get the caller's tenant's geofence",
      permission: canRead,
      audited: false,
      success: { status: 200, description: "The geofence, or null", data: z.object({ geofence: geofence.nullable() }) },
    },
    {
      method: "put",
      path: "/geofence",
      operationId: "setGeofence",
      summary: "Set the caller's tenant's geofence",
      description: "Replaces the geofence. API keys are refused.",
      permission: canWrite,
      audited: true,
      body: homeGeofenceBody,
      success: { status: 200, description: "The stored geofence", data: z.object({ tenantId: z.guid(), geofence }) },
      conflict: lockout,
    },
    {
      method: "post",
      path: "/evaluate-login",
      operationId: "evaluateLoginSecurity",
      summary: "Test an address and location against the policy",
      description:
        "A dry run for the network-security screen; no sign-in calls it. A missing coordinate is outside any geofence " +
        "(fail closed).",
      permission: canRead,
      audited: false,
      body: evaluateLoginSchema,
      success: {
        status: 200,
        description: "The verdict",
        data: z.object({
          allowed: z.boolean(),
          ip: z.union([
            z.object({ allowed: z.boolean(), reason: z.literal("no_restrictions") }),
            z.object({ allowed: z.boolean(), ip: z.string(), allowlist }),
          ]),
          geofence: z.union([
            z.object({ allowed: z.boolean(), reason: z.literal("no_geofence") }),
            z.object({ allowed: z.boolean(), distanceKm: z.number().nullable(), radiusKm: z.number() }),
          ]),
          requiresStepUp: z.boolean(),
        }),
      },
    },
    {
      method: "get",
      path: "/tenants/:tenantId/ip-allowlist",
      operationId: "getTenantIpAllowlistFor",
      summary: "Get a named tenant's IP allowlist",
      permission: superAdmin,
      audited: false,
      params: tenantIdParams,
      success: { status: 200, description: "The allowlist", data: z.object({ allowlist }) },
    },
    {
      method: "put",
      path: "/tenants/:tenantId/ip-allowlist",
      operationId: "setTenantIpAllowlistFor",
      summary: "Set a named tenant's IP allowlist",
      description: "Audited under PLATFORM and the tenant. No self-lockout guard applies.",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      body: ipAllowlistSchema,
      success: { status: 200, description: "The stored allowlist", data: z.object({ tenantId: z.guid(), allowlist }) },
    },
    {
      method: "get",
      path: "/tenants/:tenantId/geofence",
      operationId: "getTenantGeofenceFor",
      summary: "Get a named tenant's geofence",
      permission: superAdmin,
      audited: false,
      params: tenantIdParams,
      success: { status: 200, description: "The geofence, or null", data: z.object({ geofence: geofence.nullable() }) },
    },
    {
      method: "put",
      path: "/tenants/:tenantId/geofence",
      operationId: "setTenantGeofenceFor",
      summary: "Set a named tenant's geofence",
      description: "Audited under PLATFORM and the tenant. No self-lockout guard applies.",
      permission: superAdmin,
      audited: true,
      params: tenantIdParams,
      body: geofenceSchema,
      success: { status: 200, description: "The stored geofence", data: z.object({ tenantId: z.guid(), geofence }) },
    },
  ],
});
