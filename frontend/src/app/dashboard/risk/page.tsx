// src/app/dashboard/risk/page.tsx
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
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
import {
  riskService,
  type Risk,
  type RiskCreateInput,
} from "@/api/services/risk.service";
import { useToastStore } from "@/stores/toastStore";

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "MITIGATED", label: "Mitigated" },
  { value: "CLOSED", label: "Closed" },
  { value: "ACCEPTED", label: "Accepted" },
];

const CATEGORY_OPTIONS = [
  { value: "OPERATIONAL", label: "Operational" },
  { value: "FINANCIAL", label: "Financial" },
  { value: "COMPLIANCE", label: "Compliance" },
  { value: "STRATEGIC", label: "Strategic" },
  { value: "SAFETY", label: "Safety" },
];

const SCALE_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({
  value: String(n),
  label: String(n),
}));

const emptyForm: RiskCreateInput = {
  title: "",
  description: "",
  category: "OPERATIONAL",
  severity: 1,
  likelihood: 1,
  status: "OPEN",
  mitigationPlan: "",
  dueDate: "",
};

/** RPN = severity x likelihood (1-25). Colour-code the risk band. */
const rpnVariant = (rpn: number): "success" | "warning" | "danger" =>
  rpn >= 15 ? "danger" : rpn >= 8 ? "warning" : "success";

const statusVariant = (status: string): "default" | "warning" | "success" | "info" => {
  switch (status) {
    case "OPEN":
      return "warning";
    case "MITIGATED":
      return "info";
    case "CLOSED":
      return "success";
    default:
      return "default";
  }
};

