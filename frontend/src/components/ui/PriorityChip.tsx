import React from "react";
import { priorityDot } from "@/lib/priority";

/**
 * ADR-122 (P11-05; Amendment 1): an ORDINAL level — a priority, a severity, a
 * risk priority number, a score band — is not a status (doc 08). It is a
 * neutral chip with a dot from the sequential copper ramp (`--priority-*`,
 * lib/priority.ts) and its own words as the label; never a status tone, never
 * the alarm red. `level` is one of urgent / high / medium / low / none.
 */
export const PriorityChip: React.FC<{
  level: string;
  size?: "sm" | "md";
  className?: string;
  children: React.ReactNode;
}> = ({ level, size = "md", className = "", children }) => (
  <span
    data-level={level}
    className={`inline-flex items-center gap-1.5 rounded-full bg-muted font-semibold text-foreground ${
      size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-sm"
    } ${className}`}
  >
    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${priorityDot(level)}`} />
    {children}
  </span>
);

export default PriorityChip;
