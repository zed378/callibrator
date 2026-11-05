"use client";

import React from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

const TOP_GRADIENT: Record<string, string> = {
  "text-primary": "from-primary to-primary",
  "text-accent": "from-accent to-accent",
  "text-success": "from-success to-success",
  "text-warning": "from-warning to-warning",
  "text-destructive": "from-destructive to-destructive",
  "text-chart-2": "from-chart-2 to-chart-2",
  "text-chart-3": "from-chart-3 to-chart-3",
  "text-chart-4": "from-chart-4 to-chart-4",
};

const StatCard: React.FC<{
  title: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  trend?: string;
  trendUp?: boolean;
  subtitle?: string;
  delay?: number;
}> = ({
  title,
  value,
  icon,
  color,
  bgColor,
  borderColor: _borderColor,
  trend,
  trendUp,
  subtitle,
}) => {
  // ADR-122: one colour per tile (the copper-to-teal blend made the brand
  // accent read as a second brand colour). Literal class names, so Tailwind
  // generates them.
  const topGradient = TOP_GRADIENT[color] ?? "from-info to-info";

  return (
    <div className="relative">
      <div className="relative h-full rounded-2xl p-6 border overflow-hidden border-border bg-card shadow-sm">
        <div
          className={`absolute top-0 left-0 right-0 h-0.5 bg-linear-to-r ${topGradient} opacity-60 hidden lg:block`}
        />
        <div className="flex items-start justify-between mb-6">
          <div
            className={`w-14 h-14 ${bgColor} rounded-2xl flex items-center justify-center`}
          >
            {icon}
          </div>
          {trend !== undefined && (
            <div
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
                trendUp
                  ? "text-success bg-success/10"
                  : "text-destructive bg-destructive/10"
              }`}
            >
              {trendUp ? (
                <ArrowUpRight className="w-3.5 h-3.5" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5" />
              )}
              <span>{trend}</span>
            </div>
          )}
        </div>
        <div>
          <p className="text-sm mb-2 font-medium tracking-wide uppercase text-muted-foreground">
            {title}
          </p>
          <p className="text-4xl font-bold tracking-tight text-foreground">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatCard;
