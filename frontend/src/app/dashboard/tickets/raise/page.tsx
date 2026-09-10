"use client";

import React, { useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Input, Card, CardContent, Alert, Select } from "@/components/ui";
import { Plus, TicketPlus, Search, LifeBuoy } from "lucide-react";
import { useTickets } from "../hooks/useTickets";
import CreateTicketModal from "../components/CreateTicketModal";
import TicketListRow from "../components/TicketListRow";

/**
 * Raise page — the default ticket entry point, available to every tenant role
 * except the super admin. Tenants reach out to the platform for technical
 * support here and track the tickets they have raised.
 */
export default function RaiseTicketPage() {
  const {
    tickets,
    meta,
    isLoading,
    error,
    status,
    setStatus,
    priority,
    setPriority,
    q,
    setQ,
    refresh,
  } = useTickets({ fixedMine: true });

  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              Raise a Ticket
            </h1>
            <p className="text-muted-foreground mt-1">
              Need technical support? Raise a ticket to our team and track its
              progress here. {meta.total} raised.
            </p>
          </div>
          <Button
            variant="primary"
            leftIcon={<Plus className="h-5 w-5" />}
            onClick={() => setIsCreateOpen(true)}
          >
            Raise ticket
          </Button>
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

        {error && <Alert variant="error">{error}</Alert>}

        {isLoading && tickets.length === 0 ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : tickets.length > 0 ? (
          <div className="space-y-2">
            {tickets.map((t) => (
              <TicketListRow key={t.id} ticket={t} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-16 text-center">
              <LifeBuoy className="mx-auto h-16 w-16 text-muted-foreground" />
              <h3 className="text-xl font-semibold text-foreground mt-4">
                No tickets yet
              </h3>
              <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
                Raise your first support ticket to get help tracked and resolved.
              </p>
              <Button
                variant="primary"
                leftIcon={<TicketPlus className="h-5 w-5" />}
                onClick={() => setIsCreateOpen(true)}
                className="mt-6"
              >
                Raise a ticket
              </Button>
            </CardContent>
          </Card>
        )}

        <CreateTicketModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onCreated={refresh}
        />
      </div>
    </DashboardLayout>
  );
}
