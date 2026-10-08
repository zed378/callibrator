import React from "react";
import { Card, CardContent } from "@/components/ui";

interface RolesStatsProps {
  totalRoles: number;
  activeRoles: number;
  inactiveRoles: number;
}

export const RolesStats: React.FC<RolesStatsProps> = ({
  totalRoles,
  activeRoles,
  inactiveRoles,
}) => (
  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">Total Roles</p>
        <p className="text-2xl font-bold text-foreground mt-1">
          {totalRoles}
        </p>
      </CardContent>
    </Card>
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">Active</p>
        <p className="text-2xl font-bold text-success mt-1">
          {activeRoles}
        </p>
      </CardContent>
    </Card>
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">Inactive</p>
        <p className="text-2xl font-bold text-destructive mt-1">
          {inactiveRoles}
        </p>
      </CardContent>
    </Card>
  </div>
);
