// src/app/dashboard/hooks/useDashboardMetrics.ts
import { useCallback, useEffect, useState } from "react";
import {
  dashboardService,
  DashboardMetrics,
} from "@/api/services/dashboard.service";
import { useAuthStore } from "@/stores/authStore";

/**
 * Loads dashboard metrics from GET /api/v1/dashboard/metrics.
 * The backend scopes the numbers automatically: tenant users get their
 * own tenant's metrics, SUPERADMIN gets the global view with a
 * per-tenant breakdown.
 */
export function useDashboardMetrics() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role?.name === "SUPERADMIN";

  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await dashboardService.getMetrics();
      setMetrics(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load dashboard metrics",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return { user, isSuperAdmin, metrics, isLoading, error, refresh: fetchMetrics };
}

export default useDashboardMetrics;
