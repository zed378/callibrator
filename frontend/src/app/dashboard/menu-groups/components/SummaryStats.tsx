"use client";

import { CheckCircle2, XCircle, LayoutGrid, Users } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import type { ExtendedMenuGroup } from "../types";

const statConfig = (color: string) => {
  const map: Record<string, string> = {
    green: "bg-success/10 border-success/30/50",
    red: "bg-destructive/10 border-destructive/30",
    blue: "bg-info/10 border-info/30",
    purple: "bg-accent/10 border-accent/30/50",
  };
  return map[color] || map.blue;
};

const iconConfig = (color: string) => {
  const map: Record<string, { iconBg: string; icon: string; text: string }> = {
    green: { iconBg: "bg-success/10", icon: "text-success", text: "text-muted-foreground" },
    red: { iconBg: "bg-destructive/10", icon: "text-destructive", text: "text-muted-foreground" },
    blue: { iconBg: "bg-info/10", icon: "text-info", text: "text-muted-foreground" },
    purple: { iconBg: "bg-accent/10", icon: "text-accent", text: "text-muted-foreground" },
  };
  return map[color] || map.blue;
};

interface SummaryStatsProps {
  menuGroups: ExtendedMenuGroup[];
  roles: { id?: string; nameToShow?: string; name?: string }[];
  selectedRoleId: string;
}

function StatTile({
  icon,
  color,
  value,
  label,
}: {
  icon: React.ReactNode;
  color: string;
  value: number;
  label: string;
}) {
  const c = statConfig(color);
  const ic = iconConfig(color);
  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg border ${c}`}
    >
      <div className={`p-2 rounded ${ic.iconBg}`}>
        <span className={ic.icon}>{icon}</span>
      </div>
      <div>
        <div className="text-2xl font-bold">{value}</div>
        <div className={`text-xs ${ic.text}`}>{label}</div>
      </div>
    </div>
  );
}

export function SummaryStats({
  menuGroups,
  roles,
  selectedRoleId,
}: SummaryStatsProps) {

  const assignedCount = menuGroups.filter((g) => g.isAssigned).length;
  const notAssignedCount = menuGroups.filter((g) => !g.isAssigned).length;
  const totalGroups = menuGroups.length;
  const totalRoles = roles.length;
  const roleLabel =
    roles.find((r) => r.id === selectedRoleId)?.nameToShow ||
    roles.find((r) => r.id === selectedRoleId)?.name ||
    "this role";

  return (
    <Card>
      <CardHeader
        title="Current Assignments"
        subtitle={`Summary of menu groups assigned to ${roleLabel}`}
      />
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatTile
            icon={<CheckCircle2 className="w-5 h-5" />}
            color="green"
            value={assignedCount}
            label="Assigned Groups"
          />
          <StatTile
            icon={<XCircle className="w-5 h-5" />}
            color="red"
            value={notAssignedCount}
            label="Not Assigned"
          />
          <StatTile
            icon={<LayoutGrid className="w-5 h-5" />}
            color="blue"
            value={totalGroups}
            label="Total Groups"
          />
          <StatTile
            icon={<Users className="w-5 h-5" />}
            color="purple"
            value={totalRoles}
            label="Total Roles"
          />
        </div>
      </CardContent>
    </Card>
  );
}
