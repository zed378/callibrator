// src/app/dashboard/gdpr/page.tsx
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
import { Download, PencilLine, ShieldOff, Trash2 } from "lucide-react";
import {
  gdprService,
  type ConsentCategory,
  type ConsentRecord,
  type ProcessingRecord,
} from "@/api/services/gdpr.service";
import { useToastStore } from "@/stores/toastStore";

const CATEGORIES: ConsentCategory[] = [
  "analytics",
  "marketing",
  "functional",
  "necessary",
];

/** Fields a user may correct about themselves. */
const RECTIFIABLE = ["firstName", "lastName", "phone", "email"];

const fmt = (v?: string) => (v ? new Date(v).toLocaleString() : "—");

export default function GdprPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [processing, setProcessing] = useState<ProcessingRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [selected, setSelected] = useState<ConsentCategory[]>([]);
  const [isErasureOpen, setIsErasureOpen] = useState(false);
  const [erasure, setErasure] = useState({ reason: "", confirm: false });
  const [isRectifyOpen, setIsRectifyOpen] = useState(false);
  const [rectify, setRectify] = useState({ field: "firstName", value: "" });
  const [isRestrictOpen, setIsRestrictOpen] = useState(false);
  const [restrictReason, setRestrictReason] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [history, record] = await Promise.all([
        gdprService.getConsentHistory(),
        gdprService.getProcessingRecord().catch(() => null),
      ]);
      setConsents(history);
      setProcessing(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load privacy data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const exportData = async () => {
    setBusy("export");
    try {
      const data = await gdprService.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-data-export.json";
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

  const setConsent = (grant: boolean) => {
    if (selected.length === 0) {
      addToast({ type: "error", title: "Select at least one category" });
      return;
    }
    return run(
      "consent",
      () => gdprService.updateConsent(selected, grant),
      grant ? "Consent granted" : "Consent withdrawn",
    );
  };

  const submitErasure = async () => {
    if (!erasure.reason.trim()) {
      addToast({ type: "error", title: "A reason is required" });
      return;
    }
    if (!erasure.confirm) {
      addToast({ type: "error", title: "You must confirm the request" });
      return;
    }
    const ok = await run(
      "erasure",
      () =>
        gdprService.requestErasure({
          reason: erasure.reason.trim(),
          confirm: true,
        }),
      "Erasure request submitted",
    );
    if (ok) {
      setIsErasureOpen(false);
      setErasure({ reason: "", confirm: false });
    }
  };

  const submitRectify = async () => {
    if (!rectify.value.trim()) {
      addToast({ type: "error", title: "Enter the corrected value" });
      return;
    }
    const ok = await run(
      "rectify",
      () => gdprService.rectifyData(rectify.field, rectify.value.trim()),
      "Data corrected",
    );
    if (ok) {
      setIsRectifyOpen(false);
      setRectify({ field: "firstName", value: "" });
    }
  };

  const submitRestrict = async () => {
    if (!restrictReason.trim()) {
      addToast({ type: "error", title: "A reason is required" });
      return;
    }
    const ok = await run(
      "restrict",
      () => gdprService.restrictProcessing(restrictReason.trim()),
      "Processing restricted",
    );
    if (ok) {
      setIsRestrictOpen(false);
      setRestrictReason("");
    }
  };

  const consentColumns = [
    {
      key: "category",
      header: "Category",
      render: (value: unknown) => (
        <span className="font-medium capitalize">{String(value ?? "—")}</span>
      ),
    },
    {
      key: "consent",
      header: "Decision",
      render: (value: unknown) => (
        <Badge variant={value ? "success" : "default"} size="sm">
          {value ? "Granted" : "Withdrawn"}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Recorded",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">
          {fmt(value as string)}
        </span>
      ),
    },
    {
      key: "ipAddress",
      header: "From IP",
      render: (value: unknown) => (
        <span className="font-mono text-xs text-muted-foreground">
          {String(value ?? "—")}
        </span>
      ),
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Privacy &amp; GDPR</h1>
          <p className="text-sm text-muted-foreground">
            Your data-subject rights. Every action here applies to your own
            account.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {/* Rights */}
        <Card className="border-border">
          <CardContent className="pt-6 space-y-4">
            <h2 className="text-lg font-semibold">Your rights</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={exportData}
                isLoading={busy === "export"}
                leftIcon={<Download className="h-4 w-4" />}
              >
                Export my data (Art. 20)
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsRectifyOpen(true)}
                leftIcon={<PencilLine className="h-4 w-4" />}
              >
                Correct my data (Art. 16)
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsRestrictOpen(true)}
                leftIcon={<ShieldOff className="h-4 w-4" />}
              >
                Restrict processing (Art. 18)
              </Button>
              <Button
                variant="danger"
                onClick={() => setIsErasureOpen(true)}
                leftIcon={<Trash2 className="h-4 w-4" />}
              >
                Request erasure (Art. 17)
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Consent */}
        <Card className="border-border">
          <CardContent className="pt-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Consent</h2>
              <p className="text-sm text-muted-foreground">
                Select categories, then grant or withdraw them together.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => {
                const active = selected.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() =>
                      setSelected(
                        active
                          ? selected.filter((x) => x !== c)
                          : [...selected, c],
                      )
                    }
                    className={`rounded-full border px-3 py-1 text-xs capitalize transition ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => setConsent(true)}
                isLoading={busy === "consent"}
                disabled={selected.length === 0}
              >
                Grant
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConsent(false)}
                disabled={selected.length === 0}
              >
                Withdraw
              </Button>
            </div>
            <Alert variant="info">
              “Necessary” cookies are required to operate the service —
              withdrawing them may sign you out.
            </Alert>
          </CardContent>
        </Card>

        {/* Consent history */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Consent history</h2>
          <Table
            columns={consentColumns}
            data={consents as unknown as Record<string, unknown>[]}
            isLoading={isLoading}
            emptyMessage="No consent decisions recorded."
          />
        </div>

        {/* Article 30 record */}
        <Card className="border-border">
          <CardContent className="pt-6 space-y-3">
            <h2 className="text-lg font-semibold">
              How your data is processed (Art. 30)
            </h2>
            {processing ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Controller:{" "}
                  <span className="font-medium text-foreground">
                    {processing.controller}
                  </span>
                  {processing.generatedAt
                    ? ` · generated ${fmt(processing.generatedAt)}`
                    : ""}
                </p>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {(processing.activities ?? []).map((a, i) => (
                    <li key={i} className="px-3 py-2 text-sm">
                      <p className="font-medium">{a.purpose ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.lawfulBasis ? `Basis: ${a.lawfulBasis}` : ""}
                        {a.retention ? ` · Retention: ${a.retention}` : ""}
                      </p>
                      {a.categories?.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.categories.map((c) => (
                            <Badge key={c} variant="secondary" size="sm">
                              {c}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isLoading ? "Loading…" : "No processing record available."}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Erasure */}
        <Dialog
          isOpen={isErasureOpen}
          onClose={() => setIsErasureOpen(false)}
          title="Request Erasure"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="error">
              This files a right-to-erasure request for the compliance team to
              action. It does not delete your account immediately.
            </Alert>
            <FormField label="Reason" required>
              <Textarea
                rows={3}
                value={erasure.reason}
                onChange={(e) =>
                  setErasure({ ...erasure, reason: e.target.value })
                }
                placeholder="Why are you requesting erasure?"
              />
            </FormField>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={erasure.confirm}
                onChange={(e) =>
                  setErasure({ ...erasure, confirm: e.target.checked })
                }
              />
              I understand this request is recorded and may result in my account
              being deleted.
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsErasureOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={submitErasure}
                isLoading={busy === "erasure"}
              >
                Submit Request
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Rectify */}
        <Dialog
          isOpen={isRectifyOpen}
          onClose={() => setIsRectifyOpen(false)}
          title="Correct My Data"
          size="md"
        >
          <div className="p-6 space-y-4">
            <FormField label="Field">
              <Select
                value={rectify.field}
                onChange={(v) => setRectify({ ...rectify, field: v })}
                options={RECTIFIABLE.map((f) => ({ value: f, label: f }))}
              />
            </FormField>
            <FormField label="Corrected value" required>
              <Input
                value={rectify.value}
                onChange={(e) =>
                  setRectify({ ...rectify, value: e.target.value })
                }
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsRectifyOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submitRectify} isLoading={busy === "rectify"}>
                Correct
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Restrict */}
        <Dialog
          isOpen={isRestrictOpen}
          onClose={() => setIsRestrictOpen(false)}
          title="Restrict Processing"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="warning">
              Restricting processing limits what the platform may do with your
              data while a dispute is resolved.
            </Alert>
            <FormField label="Reason" required>
              <Textarea
                rows={3}
                value={restrictReason}
                onChange={(e) => setRestrictReason(e.target.value)}
                placeholder="e.g. I am disputing the accuracy of my records"
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsRestrictOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submitRestrict} isLoading={busy === "restrict"}>
                Restrict
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
