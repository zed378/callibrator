// src/app/dashboard/menu-groups/components/MenuGroupItemCardHelpers.tsx
"use client";

import React from "react";
import { CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";

// ADR-122 Amendment 1: assignment is a state — tone, shape, icon and label
// come from lib/statusTone.ts ("menuAssignment").

export function AssignmentBadge({
  groupState,
}: {
  groupState: "all" | "none" | "some";
}) {
  const state = groupState === "all" ? "assigned" : groupState === "some" ? "partial" : "unassigned";
  return <StatusBadge domain="menuAssignment" state={state} />;
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
