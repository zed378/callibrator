// src/app/dashboard/metered-billing/page.tsx
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
} from "@/components/ui";
import { BellPlus, Trash2 } from "lucide-react";
import {
  meteredBillingService,
  type AlertComparison,
  type Invoice,
  type PlanDetails,
  type UsageAlert,
  type UsageSnapshot,
} from "@/api/services/meteredBilling.service";
import { useToastStore } from "@/stores/toastStore";

const PAGE_SIZE = 10;

const fmt = (v?: string) => (v ? new Date(v).toLocaleDateString() : "—");
const num = (n?: number) => (typeof n === "number" ? n.toLocaleString() : "—");

export default function MeteredBillingPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [plan, setPlan] = useState<PlanDetails | null>(null);
  const [alerts, setAlerts] = useState<UsageAlert[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [alertForm, setAlertForm] = useState({
    metricName: "",
    threshold: "",
    comparison: "gte" as AlertComparison,
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [snap, planDetails, alertList, history] = await Promise.all([
        meteredBillingService.getUsage(),
        meteredBillingService.getPlan(),
        meteredBillingService.getAlerts(),
        meteredBillingService.getUsageHistory({ page, limit: PAGE_SIZE }),
      ]);
      setUsage(snap);
      setPlan(planDetails);
      setAlerts(alertList);
      setInvoices(history.rows);
      setInvoiceTotal(history.meta.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load usage data");
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    // Defer past the synchronous effect body — load() writes state, and doing
    // that synchronously in an effect cascades renders (set-state-in-effect).
    let active = true;
    (async () => {
      await Promise.resolve();
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const createAlert = async () => {
    const threshold = Number(alertForm.threshold);
    if (!alertForm.metricName.trim()) {
      addToast({ type: "error", title: "Pick a metric" });
      return;
    }
    if (!Number.isFinite(threshold) || threshold <= 0) {
      addToast({ type: "error", title: "Threshold must be a positive number" });
      return;
    }
    setBusy("create-alert");
    try {
      await meteredBillingService.createAlert({
        metricName: alertForm.metricName.trim(),
        threshold,
        comparison: alertForm.comparison,
      });
      addToast({ type: "success", title: "Alert created" });
      setIsAlertOpen(false);
      setAlertForm({ metricName: "", threshold: "", comparison: "gte" });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not create alert",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const deleteAlert = async (alert: UsageAlert) => {
    setBusy(alert.id);
    try {
      await meteredBillingService.deleteAlert(alert.id);
      addToast({ type: "success", title: "Alert removed" });
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

  const metrics = usage?.metrics ?? {};
  const limits = plan?.limits ?? {};
  const metricNames = Array.from(
    new Set([...Object.keys(metrics), ...Object.keys(limits)]),
  );

  const invoiceColumns = [
    {
      key: "id",
      header: "Invoice",
      render: (value: unknown) => (
        <span className="font-mono text-xs">
          {String(value ?? "").slice(0, 8)}
        </span>
      ),
    },
    {
      key: "periodStart",
      header: "Period",
      render: (value: unknown, row: Record<string, unknown>) => (
        <span className="text-sm">
          {fmt(value as string)} – {fmt(row.periodEnd as string)}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (value: unknown, row: Record<string, unknown>) => (
        <span className="font-medium">
          {typeof value === "number" ? value.toFixed(2) : "—"}{" "}
          {String(row.currency ?? "")}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (value: unknown) => (
        <Badge
          variant={value === "paid" ? "success" : "warning"}
          size="sm"
        >
          {String(value ?? "—")}
        </Badge>
      ),
    },
  ];

  const totalPages = Math.max(1, Math.ceil(invoiceTotal / PAGE_SIZE));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Usage &amp; Metering
            </h1>
            <p className="text-sm text-muted-foreground">
              Current consumption against your plan limits, invoices, and
              threshold alerts.
            </p>
          </div>
          <Button
            onClick={() => setIsAlertOpen(true)}
            leftIcon={<BellPlus className="h-4 w-4" />}
          >
            New Alert
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {/* Plan */}
        <Card className="border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Current plan</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="primary">{plan?.plan ?? "—"}</Badge>
                  {plan?.billingCycle && (
                    <span className="text-sm text-muted-foreground">
                      billed {plan.billingCycle}
                    </span>
                  )}
                </div>
              </div>
              {usage?.generatedAt && (
                <p className="text-xs text-muted-foreground">
                  as at {new Date(usage.generatedAt).toLocaleString()}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Usage vs limits */}
        <Card className="border-border">
          <CardContent className="pt-6 space-y-4">
            <h2 className="text-lg font-semibold">Usage this period</h2>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : metricNames.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No metered usage recorded.
              </p>
            ) : (
              <div className="space-y-3">
                {metricNames.map((name) => {
                  // Each metric is { total, current, history } — the meter
                  // shows current-period usage against the plan limit.
                  const used = metrics[name]?.current ?? 0;
                  const limit = limits[name];
                  const pct =
                    typeof limit === "number" && limit > 0
                      ? Math.round((used / limit) * 100)
                      : null;
                  const over = pct !== null && pct >= 100;
                  const near = pct !== null && pct >= 80 && pct < 100;
                  return (
                    <div key={name}>
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">
                          {name.replace(/_/g, " ")}
                        </span>
                        <span className="text-muted-foreground">
                          {num(used)}
                          {typeof limit === "number" ? ` / ${num(limit)}` : ""}
                          {pct !== null ? ` (${pct}%)` : ""}
                        </span>
                      </div>
                      {pct !== null && (
                        <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
                          <div
                            className={`h-1.5 rounded-full transition-all ${
                              over
                                ? "bg-destructive"
                                : near
                                  ? "bg-warning"
                                  : "bg-primary"
                            }`}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      )}
                      {over && (
                        <p className="mt-1 text-xs text-destructive">
                          Over the included limit — overage is charged at{" "}
                          {plan?.overagePricing?.[name] ?? "the rate card"} per
                          unit.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alerts */}
        <Card className="border-border">
          <CardContent className="pt-6 space-y-3">
            <h2 className="text-lg font-semibold">Threshold alerts</h2>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No alerts configured.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <div className="text-sm">
                      <span className="font-medium">
                        {a.metricName.replace(/_/g, " ")}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {a.comparison} {num(a.threshold)}
                      </span>
                      {a.isEnabled === false && (
                        <Badge variant="default" size="sm" className="ml-2">
                          disabled
                        </Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={busy === a.id}
                      onClick={() => deleteAlert(a)}
                      aria-label={`Delete ${a.metricName} alert`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Alerts are deleted rather than acknowledged — the API has no
              acknowledge action.
            </p>
          </CardContent>
        </Card>

        {/* Invoices */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Invoices</h2>
          <Table
            columns={invoiceColumns}
            data={invoices as unknown as Record<string, unknown>[]}
            isLoading={isLoading}
            emptyMessage="No invoices yet."
          />
          {invoiceTotal > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages} · {invoiceTotal} total
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
        </div>

        <Dialog
          isOpen={isAlertOpen}
          onClose={() => setIsAlertOpen(false)}
          title="New Usage Alert"
          size="md"
        >
          <div className="p-6 space-y-4">
            <FormField label="Metric" required>
              <Select
                value={alertForm.metricName}
                onChange={(v) => setAlertForm({ ...alertForm, metricName: v })}
                placeholder="Select a metric"
                options={metricNames.map((m) => ({
                  value: m,
                  label: m.replace(/_/g, " "),
                }))}
              />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="When usage is">
                <Select
                  value={alertForm.comparison}
                  onChange={(v) =>
                    setAlertForm({ ...alertForm, comparison: v as AlertComparison })
                  }
                  options={[
                    { value: "gte", label: "at or above (≥)" },
                    { value: "gt", label: "above (>)" },
                    { value: "eq", label: "exactly (=)" },
                    { value: "lt", label: "below (<)" },
                    { value: "lte", label: "at or below (≤)" },
                  ]}
                />
              </FormField>
              <FormField label="Threshold" required>
                <Input
                  type="number"
                  min={1}
                  value={alertForm.threshold}
                  onChange={(e) =>
                    setAlertForm({ ...alertForm, threshold: e.target.value })
                  }
                />
              </FormField>
            </div>
            <p className="text-xs text-muted-foreground">
              Notifications default to email.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsAlertOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createAlert} isLoading={busy === "create-alert"}>
                Create Alert
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
