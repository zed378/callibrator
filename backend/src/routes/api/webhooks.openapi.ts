/**
 * P9-18 / P9-25 (ADR-103) — the contract of `webhooks.route.ts`, code-first.
 *
 * A webhook is an outbound channel out of the tenant (A-02): every route is
 * TENANT_ADMIN (`rbac`) and JWT only (`denyApiKey`: an API key is refused, so a
 * scoped key cannot widen its own reach into an exfiltration channel).
 * Creating one also needs the plan's `webhooks` feature. A target that resolves
 * to an internal, loopback, link-local or metadata address is refused (SSRF,
 * A-176/A-307). The signing secret is answered once, on create, on a url change
 * and on rotation, and never otherwise; a caller-supplied `secret` is stripped
 * (A-51). Every write is audited in its transaction. Request bodies are the
 * contract's own schemas (`@callibrator/contracts/webhook`). Examples are
 * synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";
import { WEBHOOK_DELIVERY_STATUSES } from "@callibrator/contracts/states";
import { createWebhookSchema, rotateWebhookSecretSchema, updateWebhookSchema } from "../../validators/webhook.validator";

const timestamp = z.iso.datetime();
const HOOK = "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
const tenantAdmin = { kind: "rbac", roles: ["TENANT_ADMIN"] } as const;
const params = z.object({ id: z.guid().meta({ description: "The webhook", example: HOOK }) });

const Webhook = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    url: z.string(),
    events: z.array(z.string()),
    description: z.string().nullable(),
    isActive: z.boolean(),
    createdBy: z.guid().nullable(),
    createdAt: timestamp,
    previousSecretExpiresAt: timestamp.nullable().meta({ description: "While set, deliveries are also signed with the previous secret (P6-13)" }),
  })
  .meta({
    id: "Webhook",
    description: "A webhook as the API answers it: never its secret.",
    example: {
      id: HOOK,
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      url: "https://hooks.example.test/callibrator",
      events: ["certificate.approved"],
      description: "LIMS sync",
      isActive: true,
      createdBy: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      createdAt: "2030-01-15T09:00:00.000Z",
      previousSecretExpiresAt: null,
    },
  });
const WebhookWithSecret = Webhook.extend({ secret: z.string().meta({ description: "The signing secret, answered once" }) }).meta({
  id: "WebhookWithSecret",
});
/** A delivery row (the model's attributes; P9-25 item 11 made this exact, 2026-10-02). */
const WebhookDelivery = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    webhookId: z.guid(),
    event: z.string(),
    payload: z.object({}).loose(),
    status: z.enum(WEBHOOK_DELIVERY_STATUSES),
    attempts: z.number().int(),
    responseStatus: z.number().int().nullable(),
    lastError: z.string().nullable(),
    deliveredAt: timestamp.nullable(),
    nextAttemptAt: timestamp.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .meta({ id: "WebhookDelivery" });
/**
 * The validator's body with its refused `secret` key left out of the document:
 * the key is named in the schema only so its 400 can say why (P6-13), and a
 * client must not send it. P6-08 compares the documented keys with the
 * accepted ones on the same terms.
 */
const documented = <S extends z.ZodType>(schema: S): S =>
  schema.meta({
    override: ({ jsonSchema }) => {
      // Each body is an object schema, so it renders with `properties`.
      const { properties } = jsonSchema as { properties: Record<string, unknown> };
      delete properties["secret"];
    },
  });

const paging = z.object({
  page: z.coerce.number().int().min(1).optional().meta({ example: 1 }),
  limit: z.coerce.number().int().min(1).optional().meta({ example: 20 }),
});

export default defineRouteDocs({
  router: "api/webhooks.route",
  mount: "/api/v1/webhooks",
  tag: "Webhooks",
  tenantScoped: true,
  operations: [
    {
      method: "post",
      path: "/",
      operationId: "createWebhook",
      summary: "Register a webhook",
      description: "Needs the plan's `webhooks` feature. An internal or metadata target is a 400 (SSRF). The secret is answered once.",
      permission: tenantAdmin,
      audited: true,
      body: documented(createWebhookSchema),
      success: { status: 201, description: "The webhook and its secret", data: WebhookWithSecret },
    },
    {
      method: "get",
      path: "/",
      operationId: "listWebhooks",
      summary: "List the tenant's webhooks",
      permission: tenantAdmin,
      audited: false,
      query: paging,
      success: { status: 200, description: "A page of webhooks; pagination in the top-level `meta`", list: Webhook },
    },
    {
      method: "get",
      path: "/:id",
      operationId: "getWebhook",
      summary: "Get a webhook",
      permission: tenantAdmin,
      audited: false,
      params,
      success: { status: 200, description: "The webhook", data: Webhook },
    },
    {
      method: "patch",
      path: "/:id",
      operationId: "updateWebhook",
      summary: "Update a webhook",
      description: "A url change rotates the secret in the same transaction and answers the new one once.",
      permission: tenantAdmin,
      audited: true,
      params,
      body: documented(updateWebhookSchema),
      success: { status: 200, description: "The webhook (with `secret` when the url changed)", data: z.union([WebhookWithSecret, Webhook]) },
    },
    {
      method: "delete",
      path: "/:id",
      operationId: "deleteWebhook",
      summary: "Delete a webhook",
      permission: tenantAdmin,
      audited: true,
      params,
      success: { status: 200, description: "Deleted", data: z.object({ id: z.guid() }) },
    },
    {
      method: "get",
      path: "/:id/deliveries",
      operationId: "listWebhookDeliveries",
      summary: "List a webhook's deliveries",
      permission: tenantAdmin,
      audited: false,
      params,
      query: paging,
      success: { status: 200, description: "A page of deliveries; pagination in the top-level `meta`", list: WebhookDelivery },
    },
    {
      method: "post",
      path: "/:id/test",
      operationId: "testWebhook",
      summary: "Send a test delivery",
      permission: tenantAdmin,
      audited: false,
      params,
      success: {
        status: 200,
        description: "The attempt",
        data: z.object({
          deliveryId: z.guid(),
          status: z.string(),
          responseStatus: z.number().int().nullable(),
          attempts: z.number().int(),
          lastError: z.string().nullable(),
        }),
      },
    },
    {
      method: "post",
      path: "/:id/rotate-secret",
      operationId: "rotateWebhookSecret",
      summary: "Rotate the signing secret",
      description: "The previous secret keeps signing for `overlapHours` (0-168, default 24; P6-13). The new secret is answered once.",
      permission: tenantAdmin,
      audited: true,
      params,
      body: documented(rotateWebhookSecretSchema),
      success: { status: 200, description: "The webhook and its new secret", data: WebhookWithSecret },
    },
  ],
});
