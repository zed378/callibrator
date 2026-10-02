// src/api/services/tenantLifecycle.service.ts
//
// P9-25 (ADR-103 item 11): on the GENERATED client. Every call and every type is
// read off `paths` (generated from backend/src/routes/api/tenantLifecycle.openapi.ts);
// the exported names are unchanged.
import { typedApi, unwrap, type DataOf, type Op, type components } from "../typed";

// ---------- Types ----------

export type TenantLifecycleState =
  | "TRIAL"
  | "ACTIVE"
  | "SUSPENDED"
  | "OFFBOARDED";

type T = "/api/v1/tenants/{tenantId}";

/** The tenant row a lifecycle action answers. */
export type LifecycleTenant = components["schemas"]["Tenant"];

/** GET /tenants/:tenantId/status (A-356: no suspension fields — this answer never carries them). */
export type TenantLifecycleStatus = DataOf<Op<`${T}/status`, "get">>;

export type TenantExportData = DataOf<Op<`${T}/export`, "get">>;

const tenant = (tenantId: string) => ({ params: { path: { tenantId } } });

// ---------- Service ----------

export const tenantLifecycleService = {
  /**
   * Get lifecycle status. GET /api/v1/tenants/:tenantId/status
   */
  getStatus: async (tenantId: string): Promise<TenantLifecycleStatus> =>
    (await typedApi.GET("/api/v1/tenants/{tenantId}/status", tenant(tenantId)).then(unwrap)).data,

  /**
   * Suspend a tenant (super admin only).
   * POST /api/v1/tenants/:tenantId/suspend
   */
  suspend: async (tenantId: string, reason: string): Promise<LifecycleTenant> => {
    // As built: the body repeats the path's tenantId; the contract reads only `reason`.
    const body = { tenantId, reason };
    return (await typedApi.POST("/api/v1/tenants/{tenantId}/suspend", { ...tenant(tenantId), body }).then(unwrap)).data;
  },

  /**
   * Resume a suspended tenant. POST /api/v1/tenants/:tenantId/resume
   */
  resume: async (tenantId: string): Promise<LifecycleTenant> =>
    (await typedApi.POST("/api/v1/tenants/{tenantId}/resume", tenant(tenantId)).then(unwrap)).data,

  /**
   * Start a grace period. POST /api/v1/tenants/:tenantId/grace-period
   */
  enterGracePeriod: async (tenantId: string): Promise<LifecycleTenant> =>
    (await typedApi.POST("/api/v1/tenants/{tenantId}/grace-period", tenant(tenantId)).then(unwrap)).data,

  /**
   * Offboard a tenant (schedule deletion). POST /api/v1/tenants/:tenantId/offboard
   */
  offboard: async (tenantId: string, force?: boolean): Promise<DataOf<Op<`${T}/offboard`, "post">>> =>
    // The response carries no export (W-17, ADR-073): download one first with
    // exportData(), which stays available until the tenant is hard-deleted.
    (await typedApi.POST("/api/v1/tenants/{tenantId}/offboard", { ...tenant(tenantId), body: { force } }).then(unwrap))
      .data,

  /**
   * Cancel offboarding. POST /api/v1/tenants/:tenantId/offboard/cancel
   */
  cancelOffboarding: async (tenantId: string): Promise<LifecycleTenant> =>
    (await typedApi.POST("/api/v1/tenants/{tenantId}/offboard/cancel", tenant(tenantId)).then(unwrap)).data,

  /**
   * Export all tenant data. GET /api/v1/tenants/:tenantId/export
   */
  exportData: async (tenantId: string): Promise<TenantExportData> =>
    (await typedApi.GET("/api/v1/tenants/{tenantId}/export", tenant(tenantId)).then(unwrap)).data,
};

export default tenantLifecycleService;
