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
import { Ban, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2, X } from "lucide-react";
import {
  eSignatureService,
  type EligibleSigner,
  type KeyPair,
  type SignatureStep,
  type SignatureWorkflow,
  type VerifyResult,
} from "@/api/services/eSignature.service";
import { useToastStore } from "@/stores/toastStore";
import { useAuthStore } from "@/stores/authStore";
import {
  ESignatureFields,
  type ESignatureFormFields,
} from "@/app/dashboard/calibration/components/ESignatureFields";

type Tab = "sign" | "keys" | "workflows" | "verify";

/** Which route a workflow detail was read through — and is re-read through. */
type DetailSource = "signer" | "manage";

/**
 * A-91 — key pairs and the full workflow list are management, gated on `qms`;
 * most roles that can be named as signers do not hold it. A 403 from those
 * routes is an expected state for them, not an error to toast.
 */
const statusOf = (err: unknown) =>
  (err as { response?: { status?: number } } | null)?.response?.status;

const isForbidden = (err: unknown) => statusOf(err) === 403;

/**
 * A-130 — a 409 is a state conflict the backend explains ("has 1 signature,
 * so it cannot be deleted … cancel it instead"): shown as that explanation,
 * under a title that names the refused action, not as a generic failure.
 */
const isConflict = (err: unknown) => statusOf(err) === 409;

const errorText = (err: unknown) => (err instanceof Error ? err.message : undefined);

/** A workflow still open to signing — the only ones that can be cancelled. */
const isOpen = (status?: string) => status !== "completed" && status !== "cancelled";

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

// A-129 / A-86 — a signer is a user of the tenant, chosen from GET /signers;
// the form holds only their id. The backend reads name and email from the user
// record and refuses an email-only signer.
const emptySigner = (): string => "";

const emptySignForm = (): ESignatureFormFields => ({
  authMethod: "password",
  authPayload: "",
  meaning: "",
});

