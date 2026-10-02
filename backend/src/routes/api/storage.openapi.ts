/**
 * P9-18 / P9-25 (ADR-103) — the contract of `storage.route.ts`, code-first.
 *
 * The settings hold the tenant's object-storage credentials and decide where
 * every uploaded file is written (A-02): TENANT_ADMIN and JWT only (an API key
 * must not be able to redirect storage). Credentials are never answered, only
 * whether they are set. A new configuration is health-checked before it is
 * saved, and every change is audited. The object stream is public: the HMAC
 * token is verified before storage is touched, and the key names its owning
 * tenant, so a token for one tenant's key opens only that tenant's object.
 * Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { updateStorageSettingsSchema } from "../../validators/storage.validator";

const tenantAdmin = { kind: "rbac", roles: ["TENANT_ADMIN"] } as const;

/** A JSON Schema object as the override sees it. */
interface JsonObject {
  properties?: Record<string, unknown>;
  required?: string[];
  oneOf?: JsonObject[];
  anyOf?: JsonObject[];
  type?: string;
}

/**
 * The per-provider body (a discriminated union on `provider`) with its
 * branches' fields also listed at the top: every field any provider accepts,
 * and as required the fields every provider requires. The branches stay as
 * `oneOf`, so a client still sees which fields go with which provider; P6-08
 * reads the top-level list on the same terms as the validator (a union accepts
 * the union of its keys and requires what every branch requires).
 */
const settingsBody = updateStorageSettingsSchema.meta({
  override: ({ jsonSchema }) => {
    // A discriminated union renders as `oneOf`, each branch an object requiring its `provider`.
    const schema = jsonSchema as JsonObject;
    const branches = schema.oneOf as Required<JsonObject>[];
    schema.type = "object";
    // A key one branch forbids (`{ not: {} }`) keeps the schema of the branch that
    // accepts it, and `provider` is any branch's constant (P9-25: a last-wins merge
    // published `provider: "nfs"` and the other branch's fields as forbidden).
    const isNever = (value: unknown): boolean => "not" in (value as object);
    const properties: Record<string, unknown> = {};
    for (const branch of branches) {
      for (const [key, value] of Object.entries(branch.properties)) {
        if (!(key in properties) || isNever(properties[key])) {
          properties[key] = value;
        }
      }
    }
    properties["provider"] = {
      type: "string",
      enum: branches.map((branch) => (branch.properties["provider"] as { const: string }).const),
    };
    schema.properties = properties;
    const [first, ...rest] = branches.map((branch) => branch.required) as [string[], ...string[][]];
    schema.required = first.filter((key) => rest.every((required) => required.includes(key)));
  },
});

// storageSettings.service#publicView, field for field (P9-25 made it exact, 2026-10-02).
const StorageSettings = z
  .object({
    provider: z.enum(["default", "s3", "nfs"]).meta({ description: "`default`: the platform's storage (nothing configured)" }),
    usingPlatformDefault: z.boolean(),
    hasCredentials: z.boolean().optional().meta({ description: "Absent for `default`" }),
    bucket: z.string().optional().meta({ description: "s3 only" }),
    region: z.string().optional().meta({ description: "s3 only" }),
    endpoint: z.string().nullable().optional().meta({ description: "s3 only" }),
    forcePathStyle: z.boolean().optional().meta({ description: "s3 only" }),
    prefix: z.string().nullable().optional().meta({ description: "s3 only" }),
    root: z.string().optional().meta({ description: "nfs only" }),
    fsync: z.boolean().optional().meta({ description: "nfs only" }),
  })
  .meta({
    id: "StorageSettings",
    description: "The tenant's storage configuration, without its secrets: only whether credentials are set.",
    example: {
      provider: "s3",
      usingPlatformDefault: false,
      hasCredentials: true,
      bucket: "hospital-evidence",
      region: "eu-west-1",
      endpoint: null,
      forcePathStyle: false,
      prefix: null,
    },
  });

export default defineRouteDocs({
  router: "api/storage.route",
  mount: "/api/v1/storage",
  tag: "Storage",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/object",
      operationId: "getSignedStorageObject",
      summary: "Stream an object from a signed, expiring URL (no sign-in)",
      description:
        "Where local and NFS signed download URLs resolve (S3 URLs are presigned and never reach it). 403 for an invalid or expired token. ETag/304, a single byte Range (206, or 416 when unsatisfiable) and If-Range are honoured; images and PDF are served inline.",
      permission: null,
      audited: false,
      query: z.object({
        key: z.string().meta({ description: "The object key (it names the owning tenant)", example: "t/0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f/report.pdf" }),
        token: z.string().meta({ description: "The HMAC token from the signed URL", example: "1893456000.3f2a" }),
      }),
      success: { status: 200, description: "The object itself", file: { contentType: "application/octet-stream" } },
    },
    {
      method: "get",
      path: "/settings",
      operationId: "getStorageSettings",
      summary: "The tenant's storage configuration (secrets redacted)",
      permission: tenantAdmin,
      audited: false,
      success: { status: 200, description: "The configuration", data: StorageSettings },
    },
    {
      method: "put",
      path: "/settings",
      operationId: "updateStorageSettings",
      summary: "Configure the tenant's own storage (health-checked before it is saved)",
      permission: tenantAdmin,
      audited: true,
      body: settingsBody,
      success: { status: 200, description: "The configuration", data: StorageSettings },
    },
    {
      method: "delete",
      path: "/settings",
      operationId: "clearStorageSettings",
      summary: "Revert the tenant to the platform default storage",
      permission: tenantAdmin,
      audited: true,
      success: { status: 200, description: "The configuration", data: StorageSettings },
    },
    {
      method: "post",
      path: "/settings/test",
      operationId: "testStorageConnection",
      summary: "Health-check the tenant's active storage",
      permission: tenantAdmin,
      audited: false,
      success: {
        status: 200,
        description: "The result",
        // P9-25: what the drivers answer (local.driver / s3.driver healthCheck).
        data: z.object({
          ok: z.boolean(),
          driver: z.string(),
          bucket: z.string().optional().meta({ description: "s3 only" }),
          root: z.string().optional().meta({ description: "local and nfs only" }),
          error: z.string().optional(),
        }),
      },
    },
    {
      method: "get",
      path: "/usage",
      operationId: "getStorageUsage",
      summary: "The tenant's stored bytes and objects (a metering input)",
      permission: tenantAdmin,
      audited: false,
      success: {
        status: 200,
        description: "The usage",
        data: z.object({ bytes: z.number().int(), objects: z.number().int(), megabytes: z.number(), provider: z.string() }),
      },
    },
  ],
});
