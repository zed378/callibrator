// src/api/services/quota.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. The calls and the types are
// read off `paths` (src/api/generated/schema.d.ts, `npm run api:types`, from
// backend/src/routes/api/quota.openapi.ts); the exported names are unchanged, so
// no caller changed.
import { typedApi, unwrap, type components } from "../typed";

/** The tenant's plan, status, seats, storage and features, as the contract publishes them. */
export type Quota = components["schemas"]["QuotaUsage"];
export type PlanId = "free" | "professional" | "business" | "enterprise";
export type QuotaUsage = Quota["seats"];
export type StorageUsage = Quota["storage"];

export const quotaService = {
  /**
   * Get the current tenant's plan, feature flags and usage quotas
   */
  getQuota: async (): Promise<Quota> => {
    const response = await typedApi.GET("/api/v1/quota").then(unwrap);
    return response.data;
  },
};

export default quotaService;
