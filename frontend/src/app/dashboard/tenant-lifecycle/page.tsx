// src/app/dashboard/tenant-lifecycle/page.tsx
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
  Select,
  Textarea,
} from "@/components/ui";
import {
  ArrowLeftRight,
  Ban,
  Download,
  PlayCircle,
  TimerReset,
  Undo2,
} from "lucide-react";
import {
  tenantLifecycleService,
  type TenantLifecycleStatus,
} from "@/api/services/tenantLifecycle.service";
import { tenantService } from "@/api/services/tenant.service";
import { useToastStore } from "@/stores/toastStore";

const statusVariant = (
  status: string,
): "success" | "warning" | "danger" | "default" => {
  switch ((status || "").toUpperCase()) {
    case "ACTIVE":
      return "success";
    case "SUSPENDED":
      return "warning";
    case "OFFBOARDED":
      return "danger";
    default:
      return "default";
  }
};

const fmt = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "—";

export default function TenantLifecyclePage() {
  const addToast = useToastStore((s) => s.addToast);

  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [status, setStatus] = useState<TenantLifecycleStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [isSuspendOpen, setIsSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [isOffboardOpen, setIsOffboardOpen] = useState(false);

  useEffect(() => {
    tenantService
      .getAll(1, 100)
      .then((res) =>
        setTenants((res.data ?? []).map((t) => ({ id: t.id, name: t.name }))),
      )
      .catch(() => setTenants([]));
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) {
      setStatus(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await tenantLifecycleService.getStatus(tenantId);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load status");
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Wrap a lifecycle action with busy state + toast + refresh. */
  const run = async (
    key: string,
    fn: () => Promise<unknown>,
    successTitle: string,
  ) => {
    setBusy(key);
    try {
      await fn();
      addToast({ type: "success", title: successTitle });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Action failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const confirmSuspend = async () => {
    if (!suspendReason.trim()) {
      addToast({ type: "error", title: "A suspension reason is required" });
      return;
    }
    await run(
      "suspend",
      () => tenantLifecycleService.suspend(tenantId, suspendReason.trim()),
      "Tenant suspended",
    );
    setIsSuspendOpen(false);
    setSuspendReason("");
  };

  const confirmOffboard = async () => {
    await run(
      "offboard",
      () => tenantLifecycleService.offboard(tenantId),
      "Tenant offboarded — data exported and deletion scheduled",
    );
    setIsOffboardOpen(false);
  };

  const exportData = async () => {
    setBusy("export");
    try {
      const data = await tenantLifecycleService.exportData(tenantId);
      // Download the export snapshot as JSON for the operator.
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `tenant-${tenantId}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      addToast({ type: "success", title: "Export downloaded" });
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

  const current = (status?.status ?? "").toUpperCase();
  const isSuspended = current === "SUSPENDED";
  const isOffboarded = current === "OFFBOARDED";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Tenant Lifecycle
          </h1>
          <p className="text-sm text-muted-foreground">
            Suspend, resume, apply a grace period, or offboard a tenant.
            Offboarding always exports a data snapshot first.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Card className="bg-card/50 backdrop-blur-sm border-border relative z-50">
          <CardContent className="pt-6">
            <label className="block text-sm font-medium mb-1.5">Tenant</label>
            <Select
              value={tenantId}
              onChange={setTenantId}
              placeholder="Select a tenant"
              options={tenants.map((t) => ({ value: t.id, label: t.name }))}
            />
          </CardContent>
        </Card>

        {!tenantId && (
          <Alert variant="info">
            Select a tenant to view and manage its lifecycle state.
          </Alert>
        )}

        {tenantId && (
          <Card className="border-border">
            <CardContent className="pt-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Current status
                  </p>
                  <div className="mt-1">
                    {isLoading ? (
                      <span className="text-sm text-muted-foreground">
                        Loading…
                      </span>
                    ) : (
                      <Badge variant={statusVariant(current)}>
                        {current || "UNKNOWN"}
                      </Badge>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={exportData}
                  isLoading={busy === "export"}
                  leftIcon={<Download className="h-4 w-4" />}
                >
                  Export Data
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Suspension reason</p>
                  <p className="font-medium">
                    {status?.suspensionReason ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Suspended at</p>
                  <p className="font-medium">{fmt(status?.suspendedAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Grace period expires</p>
                  <p className="font-medium">
                    {fmt(status?.gracePeriodExpiresAt)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Offboarded at</p>
                  <p className="font-medium">{fmt(status?.offboardedAt)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Retention expires</p>
                  <p className="font-medium">
                    {fmt(status?.offboardRetentionExpiresAt)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
                <Button
                  variant="outline"
                  disabled={isSuspended || isOffboarded}
                  onClick={() => setIsSuspendOpen(true)}
                  leftIcon={<Ban className="h-4 w-4" />}
                >
                  Suspend
                </Button>
                <Button
                  variant="outline"
                  disabled={!isSuspended}
                  isLoading={busy === "resume"}
                  onClick={() =>
                    run(
                      "resume",
                      () => tenantLifecycleService.resume(tenantId),
                      "Tenant resumed",
                    )
                  }
                  leftIcon={<PlayCircle className="h-4 w-4" />}
                >
                  Resume
                </Button>
                <Button
                  variant="outline"
                  disabled={isOffboarded}
                  isLoading={busy === "grace"}
                  onClick={() =>
                    run(
                      "grace",
                      () => tenantLifecycleService.enterGracePeriod(tenantId),
                      "Grace period started",
                    )
                  }
                  leftIcon={<TimerReset className="h-4 w-4" />}
                >
                  Start Grace Period
                </Button>
                <Button
                  variant="danger"
                  disabled={isOffboarded}
                  onClick={() => setIsOffboardOpen(true)}
                  leftIcon={<ArrowLeftRight className="h-4 w-4" />}
                >
                  Offboard
                </Button>
                <Button
                  variant="outline"
                  disabled={!isOffboarded}
                  isLoading={busy === "cancel"}
                  onClick={() =>
                    run(
                      "cancel",
                      () => tenantLifecycleService.cancelOffboarding(tenantId),
                      "Offboarding cancelled",
                    )
                  }
                  leftIcon={<Undo2 className="h-4 w-4" />}
                >
                  Cancel Offboarding
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Dialog
          isOpen={isSuspendOpen}
          onClose={() => setIsSuspendOpen(false)}
          title="Suspend Tenant"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="warning">
              Suspending blocks all users of this tenant from accessing the
              platform.
            </Alert>
            <FormField label="Reason" required>
              <Textarea
                rows={3}
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Non-payment after 3 failed invoices"
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsSuspendOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmSuspend}
                isLoading={busy === "suspend"}
              >
                Suspend Tenant
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          isOpen={isOffboardOpen}
          onClose={() => setIsOffboardOpen(false)}
          title="Offboard Tenant"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="error">
              This schedules the tenant for deletion. A full data export is
              taken first and the tenant is retained until the retention window
              expires. You can cancel offboarding before then.
            </Alert>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIsOffboardOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmOffboard}
                isLoading={busy === "offboard"}
              >
                Offboard Tenant
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
