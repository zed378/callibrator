"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui";
import { Ticket } from "@/api/services/ticket.service";
import { StatusBadge, PriorityBadge, userLabel } from "./ticketBadges";

interface Props {
  ticket: Ticket;
  // Show the originating tenant (response desk, super-admin cross-tenant view).
  showTenant?: boolean;
}

/** A single clickable ticket row shared by the Raise and Response lists. */
export default function TicketListRow({ ticket: t, showTenant = false }: Props) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(`/dashboard/tickets/${t.id}`)}
      className="w-full text-left group"
    >
      <Card className="transition-all group-hover:shadow-md group-hover:-translate-y-0.5">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground shrink-0">
                {t.ticketKey}
              </span>
              <span className="font-medium text-foreground truncate">
                {t.subject}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
              {showTenant && t.tenant && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 font-medium">
                  <Building2 className="h-3 w-3" />
                  {t.tenant.name}
                </span>
              )}
              <span className="capitalize">{t.category}</span>
              <span>· by {userLabel(t.requester)}</span>
              <span>· {new Date(t.createdAt).toLocaleDateString()}</span>
              {t.assignee && <span>· to {userLabel(t.assignee)}</span>}
            </div>
          </div>
          <PriorityBadge priority={t.priority} />
          <StatusBadge status={t.status} />
        </CardContent>
      </Card>
    </button>
  );
}
