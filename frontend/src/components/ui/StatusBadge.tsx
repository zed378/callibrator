import React from "react";
import { Badge } from "./Badge";
import { statusOf, type StatusDomain } from "@/lib/statusTone";

/**
 * P11-05 (ADR-122 §6; doc 10 "StatusBadge"): a domain state as a badge — its
 * tone (shape, icon, colour) and label from the one registry,
 * lib/statusTone.ts. `children` replaces the registry label where a page shows
 * the state in its own words.
 */
export const StatusBadge: React.FC<{
  domain: StatusDomain;
  state: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
  children?: React.ReactNode;
}> = ({ domain, state, size, className, children }) => {
  const { tone, label } = statusOf(domain, state);
  return (
    <Badge tone={tone} size={size} className={className}>
      {children ?? label}
    </Badge>
  );
};

export default StatusBadge;