const signerLabel = (step: SignatureStep) =>
  step.signerName || step.signerEmail || step.signerId || "signer";

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
  const currentUserId = useAuthStore((s) => s.user?.id);
  // A-91 — "To sign" is the view every signer can open (the `esignature`
  // menu); the management tabs load only when opened.
  const [tab, setTab] = useState<Tab>("sign");

  // Shared
  const [busy, setBusy] = useState<string | null>(null);

  // To sign — the signer view (GET /my-workflows)
  const [myWorkflows, setMyWorkflows] = useState<SignatureWorkflow[]>([]);
  const [myLoading, setMyLoading] = useState(true);

  // Management (qms): set when those routes answer 403 for this user.
  const [manageDenied, setManageDenied] = useState(false);

  // Key pairs
  const [keys, setKeys] = useState<KeyPair[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysLoaded, setKeysLoaded] = useState(false);

  // Workflows
  const [workflows, setWorkflows] = useState<SignatureWorkflow[]>([]);
  const [wfLoading, setWfLoading] = useState(false);
  const [wfLoaded, setWfLoaded] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [eligibleSigners, setEligibleSigners] = useState<EligibleSigner[]>([]);
  const [signersLoading, setSignersLoading] = useState(false);
  const [form, setForm] = useState({
    documentId: "",
    subject: "",
    message: "",
    signers: [emptySigner()],
  });
  const [detail, setDetail] = useState<SignatureWorkflow | null>(null);
  const [detailSource, setDetailSource] = useState<DetailSource>("signer");
  // A-65 — signing re-authenticates: the step being signed and the signer's
  // credential, collected inline under that step.
  const [signingStepId, setSigningStepId] = useState<string | null>(null);
  const [signForm, setSignForm] = useState<ESignatureFormFields>(emptySignForm);

  // Verify
  const [verifyId, setVerifyId] = useState("");
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const loadMine = useCallback(async () => {
    setMyLoading(true);
    try {
      setMyWorkflows(await eSignatureService.getMyWorkflows());
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not load your signature requests",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setMyLoading(false);
    }
  }, [addToast]);

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      setKeys(await eSignatureService.getKeyPairs());
      setKeysLoaded(true);
    } catch (err) {
      if (isForbidden(err)) {
        setManageDenied(true);
        return;
      }
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
      setWfLoaded(true);
    } catch (err) {
      if (isForbidden(err)) {
        setManageDenied(true);
        return;
      }
      addToast({
        type: "error",
        title: "Could not load workflows",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setWfLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    // Defer past the synchronous effect body — loadMine() writes state, and
    // doing that synchronously in an effect cascades renders
    // (set-state-in-effect). Same pattern as dashboard/metered-billing.
    let active = true;
    (async () => {
      await Promise.resolve();
      if (active) await loadMine();
    })();
    return () => {
      active = false;
    };
  }, [loadMine]);

  // Management data loads when its tab is first opened, so a signer without
  // `qms` is not greeted by failed requests they cannot do anything about.
  const selectTab = (next: Tab) => {
    setTab(next);
    if (next === "keys" && !keysLoaded && !manageDenied) void loadKeys();
    if (next === "workflows" && !wfLoaded && !manageDenied) void loadWorkflows();
  };

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
  const updateSigner = (idx: number, userId: string) =>
    setForm((f) => ({
      ...f,
      signers: f.signers.map((s, i) => (i === idx ? userId : s)),
    }));

  // The users a workflow may name: loaded each time the dialog opens, so a
  // grant changed since the last open is reflected.
  const openCreate = async () => {
    setIsCreateOpen(true);
    setSignersLoading(true);
    try {
      setEligibleSigners(await eSignatureService.getEligibleSigners());
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not load the users who can sign",
        description: errorText(err),
      });
    } finally {
      setSignersLoading(false);
    }
  };

  const createWorkflow = async () => {
    const signers = form.signers.filter(Boolean).map((userId) => ({ userId }));
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

  const openDetail = async (id: string, source: DetailSource) => {
    try {
      setDetail(
        source === "signer"
          ? await eSignatureService.getMyWorkflow(id)
          : await eSignatureService.getWorkflow(id),
      );
      setDetailSource(source);
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not load workflow",
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const startSigning = (stepId: string) => {
    setSignForm(emptySignForm());
    setSigningStepId(stepId);
  };

  const cancelSigning = () => {
    setSigningStepId(null);
    setSignForm(emptySignForm());
  };

  const closeDetail = () => {
    cancelSigning();
    setDetail(null);
  };

  const submitSignature = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signingStepId) return;
    if (!signForm.authPayload || !signForm.meaning.trim()) {
      addToast({
        type: "warning",
        title: "Enter your credential and the meaning of your signature",
      });
      return;
    }
    const stepId = signingStepId;
    setBusy(`sign-${stepId}`);
    try {
      await eSignatureService.signDocument({
        stepId,
        authenticationMethod: signForm.authMethod,
        authPayload: signForm.authPayload,
        reason: signForm.meaning.trim(),
      });
      addToast({ type: "success", title: "Document signed" });
      cancelSigning();
      if (detail) await openDetail(detail.id, detailSource);
      await loadMine();
      if (wfLoaded) await loadWorkflows();
    } catch (err) {
      // Never keep a rejected credential in the form.
      setSignForm((f) => ({ ...f, authPayload: "" }));
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
        type: isConflict(err) ? "warning" : "error",
        title: isConflict(err) ? "This workflow cannot be deleted" : "Could not delete workflow",
        description: errorText(err),
      });
    } finally {
      setBusy(null);
    }
  };

  // A-130 — cancelling keeps the signatures; it is how a signed workflow is
  // withdrawn.
  const cancelWorkflow = async (id: string) => {
    setBusy(`cancel-wf-${id}`);
    try {
      await eSignatureService.cancelWorkflow(id);
      addToast({ type: "success", title: "Workflow cancelled" });
      await loadWorkflows();
      if (detail?.id === id) await openDetail(id, detailSource);
    } catch (err) {
      addToast({
        type: isConflict(err) ? "warning" : "error",
        title: isConflict(err) ? "This workflow cannot be cancelled" : "Could not cancel workflow",
        description: errorText(err),
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
          <Button size="sm" variant="ghost" onClick={() => openDetail(String(r.id), "manage")}>
            View
          </Button>
          {isOpen(r.status as string | undefined) && (
            <Button
              size="sm"
              variant="ghost"
              isLoading={busy === `cancel-wf-${r.id}`}
              onClick={() => cancelWorkflow(String(r.id))}
              leftIcon={<Ban className="h-4 w-4" />}
            >
              Cancel
            </Button>
          )}
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

  // The caller's own step in a workflow. A workflow may name them twice; the
  // one still awaiting them is the one that matters.
  const myStep = (wf: SignatureWorkflow) => {
    const mine = (wf.steps ?? []).filter((st) => st.signerId === currentUserId);
    return mine.find((st) => st.status === "pending") ?? mine[0];
  };

  const signColumns = [
    wfColumns[0],
    wfColumns[1],
    {
      key: "myStep",
      header: "Your step",
      render: (_v: unknown, r: Record<string, unknown>) => {
        const st = myStep(r as unknown as SignatureWorkflow);
        return st?.status === "pending" ? (
          <Badge variant="warning" size="sm">
            awaiting your signature
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">{st?.status ?? "—"}</span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (_v: unknown, r: Record<string, unknown>) => (
        <Button size="sm" variant="ghost" onClick={() => openDetail(String(r.id), "signer")}>
          Open
        </Button>
      ),
    },
  ];

  const manageDeniedNotice = (
    <Alert variant="info">
      Managing key pairs and workflows needs the Quality Management permission.
      Workflows that name you as a signer are under To sign.
    </Alert>
  );

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
            label="To sign"
            active={tab === "sign"}
            onClick={() => selectTab("sign")}
          />
          <TabButton
            label="Key Pairs"
            active={tab === "keys"}
            onClick={() => selectTab("keys")}
          />
          <TabButton
            label="Workflows"
            active={tab === "workflows"}
            onClick={() => selectTab("workflows")}
          />
          <TabButton
            label="Verify"
            active={tab === "verify"}
            onClick={() => selectTab("verify")}
          />
        </div>

        {tab === "sign" && (
          <div className="space-y-4">
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={loadMine}
                leftIcon={<RefreshCw className="h-4 w-4" />}
              >
                Refresh
              </Button>
            </div>
            <Table
              columns={signColumns}
              data={myWorkflows as unknown as Record<string, unknown>[]}
              isLoading={myLoading}
              emptyMessage="No signature workflows name you as a signer."
            />
          </div>
        )}

        {tab === "keys" && manageDenied && manageDeniedNotice}

        {tab === "keys" && !manageDenied && (
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

        {tab === "workflows" && manageDenied && manageDeniedNotice}

        {tab === "workflows" && !manageDenied && (
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
                onClick={() => void openCreate()}
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
              <p className="text-xs text-muted-foreground">
                Signers are users of this organisation who hold the e-signature
                permission. To have an outside party sign, invite them as a user
                first.
              </p>
              {!signersLoading && eligibleSigners.length === 0 && (
                <Alert variant="info">
                  No users can sign yet. Grant the e-signature permission to a
                  role or a user first.
                </Alert>
              )}
              {form.signers.map((userId, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <select
                    aria-label={`Signer ${i + 1}`}
                    value={userId}
                    disabled={signersLoading}
                    onChange={(e) => updateSigner(i, e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-muted/50 text-foreground ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-ring/50"
                  >
                    <option value="">
                      {signersLoading ? "Loading users…" : "Choose a signer"}
                    </option>
                    {eligibleSigners.map((signer) => (
                      <option key={signer.id} value={signer.id}>
                        {signer.name} — {signer.email}
                      </option>
                    ))}
                  </select>
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
          onClose={closeDetail}
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
              {detailSource === "manage" && isOpen(detail.status) && (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="outline"
                    isLoading={busy === `cancel-wf-${detail.id}`}
                    onClick={() => cancelWorkflow(detail.id)}
                    leftIcon={<Ban className="h-4 w-4" />}
                  >
                    Cancel workflow
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                <span className="text-sm font-medium">Steps</span>
                {(detail.steps ?? []).map((step) => {
                  // Only the step's own signer can sign it; the backend
                  // answers anyone else with 403 (A-65).
                  const isMine =
                    !!currentUserId && step.signerId === currentUserId;
                  const canSign = step.status === "pending" && isMine;
                  return (
                    <div
                      key={step.id}
                      className="rounded-md border border-border p-3 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm">{signerLabel(step)}</div>
                          <div className="text-xs text-muted-foreground">
                            {step.status ?? "waiting"} · {fmt(step.signedAt)}
                          </div>
                        </div>
                        {canSign && signingStepId !== step.id && (
                          <Button
                            size="sm"
                            onClick={() => startSigning(step.id)}
                            leftIcon={<ShieldCheck className="h-4 w-4" />}
                          >
                            Sign
                          </Button>
                        )}
                        {step.status === "pending" && !isMine && (
                          <span className="text-xs text-muted-foreground">
                            Awaiting {signerLabel(step)}
                          </span>
                        )}
                      </div>
                      {canSign && signingStepId === step.id && (
                        <form
                          onSubmit={submitSignature}
                          className="space-y-3"
                          aria-label="Sign this step"
                        >
                          <ESignatureFields
                            form={signForm}
                            setForm={setSignForm}
                            meaningOptions={[
                              "Reviewed and approved",
                              "Authored",
                              "Verified",
                            ]}
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={cancelSigning}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="submit"
                              isLoading={busy === `sign-${step.id}`}
                              leftIcon={<ShieldCheck className="h-4 w-4" />}
                            >
                              Sign
                            </Button>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })}
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
