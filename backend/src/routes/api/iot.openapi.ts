/**
 * P9-18 / P9-25 (ADR-103) — the contract of `iot.route.ts`, code-first.
 *
 * Ingest is public: the device authenticates with its ingest token (the
 * `x-iot-token` header, or `token` in the body), which is stored only as its
 * SHA-256 hash (A-29), and the endpoint is limited per client address (600 a
 * minute). A soft-deleted device or one with IoT disabled is refused (401).
 * Provisioning is tenant-scoped: reading the state needs `calibration` read;
 * changing it, and issuing, rotating or revoking the token, is TENANT_ADMIN with
 * `calibration` write and JWT only (an API key cannot mint device
 * credentials; A-46). Provisioning writes are audited. Request bodies are the
 * contract's own schemas (`@callibrator/contracts/iot`). Examples are
 * synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { updateIotConfigSchema } from "../../validators/iot.validator";

const tenantAdmin = { kind: "rbac", roles: ["TENANT_ADMIN"] } as const;
/** The path, as the controller checks it (`deviceIdSchema`), with an example. */
const deviceParams = z.object({ deviceId: z.guid().meta({ description: "The calibration device", example: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f" }) });
const ADMIN = "TENANT_ADMIN with `calibration` write, JWT only (an API key is refused).";

const IotConfig = z
  .object({
    deviceId: z.guid(),
    name: z.string(),
    iotEnabled: z.boolean(),
    readingTolerance: z.record(z.string(), z.object({ min: z.number().optional(), max: z.number().optional() }).loose()).nullable(),
    hasToken: z.boolean(),
    tokenIssuedAt: z.iso.datetime().nullable(),
  })
  .meta({
    id: "DeviceIotConfig",
    description: "A device's IoT provisioning state. The token itself is never answered here.",
    example: {
      deviceId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
      name: "Infusion pump",
      iotEnabled: true,
      readingTolerance: { temperature: { min: 2, max: 8 } },
      hasToken: true,
      tokenIssuedAt: "2030-01-15T09:00:00.000Z",
    },
  });

export default defineRouteDocs({
  router: "api/iot.route",
  mount: "/api/v1/iot",
  tag: "IoT",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/ingest",
      operationId: "ingestIotReading",
      summary: "Ingest device telemetry",
      description:
        "Public: authenticated by the device's ingest token in `x-iot-token` (or `token` in the body), not a bearer token. 401 without a token, for an unknown one, or for a device with IoT disabled; 400 without a `payload` object. Limited to 600 requests a minute per client address.",
      permission: null,
      audited: false,
      body: z
        .object({
          token: z.string().optional().meta({ description: "When the header is not sent" }),
          payload: z.object({}).loose().meta({ description: "The reading: metric names and values", example: { temperature: 4.2 } }),
        })
        .meta({ description: "Read by the controller; not validated by a schema on the route." }),
      errors: [429],
      success: {
        status: 200,
        description: "Ingested; `isAnomaly` says whether a value was outside the device's tolerance",
        data: z.object({ success: z.literal(true), isAnomaly: z.boolean() }),
      },
    },
    {
      method: "get",
      path: "/devices/:deviceId",
      operationId: "getDeviceIotConfig",
      summary: "A device's IoT provisioning state",
      permission: { kind: "dynamicAccess", resource: "calibration", action: "read" },
      audited: false,
      params: deviceParams,
      success: { status: 200, description: "The state", data: IotConfig },
    },
    {
      method: "patch",
      path: "/devices/:deviceId",
      operationId: "updateDeviceIotConfig",
      summary: "Enable or disable ingest and set the reading tolerance",
      description: ADMIN,
      permission: tenantAdmin,
      audited: true,
      params: deviceParams,
      body: updateIotConfigSchema,
      success: { status: 200, description: "The state", data: IotConfig },
    },
    {
      method: "post",
      path: "/devices/:deviceId/token",
      operationId: "issueDeviceIotToken",
      summary: "Issue or rotate the device's ingest token",
      description: `${ADMIN} The token is answered once; only its hash is stored.`,
      permission: tenantAdmin,
      audited: true,
      params: deviceParams,
      success: {
        status: 201,
        description: "The state, the new token and whether an old one was replaced",
        data: IotConfig.extend({ token: z.string(), rotated: z.boolean() }),
      },
    },
    {
      method: "delete",
      path: "/devices/:deviceId/token",
      operationId: "revokeDeviceIotToken",
      summary: "Revoke the device's ingest token and disable ingest",
      description: ADMIN,
      permission: tenantAdmin,
      audited: true,
      params: deviceParams,
      conflict: "The device has no token to revoke.",
      success: { status: 200, description: "The state", data: IotConfig },
    },
  ],
});
