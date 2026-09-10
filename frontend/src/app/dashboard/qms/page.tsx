// src/app/dashboard/qms/page.tsx
"use client";

import React, { useCallback, useEffect, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  FormField,
  Input,
  Select,
  Table,
  Textarea,
} from "@/components/ui";
import { Plus } from "lucide-react";
import {
  qmsService,
  type Capa,
  type CapaStatus,
  type NcSeverity,
  type NcStatus,
  type NonConformance,
} from "@/api/services/qms.service";
import { useToastStore } from "@/stores/toastStore";

type Tab = "nc" | "capa";

const PAGE_SIZE = 10;

const NC_STATUSES: NcStatus[] = ["OPEN", "IN_PROGRESS", "CLOSED", "CANCELLED"];
const NC_SEVERITIES: NcSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const CAPA_STATUSES: CapaStatus[] = [
  "DRAFT",
  "IN_PROGRESS",
  "COMPLETED",
  "APPROVED",
  "CANCELLED",
];

const severityVariant = (s: string): "default" | "info" | "warning" | "danger" => {
  switch (s) {
    case "CRITICAL":
      return "danger";
    case "HIGH":
      return "warning";
    case "MEDIUM":
      return "info";
    default:
      return "default";
  }
};

const statusVariant = (
  s: string,
): "default" | "info" | "success" | "warning" | "danger" => {
  switch (s) {
    case "OPEN":
    case "DRAFT":
      return "warning";
    case "IN_PROGRESS":
      return "info";
    case "CLOSED":
    case "COMPLETED":
    case "APPROVED":
      return "success";
    case "CANCELLED":
      return "default";
    default:
      return "default";
  }
};

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

