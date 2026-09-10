"use client";

import { Shield, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { MenuGroupItemCard } from "./MenuGroupItemCard";
import type { ExtendedMenuGroup, ExtendedMenuItem } from "../types";

interface BulkActionBarProps {
  menuGroups: ExtendedMenuGroup[];
  actionLoading: boolean;
  getGroupAssignmentState: (g: ExtendedMenuGroup) => "all" | "none" | "some";
  isItemAssigned: (g: ExtendedMenuGroup, item: ExtendedMenuItem) => boolean;
  isItemFullyAssigned: (
    g: ExtendedMenuGroup,
    item: ExtendedMenuItem,
  ) => boolean;
  isItemPartiallyAssigned: (
    g: ExtendedMenuGroup,
    item: ExtendedMenuItem,
  ) => boolean;
  onToggleGroup: (id: string, assigned: boolean) => void;
  onAssignGroup: (id: string) => void;
  onRevokeGroup: (id: string) => void;
  onToggleAll: () => void;
  onBulkAssign: () => void;
  onBulkRevoke: () => void;
  onToggleItem: (
    group: ExtendedMenuGroup,
    item: ExtendedMenuItem,
    checked: boolean,
  ) => void;
  onEditGroup?: (group: ExtendedMenuGroup) => void;
  onDeleteGroup?: (id: string) => void;
}

export function BulkActionBar({
  menuGroups,
  actionLoading,
  getGroupAssignmentState,
  isItemAssigned,
  isItemFullyAssigned,
  isItemPartiallyAssigned,
  onToggleGroup,
  onAssignGroup,
  onRevokeGroup,
  onToggleAll,
  onBulkAssign,
  onBulkRevoke,
  onToggleItem,
  onEditGroup,
  onDeleteGroup,
}: BulkActionBarProps) {
  const hasAssigned = menuGroups.some((g) => g.isAssigned);

  return (
    <Card>
      <CardHeader
        title={
          <div className="flex items-center gap-2">
            <Shield
              className="w-5 h-5 text-foreground"
            />
            <span className="text-foreground">
              Menu Group Assignments
            </span>
          </div>
        }
        action={
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onToggleAll}
              disabled={actionLoading}
            >
              {hasAssigned ? "Deselect All" : "Select All"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onBulkAssign}
              disabled={actionLoading || !hasAssigned}
            >
              {actionLoading && (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              )}
              Assign Selected
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={onBulkRevoke}
              disabled={actionLoading || !hasAssigned}
            >
              {actionLoading && (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              )}
              Revoke Selected
            </Button>
          </div>
        }
      />
      <CardContent>
        <div className="space-y-3">
          {menuGroups.map((group) => (
            <MenuGroupItemCard
              key={group.id}
              group={group}
              groupState={getGroupAssignmentState(group)}
              actionLoading={actionLoading}
              onToggleGroup={onToggleGroup}
              onAssignGroup={onAssignGroup}
              onRevokeGroup={onRevokeGroup}
              onToggleItem={onToggleItem}
              isItemAssigned={isItemAssigned}
              isItemFullyAssigned={isItemFullyAssigned}
              isItemPartiallyAssigned={isItemPartiallyAssigned}
              onEditGroup={onEditGroup}
              onDeleteGroup={onDeleteGroup}
            />
          ))}
          {menuGroups.length === 0 && (
            <div
              className="text-center py-8 text-muted-foreground"
            >
              No menu groups available for this role.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
