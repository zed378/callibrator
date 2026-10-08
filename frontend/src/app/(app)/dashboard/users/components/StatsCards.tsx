import React from "react";
import type { User } from "@/types";
import { Card, CardContent } from "@/components/ui";

interface StatsCardsProps {
  total: number;
  data: User[] | undefined;
}

interface StatCardProps {
  label: string;
  value: number;
  colorClass: string;
}

function StatCard({ label, value, colorClass }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${colorClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export const StatsCards: React.FC<StatsCardsProps> = ({ total, data }) => {
  const active = Array.isArray(data)
    ? data.filter((u) => u.status === "ACTIVE").length || 0
    : 0;
  const suspended = Array.isArray(data)
    ? data.filter((u) => u.status === "SUSPENDED").length || 0
    : 0;
  const pending = Array.isArray(data)
    ? data.filter((u) => u.status === "PENDING").length || 0
    : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
      <StatCard label="Total Users" value={total} colorClass="text-foreground" />
      <StatCard label="Active" value={active} colorClass="text-success" />
      <StatCard label="Suspended" value={suspended} colorClass="text-destructive" />
      <StatCard label="Pending" value={pending} colorClass="text-warning" />
    </div>
  );
};
