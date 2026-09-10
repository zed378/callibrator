"use client";

import React, { useEffect, useState } from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

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
  delay: number;
}> = ({
  title,
  value,
  icon,
  color,
  bgColor,
  borderColor,
  trend,
  trendUp,
  subtitle,
  delay,
}) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);

  const topGradient =
    color === "text-primary"
      ? "from-primary to-accent"
      : color === "text-success"
        ? "from-success to-success"
        : color === "text-accent"
          ? "from-accent to-accent"
          : "from-info to-info";

  return (
    <div
      className={`relative group cursor-pointer transition-all duration-700 ease-out ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
      }`}
    >
      <div
        className={`absolute -inset-px ${borderColor} rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm hidden lg:block`}
      />
      <div
        className={`relative h-full rounded-2xl p-6 border overflow-hidden group-hover:transition-all duration-500 border-border bg-card shadow-sm group-hover:shadow-md group-hover:border-primary/30`}
      >
        <div
          className={`absolute top-0 left-0 right-0 h-0.5 bg-linear-to-r ${topGradient} opacity-60 group-hover:opacity-100 transition-opacity duration-500 hidden lg:block`}
        />
        <div className="flex items-start justify-between mb-6">
          <div
            className={`w-14 h-14 ${bgColor} rounded-2xl flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-all duration-500`}
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
        <div
          className={`absolute inset-0 bg-linear-to-r from-transparent via-white/[0.02] to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 hidden lg:block`}
        />
      </div>
    </div>
  );
};

export default StatCard;
