"use client";

import { Users, Shield, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import type { Role } from "@/types";

interface RoleSelectionCardProps {
  roles: Role[];
  selectedRoleId: string;
  onSelectRole: (val: string) => void;
}

export function RoleSelectionCard({
  roles,
  selectedRoleId,
  onSelectRole,
}: RoleSelectionCardProps) {
  if (roles.length === 0) {
    return (
      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-foreground" />
              <span className="text-foreground">
                Select Role
              </span>
            </div>
          }
          subtitle="Choose the role to manage menu group assignments for"
        />
        <CardContent>
          <div className="text-center py-6">
            <Shield className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm mb-2 text-muted-foreground">
              No roles available. Create roles in the Roles page first before
              managing menu groups.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                (window.location.href = "/dashboard/roles")
              }
            >
              Go to Roles
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-foreground" />
            <span className="text-foreground">
              Select Role
            </span>
          </div>
        }
        subtitle="Choose the role to manage menu group assignments for"
      />
      <CardContent>
        <Select
          value={selectedRoleId}
          onChange={onSelectRole}
          placeholder="Select a role to manage..."
          options={roles.map((role) => ({
            value: role.id || "",
            label:
              role.nameToShow ||
              role.name + (role.roleLevel ? ` (Level ${role.roleLevel})` : ""),
          }))}
          className="max-w-md"
        />
      </CardContent>
    </Card>
  );
}
