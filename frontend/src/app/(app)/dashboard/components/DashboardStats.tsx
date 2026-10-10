// src/app/dashboard/components/DashboardStats.tsx
"use client";

import React from "react";
import {
  Users,
  Building2,
  Cpu,
  CheckCircle,
  Clock,
  AlertCircle,
  FileText,
  Package,
  Wrench,
  RefreshCw,
} from "lucide-react";
import StatCard from "./stat-card";
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

interface StatDef {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({
  metrics,
  isSuperAdmin,
  facilityBound = false,
}) => {
  const activeDevices = metrics.devices.byStatus?.active ?? 0;
  const complianceValue =
    metrics.calibrations.complianceRate !== null
      ? `${metrics.calibrations.complianceRate}%`
      : "—";

  const stats: StatDef[] = [];

  if (isSuperAdmin && metrics.scope === "global") {
    stats.push(
      {
        title: "Tenants",
        value: metrics.tenants?.total ?? 0,
        subtitle: `${metrics.tenants?.active ?? 0} active`,
        icon: <Building2 className="w-7 h-7 text-chart-2" />,
        color: "text-chart-2",
        bgColor: "bg-chart-2/15",
        borderColor: "bg-linear-to-r from-chart-2 to-chart-2",
      },
      {
        title: "Users",
        value: metrics.users.total,
        subtitle: `${metrics.users.verified} verified`,
        icon: <Users className="w-7 h-7 text-primary" />,
        color: "text-primary",
        bgColor: "bg-primary/15",
        borderColor: "bg-linear-to-r from-primary to-primary",
      },
    );
  } else {
    stats.push(
      {
        title: "Team Members",
        value: metrics.users.total,
        subtitle: `${metrics.users.verified} verified`,
        icon: <Users className="w-7 h-7 text-primary" />,
        color: "text-primary",
        bgColor: "bg-primary/15",
        borderColor: "bg-linear-to-r from-primary to-primary",
      },
      {
        title: "Warehouses",
        value: metrics.inventory.warehouses,
        subtitle: `${metrics.inventory.stockItems} stock items`,
        icon: <Building2 className="w-7 h-7 text-chart-4" />,
        color: "text-chart-4",
        bgColor: "bg-chart-4/15",
        borderColor: "bg-linear-to-r from-chart-4 to-chart-4",
      },
    );
  }

  stats.push(
    {
      title: "Devices",
      value: metrics.devices.total,
      subtitle: `${activeDevices} active`,
      icon: <Cpu className="w-7 h-7 text-chart-2" />,
      color: "text-chart-2",
      bgColor: "bg-chart-2/15",
      borderColor: "bg-linear-to-r from-chart-2 to-chart-2",
    },
    {
      title: "Compliance Rate",
      value: complianceValue,
      subtitle: `${metrics.calibrations.compliant} of ${metrics.calibrations.total} calibrations`,
      icon: <CheckCircle className="w-7 h-7 text-success" />,
      color: "text-success",
      bgColor: "bg-success/15",
      borderColor: "bg-linear-to-r from-success to-success",
    },
    {
      title: "Due in 30 Days",
      value: metrics.devices.dueSoon,
      subtitle: "calibrations coming up",
      icon: <Clock className="w-7 h-7 text-warning" />,
      color: "text-warning",
      bgColor: "bg-warning/15",
      borderColor: "bg-linear-to-r from-warning to-warning",
    },
    {
      title: "Overdue",
      value: metrics.devices.overdue,
      subtitle: "past calibration date",
      icon: <AlertCircle className="w-7 h-7 text-destructive" />,
      color: "text-destructive",
      bgColor: "bg-destructive/15",
      borderColor: "bg-linear-to-r from-destructive to-destructive",
    },
    {
      title: "Certificates",
      value: metrics.certificates.total,
      subtitle: Object.entries(metrics.certificates.byStatus || {})
        .map(([k, v]) => `${v} ${k}`)
        .slice(0, 3)
        .join(" · "),
      icon: <FileText className="w-7 h-7 text-accent" />,
      color: "text-accent",
      bgColor: "bg-accent/15",
      borderColor: "bg-linear-to-r from-accent to-accent",
    },
    {
      title: "Low Stock",
      value: metrics.inventory.lowStockItems,
      subtitle: `of ${metrics.inventory.stockItems} stock items`,
      icon: <Package className="w-7 h-7 text-warning" />,
      color: "text-warning",
      bgColor: "bg-warning/15",
      borderColor: "bg-linear-to-r from-warning to-warning",
    },
  );

  // Last card differs by scope: operational backlog
  stats.push(
    isSuperAdmin && metrics.scope === "global"
      ? {
          title: "Open Work Orders",
          value: metrics.maintenance.openWorkOrders,
          subtitle: `${metrics.inventory.pendingTransfers} pending transfers`,
          icon: <Wrench className="w-7 h-7 text-chart-3" />,
          color: "text-chart-3",
          bgColor: "bg-chart-3/15",
          borderColor: "bg-linear-to-r from-chart-3 to-chart-3",
        }
      : {
          title: "Pending Transfers",
          value: metrics.inventory.pendingTransfers,
          subtitle: `${metrics.maintenance.openWorkOrders} open work orders · ${metrics.inventory.openOpnames} opnames`,
          icon: <RefreshCw className="w-7 h-7 text-chart-3" />,
          color: "text-chart-3",
          bgColor: "bg-chart-3/15",
          borderColor: "bg-linear-to-r from-chart-3 to-chart-3",
        },
  );

  const shown = facilityBound ? stats.filter((s) => !PROVIDER_INTERNAL.has(s.title)) : stats;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 relative">
      {shown.map((stat, i) => (
        <StatCard
          key={stat.title}
          title={stat.title}
          value={stat.value}
          subtitle={stat.subtitle}
          icon={stat.icon}
          color={stat.color}
          bgColor={stat.bgColor}
          borderColor={stat.borderColor}
          delay={100 + i * 75}
        />
      ))}
    </div>
  );
};

export default DashboardStats;
