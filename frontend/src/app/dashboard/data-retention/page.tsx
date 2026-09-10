// src/app/dashboard/data-retention/page.tsx
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
  Textarea,
} from "@/components/ui";
import { Eraser, Lock, ShieldOff, Trash2, UserX } from "lucide-react";
import {
  dataRetentionService,
  type LegalHoldStatus,
  type RetentionPolicy,
} from "@/api/services/dataRetention.service";
import { tenantService } from "@/api/services/tenant.service";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";

const POLICY_KEYS: { key: string; label: string; help: string }[] = [
  {
    key: "audit_log_retention_days",
    label: "Audit Logs",
    help: "Compliance records — keep at least as long as the underlying data.",
  },
  {
    key: "notification_retention_days",
    label: "Notifications",
    help: "In-app notification history.",
  },
  {
    key: "session_retention_days",
    label: "Sessions",
    help: "Expired/revoked session rows.",
  },
];

const ENTITY_OPTIONS = [
  { value: "users", label: "Users" },
  { value: "audit_logs", label: "Audit Logs" },
];

export default function DataRetentionPage() {
  const addToast = useToastStore((s) => s.addToast);
  const user = useAuthStore((s) => s.user);

  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  // Derived: default to the signed-in user's tenant; explicit choice wins.
  const tenantId = selectedTenantId || user?.tenantId || "";

  const [policy, setPolicy] = useState<RetentionPolicy>({});
  const [legalHold, setLegalHold] = useState<LegalHoldStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const [isHoldOpen, setIsHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [isPurgeOpen, setIsPurgeOpen] = useState(false);
  const [isAnonOpen, setIsAnonOpen] = useState(false);
  const [anonEntity, setAnonEntity] = useState("users");

  useEffect(() => {
    tenantService
      .getAll(1, 100)
      .then((res) =>
        setTenants((res.data ?? []).map((t) => ({ id: t.id, name: t.name }))),
      )
      .catch(() => setTenants([]));
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [p, h] = await Promise.all([
        dataRetentionService.getPolicy(tenantId),
        dataRetentionService.getLegalHold(tenantId),
      ]);
      setPolicy(p ?? {});
      setLegalHold(h ?? null);
      setDrafts(
        Object.fromEntries(
          POLICY_KEYS.map((pk) => [pk.key, String(p?.[pk.key] ?? "")]),
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load retention settings",
      );
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const held = legalHold?.enabled === true;

  const savePolicy = async (key: string) => {
    const days = Number(drafts[key]);
    if (!Number.isInteger(days) || days < 0) {
      addToast({ type: "error", title: "Enter a whole number of days (0+)" });
      return;
    }
    setBusy(key);
    try {
      await dataRetentionService.setPolicy(tenantId, key, days);
      addToast({ type: "success", title: "Retention policy updated" });
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Update failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const run = async (key: string, fn: () => Promise<unknown>, title: string) => {
    setBusy(key);
    try {
      await fn();
      addToast({ type: "success", title });
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

  const confirmHold = async () => {
    if (!holdReason.trim()) {
      addToast({ type: "error", title: "A legal-hold reason is required" });
      return;
    }
    await run(
      "hold",
      () => dataRetentionService.enableLegalHold(tenantId, holdReason.trim()),
      "Legal hold enabled",
    );
    setIsHoldOpen(false);
    setHoldReason("");
  };

  const confirmPurge = async () => {
    await run(
      "purge",
      () => dataRetentionService.purge(tenantId),
      "Purge completed",
    );
    setIsPurgeOpen(false);
  };

  const confirmAnonymize = async () => {
    await run(
      "anon",
      () => dataRetentionService.anonymize(tenantId, anonEntity),
      "Dataset anonymized",
    );
    setIsAnonOpen(false);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Data Retention</h1>
          <p className="text-sm text-muted-foreground">
            Retention windows, legal hold, and privacy operations (purge, PII
            masking, anonymization).
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <Card className="bg-card/50 backdrop-blur-sm border-border">
          <CardContent className="pt-6">
            <label className="block text-sm font-medium mb-1.5">Tenant</label>
            <Select
              value={tenantId}
              onChange={setSelectedTenantId}
              placeholder="Select a tenant"
              options={tenants.map((t) => ({ value: t.id, label: t.name }))}
            />
          </CardContent>
        </Card>

        {!tenantId && (
          <Alert variant="info">
            Select a tenant to manage its retention settings.
          </Alert>
        )}

        {tenantId && (
          <>
            {/* Legal hold gates every destructive operation below. */}
            <Card className="border-border">
              <CardContent className="pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold">Legal Hold</h2>
                      <Badge variant={held ? "warning" : "default"} size="sm">
                        {held ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      While a legal hold is active, purge, PII masking, and
                      anonymization are blocked.
                    </p>
                    {held && legalHold?.reason && (
                      <p className="mt-2 text-sm">
                        <span className="text-muted-foreground">Reason: </span>
                        <span className="font-medium">{legalHold.reason}</span>
                      </p>
                    )}
                  </div>
                  {held ? (
                    <Button
                      variant="outline"
                      isLoading={busy === "unhold"}
                      onClick={() =>
                        run(
                          "unhold",
                          () => dataRetentionService.disableLegalHold(tenantId),
                          "Legal hold released",
                        )
                      }
                      leftIcon={<ShieldOff className="h-4 w-4" />}
                    >
                      Release Hold
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => setIsHoldOpen(true)}
                      leftIcon={<Lock className="h-4 w-4" />}
                    >
                      Enable Hold
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardContent className="pt-6 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">Retention Windows</h2>
                  <p className="text-sm text-muted-foreground">
                    Records older than the window are removed on purge. 0 = keep
                    forever.
                  </p>
                </div>

                {POLICY_KEYS.map((pk) => (
                  <div
                    key={pk.key}
                    className="flex flex-col sm:flex-row sm:items-end gap-3 pb-4 border-b border-border last:border-0"
                  >
                    <div className="flex-1">
                      <FormField label={pk.label} helperText={pk.help}>
                        <Input
                          type="number"
                          min={0}
                          value={drafts[pk.key] ?? ""}
                          onChange={(e) =>
                            setDrafts({ ...drafts, [pk.key]: e.target.value })
                          }
                          placeholder={
                            isLoading ? "Loading…" : "days (e.g. 365)"
                          }
                        />
                      </FormField>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        current: {policy?.[pk.key] ?? "—"}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        isLoading={busy === pk.key}
                        onClick={() => savePolicy(pk.key)}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardContent className="pt-6 space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">Privacy Operations</h2>
                  <p className="text-sm text-muted-foreground">
                    Irreversible. Requires super-admin and no active legal hold.
                  </p>
                </div>

                {held && (
                  <Alert variant="warning">
                    A legal hold is active — these operations will be rejected
                    until it is released.
                  </Alert>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={held}
                    onClick={() => setIsPurgeOpen(true)}
                    leftIcon={<Trash2 className="h-4 w-4" />}
                  >
                    Purge Expired Records
                  </Button>
                  <Button
                    variant="outline"
                    disabled={held}
                    onClick={() => setIsAnonOpen(true)}
                    leftIcon={<Eraser className="h-4 w-4" />}
                  >
                    Anonymize Dataset
                  </Button>
                  <Button
                    variant="outline"
                    disabled
                    leftIcon={<UserX className="h-4 w-4" />}
                    title="Mask PII targets specific record ids — launch it from a record list."
                  >
                    Mask PII (per-record)
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  PII masking targets specific record ids, so it is initiated
                  from a record list rather than in bulk here.
                </p>
              </CardContent>
            </Card>
          </>
        )}

        <Dialog
          isOpen={isHoldOpen}
          onClose={() => setIsHoldOpen(false)}
          title="Enable Legal Hold"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="warning">
              A legal hold suspends all data purging and anonymization for this
              tenant until released.
            </Alert>
            <FormField label="Reason" required>
              <Textarea
                rows={3}
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="e.g. Pending litigation — matter #1234"
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsHoldOpen(false)}>
                Cancel
              </Button>
              <Button onClick={confirmHold} isLoading={busy === "hold"}>
                Enable Hold
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          isOpen={isPurgeOpen}
          onClose={() => setIsPurgeOpen(false)}
          title="Purge Expired Records"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="error">
              This permanently deletes records older than each configured
              retention window. This cannot be undone.
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsPurgeOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmPurge}
                isLoading={busy === "purge"}
              >
                Purge Now
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          isOpen={isAnonOpen}
          onClose={() => setIsAnonOpen(false)}
          title="Anonymize Dataset"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="error">
              Irreversibly replaces identifying fields with
              <span className="font-mono"> [ANONYMIZED]</span> across the
              selected dataset.
            </Alert>
            <FormField label="Entity">
              <Select
                value={anonEntity}
                onChange={setAnonEntity}
                options={ENTITY_OPTIONS}
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsAnonOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={confirmAnonymize}
                isLoading={busy === "anon"}
              >
                Anonymize
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
