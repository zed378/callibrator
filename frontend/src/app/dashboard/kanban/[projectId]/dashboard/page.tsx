"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Card, CardContent, Alert, Select } from "@/components/ui";
import {
  ArrowLeft,
  LayoutGrid,
  CheckCircle2,
  Loader2,
  Clock,
  UserX,
  TrendingUp,
} from "lucide-react";
import {
  kanbanService,
  KanbanMetrics,
  KanbanSprint,
} from "@/api/services/kanban.service";

// ---- Small presentational helpers ----

function StatTile({
  label,
  value,
  icon,
  accent = "text-foreground",
  suffix,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent?: string;
  suffix?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
          <span className={accent}>{icon}</span>
        </div>
        <div className={`mt-2 text-3xl font-extrabold ${accent}`}>
          {value}
          {suffix && (
            <span className="text-lg font-semibold text-muted-foreground">
              {suffix}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BarList({
  title,
  rows,
  emptyText = "No data.",
}: {
  title: string;
  rows: { key: string; label: string; count: number; color?: string; hint?: string }[];
  emptyText?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const nonEmpty = rows.some((r) => r.count > 0);
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>
        {!nonEmpty ? (
          <p className="text-xs text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="space-y-2.5">
            {rows.map((r) => (
              <div key={r.key} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-xs text-foreground truncate flex items-center gap-1">
                  {r.color && (
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: r.color }}
                    />
                  )}
                  <span className="truncate" title={r.label}>
                    {r.label}
                  </span>
                </div>
                <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{
                      width: `${(r.count / max) * 100}%`,
                      backgroundColor: r.color || undefined,
                    }}
                  />
                </div>
                <span className="w-8 text-right text-xs font-semibold text-foreground">
                  {r.count}
                </span>
                {r.hint && (
                  <span className="text-[10px] text-destructive font-bold">
                    {r.hint}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#ef4444",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#94a3b8",
  none: "#cbd5e1",
};

function KanbanDashboardContent() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.projectId);

  const [metrics, setMetrics] = useState<KanbanMetrics | null>(null);
  const [sprints, setSprints] = useState<KanbanSprint[]>([]);
  const [scope, setScope] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sprint list for the scope selector (loaded once).
  useEffect(() => {
    kanbanService
      .listSprints(projectId)
      .then((r) => setSprints(r.sprints))
      .catch(() => setSprints([]));
  }, [projectId]);

  // Load metrics for the current scope. State is only set inside the async
  // continuation (never synchronously in the effect body).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const m = await kanbanService.getMetrics(
          projectId,
          scope === "all" ? undefined : scope,
        );
        if (!active) return;
        setError(null);
        setMetrics(m);
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : "Failed to load metrics");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, scope]);

  const s = metrics?.summary;

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/dashboard/kanban/${projectId}`)}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Board
          </Button>
          <div className="w-52">
            <Select
              value={scope}
              onChange={setScope}
              options={[
                { value: "all", label: "All cards" },
                { value: "backlog", label: "Backlog" },
                ...sprints.map((sp) => ({ value: sp.id, label: sp.name })),
              ]}
            />
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            Board Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            KPIs and work distribution
            {scope !== "all" ? " for the selected sprint" : " across the board"}.
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {loading && !metrics ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading metrics…
          </div>
        ) : s && metrics ? (
          <>
            {/* KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatTile
                label="Total"
                value={s.total}
                icon={<LayoutGrid className="h-4 w-4" />}
              />
              <StatTile
                label="Done"
                value={s.done}
                accent="text-success"
                icon={<CheckCircle2 className="h-4 w-4" />}
              />
              <StatTile
                label="In progress"
                value={s.inProgress}
                icon={<Loader2 className="h-4 w-4" />}
              />
              <StatTile
                label="Completion"
                value={s.completionRate}
                suffix="%"
                accent="text-primary"
                icon={<TrendingUp className="h-4 w-4" />}
              />
              <StatTile
                label="Overdue"
                value={s.overdue}
                accent={s.overdue > 0 ? "text-destructive" : "text-foreground"}
                icon={<Clock className="h-4 w-4" />}
              />
              <StatTile
                label="Unassigned"
                value={s.unassigned}
                accent={s.unassigned > 0 ? "text-warning" : "text-foreground"}
                icon={<UserX className="h-4 w-4" />}
              />
            </div>

            {/* Progress bar */}
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-foreground">
                    Overall progress
                  </h3>
                  <span className="text-sm font-bold text-primary">
                    {s.completionRate}%
                  </span>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-success transition-all"
                    style={{ width: `${s.completionRate}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {s.done} of {s.total} cards done · {s.columns} columns ·{" "}
                  {s.sprints} sprints
                </p>
              </CardContent>
            </Card>

            {/* Distributions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BarList
                title="Cards by column"
                rows={metrics.byColumn.map((c) => ({
                  key: c.columnId,
                  label: c.name,
                  count: c.count,
                  hint: c.overWip ? "WIP!" : undefined,
                }))}
              />
              <BarList
                title="Cards by priority"
                rows={metrics.byPriority.map((p) => ({
                  key: p.priority,
                  label: p.priority,
                  count: p.count,
                  color: PRIORITY_COLORS[p.priority],
                }))}
              />
              <BarList
                title="Workload by assignee"
                rows={metrics.byAssignee.map((a) => ({
                  key: a.userId,
                  label: a.name,
                  count: a.count,
                }))}
                emptyText="No assigned cards."
              />
              <BarList
                title="Cards by label"
                rows={metrics.byLabel.map((l) => ({
                  key: l.labelId,
                  label: l.name,
                  count: l.count,
                  color: l.color || undefined,
                }))}
                emptyText="No labels."
              />
              {metrics.bySprint.length > 0 && (
                <BarList
                  title="Cards by sprint"
                  rows={metrics.bySprint.map((sp) => ({
                    key: sp.sprintId || "backlog",
                    label: sp.name,
                    count: sp.count,
                  }))}
                />
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No metrics available.</p>
        )}
      </div>
    </DashboardLayout>
  );
}

export default function KanbanDashboardPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <KanbanDashboardContent />
    </Suspense>
  );
}
