// src/app/dashboard/components/DashboardCharts.tsx
"use client";

import React from "react";
import { BarChart3, RefreshCw, Activity } from "lucide-react";
import { Button } from "@/components/ui";
import SparklineChart from "./sparkline-chart";
import ActivityTimelineItem from "./activity-timeline-item";
import type { TrendPoint } from "@/api/services/dashboard.service";
import type { User } from "@/types";

interface DashboardChartsProps {
  calibrationTrend: TrendPoint[];
  certificateTrend: TrendPoint[];
  recentUsers: User[];
  onRefresh?: () => void;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const monthLabel = (month: string) => {
  const idx = parseInt(month.split("-")[1] ?? "", 10) - 1;
  return MONTH_LABELS[idx] ?? month;
};

/** Month-over-month change of the last two points, e.g. "+25%". */
const trendChange = (trend: TrendPoint[]): { label: string; up: boolean } => {
  if (trend.length < 2) return { label: "—", up: true };
  const prev = trend[trend.length - 2].count;
  const last = trend[trend.length - 1].count;
  if (prev === 0) return { label: last > 0 ? `+${last}` : "0", up: last >= 0 };
  const pct = Math.round(((last - prev) / prev) * 100);
  return { label: `${pct >= 0 ? "+" : ""}${pct}%`, up: pct >= 0 };
};

const TrendRow: React.FC<{
  title: string;
  color: string;
  trend: TrendPoint[];
}> = ({ title, color, trend }) => {
  const change = trendChange(trend);
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-muted-foreground">
          {title}
        </span>
        <span
          className={`text-sm font-semibold ${
            change.up ? "text-success" : "text-destructive"
          }`}
        >
          {change.label}
        </span>
      </div>
      <SparklineChart color={color} data={trend.map((p) => p.count)} />
      <div className="flex justify-between mt-1 px-0.5">
        {trend.map((p) => (
          <span key={p.month} className="text-[10px] text-muted-foreground">
            {monthLabel(p.month)}
          </span>
        ))}
      </div>
    </div>
  );
};

export const DashboardCharts: React.FC<DashboardChartsProps> = ({
  calibrationTrend,
  certificateTrend,
  recentUsers,
  onRefresh,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Activity Trends */}
      <div className="lg:col-span-2 rounded-2xl border overflow-hidden border-border bg-card shadow-sm">
        <div className="px-6 py-5 border-b flex items-center justify-between border-border bg-muted/[0.03]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-primary/10">
              <BarChart3 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Activity Trends
              </h2>
              <p className="text-xs text-muted-foreground">
                Last 6 months
              </p>
            </div>
          </div>
          {onRefresh && (
            <Button
              variant="ghost"
              onClick={onRefresh}
              className="p-2 rounded-lg transition-colors duration-300 hover:bg-muted/50 text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          )}
        </div>
        <div className="p-6 space-y-6">
          <TrendRow
            title="Calibrations Performed"
            color="var(--primary)"
            trend={calibrationTrend}
          />
          <TrendRow
            title="Certificates Issued"
            color="var(--accent)"
            trend={certificateTrend}
          />
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-2xl border overflow-hidden border-border bg-card shadow-sm">
        <div className="px-6 py-5 border-b flex items-center justify-between border-border bg-muted/[0.03]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-success/10">
              <Activity className="w-5 h-5 text-success" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              Recent Activity
            </h2>
          </div>
        </div>
        <div className="p-3 space-y-1">
          {recentUsers.length > 0 ? (
            recentUsers
              .slice(0, 4)
              .map((u, i) => (
                <ActivityTimelineItem
                  key={u.id}
                  name={u.username || u.email}
                  action={u.email || "User"}
                  time="Recently"
                  color="bg-primary/20"
                  delay={500 + i * 100}
                />
              ))
          ) : (
            <div className="py-12 text-center">
              <Activity className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="font-medium text-muted-foreground">
                No recent activity
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardCharts;
