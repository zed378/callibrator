// src/app/dashboard/supplier-scorecard/page.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  supplierScorecardService,
  type SupplierScorecard,
  type SupplierScorecardCreateInput,
} from "@/api/services/supplierScorecard.service";
import { vendorService, type Vendor } from "@/api/services/vendor.service";
import { useToastStore } from "@/stores/toastStore";

const STATUS_OPTIONS = [
  { value: "APPROVED", label: "Approved" },
  { value: "PROBATION", label: "Probation" },
  { value: "DISQUALIFIED", label: "Disqualified" },
];

const emptyForm: SupplierScorecardCreateInput = {
  vendorId: "",
  evaluationDate: new Date().toISOString().slice(0, 10),
  qualityScore: 0,
  deliveryScore: 0,
  serviceScore: 0,
  status: "APPROVED",
  comments: "",
  nextEvaluationDate: "",
};

const scoreVariant = (score: number): "success" | "warning" | "danger" =>
  score >= 80 ? "success" : score >= 60 ? "warning" : "danger";

const statusVariant = (
  status: string,
): "success" | "warning" | "danger" | "default" => {
  switch (status) {
    case "APPROVED":
      return "success";
    case "PROBATION":
      return "warning";
    case "DISQUALIFIED":
      return "danger";
    default:
      return "default";
  }
};

/** Average of the three sub-scores — mirrors the backend's virtual overallScore. */
const computeOverall = (f: SupplierScorecardCreateInput): number =>
  Math.round(
    ((Number(f.qualityScore) || 0) +
      (Number(f.deliveryScore) || 0) +
      (Number(f.serviceScore) || 0)) /
      3,
  );

