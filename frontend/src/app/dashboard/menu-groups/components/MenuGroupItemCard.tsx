// src/app/dashboard/menu-groups/components/MenuGroupItemCard.tsx
"use client";

import React from "react";
import {
  CheckCircle2,
  XCircle,
  LayoutGrid,
  Settings,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { ExtendedMenuGroup, ExtendedMenuItem } from "../types";
import {
  AssignmentBadge,
  GroupCheckbox,
  ItemCheckbox,
} from "./MenuGroupItemCardHelpers";

interface MenuGroupItemCardProps {
  group: ExtendedMenuGroup;
  groupState: "all" | "none" | "some";
  actionLoading: boolean;
  onToggleGroup: (id: string, assigned: boolean) => void;
  onAssignGroup: (id: string) => void;
  onRevokeGroup: (id: string) => void;
  onToggleItem: (
    group: ExtendedMenuGroup,
    item: ExtendedMenuItem,
    checked: boolean,
  ) => void;
  isItemAssigned: (group: ExtendedMenuGroup, item: ExtendedMenuItem) => boolean;
  isItemFullyAssigned: (
    group: ExtendedMenuGroup,
    item: ExtendedMenuItem,
  ) => boolean;
  isItemPartiallyAssigned: (
    group: ExtendedMenuGroup,
    item: ExtendedMenuItem,
  ) => boolean;
  onEditGroup?: (group: ExtendedMenuGroup) => void;
  onDeleteGroup?: (id: string) => void;
}

export function MenuGroupItemCard({
  group,
  groupState,
  actionLoading,
  onToggleGroup,
  onAssignGroup,
  onRevokeGroup,
  onToggleItem,
  isItemAssigned,
  isItemFullyAssigned,
  isItemPartiallyAssigned,
  onEditGroup,
  onDeleteGroup,
}: MenuGroupItemCardProps) {
  return (
    <div className="rounded-lg overflow-hidden">
      {/* Group Header */}
      <div
        className="flex items-center gap-3 p-3 rounded bg-muted text-foreground"
      >
        <GroupCheckbox
          groupState={groupState}
          onToggle={() => onToggleGroup(group.id || "", !group.isAssigned)}
          disabled={actionLoading}
        />
        <div
          className="p-1.5 rounded bg-card"
        >
          <LayoutGrid className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <span className="font-medium">{group.label}</span>
          {group.path && (
            <span
              className="text-xs ml-2 text-muted-foreground"
            >
              {group.path}
            </span>
          )}
        </div>
        <AssignmentBadge groupState={groupState} />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (groupState === "all") onRevokeGroup(group.id || "");
            else onAssignGroup(group.id || "");
          }}
          disabled={actionLoading}
        >
          {groupState === "all" ? "Revoke" : "Assign"}
        </Button>
        {onEditGroup && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEditGroup(group)}
            disabled={actionLoading}
            title="Edit menu group"
          >
            <Pencil className="w-4 h-4" />
          </Button>
        )}
        {onDeleteGroup && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDeleteGroup(group.id || "")}
            disabled={actionLoading}
            title="Delete menu group"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Group Items */}
      {group.items && group.items.length > 0 && (
        <div
          className="px-3 py-2 space-y-1 text-foreground"
        >
          {group.items.map((item) => {
            const itemAssigned = isItemAssigned(group, item);
            return (
              <div
                key={item.id}
                className="flex items-center gap-2 py-1.5 px-2 text-sm rounded hover:bg-muted"
              >
                <ItemCheckbox
                  fullyAssigned={isItemFullyAssigned(group, item)}
                  partiallyAssigned={isItemPartiallyAssigned(group, item)}
                  onToggle={() => onToggleItem(group, item, !itemAssigned)}
                  disabled={actionLoading}
                />
                <div
                  className="p-1 rounded bg-card"
                >
                  <Settings
                    className="w-3 h-3 text-muted-foreground"
                  />
                </div>
                <span className="font-medium">{item.label}</span>
                <span className="text-xs">
                  {"\u2192"} {item.path}
                </span>
                {item.requiredPermission && (
                  <Badge variant="primary" className="text-xs">
                    {item.requiredPermission}
                  </Badge>
                )}
                {group.isAssigned ? (
                  <Badge variant="success" className="text-xs">
                    <CheckCircle2 className="w-3 h-3 mr-0.5" />
                    Via Group
                  </Badge>
                ) : itemAssigned ? (
                  <Badge variant="success" className="text-xs">
                    <CheckCircle2 className="w-3 h-3 mr-0.5" />
                    Assigned
                  </Badge>
                ) : (
                  !group.isAssigned && (
                    <Badge variant="danger" className="text-xs">
                      <XCircle className="w-3 h-3 mr-0.5" />
                      Not Assigned
                    </Badge>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
