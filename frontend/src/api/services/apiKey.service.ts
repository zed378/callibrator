// src/api/services/apiKey.service.ts
import { api } from "../client";
import { PaginatedResponse } from "@/types";

export interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
}

/** Returned only once, on creation — includes the raw secret key. */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

export interface ApiKeyCreateInput {
  name: string;
  scopes: string[];
  expiresAt?: string;
}

// Backend envelope: for LIST endpoints `data` is the array itself and
// `meta` sits at the TOP level of the envelope.
interface BackendApiKeysResponse {
  success: boolean;
  status: number;
  message: string;
  data: ApiKey[] | null;
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

interface BackendApiKeyResponse<T = ApiKey> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

export const apiKeyService = {
  getAll: async (page = 1, limit = 20): Promise<PaginatedResponse<ApiKey>> => {
    const response = await api.get<BackendApiKeysResponse>("/api/v1/api-keys", {
      params: { page, limit },
    });

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

  getById: async (id: string): Promise<ApiKey> => {
    const response = await api.get<BackendApiKeyResponse>(
      `/api/v1/api-keys/${id}`,
    );
    return response.data;
  },

  /**
   * Create a new API key. The returned `key` is the raw secret and is
   * shown ONLY ONCE — it can never be retrieved again.
   */
  create: async (data: ApiKeyCreateInput): Promise<CreatedApiKey> => {
    const response = await api.post<BackendApiKeyResponse<CreatedApiKey>>(
      "/api/v1/api-keys",
      data,
    );
    return response.data;
  },

  /** Revoke (delete) an API key. */
  revoke: async (id: string): Promise<{ id: string }> => {
    const response = await api.delete<BackendApiKeyResponse<{ id: string }>>(
      `/api/v1/api-keys/${id}`,
    );
    return response.data;
  },
};

export default apiKeyService;
