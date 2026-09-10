// src/app/dashboard/sop/page.tsx
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
import { CheckCircle2, ExternalLink, Plus, Send } from "lucide-react";
import {
  sopService,
  type SopDocument,
  type SopStatus,
} from "@/api/services/sop.service";
import { useToastStore } from "@/stores/toastStore";

const PAGE_SIZE = 10;

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

export default function SopPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [docs, setDocs] = useState<SopDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    version: "1.0",
    contentUrl: "",
    requiresTraining: true,
  });

  const [publishTarget, setPublishTarget] = useState<SopDocument | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await sopService.listDocuments({
        page,
        limit: PAGE_SIZE,
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      setDocs(res.rows);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    } finally {
      setIsLoading(false);
    }
  }, [page, statusFilter]);

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

  const create = async () => {
    if (!form.title.trim()) {
      addToast({ type: "error", title: "A title is required" });
      return;
    }
    const ok = await run(
      "create",
      () =>
        sopService.createDocument({
          title: form.title.trim(),
          version: form.version.trim() || undefined,
          contentUrl: form.contentUrl.trim() || undefined,
          requiresTraining: form.requiresTraining,
        }),
      "Document created as DRAFT",
    );
    if (ok) {
      setIsCreateOpen(false);
      setForm({ title: "", version: "1.0", contentUrl: "", requiresTraining: true });
    }
  };

  const confirmPublish = async () => {
    if (!publishTarget) return;
    const ok = await run(
      "publish",
      () => sopService.publishDocument(publishTarget.id),
      publishTarget.requiresTraining
        ? "Published — training assigned to every user in the tenant"
        : "Published",
    );
    if (ok) setPublishTarget(null);
  };

  const acknowledge = (doc: SopDocument) =>
    run(
      doc.id,
      () => sopService.acknowledgeTraining(doc.id),
      "Training acknowledged",
    );

  const columns = [
    {
      key: "documentNumber",
      header: "Document",
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
      key: "version",
      header: "Version",
      render: (value: unknown) => (
        <span className="font-mono text-sm">{String(value ?? "—")}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (value: unknown) => (
        <Badge variant={value === "PUBLISHED" ? "success" : "warning"} size="sm">
          {String(value ?? "")}
        </Badge>
      ),
    },
    {
      key: "requiresTraining",
      header: "Training",
      render: (value: unknown) => (
        <Badge variant={value ? "info" : "default"} size="sm">
          {value ? "Required" : "Not required"}
        </Badge>
      ),
    },
    {
      key: "publishedDate",
      header: "Published",
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
        const doc = r as unknown as SopDocument;
        return (
          <div className="flex items-center gap-1">
            {doc.contentUrl && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => window.open(doc.contentUrl as string, "_blank")}
                aria-label="Open document"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
            {doc.status === "DRAFT" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPublishTarget(doc)}
                leftIcon={<Send className="h-4 w-4" />}
              >
                Publish
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                isLoading={busy === doc.id}
                onClick={() => acknowledge(doc)}
                leftIcon={<CheckCircle2 className="h-4 w-4" />}
              >
                I have read this
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">SOP Documents</h1>
            <p className="text-sm text-muted-foreground">
              Controlled procedures. Publishing a document that requires
              training assigns it to everyone in the tenant.
            </p>
          </div>
          <Button
            onClick={() => setIsCreateOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            New Document
          </Button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

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
                  options={(["DRAFT", "PUBLISHED"] as SopStatus[]).map((s) => ({
                    value: s,
                    label: s,
                  }))}
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
          columns={columns}
          data={docs as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          emptyMessage="No SOP documents yet."
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

        <Alert variant="info">
          Training acknowledgements have no list endpoint — a user confirms
          their own reading from this table once a document is published.
        </Alert>

        <Dialog
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          title="New SOP Document"
          size="md"
        >
          <div className="p-6 space-y-4">
            <FormField
              label="Title"
              required
              helperText="The document number and DRAFT status are assigned automatically."
            >
              <Input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Thermometer calibration procedure"
              />
            </FormField>
            <FormField label="Version">
              <Input
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
                placeholder="1.0"
              />
            </FormField>
            <FormField
              label="Content URL"
              helperText="Link to the procedure itself (e.g. a PDF)."
            >
              <Input
                value={form.contentUrl}
                onChange={(e) =>
                  setForm({ ...form, contentUrl: e.target.value })
                }
                placeholder="https://example.com/sop.pdf"
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.requiresTraining}
                onChange={(e) =>
                  setForm({ ...form, requiresTraining: e.target.checked })
                }
              />
              Requires training acknowledgement on publish
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={create} isLoading={busy === "create"}>
                Create Draft
              </Button>
            </div>
          </div>
        </Dialog>

        <Dialog
          isOpen={publishTarget !== null}
          onClose={() => setPublishTarget(null)}
          title="Publish Document"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant={publishTarget?.requiresTraining ? "warning" : "info"}>
              {publishTarget?.requiresTraining
                ? "This assigns a pending training acknowledgement to EVERY user in the tenant. It cannot be undone."
                : "This marks the document as published. It cannot be returned to draft."}
            </Alert>
            <p className="text-sm">
              <span className="font-mono text-xs text-muted-foreground">
                {publishTarget?.documentNumber}
              </span>
              <br />
              <span className="font-medium">{publishTarget?.title}</span>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPublishTarget(null)}>
                Cancel
              </Button>
              <Button onClick={confirmPublish} isLoading={busy === "publish"}>
                Publish
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
