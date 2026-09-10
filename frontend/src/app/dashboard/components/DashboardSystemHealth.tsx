// src/app/dashboard/components/DashboardSystemHealth.tsx
"use client";

import React from "react";
import { Server } from "lucide-react";
import HealthIndicator from "./health-indicator";

export const DashboardSystemHealth: React.FC = () => {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="px-6 py-5 border-b flex items-center justify-between border-border bg-muted/[0.03]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-success/10">
            <Server className="w-5 h-5 text-success" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              System Health
            </h2>
            <p className="text-xs text-muted-foreground">
              Real-time infrastructure status
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-success/10 border-success/30">
          <div className="w-2 h-2 bg-success rounded-full animate-pulse" />
          <span className="text-xs font-semibold text-success">
            All Systems Go
          </span>
        </div>
      </div>
      <div className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <HealthIndicator
            name="API Server"
            status="healthy"
            uptime="99.9% uptime"
            delay={600}
          />
          <HealthIndicator
            name="PostgreSQL Database"
            status="healthy"
            uptime="Connected • 2ms"
            delay={700}
          />
          <HealthIndicator
            name="Redis Cache"
            status="healthy"
            uptime="Active • 1ms"
            delay={800}
          />
          <HealthIndicator
            name="RabbitMQ Queue"
            status="healthy"
            uptime="3 messages pending"
            delay={900}
          />
        </div>
      </div>
    </div>
  );
};

export default DashboardSystemHealth;
