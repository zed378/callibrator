// src/app/dashboard/components/TenantBreakdown.tsx
"use client";

import React from "react";
import Link from "next/link";
import { Building2, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui";
import type { TenantBreakdownRow } from "@/api/services/dashboard.service";

interface TenantBreakdownProps {
  rows: TenantBreakdownRow[];
}

/** SUPERADMIN-only: per-tenant metric breakdown on the global dashboard. */
export const TenantBreakdown: React.FC<TenantBreakdownProps> = ({ rows }) => {
  return (
    <div className="rounded-2xl border overflow-hidden border-border bg-card shadow-sm">
      <div className="px-6 py-5 border-b flex items-center justify-between border-border bg-muted/[0.03]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-accent/10">
            <Building2 className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Tenant Breakdown
            </h2>
            <p className="text-xs text-muted-foreground">
              Per-tenant usage across the platform
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/tenants"
          className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Manage tenants
          <ArrowUpRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-3 font-medium">Tenant</th>
              <th className="px-6 py-3 font-medium">Code</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 font-medium text-right">Users</th>
              <th className="px-6 py-3 font-medium text-right">Devices</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-6 py-3 font-medium text-foreground">
                    {t.name}
                  </td>
                  <td className="px-6 py-3 text-muted-foreground">
                    {t.code || "-"}
                  </td>
                  <td className="px-6 py-3">
                    <Badge
                      variant={t.status === "active" ? "success" : "warning"}
                      size="sm"
                    >
                      {t.status || "unknown"}
                    </Badge>
                  </td>
                  <td className="px-6 py-3 text-right text-foreground">
                    {t.users.toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-right text-foreground">
                    {t.devices.toLocaleString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={5}
                  className="px-6 py-10 text-center text-muted-foreground"
                >
                  No tenants yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TenantBreakdown;
