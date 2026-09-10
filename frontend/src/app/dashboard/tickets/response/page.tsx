"use client";

import React, { useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Input, Card, CardContent, Alert, Select } from "@/components/ui";
import { Search, TicketCheck, Inbox, AlertTriangle, CheckCircle2 } from "lucide-react";
import { ticketService, TicketMetrics } from "@/api/services/ticket.service";
import { useTickets } from "../hooks/useTickets";
import TicketListRow from "../components/TicketListRow";
import { useTicketPov } from "../ticketPov";

function StatTile({
  label,
  value,
  icon,
  accent = "text-foreground",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
          <span className={accent}>{icon}</span>
        </div>
        <div className={`mt-2 text-3xl font-extrabold ${accent}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

/**
 * Response desk — for the super admin (who spans every tenant) and per-tenant
 * responders. Works the incoming support queue: triage, assign, reply, resolve.
 */
export default function TicketResponsePage() {
  const { isSuperAdmin } = useTicketPov();
  const {
    tickets,
    meta,
    isLoading,
    error,
    status,
    setStatus,
    priority,
    setPriority,
    mine,
    setMine,
    q,
    setQ,
  } = useTickets();

  const [metrics, setMetrics] = useState<TicketMetrics | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const m = await ticketService.getMetrics();
        if (active) setMetrics(m);
      } catch {
        if (active) setMetrics(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [tickets]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Ticket Response
          </h1>
          <p className="text-muted-foreground mt-1">
            {isSuperAdmin
              ? "Technical-support desk across every tenant. Triage, assign and resolve incoming tickets."
              : "Your tenant's support queue. Triage, assign and resolve incoming tickets."}
          </p>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label="Total"
            value={metrics?.total ?? 0}
            icon={<Inbox className="h-4 w-4" />}
          />
          <StatTile
            label="Open"
            value={metrics?.open ?? 0}
            accent="text-info"
            icon={<TicketCheck className="h-4 w-4" />}
          />
          <StatTile
            label="Overdue"
            value={metrics?.overdue ?? 0}
            accent="text-destructive"
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <StatTile
            label="Resolved"
            value={metrics?.resolved ?? 0}
            accent="text-success"
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search subject or key (e.g. TKT-12)…"
              className="pl-9"
            />
          </div>
          <Select
            value={status}
            onChange={(v) => setStatus(v as never)}
            options={[
              { value: "", label: "All statuses" },
              { value: "open", label: "Open" },
              { value: "in_progress", label: "In progress" },
              { value: "resolved", label: "Resolved" },
              { value: "closed", label: "Closed" },
            ]}
          />
          <Select
            value={priority}
            onChange={(v) => setPriority(v as never)}
            options={[
              { value: "", label: "All priorities" },
              { value: "urgent", label: "Urgent" },
              { value: "high", label: "High" },
              { value: "medium", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked as never)}
            className="h-4 w-4 accent-primary"
          />
          Only tickets assigned to me
        </label>

        {error && <Alert variant="error">{error}</Alert>}

        {isLoading && tickets.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : tickets.length > 0 ? (
          <div className="space-y-2">
            {tickets.map((t) => (
              <TicketListRow key={t.id} ticket={t} showTenant={isSuperAdmin} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-16 text-center">
              <TicketCheck className="mx-auto h-16 w-16 text-muted-foreground" />
              <h3 className="text-xl font-semibold text-foreground mt-4">
                Queue is clear
              </h3>
              <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                No tickets match this view. New support requests will appear here
                as tenants raise them.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
