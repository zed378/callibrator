// src/app/dashboard/finance/page.tsx
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
import { Download, Plus, Trash2 } from "lucide-react";
import {
  financeService,
  type DepreciationMethod,
  type DepreciationReport,
  type FinanceRecord,
} from "@/api/services/finance.service";
import { deviceService } from "@/api/services/device.service";
import { useToastStore } from "@/stores/toastStore";

const PAGE_SIZE = 10;

const METHODS: DepreciationMethod[] = ["straight_line", "declining_balance"];

const money = (n?: number) =>
  typeof n === "number"
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

export default function FinancePage() {
  const addToast = useToastStore((s) => s.addToast);

  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [methodFilter, setMethodFilter] = useState("");
  const [report, setReport] = useState<DepreciationReport | null>(null);
  const [asOf, setAsOf] = useState("");
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({
    deviceId: "",
    purchasePrice: "",
    purchaseDate: "",
    salvageValue: "0",
    usefulLifeYears: "5",
    depreciationMethod: "straight_line" as DepreciationMethod,
    invoiceNumber: "",
    notes: "",
  });

  const [confirmDelete, setConfirmDelete] = useState<FinanceRecord | null>(null);

  useEffect(() => {
    deviceService
      .getAll(1, 100)
      .then((res) =>
        setDevices((res.data ?? []).map((d) => ({ id: d.id, name: d.name }))),
      )
      .catch(() => setDevices([]));
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [list, rep] = await Promise.all([
        financeService.getAll(page, PAGE_SIZE, {
          ...(methodFilter ? { method: methodFilter as DepreciationMethod } : {}),
        }),
        financeService.getDepreciationReport(asOf || undefined).catch(() => null),
      ]);
      setRecords(list.data);
      setTotal(list.meta.total);
      setReport(rep);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load finance data");
    } finally {
      setIsLoading(false);
    }
  }, [page, methodFilter, asOf]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const price = Number(form.purchasePrice);
    const life = Number(form.usefulLifeYears);
    if (!form.deviceId || !form.purchaseDate) {
      addToast({ type: "error", title: "Device and purchase date are required" });
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      addToast({ type: "error", title: "Purchase price must be a number" });
      return;
    }
    if (!Number.isInteger(life) || life < 1 || life > 50) {
      addToast({ type: "error", title: "Useful life must be 1–50 years" });
      return;
    }
    setBusy("create");
    try {
      await financeService.create({
        deviceId: form.deviceId,
        purchasePrice: price,
        purchaseDate: form.purchaseDate,
        salvageValue: Number(form.salvageValue) || 0,
        usefulLifeYears: life,
        depreciationMethod: form.depreciationMethod,
        invoiceNumber: form.invoiceNumber.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      addToast({ type: "success", title: "Asset recorded" });
      setIsCreateOpen(false);
      setForm({
        deviceId: "",
        purchasePrice: "",
        purchaseDate: "",
        salvageValue: "0",
        usefulLifeYears: "5",
        depreciationMethod: "straight_line",
        invoiceNumber: "",
        notes: "",
      });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not record asset",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirmDelete) return;
    setBusy("delete");
    try {
      await financeService.delete(confirmDelete.id);
      addToast({ type: "success", title: "Asset record deleted" });
      setConfirmDelete(null);
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Delete failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = async () => {
    setBusy("csv");
    try {
      const csv = await financeService.exportDepreciationCsv(asOf || undefined);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "depreciation-report.csv";
      a.click();
      URL.revokeObjectURL(url);
      addToast({ type: "success", title: "Report downloaded" });
    } catch (err) {
      addToast({
        type: "error",
        title: "Export failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const deviceName = (r: FinanceRecord) =>
    r.device?.name ?? devices.find((d) => d.id === r.deviceId)?.name ?? r.deviceId;

  const columns = [
    {
      key: "deviceId",
      header: "Asset",
      render: (_v: unknown, r: Record<string, unknown>) => {
        const rec = r as unknown as FinanceRecord;
        return (
          <div>
            <div className="font-medium">{deviceName(rec)}</div>
            {rec.invoiceNumber && (
              <div className="font-mono text-xs text-muted-foreground">
                {rec.invoiceNumber}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: "purchasePrice",
      header: "Purchase",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div>
          <div className="font-medium">{money(value as number)}</div>
          <div className="text-xs text-muted-foreground">
            {fmt(row.purchaseDate as string)}
          </div>
        </div>
      ),
    },
    {
      key: "usefulLifeYears",
      header: "Life",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div className="text-sm">
          <div>{String(value ?? "—")} yrs</div>
          <div className="text-xs text-muted-foreground">
            salvage {money(row.salvageValue as number)}
          </div>
        </div>
      ),
    },
    {
      key: "depreciationMethod",
      header: "Method",
      render: (value: unknown) => (
        <Badge variant="secondary" size="sm">
          {String(value ?? "").replace("_", " ")}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (_v: unknown, r: Record<string, unknown>) => {
        const rec = r as unknown as FinanceRecord;
        return (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmDelete(rec)}
            aria-label="Delete asset record"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        );
      },
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const t = report?.totals;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Asset Finance</h1>
            <p className="text-sm text-muted-foreground">
              Purchase cost and depreciation per device. Book values are
              computed as at a valuation date.
            </p>
          </div>
          <Button
            onClick={() => setIsCreateOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Record Asset
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {/* Depreciation summary */}
        <Card className="border-border">
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1">
                <FormField
                  label="Valuation date"
                  helperText="Leave blank to value as at today."
                >
                  <Input
                    type="date"
                    value={asOf}
                    onChange={(e) => setAsOf(e.target.value)}
                  />
                </FormField>
              </div>
              <Button
                variant="outline"
                onClick={exportCsv}
                isLoading={busy === "csv"}
                leftIcon={<Download className="h-4 w-4" />}
              >
                Export CSV
              </Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                ["Total purchase", money(t?.totalPurchase)],
                ["Accumulated depreciation", money(t?.totalAccumulatedDepreciation)],
                ["Net book value", money(t?.totalBookValue)],
                ["Fully depreciated", String(t?.fullyDepreciatedCount ?? 0)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>
            {report?.asOf && (
              <p className="text-xs text-muted-foreground">
                Valued as at {new Date(report.asOf).toLocaleString()} ·{" "}
                {report.count} asset{report.count === 1 ? "" : "s"}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <FormField label="Filter by method">
              <div className="flex gap-2">
                <Select
                  value={methodFilter}
                  onChange={(v) => {
                    setMethodFilter(v);
                    setPage(1);
                  }}
                  placeholder="All methods"
                  options={METHODS.map((m) => ({
                    value: m,
                    label: m.replace("_", " "),
                  }))}
                />
                {methodFilter && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setMethodFilter("");
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
          columns={columns}
          data={records as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          emptyMessage="No assets recorded yet."
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

        <Dialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="Record Asset"
          size="lg"
        >
          <div className="p-6 space-y-4">
            <FormField label="Device" required>
              <Select
                value={form.deviceId}
                onChange={(v) => setForm({ ...form, deviceId: v })}
                placeholder="Select a device"
                options={devices.map((d) => ({ value: d.id, label: d.name }))}
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Purchase price" required>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.purchasePrice}
                  onChange={(e) =>
                    setForm({ ...form, purchasePrice: e.target.value })
                  }
                />
              </FormField>
              <FormField label="Purchase date" required>
                <Input
                  type="date"
                  value={form.purchaseDate}
                  onChange={(e) =>
                    setForm({ ...form, purchaseDate: e.target.value })
                  }
                />
              </FormField>
              <FormField
                label="Salvage value"
                helperText="Residual value at end of life."
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.salvageValue}
                  onChange={(e) =>
                    setForm({ ...form, salvageValue: e.target.value })
                  }
                />
              </FormField>
              <FormField label="Useful life (years)" required helperText="1–50.">
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={form.usefulLifeYears}
                  onChange={(e) =>
                    setForm({ ...form, usefulLifeYears: e.target.value })
                  }
                />
              </FormField>
            </div>

            <FormField label="Depreciation method">
              <Select
                value={form.depreciationMethod}
                onChange={(v) =>
                  setForm({ ...form, depreciationMethod: v as DepreciationMethod })
                }
                options={METHODS.map((m) => ({
                  value: m,
                  label: m.replace("_", " "),
                }))}
              />
            </FormField>

            <FormField label="Invoice number">
              <Input
                value={form.invoiceNumber}
                onChange={(e) =>
                  setForm({ ...form, invoiceNumber: e.target.value })
                }
              />
            </FormField>

            <FormField label="Notes">
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </FormField>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create} isLoading={busy === "create"}>
                Record Asset
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          isOpen={confirmDelete !== null}
          onClose={() => setConfirmDelete(null)}
          title="Delete Asset Record"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="error">
              The depreciation history for this asset will be removed from the
              report. The device itself is not affected.
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={remove}
                isLoading={busy === "delete"}
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
