// src/app/dashboard/esignature/page.tsx
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
  Table,
  Textarea,
} from "@/components/ui";
import { KeyRound, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import {
  eSignatureService,
  type KeyPair,
  type Signer,
  type SignatureWorkflow,
  type VerifyResult,
} from "@/api/services/eSignature.service";
import { useToastStore } from "@/stores/toastStore";

type Tab = "keys" | "workflows" | "verify";

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString() : "—");

const statusVariant = (
  s?: string,
): "default" | "info" | "success" | "warning" | "danger" => {
  switch (s) {
    case "completed":
      return "success";
    case "in_progress":
    case "pending":
      return "info";
    case "cancelled":
    case "expired":
      return "danger";
    default:
      return "default";
  }
};

const emptySigner = (): Signer => ({ userId: "", email: "", name: "" });

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

export default function ESignaturePage() {
  const addToast = useToastStore((s) => s.addToast);
  const [tab, setTab] = useState<Tab>("keys");

  // Shared
  const [busy, setBusy] = useState<string | null>(null);

  // Key pairs
  const [keys, setKeys] = useState<KeyPair[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);

  // Workflows
  const [workflows, setWorkflows] = useState<SignatureWorkflow[]>([]);
  const [wfLoading, setWfLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({
    documentId: "",
    subject: "",
    message: "",
    signers: [emptySigner()],
  });
  const [detail, setDetail] = useState<SignatureWorkflow | null>(null);

  // Verify
  const [verifyId, setVerifyId] = useState("");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      setKeys(await eSignatureService.getKeyPairs());
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not load key pairs",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setKeysLoading(false);
    }
  }, [addToast]);

  const loadWorkflows = useCallback(async () => {
    setWfLoading(true);
    try {
      setWorkflows(await eSignatureService.getWorkflows());
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not load workflows",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setWfLoading(false);
    }
  }, [addToast]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadKeys(), loadWorkflows()]);
  }, [loadKeys, loadWorkflows]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // ---- Key-pair actions ----
  const generateKey = async () => {
    setBusy("gen-key");
    try {
      await eSignatureService.createKeyPair();
      addToast({ type: "success", title: "Key pair generated" });
      await loadKeys();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not generate key pair",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const deleteKey = async (id: string) => {
    setBusy(`del-key-${id}`);
    try {
      await eSignatureService.deleteKeyPair(id);
      addToast({ type: "success", title: "Key pair deleted" });
      await loadKeys();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not delete key pair",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  // ---- Workflow actions ----
  const updateSigner = (idx: number, patch: Partial<Signer>) =>
    setForm((f) => ({
      ...f,
      signers: f.signers.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    }));

  const createWorkflow = async () => {
    const signers = form.signers.filter((s) => s.email.trim());
    if (!form.documentId.trim() || !form.subject.trim() || signers.length === 0) {
      addToast({
        type: "warning",
        title: "Document, subject and at least one signer are required",
      });
      return;
    }
    setBusy("create-wf");
    try {
      await eSignatureService.createWorkflow({
        documentId: form.documentId.trim(),
        subject: form.subject.trim(),
        message: form.message.trim() || undefined,
        signers,
      });
      addToast({ type: "success", title: "Signature workflow created" });
      setIsCreateOpen(false);
      setForm({ documentId: "", subject: "", message: "", signers: [emptySigner()] });
      await loadWorkflows();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not create workflow",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const openDetail = async (id: string) => {
    try {
      setDetail(await eSignatureService.getWorkflow(id));
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not load workflow",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const signStep = async (stepId: string) => {
    setBusy(`sign-${stepId}`);
    try {
      await eSignatureService.signDocument({ stepId });
      addToast({ type: "success", title: "Document signed" });
      if (detail) await openDetail(detail.id);
      await loadWorkflows();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not sign",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const deleteWorkflow = async (id: string) => {
    setBusy(`del-wf-${id}`);
    try {
      await eSignatureService.deleteWorkflow(id);
      addToast({ type: "success", title: "Workflow deleted" });
      await loadWorkflows();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not delete workflow",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  // ---- Verify ----
  const runVerify = async () => {
    if (!verifyId.trim()) return;
    setBusy("verify");
    setVerifyResult(null);
    try {
      setVerifyResult(await eSignatureService.verifySignature(verifyId.trim()));
    } catch (err) {
      addToast({
        type: "error",
        title: "Verification failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const keyColumns = [
    {
      key: "keyId",
      header: "Key",
      render: (_v: unknown, r: Record<string, unknown>) => (
        <div>
          <div className="font-medium">{String(r.keyId ?? r.id ?? "—")}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {String(r.algorithm ?? "RS256")}
          </div>
        </div>
      ),
    },
    {
      key: "publicKey",
      header: "Public key",
      render: (value: unknown) => (
        <span className="font-mono text-xs text-muted-foreground">
          {value ? `${String(value).slice(0, 40)}…` : "—"}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">{fmt(value as string)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (_v: unknown, r: Record<string, unknown>) => (
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          isLoading={busy === `del-key-${r.id}`}
          onClick={() => deleteKey(String(r.id))}
          leftIcon={<Trash2 className="h-4 w-4" />}
        >
          Delete
        </Button>
      ),
    },
  ];

  const wfColumns = [
    {
      key: "subject",
      header: "Workflow",
      render: (value: unknown, r: Record<string, unknown>) => (
        <div>
          <div className="font-medium">{String(value ?? "—")}</div>
          <div className="font-mono text-xs text-muted-foreground">
            doc: {String(r.documentId ?? "—")}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (value: unknown) => (
        <Badge variant={statusVariant(value as string)} size="sm">
          {String(value ?? "pending")}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">{fmt(value as string)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (_v: unknown, r: Record<string, unknown>) => (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => openDetail(String(r.id))}>
            View
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            isLoading={busy === `del-wf-${r.id}`}
            onClick={() => deleteWorkflow(String(r.id))}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">e-Signature</h1>
          <p className="text-sm text-muted-foreground">
            21 CFR Part 11 signing workflows, tenant key pairs, and signature
            verification.
          </p>
        </div>

        <div className="flex gap-2 border-b border-border">
          <TabButton
            label="Key Pairs"
            active={tab === "keys"}
            onClick={() => setTab("keys")}
          />
          <TabButton
            label="Workflows"
            active={tab === "workflows"}
            onClick={() => setTab("workflows")}
          />
          <TabButton
            label="Verify"
            active={tab === "verify"}
            onClick={() => setTab("verify")}
          />
        </div>

        {tab === "keys" && (
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={loadKeys}
                leftIcon={<RefreshCw className="h-4 w-4" />}
              >
                Refresh
              </Button>
              <Button
                onClick={generateKey}
                isLoading={busy === "gen-key"}
                leftIcon={<KeyRound className="h-4 w-4" />}
              >
                Generate Key Pair
              </Button>
            </div>
            <Table
              columns={keyColumns}
              data={keys as unknown as Record<string, unknown>[]}
              isLoading={keysLoading}
              emptyMessage="No key pairs yet. Generate one to start signing."
            />
          </div>
        )}

        {tab === "workflows" && (
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={loadWorkflows}
                leftIcon={<RefreshCw className="h-4 w-4" />}
              >
                Refresh
              </Button>
              <Button
                onClick={() => setIsCreateOpen(true)}
                leftIcon={<Plus className="h-4 w-4" />}
              >
                New Workflow
              </Button>
            </div>
            <Table
              columns={wfColumns}
              data={workflows as unknown as Record<string, unknown>[]}
              isLoading={wfLoading}
              emptyMessage="No signature workflows yet."
            />
          </div>
        )}

        {tab === "verify" && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <FormField
                label="Signature ID"
                helperText="Recompute a signature's hash to confirm it hasn't been tampered with."
              >
                <Input
                  value={verifyId}
                  onChange={(e) => setVerifyId(e.target.value)}
                  placeholder="signature record id"
                />
              </FormField>
              <Button
                onClick={runVerify}
                isLoading={busy === "verify"}
                leftIcon={<ShieldCheck className="h-4 w-4" />}
              >
                Verify Signature
              </Button>
              {verifyResult && (
                <Alert variant={verifyResult.valid ? "success" : "error"}>
                  {verifyResult.valid
                    ? "Signature is valid — the signed record is intact."
                    : `Invalid: ${verifyResult.reason ?? "signature does not match"}`}
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* Create workflow dialog */}
        <Dialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="New Signature Workflow"
          size="lg"
        >
          <div className="p-6 space-y-4">
            <FormField label="Document ID">
              <Input
                value={form.documentId}
                onChange={(e) => setForm({ ...form, documentId: e.target.value })}
                placeholder="e.g. certificate uuid"
              />
            </FormField>
            <FormField label="Subject">
              <Input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Please sign this certificate"
              />
            </FormField>
            <FormField label="Message" helperText="Optional note to signers.">
              <Textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                rows={2}
              />
            </FormField>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Signers (in order)</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm((f) => ({ ...f, signers: [...f.signers, emptySigner()] }))
                  }
                  leftIcon={<Plus className="h-3 w-3" />}
                >
                  Add signer
                </Button>
              </div>
              {form.signers.map((s, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <Input
                    value={s.name}
                    onChange={(e) => updateSigner(i, { name: e.target.value })}
                    placeholder="Name"
                  />
                  <Input
                    value={s.email}
                    onChange={(e) => updateSigner(i, { email: e.target.value })}
                    placeholder="Email"
                  />
                  <Input
                    value={s.userId}
                    onChange={(e) => updateSigner(i, { userId: e.target.value })}
                    placeholder="User ID (optional)"
                  />
                  {form.signers.length > 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          signers: f.signers.filter((_, idx) => idx !== i),
                        }))
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createWorkflow} isLoading={busy === "create-wf"}>
                Create Workflow
              </Button>
            </div>
          </div>
        </Dialog>

        {/* Workflow detail dialog */}
        <Dialog
          isOpen={!!detail}
          onClose={() => setDetail(null)}
          title={detail?.subject || "Workflow"}
          size="lg"
        >
          {detail && (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(detail.status)} size="sm">
                  {detail.status ?? "pending"}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  doc: {detail.documentId}
                </span>
              </div>
              {detail.message && (
                <p className="text-sm text-muted-foreground">{detail.message}</p>
              )}
              <div className="space-y-2">
                <span className="text-sm font-medium">Steps</span>
                {(detail.steps ?? []).map((step) => (
                  <div
                    key={step.id}
                    className="flex items-center justify-between rounded-md border border-border p-3"
                  >
                    <div>
                      <div className="text-sm">{step.userId || "signer"}</div>
                      <div className="text-xs text-muted-foreground">
                        {step.status ?? "waiting"} · {fmt(step.signedAt)}
                      </div>
                    </div>
                    {step.status === "pending" && (
                      <Button
                        size="sm"
                        isLoading={busy === `sign-${step.id}`}
                        onClick={() => signStep(step.id)}
                        leftIcon={<ShieldCheck className="h-4 w-4" />}
                      >
                        Sign
                      </Button>
                    )}
                  </div>
                ))}
                {(detail.steps ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">No steps.</p>
                )}
              </div>
            </div>
          )}
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
