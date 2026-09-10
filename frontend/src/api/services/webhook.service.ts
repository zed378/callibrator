// src/api/services/webhook.service.ts
import { api } from "../client";
import { PaginatedResponse } from "@/types";

export interface Webhook {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  description?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
}

/** Returned only once, on creation — includes the raw signing secret. */
export interface CreatedWebhook extends Webhook {
  secret: string;
}

export type WebhookDeliveryStatus =
  | "pending"
  | "success"
  | "failed"
  | "exhausted";

export interface WebhookDelivery {
  id: string;
  tenantId: string;
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus?: number | null;
  lastError?: string | null;
  deliveredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookCreateInput {
  url: string;
  events: string[];
  description?: string;
  isActive?: boolean;
}

export interface WebhookUpdateInput {
  url?: string;
  events?: string[];
  description?: string;
  isActive?: boolean;
}

export interface WebhookTestResult {
  deliveryId: string;
  status: string;
  responseStatus?: number | null;
  attempts: number;
  lastError?: string | null;
}

// Backend envelope: for LIST endpoints `data` is the array itself and
// `meta` sits at the TOP level of the envelope.
interface BackendListResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T[] | null;
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

function toPaginated<T>(
  response: BackendListResponse<T>,
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

export const webhookService = {
  getAll: async (page = 1, limit = 20): Promise<PaginatedResponse<Webhook>> => {
    const response = await api.get<BackendListResponse<Webhook>>(
      "/api/v1/webhooks",
      { params: { page, limit } },
    );
    return toPaginated(response, page, limit);
  },

  getById: async (id: string): Promise<Webhook> => {
    const response = await api.get<BackendResponse<Webhook>>(
      `/api/v1/webhooks/${id}`,
    );
    return response.data;
  },

  /**
   * Create a webhook. The returned `secret` (used to verify the
   * X-Webhook-Signature HMAC-SHA256 header) is shown ONLY ONCE.
   */
  create: async (data: WebhookCreateInput): Promise<CreatedWebhook> => {
    const response = await api.post<BackendResponse<CreatedWebhook>>(
      "/api/v1/webhooks",
      data,
    );
    return response.data;
  },

  update: async (id: string, data: WebhookUpdateInput): Promise<Webhook> => {
    const response = await api.patch<BackendResponse<Webhook>>(
      `/api/v1/webhooks/${id}`,
      data,
    );
    return response.data;
  },

  delete: async (id: string): Promise<{ id: string }> => {
    const response = await api.delete<BackendResponse<{ id: string }>>(
      `/api/v1/webhooks/${id}`,
    );
    return response.data;
  },

  getDeliveries: async (
    id: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedResponse<WebhookDelivery>> => {
    const response = await api.get<BackendListResponse<WebhookDelivery>>(
      `/api/v1/webhooks/${id}/deliveries`,
      { params: { page, limit } },
    );
    return toPaginated(response, page, limit);
  },

  /** Send a test event to the webhook endpoint. */
  test: async (id: string): Promise<WebhookTestResult> => {
    const response = await api.post<BackendResponse<WebhookTestResult>>(
      `/api/v1/webhooks/${id}/test`,
      {},
    );
    return response.data;
  },
};

export default webhookService;
