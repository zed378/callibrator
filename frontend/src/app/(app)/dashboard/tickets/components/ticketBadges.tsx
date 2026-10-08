import React from "react";
import { StatusBadge as RegistryBadge } from "@/components/ui/StatusBadge";
import { priorityDot } from "@/lib/priority";

// ADR-122 (P11-05): the ticket states' tones and labels live in lib/statusTone.ts;
// priority is not a status (lib/priority.ts).

export function StatusBadge({ status }: { status: string }) {
  return <RegistryBadge domain="ticket" state={status} size="sm" />;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-foreground">
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${priorityDot(priority)}`} />
      {priority}
    </span>
  );
}

export const userLabel = (
  u: { firstName?: string | null; lastName?: string | null; email: string } | null,
): string =>
  u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || u.email : "—";
