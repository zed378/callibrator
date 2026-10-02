// src/api/services/dashboard.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. The calls and the types are
// read off `paths` (src/api/generated/schema.d.ts, `npm run api:types`, from
// backend/src/routes/api/dashboard.openapi.ts); the exported names are unchanged, so
// no caller changed.
import { typedApi, unwrap, type components } from "../typed";

// Backend route: GET /api/v1/dashboard/metrics
// Non-superadmins always get their own tenant's metrics.
// SUPERADMIN gets global metrics (+ tenantBreakdown) and may pass
// tenantId to inspect a single tenant.

export type DashboardMetrics = components["schemas"]["DashboardMetrics"];
export type TrendPoint = DashboardMetrics["trends"]["calibrations"][number];
export type TenantBreakdownRow = NonNullable<DashboardMetrics["tenantBreakdown"]>[number];

export const dashboardService = {
  getMetrics: async (tenantId?: string): Promise<DashboardMetrics> => {
    const response = await typedApi
      .GET("/api/v1/dashboard/metrics", tenantId ? { params: { query: { tenantId } } } : {})
      .then(unwrap);
    return response.data;
  },
};
