// src/app/dashboard/components/DashboardSystemHealth.tsx
//
// F-02. This panel used to render four hardcoded "healthy" indicators with
// invented latencies, and stayed green with the database down. It now shows
// exactly what GET /api/v1/health reports and nothing else:
//
//   - super admin only. The endpoint answers 403 to everyone else, and anyone
//     else sees NO panel — not a neutral one, and never a green one.
//   - a 503 is a real answer (a required dependency is down) and is rendered.
//   - a failed request renders "could not load", never a verdict.
//   - "not configured" and "unknown" are neutral, never green.
"use client";

import React, { useEffect, useState } from "react";
import { Server, RefreshCw } from "lucide-react";
import HealthIndicator from "./health-indicator";
import {
  healthService,
  DependencyReport,
  HealthReport,
} from "@/api/services/health.service";

type PanelState =
  | { kind: "loading" }
  | { kind: "ready"; report: HealthReport }
  | { kind: "failed"; message: string }
  | { kind: "forbidden" };

const DEPENDENCY_LABELS: Record<string, string> = {
  postgres: "PostgreSQL Database",
  redis: "Redis",
  rabbitmq: "RabbitMQ",
  mqtt: "MQTT Broker",
  clamav: "ClamAV",
};

const indicatorStatus = (
  dependency: DependencyReport,
): "healthy" | "error" | "neutral" => {
  if (dependency.status === "healthy") return "healthy";
  if (dependency.status === "unhealthy") return "error";
  return "neutral";
};

const neutralLabel = (dependency: DependencyReport): string | undefined => {
  if (dependency.status === "not configured") return "Not configured";
  if (dependency.status === "unknown") return "Not measured";
  return undefined;
};

const dependencyDetail = (dependency: DependencyReport): string => {
  const parts: string[] = [dependency.required ? "Required" : "Optional"];
  if (dependency.status === "unhealthy" && dependency.error) {
    parts.push(dependency.error);
  } else if (typeof dependency.latencyMs === "number") {
    parts.push(`${dependency.latencyMs} ms`);
  }
  if (dependency.detail) parts.push(dependency.detail);
  return parts.join(" • ");
};

const statusCodeOf = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | null)?.response?.status;

/**
 * One probe of GET /api/v1/health, resolved to the state the panel should show.
 * Never rejects: every failure becomes "failed" or "forbidden", and neither of
 * those renders a verdict.
 */
const fetchPanelState = async (): Promise<PanelState> => {
  try {
    const report = await healthService.getDetail();
    return { kind: "ready", report };
  } catch (error: unknown) {
    if (statusCodeOf(error) === 403) return { kind: "forbidden" };
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : "Request failed",
    };
  }
};

const formatCheckedAt = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString();
};

const VERDICT_STYLES = {
  loading: {
    text: "Checking…",
    box: "bg-muted/30 border-border",
    dot: "bg-muted-foreground",
    label: "text-muted-foreground",
  },
  healthy: {
    text: "Required dependencies healthy",
    box: "bg-success/10 border-success/30",
    dot: "bg-success",
    label: "text-success",
  },
  unhealthy: {
    text: "Required dependency down",
    box: "bg-destructive/10 border-destructive/30",
    dot: "bg-destructive",
    label: "text-destructive",
  },
  unknown: {
    text: "Status unknown",
    box: "bg-muted/30 border-border",
    dot: "bg-muted-foreground",
    label: "text-muted-foreground",
  },
} as const;

export interface DashboardSystemHealthProps {
  /**
   * Only a super admin may read the per-dependency breakdown. For anyone else
   * the panel renders nothing and makes no request.
   */
  isSuperAdmin: boolean;
}

export const DashboardSystemHealth: React.FC<DashboardSystemHealthProps> = ({
  isSuperAdmin,
}) => {
  const [state, setState] = useState<PanelState>({ kind: "loading" });

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    fetchPanelState().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin]);

  const refresh = () => {
    setState({ kind: "loading" });
    fetchPanelState().then(setState);
  };

  if (!isSuperAdmin || state.kind === "forbidden") return null;

  const verdict =
    state.kind === "ready"
      ? state.report.status
      : state.kind === "loading"
        ? "loading"
        : "unknown";
  const verdictStyle = VERDICT_STYLES[verdict];

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="px-6 py-5 border-b flex flex-wrap items-center justify-between gap-3 border-border bg-muted/[0.03]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-muted/40">
            <Server className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              System Health
            </h2>
            <p className="text-xs text-muted-foreground">
              {state.kind === "ready"
                ? `Dependency probes as of ${formatCheckedAt(state.report.checkedAt)}`
                : "Dependency probes"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            data-testid="health-verdict"
            data-status={verdict}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${verdictStyle.box}`}
          >
            <div className={`w-2 h-2 rounded-full ${verdictStyle.dot}`} />
            <span className={`text-xs font-semibold ${verdictStyle.label}`}>
              {verdictStyle.text}
            </span>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={state.kind === "loading"}
            aria-label="Re-check dependencies"
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="p-6">
        {state.kind === "loading" && (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            aria-busy="true"
          >
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-24 rounded-2xl bg-muted/30 animate-pulse"
              />
            ))}
          </div>
        )}

        {state.kind === "failed" && (
          <div className="flex items-center gap-4">
            <span className="text-2xl font-semibold text-muted-foreground">
              —
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">
                Could not load dependency status
              </p>
              <p className="text-xs text-muted-foreground">{state.message}</p>
            </div>
          </div>
        )}

        {state.kind === "ready" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {state.report.dependencies.map((dependency, index) => (
              <div
                key={dependency.name}
                data-testid={`health-dependency-${dependency.name}`}
                data-status={dependency.status}
              >
                <HealthIndicator
                  name={DEPENDENCY_LABELS[dependency.name] ?? dependency.name}
                  status={indicatorStatus(dependency)}
                  label={neutralLabel(dependency)}
                  uptime={dependencyDetail(dependency)}
                  delay={index * 100}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardSystemHealth;
