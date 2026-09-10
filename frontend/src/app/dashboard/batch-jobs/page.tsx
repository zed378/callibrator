// src/app/dashboard/batch-jobs/page.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
} from "@/components/ui";
import { Download, Play, RefreshCw } from "lucide-react";
import { batchJobService, type BatchJob } from "@/api/services/batchJob.service";
import { useToastStore } from "@/stores/toastStore";

const PAGE_SIZE = 10;
const POLL_MS = 5000;

const statusVariant = (
  s: string,
): "default" | "info" | "success" | "warning" | "danger" => {
  switch (s) {
    case "COMPLETED":
      return "success";
    case "PROCESSING":
      return "info";
    case "PENDING":
      return "warning";
    case "FAILED":
      return "danger";
    default:
      return "default";
  }
};

const fmt = (v?: string) => (v ? new Date(v).toLocaleString() : "—");

export default function BatchJobsPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [isTestOpen, setIsTestOpen] = useState(false);
  const [testForm, setTestForm] = useState({ type: "EXPORT_CSV", totalItems: 10 });

  // Keep the latest loader in a ref so the poll interval never goes stale.
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const res = await batchJobService.getAll({ page, limit: PAGE_SIZE });
        setJobs(res.rows);
        setTotal(res.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load jobs");
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [page],
  );

  useEffect(() => {
    loadRef.current = () => void load(true);
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  // Jobs progress server-side, so refresh while any are still running.
  const hasRunning = jobs.some(
    (j) => j.status === "PENDING" || j.status === "PROCESSING",
  );

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => loadRef.current(), POLL_MS);
    return () => clearInterval(id);
  }, [hasRunning]);

  const createTestJob = async () => {
    setBusy("create");
    try {
      await batchJobService.createTestJob({
        type: testForm.type.trim() || undefined,
        totalItems: testForm.totalItems || undefined,
      });
      addToast({ type: "success", title: "Job queued" });
      setIsTestOpen(false);
      await load();
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not queue job",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const columns = [
    {
      key: "type",
      header: "Job",
      render: (value: unknown, row: Record<string, unknown>) => (
        <div>
          <div className="font-medium">{String(value ?? "—")}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {String(row.id ?? "").slice(0, 8)}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (value: unknown) => (
        <Badge variant={statusVariant(String(value))} size="sm">
          {String(value ?? "")}
        </Badge>
      ),
    },
    {
      key: "processedItems",
      header: "Progress",
      render: (_v: unknown, r: Record<string, unknown>) => {
        const job = r as unknown as BatchJob;
        const totalItems = job.totalItems ?? 0;
        const done = job.processedItems ?? 0;
        const pct = totalItems > 0 ? Math.round((done / totalItems) * 100) : 0;
        return (
          <div className="w-40">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {done}/{totalItems || "?"}
              </span>
              <span>{totalItems > 0 ? `${pct}%` : ""}</span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-muted">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  job.status === "FAILED" ? "bg-destructive" : "bg-primary"
                }`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
            {job.failedItems ? (
              <p className="mt-1 text-xs text-destructive">
                {job.failedItems} failed
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "createdAt",
      header: "Started",
      render: (value: unknown) => (
        <span className="text-sm text-muted-foreground">
          {fmt(value as string)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (_v: unknown, r: Record<string, unknown>) => {
        const job = r as unknown as BatchJob;
        if (job.resultUrl) {
          return (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.open(job.resultUrl as string, "_blank")}
              leftIcon={<Download className="h-4 w-4" />}
            >
              Result
            </Button>
          );
        }
        if (job.errorMessage) {
          return (
            <span
              className="text-xs text-destructive"
              title={job.errorMessage}
            >
              {job.errorMessage.slice(0, 40)}
            </span>
          );
        }
        return <span className="text-muted-foreground">—</span>;
      },
    },
  ];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Background Jobs
            </h1>
            <p className="text-sm text-muted-foreground">
              Long-running exports and imports. Progress updates automatically
              while a job is running.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => load()}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Refresh
            </Button>
            <Button
              onClick={() => setIsTestOpen(true)}
              leftIcon={<Play className="h-4 w-4" />}
            >
              Queue Test Job
            </Button>
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {hasRunning && (
          <Card className="bg-card/50 backdrop-blur-sm border-border">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                Auto-refreshing every {POLL_MS / 1000}s while jobs are running.
              </p>
            </CardContent>
          </Card>
        )}

        <Table
          columns={columns}
          data={jobs as unknown as Record<string, unknown>[]}
          isLoading={isLoading}
          emptyMessage="No background jobs have run."
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
          Jobs cannot be cancelled or deleted — the API exposes listing, status
          and a test-job trigger only.
        </Alert>

        <Dialog
          isOpen={isTestOpen}
          onClose={() => setIsTestOpen(false)}
          title="Queue Test Job"
          size="md"
        >
          <div className="p-6 space-y-4">
            <Alert variant="info">
              Enqueues a demo job that reports progress — useful for checking
              the worker is alive.
            </Alert>
            <FormField label="Type" helperText="Defaults to EXPORT_CSV.">
              <Input
                value={testForm.type}
                onChange={(e) =>
                  setTestForm({ ...testForm, type: e.target.value })
                }
                placeholder="EXPORT_CSV"
              />
            </FormField>
            <FormField label="Total items" helperText="Defaults to 10.">
              <Input
                type="number"
                min={1}
                value={String(testForm.totalItems)}
                onChange={(e) =>
                  setTestForm({
                    ...testForm,
                    totalItems: Number(e.target.value) || 0,
                  })
                }
              />
            </FormField>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsTestOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createTestJob} isLoading={busy === "create"}>
                Queue Job
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