export default function RiskPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [risks, setRisks] = useState<Risk[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RiskCreateInput>(emptyForm);

  const [deleteTarget, setDeleteTarget] = useState<Risk | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await riskService.list({
        status: statusFilter || undefined,
        category: categoryFilter || undefined,
      });
      setRisks(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load risks");
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, categoryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setIsFormOpen(true);
  };

  const openEdit = (risk: Risk) => {
    setEditingId(risk.id);
    setForm({
      title: risk.title,
      description: risk.description ?? "",
      category: risk.category,
      severity: risk.severity,
      likelihood: risk.likelihood,
      status: risk.status,
      mitigationPlan: risk.mitigationPlan ?? "",
      dueDate: risk.dueDate ? risk.dueDate.slice(0, 10) : "",
    });
    setIsFormOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      addToast({ type: "error", title: "Title is required" });
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: RiskCreateInput = {
        ...form,
        dueDate: form.dueDate || undefined,
      };
      if (editingId) {
        await riskService.update(editingId, payload);
        addToast({ type: "success", title: "Risk updated" });
      } else {
        await riskService.create(payload);
        addToast({ type: "success", title: "Risk created" });
      }
      setIsFormOpen(false);
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Save failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsSubmitting(true);
    try {
      await riskService.delete(deleteTarget.id);
      addToast({ type: "success", title: "Risk deleted" });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Delete failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const visible = risks.filter((r) =>
    search.trim()
      ? `${r.title} ${r.description ?? ""}`
          .toLowerCase()
          .includes(search.trim().toLowerCase())
      : true,
  );

  const columns = [
    { key: "title", header: "Risk" },
    {
      key: "category",
      header: "Category",
      render: (value: unknown) => (
        <span className="text-sm capitalize">
          {String(value ?? "").toLowerCase()}
        </span>
      ),
    },
    { key: "severity", header: "Severity" },
    { key: "likelihood", header: "Likelihood" },
    {
      key: "rpn",
      header: "RPN",
      render: (_value: unknown, row: Record<string, unknown>) => {
        const rpn =
          Number(row.severity ?? 0) * Number(row.likelihood ?? 0) || 0;
        return (
          <Badge variant={rpnVariant(rpn)} size="sm">
            {rpn}
          </Badge>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (value: unknown) => (
        <Badge variant={statusVariant(String(value ?? ""))} size="sm">
          {String(value ?? "")}
        </Badge>
      ),
    },
    {
      key: "dueDate",
      header: "Due",
      render: (value: unknown) =>
        value ? new Date(String(value)).toLocaleDateString() : "—",
    },
    {
      key: "actions",
      header: "Actions",
      render: (_value: unknown, row: Record<string, unknown>) => {
        const risk = row as unknown as Risk;
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openEdit(risk)}
              aria-label="Edit risk"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(risk)}
              aria-label="Delete risk"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Risk Register</h1>
            <p className="text-sm text-muted-foreground">
              Identify, score, and mitigate risks (ISO 14971). RPN = severity ×
              likelihood.
            </p>
          </div>
          <Button onClick={openCreate} leftIcon={<Plus className="h-4 w-4" />}>
            Add Risk
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input
                placeholder="Search risks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leftIcon={<Search className="h-4 w-4" />}
              />
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                options={[{ value: "", label: "All Statuses" }, ...STATUS_OPTIONS]}
              />
              <Select
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  { value: "", label: "All Categories" },
                  ...CATEGORY_OPTIONS,
                ]}
              />
            </div>
          </CardContent>
        </Card>

        <Table
          columns={columns}
          data={visible as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          emptyMessage="No risks recorded yet."
        />

        <Dialog
          isOpen={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          title={editingId ? "Edit Risk" : "Add Risk"}
          size="xl"
        >
          <form onSubmit={submit} className="p-6 space-y-4">
            <FormField label="Title" required>
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Ventilator calibration drift"
              />
            </FormField>

            <FormField label="Description">
              <Textarea
                rows={3}
                value={form.description ?? ""}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Category">
                <Select
                  value={String(form.category ?? "OPERATIONAL")}
                  onChange={(v) => setForm({ ...form, category: v })}
                  options={CATEGORY_OPTIONS}
                />
              </FormField>
              <FormField label="Status">
                <Select
                  value={String(form.status ?? "OPEN")}
                  onChange={(v) => setForm({ ...form, status: v })}
                  options={STATUS_OPTIONS}
                />
              </FormField>
              <FormField label="Severity (1-5)">
                <Select
                  value={String(form.severity ?? 1)}
                  onChange={(v) => setForm({ ...form, severity: Number(v) })}
                  options={SCALE_OPTIONS}
                />
              </FormField>
              <FormField label="Likelihood (1-5)">
                <Select
                  value={String(form.likelihood ?? 1)}
                  onChange={(v) => setForm({ ...form, likelihood: Number(v) })}
                  options={SCALE_OPTIONS}
                />
              </FormField>
            </div>

            <FormField
              label="Computed RPN"
              helperText="Severity × Likelihood — 15+ is a high-priority risk."
            >
              <Badge
                variant={rpnVariant(
                  Number(form.severity ?? 0) * Number(form.likelihood ?? 0),
                )}
              >
                {Number(form.severity ?? 0) * Number(form.likelihood ?? 0)}
              </Badge>
            </FormField>

            <FormField label="Mitigation Plan">
              <Textarea
                rows={3}
                value={form.mitigationPlan ?? ""}
                onChange={(e) =>
                  setForm({ ...form, mitigationPlan: e.target.value })
                }
              />
            </FormField>

            <FormField label="Due Date">
              <Input
                type="date"
                value={form.dueDate ?? ""}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </FormField>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsFormOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" isLoading={isSubmitting}>
                {editingId ? "Save Changes" : "Create Risk"}
              </Button>
            </div>
          </form>
        </Dialog>

        <Dialog
          isOpen={deleteTarget !== null}
          onClose={() => setDeleteTarget(null)}
          title="Delete Risk"
          size="sm"
        >
          <div className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Delete <span className="font-semibold">{deleteTarget?.title}</span>
              ? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmDelete}
                isLoading={isSubmitting}
              >
                Delete
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