export default function SupplierScorecardPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [scorecards, setScorecards] = useState<SupplierScorecard[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [vendorFilter, setVendorFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierScorecardCreateInput>(emptyForm);
  const [deleteTarget, setDeleteTarget] = useState<SupplierScorecard | null>(
    null,
  );

  const vendorNameById = useMemo(() => {
    const map: Record<string, string> = {};
    vendors.forEach((v) => {
      map[v.id] = v.name;
    });
    return map;
  }, [vendors]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await supplierScorecardService.list({
        vendorId: vendorFilter || undefined,
        status: statusFilter || undefined,
      });
      setScorecards(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scorecards");
    } finally {
      setIsLoading(false);
    }
  }, [vendorFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  // Vendors power the picker + resolve names in the table.
  useEffect(() => {
    vendorService
      .getAll(1, 100)
      .then((res) => setVendors(res.data ?? []))
      .catch(() => setVendors([]));
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setIsFormOpen(true);
  };

  const openEdit = (sc: SupplierScorecard) => {
    setEditingId(sc.id);
    setForm({
      vendorId: sc.vendorId,
      evaluationDate: sc.evaluationDate
        ? sc.evaluationDate.slice(0, 10)
        : new Date().toISOString().slice(0, 10),
      qualityScore: sc.qualityScore,
      deliveryScore: sc.deliveryScore,
      serviceScore: sc.serviceScore,
      status: sc.status,
      comments: sc.comments ?? "",
      nextEvaluationDate: sc.nextEvaluationDate
        ? sc.nextEvaluationDate.slice(0, 10)
        : "",
    });
    setIsFormOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.vendorId) {
      addToast({ type: "error", title: "Vendor is required" });
      return;
    }
    setIsSubmitting(true);
    try {
      const payload: SupplierScorecardCreateInput = {
        ...form,
        nextEvaluationDate: form.nextEvaluationDate || undefined,
      };
      if (editingId) {
        await supplierScorecardService.update(editingId, payload);
        addToast({ type: "success", title: "Scorecard updated" });
      } else {
        await supplierScorecardService.create(payload);
        addToast({ type: "success", title: "Scorecard created" });
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
      await supplierScorecardService.delete(deleteTarget.id);
      addToast({ type: "success", title: "Scorecard deleted" });
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

  const columns = [
    {
      key: "vendorId",
      header: "Vendor",
      render: (value: unknown) => (
        <span className="font-medium">
          {vendorNameById[String(value)] ?? "—"}
        </span>
      ),
    },
    {
      key: "evaluationDate",
      header: "Evaluated",
      render: (value: unknown) =>
        value ? new Date(String(value)).toLocaleDateString() : "—",
    },
    { key: "qualityScore", header: "Quality" },
    { key: "deliveryScore", header: "Delivery" },
    { key: "serviceScore", header: "Service" },
    {
      key: "overallScore",
      header: "Overall",
      render: (_value: unknown, row: Record<string, unknown>) => {
        const overall =
          Math.round(
            ((Number(row.qualityScore) || 0) +
              (Number(row.deliveryScore) || 0) +
              (Number(row.serviceScore) || 0)) /
              3,
          ) || 0;
        return (
          <Badge variant={scoreVariant(overall)} size="sm">
            {overall}
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
      key: "actions",
      header: "Actions",
      render: (_value: unknown, row: Record<string, unknown>) => {
        const sc = row as unknown as SupplierScorecard;
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openEdit(sc)}
              aria-label="Edit scorecard"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(sc)}
              aria-label="Delete scorecard"
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
            <h1 className="text-2xl font-bold tracking-tight">
              Supplier Scorecards
            </h1>
            <p className="text-sm text-muted-foreground">
              Periodic quality, delivery, and service evaluation of vendors.
            </p>
          </div>
          <Button onClick={openCreate} leftIcon={<Plus className="h-4 w-4" />}>
            New Evaluation
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Select
                value={vendorFilter}
                onChange={setVendorFilter}
                options={[
                  { value: "", label: "All Vendors" },
                  ...vendors.map((v) => ({ value: v.id, label: v.name })),
                ]}
              />
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "", label: "All Statuses" },
                  ...STATUS_OPTIONS,
                ]}
              />
            </div>
          </CardContent>
        </Card>

        <Table
          columns={columns}
          data={scorecards as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          emptyMessage="No supplier evaluations recorded yet."
        />

        <Dialog
          isOpen={isFormOpen}
          onClose={() => setIsFormOpen(false)}
          title={editingId ? "Edit Evaluation" : "New Evaluation"}
          size="xl"
        >
          <form onSubmit={submit} className="p-6 space-y-4">
            <FormField label="Vendor" required>
              <Select
                value={form.vendorId}
                onChange={(v) => setForm({ ...form, vendorId: v })}
                placeholder="Select a vendor"
                options={vendors.map((v) => ({ value: v.id, label: v.name }))}
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField label="Quality (0-100)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={String(form.qualityScore ?? 0)}
                  onChange={(e) =>
                    setForm({ ...form, qualityScore: Number(e.target.value) })
                  }
                />
              </FormField>
              <FormField label="Delivery (0-100)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={String(form.deliveryScore ?? 0)}
                  onChange={(e) =>
                    setForm({ ...form, deliveryScore: Number(e.target.value) })
                  }
                />
              </FormField>
              <FormField label="Service (0-100)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={String(form.serviceScore ?? 0)}
                  onChange={(e) =>
                    setForm({ ...form, serviceScore: Number(e.target.value) })
                  }
                />
              </FormField>
            </div>

            <FormField
              label="Overall Score"
              helperText="Average of quality, delivery, and service."
            >
              <Badge variant={scoreVariant(computeOverall(form))}>
                {computeOverall(form)}
              </Badge>
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Evaluation Date" required>
                <Input
                  type="date"
                  value={form.evaluationDate}
                  onChange={(e) =>
                    setForm({ ...form, evaluationDate: e.target.value })
                  }
                />
              </FormField>
              <FormField label="Next Evaluation">
                <Input
                  type="date"
                  value={form.nextEvaluationDate ?? ""}
                  onChange={(e) =>
                    setForm({ ...form, nextEvaluationDate: e.target.value })
                  }
                />
              </FormField>
            </div>

            <FormField label="Status">
              <Select
                value={String(form.status ?? "APPROVED")}
                onChange={(v) => setForm({ ...form, status: v })}
                options={STATUS_OPTIONS}
              />
            </FormField>

            <FormField label="Comments">
              <Textarea
                rows={3}
                value={form.comments ?? ""}
                onChange={(e) => setForm({ ...form, comments: e.target.value })}
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
                {editingId ? "Save Changes" : "Create Evaluation"}
              </Button>
            </div>
          </form>
        </Dialog>

        <Dialog
          isOpen={deleteTarget !== null}
          onClose={() => setDeleteTarget(null)}
          title="Delete Evaluation"
          size="sm"
        >
          <div className="p-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Delete this supplier evaluation? This cannot be undone.
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
