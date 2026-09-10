// src/api/services/quota.service.ts
import { api } from "../client";

export type PlanId = "free" | "professional" | "business" | "enterprise";

export interface QuotaUsage {
  used: number;
  limit: number | null;
}

export interface StorageUsage {
  usedMb: number;
  limitMb: number | null;
}

export interface Quota {
  plan: PlanId;
  status: string;
  features: string[];
  seats: QuotaUsage;
  storage: StorageUsage;
}

// Backend response envelope
interface BackendQuotaResponse {
  success: boolean;
  status: number;
  message: string;
  data: Quota;
}

export const quotaService = {
  /**
   * Get the current tenant's plan, feature flags and usage quotas
   */
  getQuota: async (): Promise<Quota> => {
    const response = await api.get<BackendQuotaResponse>("/api/v1/quota");
    return response.data;
  },
};

export default quotaService;
