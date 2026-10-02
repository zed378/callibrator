/**
 * P9-21 / P9-25 (ADR-103) — the contract of `apiKeys.route.ts`, code-first.
 *
 * Every route is TENANT_ADMIN (`rbac`) and JWT only (`denyApiKey`: an API key
 * cannot mint or revoke keys). No route mounts a schema: the create body is
 * read RAW and checked by apiKey.service (`name` required; `scopes` a
 * non-empty array of `<resource>:<read|write>` over API_KEY_SCOPE_RESOURCES,
 * no wildcard), documented as the service reads it. Answers are the service's
 * public projection of a key; the secret is answered once, by the create.
 * Examples are synthetic.
 */
import { z } from "zod";
import { API_KEY_SCOPE_RESOURCES } from "@callibrator/contracts/apiKeyScopes";
import { defineRouteDocs } from "../../docs/openapi/operation";

const tenantAdmin = { kind: "rbac", roles: ["TENANT_ADMIN"] } as const;

/** `:id`, checked by `validateUuid` (the SHAPE: `z.guid()`). */
const params = z.object({
  id: z.guid().meta({ description: "The API key's id", example: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a" }),
});

/** POST / — read raw; apiKey.service checks it (400 on a missing name or a bad scope). */
const createBody = z.object({
  name: z.string().meta({ description: "A label for the key", example: "LIMS integration" }),
  scopes: z
    .array(z.string())
    .min(1)
    .meta({
      description:
        "`<resource>:<read|write>` (an absent action is `write`); the resource is one of " +
        `${String(API_KEY_SCOPE_RESOURCES.length)} menu slugs. A wildcard resource or action is refused.`,
      example: ["equipment:read", "certificate:read"],
    }),
  expiresAt: z.iso.datetime().nullable().optional().meta({ description: "Absent, null or empty: the key does not expire" }),
});

/** The service's public projection: the hash is never answered. */
const apiKeyPublic = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    name: z.string(),
    keyPrefix: z.string().meta({ description: "The key's first 12 characters, to recognise it", example: "cbk_1a2b3c4d" }),
    scopes: z.array(z.string()),
    lastUsedAt: z.iso.datetime().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    isActive: z.boolean(),
    createdBy: z.guid().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "ApiKey", description: "An API key, without its secret" });

const listQuery = z.object({
  page: z.string().optional().meta({ description: "1-based page", example: "1" }),
  limit: z.string().optional().meta({ description: "Rows per page; capped by MAX_LIMIT, anything not a number reads as the default" }),
});

export default defineRouteDocs({
  router: "api/apiKeys.route",
  mount: "/api/v1/api-keys",
  tag: "API Keys",
  tagDescription: "Tenant-scoped API keys (service accounts). Managed by a tenant administrator signed in with a JWT.",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/",
      operationId: "createApiKey",
      summary: "Create an API key",
      description:
        "Answers the full key ONCE (`key`); only its hash is stored. Needs the plan feature `api_keys`: " +
        "a plan without it answers **402** before the body is read (the super admin is not checked).",
      permission: tenantAdmin,
      audited: true,
      body: createBody,
      success: {
        status: 201,
        description: "The key, with its secret (shown once)",
        data: apiKeyPublic.extend({ key: z.string().meta({ description: "The secret; never answered again" }) }),
      },
      errors: [400],
    },
    {
      method: "get",
      path: "/",
      operationId: "listApiKeys",
      summary: "List API keys",
      description: "The tenant's keys, newest first, without secrets.",
      permission: tenantAdmin,
      audited: false,
      query: listQuery,
      success: { status: 200, description: "A page of keys", list: apiKeyPublic },
    },
    {
      method: "get",
      path: "/:id",
      operationId: "getApiKey",
      summary: "Get an API key",
      permission: tenantAdmin,
      audited: false,
      params,
      success: { status: 200, description: "The key, without its secret", data: apiKeyPublic },
    },
    {
      method: "delete",
      path: "/:id",
      operationId: "revokeApiKey",
      summary: "Revoke an API key",
      description: "Deactivates and soft-deletes the key; it authenticates nothing from then on.",
      permission: tenantAdmin,
      audited: true,
      params,
      success: { status: 200, description: "The revoked key's id", data: z.object({ id: z.guid() }) },
    },
  ],
});
