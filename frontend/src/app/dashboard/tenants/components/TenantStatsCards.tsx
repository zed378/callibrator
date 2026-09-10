import React from "react";
import type { Tenant } from "@/types";
import { Card } from "@/components/ui";

interface StatsCardsProps {
  total: number;
  data: Tenant[] | undefined;
}

interface StatCardProps {
  label: string;
  value: number;
  colorClass: string;
}

function StatCard({ label, value, colorClass }: StatCardProps) {
  return (
    <Card>
      <div className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${colorClass}`}>{value}</p>
      </div>
    </Card>
  );
}

export const TenantStatsCards: React.FC<StatsCardsProps> = ({
  total,
  data,
}) => {
  const tenants = Array.isArray(data) ? data : [];
  const active = tenants.filter((t) => t.status === "ACTIVE").length;
  const suspended = tenants.filter((t) => t.status === "SUSPENDED").length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard label="Total Tenants" value={total} colorClass="text-foreground" />
      <StatCard label="Active" value={active} colorClass="text-success" />
      <StatCard label="Suspended" value={suspended} colorClass="text-destructive" />
    </div>
  );
};
