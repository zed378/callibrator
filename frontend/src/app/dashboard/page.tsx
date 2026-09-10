// src/app/dashboard/page.tsx
"use client";

import React, { useEffect } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { useAuthStore } from "@/stores/authStore";
import { useUserStore } from "@/stores/userStore";
import { Sparkles, Globe, Building2 } from "lucide-react";
import { Alert } from "@/components/ui";
import {
  RealTimeClock,
  GridBackground,
  DashboardStats,
  DashboardQuickActions,
  DashboardSystemHealth,
  DashboardCharts,
  TenantBreakdown,
} from "./components";
import useDashboardMetrics from "./hooks/useDashboardMetrics";

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-44 rounded-2xl border border-border bg-card shadow-sm animate-pulse"
        />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { fetchUser } = useAuthStore();
  const { users, fetchUsers } = useUserStore();
  const { user, isSuperAdmin, metrics, isLoading, error, refresh } =
    useDashboardMetrics();

  // Time-of-day greeting is resolved after mount — reading `new Date()` during
  // render is non-deterministic and not allowed during prerender in Next 16.
  const [greeting, setGreeting] = React.useState("Welcome");

  useEffect(() => {
    fetchUser();
    fetchUsers();
  }, [fetchUser, fetchUsers]);

  useEffect(() => {
    // Resolve the greeting after mount — reading current time during render is
    // disallowed during prerender (Next 16).
    const h = new Date().getHours();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGreeting(
      h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening",
    );
  }, []);

  const userName =
    user?.firstName && user?.lastName
      ? `${user.firstName} ${user.lastName}`
      : user?.username || "Admin";

  const scopeLabel =
    metrics?.scope === "global"
      ? "Global overview — all tenants"
      : metrics?.tenant?.name
        ? `Overview for ${metrics.tenant.name}`
        : "Overview for your organization";

  const recentUsers = Array.isArray(users?.data) ? users.data : [];

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <GridBackground />

        {/* Hero Section */}
        <div className="relative">
          <div className="rounded-3xl p-8 border overflow-hidden border-border bg-card shadow-sm">
            <div className="absolute top-0 right-0 w-80 h-80 bg-linear-to-br from-primary/10 to-accent/10 rounded-full blur-3xl hidden dark:block" />
            <div className="absolute bottom-0 left-1/2 w-60 h-60 bg-linear-to-tr from-info/10 to-info/10 rounded-full blur-3xl hidden dark:block" />
            <div className="relative flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <span className="text-sm font-semibold uppercase tracking-wider text-primary">
                    Dashboard Overview
                  </span>
                  {metrics && (
                    <span className="ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/10 text-primary">
                      {metrics.scope === "global" ? (
                        <Globe className="w-3.5 h-3.5" />
                      ) : (
                        <Building2 className="w-3.5 h-3.5" />
                      )}
                      {metrics.scope === "global"
                        ? "Global"
                        : metrics.tenant?.name || "Tenant"}
                    </span>
                  )}
                </div>
                <h1 className="text-4xl lg:text-5xl font-bold mb-3 tracking-tight text-foreground">
                  {greeting}
                  <span className="block mt-1">
                    {userName}{" "}
                    <span className="inline-block animate-bounce">👋</span>
                  </span>
                </h1>
                <p className="text-lg max-w-xl text-muted-foreground">
                  {scopeLabel}. Here&apos;s what&apos;s happening across your
                  devices, calibrations, and inventory.
                </p>
              </div>
              <RealTimeClock />
            </div>
          </div>
        </div>

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
          <DashboardStats metrics={metrics} isSuperAdmin={isSuperAdmin} />
        ) : (
          isLoading && <StatsSkeleton />
        )}

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

        {/* System Health */}
        <DashboardSystemHealth />
      </div>
    </DashboardLayout>
  );
}
