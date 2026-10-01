// src/app/dashboard/menu-groups/components/MenuGroupItemCardHelpers.tsx
"use client";

import React from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

export function AssignmentBadge({
  groupState,
}: {
  groupState: "all" | "none" | "some";
}) {
  if (groupState === "all") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Assigned
      </Badge>
    );
  }
  if (groupState === "some") {
    return (
      <Badge variant="warning">
        <div className="w-2 h-2 bg-warning rounded-sm mr-1" />
        Partially Assigned
      </Badge>
    );
  }
  return (
    <Badge variant="default">
      <XCircle className="w-3 h-3 mr-1" />
      Not Assigned
    </Badge>
  );
}

export function GroupCheckbox({
  groupState,
  onToggle,
  disabled,
  label,
}: {
  groupState: "all" | "none" | "some";
  onToggle: () => void;
  disabled: boolean;
  /** The accessible name — an icon-only toggle has no text of its own. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={groupState === "all" ? true : groupState === "some" ? "mixed" : false}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className="flex items-center justify-center w-5 h-5 rounded border-2 border-border/60 hover:border-primary disabled:opacity-50"
    >
      {groupState === "all" ? (
        <CheckCircle2 className="w-4 h-4 text-primary" />
      ) : groupState === "some" ? (
        <div className="w-2.5 h-2.5 bg-primary rounded-sm" />
      ) : (
        <div className="w-0 h-0" />
      )}
    </button>
  );
}

export function ItemCheckbox({
  fullyAssigned,
  partiallyAssigned,
  onToggle,
  disabled,
  label,
}: {
  fullyAssigned: boolean;
  partiallyAssigned: boolean;
  onToggle: () => void;
  disabled: boolean;
  /** The accessible name — an icon-only toggle has no text of its own. */
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={fullyAssigned ? true : partiallyAssigned ? "mixed" : false}
      aria-label={label}
      onClick={onToggle}
      disabled={disabled}
      className="flex items-center justify-center w-5 h-5 rounded border-2 border-border/60 hover:border-primary disabled:opacity-50"
    >
      {fullyAssigned ? (
        <CheckCircle2 className="w-4 h-4 text-primary" />
      ) : partiallyAssigned ? (
        <div className="w-2.5 h-2.5 bg-primary rounded-sm" />
      ) : (
        <div className="w-0 h-0" />
      )}
    </button>
  );
}
