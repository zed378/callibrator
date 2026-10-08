/**
 * useDashboardMetrics — load, the super-admin flag, a failed load, refresh.
 * The fixture is the `data` of GET /api/v1/dashboard/metrics as
 * backend/src/services/dashboard.service.js builds it for a tenant user.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const dashboardService = { getMetrics: jest.fn() };
jest.mock("@/api/services/dashboard.service", () => ({ dashboardService }));

import { useDashboardMetrics } from "../useDashboardMetrics";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

const tenantMetrics = {
  scope: "tenant",
  generatedAt: "2026-09-29T00:00:00.000Z",
  users: { total: 4, verified: 3 },
  devices: { total: 10, byStatus: { active: 9, retired: 1 }, dueSoon: 2, overdue: 1 },
  calibrations: { total: 20, compliant: 19, complianceRate: 95, last30Days: 3 },
  certificates: { total: 5, byStatus: { approved: 5 } },
  inventory: { stockItems: 1, totalQuantity: 7, lowStockItems: 0, warehouses: 1, pendingTransfers: 0, openOpnames: 0 },
  maintenance: { openWorkOrders: 2 },
  trends: { calibrations: [{ month: "2026-09", count: 3 }], certificates: [] },
  tenant: { id: "t1", name: "RS A", code: "RSA", status: "active" },
};

const signIn = (role: string) =>
  useAuthStore.setState({ user: { id: "u1", role: { name: role } } as unknown as User });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useDashboardMetrics", () => {
  it("loads the caller's metrics and is not super admin for a tenant role", async () => {
    signIn("HEALTHCARE ADMIN");
    dashboardService.getMetrics.mockResolvedValue(tenantMetrics);
    const { result } = renderHook(() => useDashboardMetrics());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.metrics).toEqual(tenantMetrics);
    expect(result.current.error).toBeNull();
    expect(result.current.isSuperAdmin).toBe(false);
    expect(dashboardService.getMetrics).toHaveBeenCalledWith();
  });

  it("flags SUPERADMIN so the screen renders the global view", async () => {
    signIn("SUPERADMIN");
    dashboardService.getMetrics.mockResolvedValue({ ...tenantMetrics, scope: "global", tenant: undefined });
    const { result } = renderHook(() => useDashboardMetrics());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSuperAdmin).toBe(true);
  });

  it("a failed load carries the backend message; refresh clears it on success", async () => {
    signIn("SUPERVISOR");
    dashboardService.getMetrics.mockRejectedValueOnce(new Error("Too many requests"));
    const { result } = renderHook(() => useDashboardMetrics());
    await waitFor(() => expect(result.current.error).toBe("Too many requests"));
    expect(result.current.metrics).toBeNull();

    dashboardService.getMetrics.mockResolvedValue(tenantMetrics);
    await act(async () => result.current.refresh());
    expect(result.current.error).toBeNull();
    expect(result.current.metrics).toEqual(tenantMetrics);
  });

  it("a non-Error rejection falls back to a generic message", async () => {
    signIn("SUPERVISOR");
    dashboardService.getMetrics.mockRejectedValue("boom");
    const { result } = renderHook(() => useDashboardMetrics());
    await waitFor(() => expect(result.current.error).toBe("Failed to load dashboard metrics"));
  });
});