export default function QmsPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [tab, setTab] = useState<Tab>("nc");
  const [ncs, setNcs] = useState<NonConformance[]>([]);
  const [capas, setCapas] = useState<Capa[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [isNcOpen, setIsNcOpen] = useState(false);
  const [ncForm, setNcForm] = useState({
    title: "",
    description: "",
    severity: "MEDIUM" as NcSeverity,
  });

  const [isCapaOpen, setIsCapaOpen] = useState(false);
  const [capaForm, setCapaForm] = useState({
    ncId: "",
    title: "",
    actionPlan: "",
    dueDate: "",
  });

  const [rootCauseFor, setRootCauseFor] = useState<NonConformance | null>(null);
  const [rootCause, setRootCause] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = {
        page,
        limit: PAGE_SIZE,
        ...(statusFilter ? { status: statusFilter } : {}),
      };
      if (tab === "nc") {
        const res = await qmsService.listNonConformances(params);
        setNcs(res.rows);
        setTotal(res.total);
      } else {
        const res = await qmsService.listCapas(params);
        setCapas(res.rows);
        setTotal(res.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load QMS data");
    } finally {
      setIsLoading(false);
    }
  }, [tab, page, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setPage(1);
    setStatusFilter("");
  };

  const run = async (key: string, fn: () => Promise<unknown>, title: string) => {
    setBusy(key);
    try {
      await fn();
      addToast({ type: "success", title });
      await load();
      return true;
    } catch (err) {
      addToast({
        type: "error",
        title: "Action failed",
        description: err instanceof Error ? err.message : undefined,
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const createNc = async () => {
    if (!ncForm.title.trim()) {
      addToast({ type: "error", title: "A title is required" });
      return;
    }
    const ok = await run(
      "create-nc",
      () =>
        qmsService.createNonConformance({
          title: ncForm.title.trim(),
          description: ncForm.description.trim() || undefined,
          severity: ncForm.severity,
        }),
      "Non-conformance raised",
    );
    if (ok) {
      setIsNcOpen(false);
      setNcForm({ title: "", description: "", severity: "MEDIUM" });
    }
  };

  const createCapa = async () => {
    if (!capaForm.ncId.trim() || !capaForm.title.trim()) {
      addToast({ type: "error", title: "An NC and a title are required" });
      return;
    }
    const ok = await run(
      "create-capa",
      () =>
        qmsService.createCapa({
          ncId: capaForm.ncId,
          title: capaForm.title.trim(),
          actionPlan: capaForm.actionPlan.trim() || undefined,
          dueDate: capaForm.dueDate || undefined,
        }),
      "CAPA created",
    );
    if (ok) {
      setIsCapaOpen(false);
      setCapaForm({ ncId: "", title: "", actionPlan: "", dueDate: "" });
    }
  };

  const saveRootCause = async () => {
    if (!rootCauseFor) return;
    const ok = await run(
      "root-cause",
      () => qmsService.setRootCause(rootCauseFor.id, rootCause),
      "Root cause recorded",
    );
    if (ok) {
      setRootCauseFor(null);
      setRootCause("");
    }
  };

  /** Open the CAPA dialog pre-linked to an NC. */
  const openCapaFor = (nc: NonConformance) => {
    setCapaForm({
      ncId: nc.id,
      title: `Corrective action for ${nc.ncNumber}`,
      actionPlan: "",
      dueDate: "",
    });
    setIsCapaOpen(true);
  };

  const ncColumns = [
    {
      key: "ncNumber",
      header: "NC",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div>
          <div className="font-mono text-xs text-muted-foreground">
            {String(value ?? "")}
          </div>
          <div className="font-medium">{String(row.title ?? "")}</div>
        </div>
      ),
    },
    {
      key: "severity",
      header: "Severity",
      render: (value: unknown) => (
        <Badge variant={severityVariant(String(value))} size="sm">
          {String(value ?? "")}
        </Badge>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (value: unknown) => (
        <Badge variant={statusVariant(String(value))} size="sm">
          {String(value ?? "").replace("_", " ")}
        </Badge>
      ),
    },
    {
      key: "rootCause",
      header: "Root cause",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">
          {value ? String(value).slice(0, 40) : "—"}
        </span>
      ),
    },
    {
      key: "dateIdentified",
      header: "Identified",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">
          {fmt(value as string)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (_v: unknown, r: Record<string, unknown>) => {
        const nc = r as unknown as NonConformance;
        return (
          <div className="flex items-center gap-1">
            <Select
              value={nc.status}
              onChange={(v) =>
                run(nc.id, () => qmsService.updateNcStatus(nc.id, v as NcStatus), "Status updated")
              }
              options={NC_STATUSES.map((s) => ({
                value: s,
                label: s.replace("_", " "),
              }))}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRootCauseFor(nc);
                setRootCause(nc.rootCause ?? "");
              }}
            >
              Root cause
            </Button>
            <Button size="sm" variant="ghost" onClick={() => openCapaFor(nc)}>
              + CAPA
            </Button>
          </div>
        );
      },
    },
  ];

  const capaColumns = [
    {
      key: "capaNumber",
      header: "CAPA",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div>
          <div className="font-mono text-xs text-muted-foreground">
            {String(value ?? "")}
          </div>
          <div className="font-medium">{String(row.title ?? "")}</div>
        </div>
      ),
    },
    {
      key: "nonConformance",
      header: "Against NC",
      render: (value: unknown) => {
        const nc = value as { ncNumber?: string; title?: string } | undefined;
        return nc ? (
          <div>
            <div className="font-mono text-xs">{nc.ncNumber}</div>
            <div className="text-xs text-muted-foreground">
              {nc.title?.slice(0, 30)}
            </div>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (value: unknown) => (
        <Badge variant={statusVariant(String(value))} size="sm">
          {String(value ?? "").replace("_", " ")}
        </Badge>
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">
          {fmt(value as string)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (_v: unknown, r: Record<string, unknown>) => {
        const capa = r as unknown as Capa;
        return (
          <Select
            value={capa.status}
            onChange={(v) =>
              run(
                capa.id,
                () => qmsService.updateCapaStatus(capa.id, v as CapaStatus),
                "Status updated",
              )
            }
            options={CAPA_STATUSES.map((s) => ({
              value: s,
              label: s.replace("_", " "),
            }))}
          />
        );
      },
    },
  ];

  const rows = tab === "nc" ? ncs : capas;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Quality Management
            </h1>
            <p className="text-sm text-muted-foreground">
              Non-conformances and the corrective/preventive actions raised
              against them.
            </p>
          </div>
          <Button
            onClick={() => (tab === "nc" ? setIsNcOpen(true) : setIsCapaOpen(true))}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {tab === "nc" ? "Raise NC" : "New CAPA"}
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex gap-1 border-b border-border">
          {(
            [
              ["nc", "Non-Conformances"],
              ["capa", "CAPAs"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => switchTab(t)}
              className={`px-4 py-2 text-sm font-medium transition ${
                tab === t
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <FormField label="Filter by status">
              <div className="flex gap-2">
                <Select
                  value={statusFilter}
                  onChange={(v) => {
                    setStatusFilter(v);
                    setPage(1);
                  }}
                  placeholder="All statuses"
                  options={(tab === "nc" ? NC_STATUSES : CAPA_STATUSES).map(
                    (s) => ({ value: s, label: s.replace("_", " ") }),
                  )}
                />
                {statusFilter && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setStatusFilter("");
                      setPage(1);
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </FormField>
          </CardContent>
        </Card>

        <Table
          columns={tab === "nc" ? ncColumns : capaColumns}
          data={rows as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          emptyMessage={
            tab === "nc"
              ? "No non-conformances recorded."
              : "No CAPAs raised yet."
          }
        />

        {total > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages} · {total} total
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Raise NC */}
        <Dialog
          isOpen={isNcOpen}
          onClose={() => setIsNcOpen(false)}
          title="Raise Non-Conformance"
          size="md"
        >
          <div className="p-6 space-y-4">
            <FormField
              label="Title"
              required
              helperText="The NC number and OPEN status are assigned automatically."
            >
              <Input
                value={ncForm.title}
                onChange={(e) => setNcForm({ ...ncForm, title: e.target.value })}
                placeholder="e.g. Thermometer reading outside tolerance"
              />
            </FormField>
            <FormField label="Description">
              <Textarea
                rows={3}
                value={ncForm.description}
                onChange={(e) =>
                  setNcForm({ ...ncForm, description: e.target.value })
                }
              />
            </FormField>
            <FormField label="Severity">
              <Select
                value={ncForm.severity}
                onChange={(v) =>
                  setNcForm({ ...ncForm, severity: v as NcSeverity })
                }
                options={NC_SEVERITIES.map((s) => ({ value: s, label: s }))}
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsNcOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createNc} isLoading={busy === "create-nc"}>
                Raise NC
              </Button>
            </div>
          </div>
        </Dialog>

        {/* New CAPA */}
        <Dialog
          isOpen={isCapaOpen}
          onClose={() => setIsCapaOpen(false)}
          title="New CAPA"
          size="md"
        >
          <div className="p-6 space-y-4">
            <FormField
              label="Non-conformance ID"
              required
              helperText="A CAPA must be raised against an existing NC — use the “+ CAPA” action on a row to prefill this."
            >
              <Input
                value={capaForm.ncId}
                onChange={(e) =>
                  setCapaForm({ ...capaForm, ncId: e.target.value })
                }
                placeholder="NC uuid"
                className="font-mono text-xs"
              />
            </FormField>
            <FormField label="Title" required>
              <Input
                value={capaForm.title}
                onChange={(e) =>
                  setCapaForm({ ...capaForm, title: e.target.value })
                }
              />
            </FormField>
            <FormField label="Action plan">
              <Textarea
                rows={3}
                value={capaForm.actionPlan}
                onChange={(e) =>
                  setCapaForm({ ...capaForm, actionPlan: e.target.value })
                }
                placeholder="What will be done to correct and prevent recurrence?"
              />
            </FormField>
            <FormField label="Due date">
              <Input
                type="date"
                value={capaForm.dueDate}
                onChange={(e) =>
                  setCapaForm({ ...capaForm, dueDate: e.target.value })
                }
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCapaOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createCapa} isLoading={busy === "create-capa"}>
                Create CAPA
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Root cause */}
        <Dialog
          isOpen={rootCauseFor !== null}
          onClose={() => setRootCauseFor(null)}
          title={`Root cause — ${rootCauseFor?.ncNumber ?? ""}`}
          size="md"
        >
          <div className="p-6 space-y-4">
            <FormField
              label="Root cause"
              helperText="Recorded as a single field on the NC; there is no separate investigation record."
            >
              <Textarea
                rows={4}
                value={rootCause}
                onChange={(e) => setRootCause(e.target.value)}
                placeholder="e.g. Sensor drift beyond the calibration interval"
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRootCauseFor(null)}>
                Cancel
              </Button>
              <Button onClick={saveRootCause} isLoading={busy === "root-cause"}>
                Save
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
