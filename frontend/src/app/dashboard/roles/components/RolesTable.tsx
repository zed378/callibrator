import React from "react";
import { Shield, Edit2, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { Role } from "@/types";

interface RolesTableProps {
  roles: Role[];
  onEdit: (role: Role) => void;
  onDelete: (id: string) => void;
}

const levelColor: Record<number, string> = {
  1: "success",
  2: "warning",
  3: "danger",
};

export const RolesTable: React.FC<RolesTableProps> = ({
  roles,
  onEdit,
  onDelete,
}) => (
  <div className="overflow-x-auto overflow-y-hidden">
    <table className="w-full table-fixed">
      <thead className="bg-muted">
        <tr>
          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-0">
            Name
          </th>
          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-0">
            Display Name
          </th>
          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-0">
            Description
          </th>
          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-0">
            Level
          </th>
          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-0">
            Status
          </th>
          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-0">
            Created
          </th>
          <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-0">
            Actions
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {roles.map((role) => (
          <tr
            key={role.id}
            className="hover:bg-muted transition-colors"
          >
            <td className="px-6 py-4 whitespace-nowrap">
              <div className="flex items-center">
                {/* shrink-0 keeps the icon visible + fixed-size when a long
                    role name would otherwise squeeze it to zero width. */}
                <Shield className="h-5 w-5 shrink-0 text-muted-foreground mr-3" />
                <span className="text-sm font-medium text-foreground">
                  {role.name}
                </span>
              </div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
              {role.nameToShow || "-"}
            </td>
            <td className="px-6 py-4 text-sm text-muted-foreground">
              <div className="max-w-xs truncate">
                {role.description || "-"}
              </div>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
              <Badge
                variant={
                  (levelColor[role.roleLevel ?? -1] || "default") as
                    | "default"
                    | "success"
                    | "warning"
                    | "danger"
                }
              >
                Level {role.roleLevel ?? "-"}
              </Badge>
            </td>
            <td className="px-6 py-4 whitespace-nowrap">
              {role.isActive ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="danger">Inactive</Badge>
              )}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
              {role.createdAt
                ? new Date(role.createdAt).toLocaleDateString()
                : "-"}
            </td>
            <td className="px-6 py-4 whitespace-nowrap text-right">
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Edit2 className="h-4 w-4" />}
                  onClick={() => onEdit(role)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<Trash2 className="h-4 w-4" />}
                  onClick={() => onDelete(role.id)}
                  className="text-destructive hover:text-destructive/80"
                >
                  Delete
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
