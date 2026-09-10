import { api } from "../client";

// Backend route: GET /api/v1/dashboard/metrics
// Non-superadmins always get their own tenant's metrics.
// SUPERADMIN gets global metrics (+ tenantBreakdown) and may pass
// tenantId to inspect a single tenant.

export interface TrendPoint {
  month: string; // "2026-02"
  count: number;
}

export interface TenantBreakdownRow {
  id: string;
  name: string;
  code?: string;
  status?: string;
  users: number;
  devices: number;
}

export interface DashboardMetrics {
  scope: "tenant" | "global";
  generatedAt: string;
  tenant?: {
    id: string;
    name: string;
    code?: string;
    status?: string;
  } | null;
  users: {
    total: number;
    verified: number;
  };
  devices: {
    total: number;
    byStatus: Record<string, number>;
    dueSoon: number;
    overdue: number;
  };
  calibrations: {
    total: number;
    compliant: number;
    complianceRate: number | null; // percentage, e.g. 97.5
    last30Days: number;
  };
  certificates: {
    total: number;
    byStatus: Record<string, number>;
  };
  inventory: {
    stockItems: number;
    totalQuantity: number;
    lowStockItems: number;
    warehouses: number;
    pendingTransfers: number;
    openOpnames: number;
  };
  maintenance: {
    openWorkOrders: number;
  };
  trends: {
    calibrations: TrendPoint[];
    certificates: TrendPoint[];
  };
  // Global scope only
  tenants?: {
    total: number;
    active: number;
  };
  tenantBreakdown?: TenantBreakdownRow[];
}

interface BackendMetricsResponse {
  success: boolean;
  status: number;
  message: string;
  data: DashboardMetrics;
}

export const dashboardService = {
  getMetrics: async (tenantId?: string): Promise<DashboardMetrics> => {
    const response = await api.get<BackendMetricsResponse>(
      "/api/v1/dashboard/metrics",
      { params: tenantId ? { tenantId } : undefined },
    );
    return response.data;
  },
};
