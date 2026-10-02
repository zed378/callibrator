// src/api/services/apiKey.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. Every call and every type is
// read off `paths` (generated from backend/src/routes/api/apiKeys.openapi.ts);
// the exported names are unchanged, so no caller changed.
import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type components } from "../typed";
import { PaginatedResponse } from "@/types";

export type ApiKey = components["schemas"]["ApiKey"];

/** Returned only once, on creation — includes the raw secret key. */
export type CreatedApiKey = DataOf<Op<"/api/v1/api-keys", "post">>;

export type ApiKeyCreateInput = JsonBody<Op<"/api/v1/api-keys", "post">>;

const byId = (id: string) => ({ params: { path: { id } } });

export const apiKeyService = {
  getAll: async (page = 1, limit = 20): Promise<PaginatedResponse<ApiKey>> => {
    const response = await typedApi
      .GET("/api/v1/api-keys", {
        // The contract publishes the query as the strings the controller parses.
        params: { query: { page: String(page), limit: String(limit) } },
      })
      .then(unwrap);

    // Defensive: `data` may be null and `meta` may be missing.
    const rows: ApiKey[] = Array.isArray(response?.data) ? response.data : [];
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
  },

  getById: async (id: string): Promise<ApiKey> =>
    (await typedApi.GET("/api/v1/api-keys/{id}", byId(id)).then(unwrap)).data,

  /**
   * Create a new API key. The returned `key` is the raw secret and is
   * shown ONLY ONCE — it can never be retrieved again.
   */
  create: async (data: ApiKeyCreateInput): Promise<CreatedApiKey> =>
    (await typedApi.POST("/api/v1/api-keys", { body: data }).then(unwrap)).data,

  /** Revoke (delete) an API key. */
  revoke: async (id: string): Promise<{ id: string }> =>
    (await typedApi.DELETE("/api/v1/api-keys/{id}", byId(id)).then(unwrap)).data,
};

export default apiKeyService;
