// src/api/services/webhook.service.ts
// P9-25 (ADR-103 item 11): on the GENERATED client; the types are the contract's
// (backend/src/routes/api/webhooks.openapi.ts). The exported names are unchanged.
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";
import { PaginatedResponse } from "@/types";

export type Webhook = components["schemas"]["Webhook"];
export type WebhookWithSecret = components["schemas"]["WebhookWithSecret"];
export type CreatedWebhook = WebhookWithSecret;
/**
 * When the url changes the answer carries a new one-time `secret`; otherwise
 * none (the contract's `WebhookWithSecret | Webhook`, read as one shape).
 */
export type UpdatedWebhook = Webhook & Partial<Pick<WebhookWithSecret, "secret">>;
export type WebhookDelivery = components["schemas"]["WebhookDelivery"];
export type WebhookDeliveryStatus = WebhookDelivery["status"];

// There is deliberately no `secret` field on either input: the backend
// generates it, and a caller-supplied one is refused (P6-13).
export type WebhookCreateInput = JsonBody<Op<"/api/v1/webhooks", "post">>;
export type WebhookUpdateInput = JsonBody<Op<"/api/v1/webhooks/{id}", "patch">>;
export type WebhookTestResult = DataOf<Op<"/api/v1/webhooks/{id}/test", "post">>;

/** A list answer: rows in `data`, pagination in the top-level `meta`. */
interface ListAnswer<T> {
  success: boolean;
  message: string;
  data: T[] | null;
  meta?: { total: number; page: number; limit: number; totalPages: number };
}

function toPaginated<T>(
  response: ListAnswer<T>,
  page: number,
  limit: number,
): PaginatedResponse<T> {
  // Defensive: `data` may be null and `meta` may be missing.
  const rows: T[] = Array.isArray(response?.data) ? response.data : [];
  const meta = response?.meta;
  const total = meta?.total ?? rows.length;
  const lim = meta?.limit ?? limit;

  return {
    success: response?.success ?? true,
    message: response?.message ?? "",
    data: rows,
    meta: {
      total,
      page: meta?.page ?? page,
      limit: lim,
      totalPages: meta?.totalPages ?? Math.max(1, Math.ceil(total / lim)),
    },
  };
}

const byId = (id: string) => ({ params: { path: { id } } });

export const webhookService = {
  getAll: async (page = 1, limit = 20): Promise<PaginatedResponse<Webhook>> => {
    const response = await typedApi.GET("/api/v1/webhooks", { params: { query: { page, limit } } }).then(unwrap);
    return toPaginated(response, page, limit);
  },

  getById: async (id: string): Promise<Webhook> =>
    (await typedApi.GET("/api/v1/webhooks/{id}", byId(id)).then(unwrap)).data,

  /**
   * Create a webhook. The returned `secret` (used to verify the
   * X-Webhook-Signature HMAC-SHA256 header) is shown ONLY ONCE.
   */
  create: async (data: WebhookCreateInput): Promise<CreatedWebhook> =>
    (await typedApi.POST("/api/v1/webhooks", { body: data }).then(unwrap)).data,

  /**
   * Update a webhook. When the url changes the response carries a new
   * one-time `secret`; otherwise it has none.
   */
  update: async (id: string, data: WebhookUpdateInput): Promise<UpdatedWebhook> =>
    (await typedApi.PATCH("/api/v1/webhooks/{id}", { ...byId(id), body: data }).then(unwrap)).data,

  /**
   * Issue a new signing secret, returned only in this response. The old one
   * keeps signing for the overlap window (the backend's default, 24 hours,
   * since P6-13; this body names none).
   */
  rotateSecret: async (id: string): Promise<WebhookWithSecret> =>
    (await typedApi.POST("/api/v1/webhooks/{id}/rotate-secret", { ...byId(id), body: {} }).then(unwrap)).data,

  delete: async (id: string): Promise<{ id: string }> =>
    (await typedApi.DELETE("/api/v1/webhooks/{id}", byId(id)).then(unwrap)).data,

  getDeliveries: async (id: string, page = 1, limit = 20): Promise<PaginatedResponse<WebhookDelivery>> => {
    const response = await typedApi
      .GET("/api/v1/webhooks/{id}/deliveries", { params: { path: { id }, query: { page, limit } } })
      .then(unwrap);
    return toPaginated(response, page, limit);
  },

  /** Send a test event to the webhook endpoint. */
  test: async (id: string): Promise<WebhookTestResult> =>
    (
      await typedApi
        .POST("/api/v1/webhooks/{id}/test", {
          ...byId(id),
          // As built: an empty JSON object, though the contract reads no body.
          body: {} as never,
        })
        .then(unwrap)
    ).data,
};

export default webhookService;
