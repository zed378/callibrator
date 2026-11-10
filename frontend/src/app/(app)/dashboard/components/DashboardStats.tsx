// src/app/dashboard/components/DashboardStats.tsx
"use client";

import React from "react";
import type { DashboardMetrics } from "@/api/services/dashboard.service";

interface DashboardStatsProps {
  metrics: DashboardMetrics;
  isSuperAdmin: boolean;
  /**
   * P22-07 (ADR-126 Am. 6): a facility-bound user. The provider-internal figures (warehouses,
   * stock, transfers, opnames) always read 0 for one — their models deny a bound caller — so their
   * cards are hidden rather than shown as zeros.
   */
  facilityBound?: boolean;
}

/** The cards that count provider-internal records (hidden for a bound user). */
const PROVIDER_INTERNAL = new Set(["Warehouses", "Low Stock", "Pending Transfers"]);

/**
 * The three figures an operator acts on: is the fleet in tolerance, what falls due, what is
 * already late. They lead the page at a larger size; the rest are a reference ledger below.
 * Eight equal cards in eight hues gave the one overdue device the same weight as a stock count.
 */
const ATTENTION = ["Compliance Rate", "Due in 30 Days", "Overdue"] as const;

/** Colour carries state only: a non-zero overdue or due-soon count, nothing else. */
const ALERT_TEXT: Record<string, string> = {
  "Due in 30 Days": "text-warning",
  Overdue: "text-destructive",
};

interface StatDef {
  title: string;
  value: number | string;
  subtitle?: string;
}

const formatValue = (value: number | string) => (typeof value === "number" ? value.toLocaleString() : value);

export const DashboardStats: React.FC<DashboardStatsProps> = ({
  metrics,
  isSuperAdmin,
  facilityBound = false,
}) => {
  const activeDevices = metrics.devices.byStatus?.active ?? 0;
  const complianceValue =
    metrics.calibrations.complianceRate !== null
      ? `${metrics.calibrations.complianceRate}%`
      : "n/a";
  const global = isSuperAdmin && metrics.scope === "global";

  const stats: StatDef[] = [];

  if (global) {
    stats.push(
      {
        title: "Tenants",
        value: metrics.tenants?.total ?? 0,
        subtitle: `${metrics.tenants?.active ?? 0} active`,
      },
      {
        title: "Users",
        value: metrics.users.total,
        subtitle: `${metrics.users.verified} verified`,
      },
    );
  } else {
    stats.push(
      {
        title: "Team Members",
        value: metrics.users.total,
        subtitle: `${metrics.users.verified} verified`,
      },
      {
        title: "Warehouses",
        value: metrics.inventory.warehouses,
        subtitle: `${metrics.inventory.stockItems} stock items`,
      },
    );
  }

  stats.push(
    {
      title: "Devices",
      value: metrics.devices.total,
      subtitle: `${activeDevices} active`,
    },
    {
      title: "Compliance Rate",
      value: complianceValue,
      subtitle: `${metrics.calibrations.compliant} of ${metrics.calibrations.total} calibrations`,
    },
    {
      title: "Due in 30 Days",
      value: metrics.devices.dueSoon,
      subtitle: "calibrations coming up",
    },
    {
      title: "Overdue",
      value: metrics.devices.overdue,
      subtitle: "past calibration date",
    },
    {
      title: "Certificates",
      value: metrics.certificates.total,
      subtitle: Object.entries(metrics.certificates.byStatus || {})
        .map(([k, v]) => `${v} ${k}`)
        .slice(0, 3)
        .join(" · "),
    },
    {
      title: "Low Stock",
      value: metrics.inventory.lowStockItems,
      subtitle: `of ${metrics.inventory.stockItems} stock items`,
    },
  );

  // Last card differs by scope: operational backlog
  stats.push(
    global
      ? {
          title: "Open Work Orders",
          value: metrics.maintenance.openWorkOrders,
          subtitle: `${metrics.inventory.pendingTransfers} pending transfers`,
        }
      : {
          title: "Pending Transfers",
          value: metrics.inventory.pendingTransfers,
          subtitle: `${metrics.maintenance.openWorkOrders} open work orders · ${metrics.inventory.openOpnames} opnames`,
        },
  );

  const shown = facilityBound ? stats.filter((s) => !PROVIDER_INTERNAL.has(s.title)) : stats;
  const attention = ATTENTION.map((title) => shown.find((s) => s.title === title)).filter(
    (s): s is StatDef => s !== undefined,
  );
  const ledger = shown.filter((s) => !(ATTENTION as readonly string[]).includes(s.title));

  return (
    <div className="space-y-6">
      <section
        aria-label="Calibration status"
        className="grid divide-y divide-border rounded-2xl border border-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0"
      >
        {attention.map((stat) => {
          const raised = typeof stat.value === "number" && stat.value > 0 ? ALERT_TEXT[stat.title] : undefined;
          return (
            <div key={stat.title} className="p-6">
              <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
              <p className={`mt-2 text-5xl font-semibold tabular-nums tracking-tight ${raised ?? "text-foreground"}`}>
                {formatValue(stat.value)}
              </p>
              {stat.subtitle && <p className="mt-2 text-sm text-muted-foreground">{stat.subtitle}</p>}
            </div>
          );
        })}
      </section>

      <section aria-label="Registry totals">
        <dl className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
          {ledger.map((stat) => (
            <div key={stat.title} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-border py-3">
              <dt className="text-sm font-medium text-foreground">{stat.title}</dt>
              <dd className="row-span-2 text-xl font-semibold tabular-nums text-foreground">{formatValue(stat.value)}</dd>
              {stat.subtitle && <dd className="truncate text-xs text-muted-foreground">{stat.subtitle}</dd>}
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
};

export default DashboardStats;
