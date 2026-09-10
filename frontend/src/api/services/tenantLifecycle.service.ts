import { api } from "../client";

// ---------- Types ----------

export type TenantLifecycleState =
  | "TRIAL"
  | "ACTIVE"
  | "SUSPENDED"
  | "OFFBOARDED";

export interface TenantLifecycleStatus {
  tenantId: string;
  status: string;
  suspensionReason?: string | null;
  suspendedAt?: string | null;
  gracePeriodExpiresAt?: string | null;
  offboardedAt?: string | null;
  offboardRetentionExpiresAt?: string | null;
}

export interface TenantExportData {
  exportedAt: string;
  tenant: Record<string, unknown>;
  users?: Record<string, unknown>[];
  settings?: Record<string, unknown>[];
  subscriptions?: Record<string, unknown>[];
  invoices?: Record<string, unknown>[];
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const tenantLifecycleService = {
  /**
   * Get lifecycle status. GET /api/v1/tenants/:tenantId/status
   */
  getStatus: async (tenantId: string): Promise<TenantLifecycleStatus> => {
    const response = await api.get<BackendResponse<TenantLifecycleStatus>>(
      `/api/v1/tenants/${tenantId}/status`,
    );
    return response.data;
  },

  /**
   * Suspend a tenant (super admin only).
   * POST /api/v1/tenants/:tenantId/suspend
   */
  suspend: async (
    tenantId: string,
    reason: string,
  ): Promise<TenantLifecycleStatus> => {
    const response = await api.post<BackendResponse<TenantLifecycleStatus>>(
      `/api/v1/tenants/${tenantId}/suspend`,
      { tenantId, reason },
    );
    return response.data;
  },

  /**
   * Resume a suspended tenant. POST /api/v1/tenants/:tenantId/resume
   */
  resume: async (tenantId: string): Promise<TenantLifecycleStatus> => {
    const response = await api.post<BackendResponse<TenantLifecycleStatus>>(
      `/api/v1/tenants/${tenantId}/resume`,
    );
    return response.data;
  },

  /**
   * Start a grace period. POST /api/v1/tenants/:tenantId/grace-period
   */
  enterGracePeriod: async (
    tenantId: string,
  ): Promise<TenantLifecycleStatus> => {
    const response = await api.post<BackendResponse<TenantLifecycleStatus>>(
      `/api/v1/tenants/${tenantId}/grace-period`,
    );
    return response.data;
  },

  /**
   * Offboard a tenant (schedule deletion). POST /api/v1/tenants/:tenantId/offboard
   */
  offboard: async (
    tenantId: string,
    force?: boolean,
  ): Promise<{ tenant: TenantLifecycleStatus; exportData: TenantExportData }> => {
    const response = await api.post<
      BackendResponse<{
        tenant: TenantLifecycleStatus;
        exportData: TenantExportData;
      }>
    >(`/api/v1/tenants/${tenantId}/offboard`, { force });
    return response.data;
  },

  /**
   * Cancel offboarding. POST /api/v1/tenants/:tenantId/offboard/cancel
   */
  cancelOffboarding: async (
    tenantId: string,
  ): Promise<TenantLifecycleStatus> => {
    const response = await api.post<BackendResponse<TenantLifecycleStatus>>(
      `/api/v1/tenants/${tenantId}/offboard/cancel`,
    );
    return response.data;
  },

  /**
   * Export all tenant data. GET /api/v1/tenants/:tenantId/export
   */
  exportData: async (tenantId: string): Promise<TenantExportData> => {
    const response = await api.get<BackendResponse<TenantExportData>>(
      `/api/v1/tenants/${tenantId}/export`,
    );
    return response.data;
  },
};

export default tenantLifecycleService;
