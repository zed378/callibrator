"use client";
/**
 * The dashboard home's client island (moved out of page.tsx by P22-07, so the server page can hand
 * it the `dashboard.` and `devices.condition.` strings in the request's language). P22-07 (F-70 …
 * F-73; ADR-126 Am. 6) adds the device-condition panel with its drill-down, the IPM figures and the
 * technician activity, and hides the provider-internal cards (warehouses, stock, transfers,
 * opnames) for a facility-bound user, whose figures for them are always 0.
 */

import React, { useEffect } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { useAuthStore } from "@/stores/authStore";
import { useUserStore } from "@/stores/userStore";
import { Alert } from "@/components/ui";
import {
  DashboardStats,
  DashboardQuickActions,
  DashboardSystemHealth,
  DashboardCharts,
  TenantBreakdown,
  DashboardUpdatedAt,
  DeviceConditionPanel,
  IpmPanel,
  TechnicianActivity,
} from "./components";
import useDashboardMetrics from "./hooks/useDashboardMetrics";
import { useClientValue } from "@/hooks/useClientValue";
import { usePermissions } from "@/hooks/usePermissions";

/** Time-of-day greeting for an hour 0-23. */
const greetingForHour = (h: number): string =>
  h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
const greetingForNow = () => greetingForHour(new Date().getHours());

/** The loading shape of DashboardStats: a three-figure band, then the ledger rows. */
function StatsSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="h-36 rounded-2xl border border-border bg-card motion-safe:animate-pulse" />
      <div className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-14 border-b border-border" />
        ))}
      </div>
    </div>
  );
}

export function DashboardClient() {
  const { fetchUser } = useAuthStore();
  const { users, fetchUsers } = useUserStore();
  const { user, isSuperAdmin, metrics, isLoading, error, refresh } =
    useDashboardMetrics();

  // Time-of-day greeting is resolved after mount — reading `new Date()` during
  // render is non-deterministic and not allowed during prerender in Next 16.
  const greeting = useClientValue(greetingForNow, "Welcome");

  // ADR-102: the user list is read only by a caller the API lets read it
  // (`users` read). It used to be fetched for every role and 403'd for most.
  const { loaded: permissionsLoaded, canRead, facilityBound } = usePermissions();
  const mayReadUsers = canRead("users");

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (mayReadUsers) fetchUsers();
  }, [mayReadUsers, fetchUsers]);

  const userName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.username || "Admin";

  const scopeLabel =
    metrics?.scope === "global"
      ? "Global overview: all tenants"
      : metrics?.tenant?.name
        ? `Overview for ${metrics.tenant.name}`
        : "Overview for your organization";

  const recentUsers = !permissionsLoaded || !mayReadUsers
    ? null
    : Array.isArray(users?.data)
      ? users.data
      : [];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header: who, where, and how fresh the figures are. A 5xl greeting card with an
            eyebrow, a scope pill and a filler sentence pushed the figures below the fold. */}
        <header className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {greeting}
            <span className="block">{userName}</span>
          </h1>
          <p className="text-base text-muted-foreground">{scopeLabel}</p>
          {metrics?.generatedAt && <DashboardUpdatedAt generatedAt={metrics.generatedAt} />}
        </header>
        {error && (
          <Alert variant="error">
            {error}{" "}
            <button
              type="button"
              onClick={refresh}
              className="underline font-medium"
            >
              Retry
            </button>
          </Alert>
        )}

        {/* Stats Grid — dynamic, tenant-scoped (global for SUPERADMIN) */}
        {metrics ? (
          <DashboardStats metrics={metrics} isSuperAdmin={isSuperAdmin} facilityBound={facilityBound} />
        ) : (
          isLoading && <StatsSkeleton />
        )}

        {/* P22-07: devices by condition (F-70, F-71) and the IPM figures */}
        {metrics && (
          <div className="grid gap-6 xl:grid-cols-2">
            <DeviceConditionPanel byCondition={metrics.devices.byCondition} canOpenRegister={canRead("calibration")} />
            <IpmPanel ipm={metrics.ipm} canOpenHistory={canRead("ipm")} />
          </div>
        )}

        {/* P22-07: technician activity (F-73), for an ipm reader in a tenant's view */}
        {metrics?.scope === "tenant" && permissionsLoaded && canRead("ipm") && <TechnicianActivity userId={user?.id ?? null} />}

        {/* Charts & Activity Section */}
        {metrics && (
          <DashboardCharts
            calibrationTrend={metrics.trends.calibrations}
            certificateTrend={metrics.trends.certificates}
            recentUsers={recentUsers}
            onRefresh={refresh}
          />
        )}

        {/* SUPERADMIN only: per-tenant breakdown */}
        {metrics?.scope === "global" && metrics.tenantBreakdown && (
          <TenantBreakdown rows={metrics.tenantBreakdown} />
        )}

        {/* Quick Actions */}
        <DashboardQuickActions />

        {/* System Health — SUPERADMIN only; live probes from GET /api/v1/health */}
        <DashboardSystemHealth isSuperAdmin={isSuperAdmin} />
      </div>
    </DashboardLayout>
  );
}

export default DashboardClient;
