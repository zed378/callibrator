/**
 * P9-18 / P9-25 (ADR-103) — the contract of `health.route.ts`, code-first.
 *
 * The module exports two routers (A-06): the public probes, mounted at the host
 * root, and the gated detail, mounted at /api/v1/health. One module documents
 * both, so the mount is empty and each path is the full one. The public
 * probes answer an aggregate verdict and nothing else (no runtime or
 * dependency detail: nginx publishes /health). The detail is super admin and
 * JWT only; the job metrics are for a scraper, gated by the METRICS_TOKEN
 * bearer rather than a session. Each probe answers 503 when a required
 * dependency (or a scheduled job) is failing, so a caller can act on the code
 * alone. Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";

const PLATFORM = { kind: "superAdminOnly" } as const;
const UNHEALTHY = "503 when a required dependency is unavailable (the body says so).";

const Readiness = z
  .object({
    success: z.boolean(),
    status: z.number().int(),
    message: z.string(),
    // P9-25 item 11 (2026-10-02): `health.service#getReadiness`'s report, field for field (it was a sketch).
    data: z.object({
      status: z.enum(["healthy", "unhealthy"]).meta({ description: "Over the REQUIRED dependencies only" }),
      checkedAt: z.iso.datetime(),
      dependencies: z.array(
        z.object({
          name: z.string(),
          required: z.boolean(),
          status: z.enum(["healthy", "unhealthy", "not configured", "unknown"]),
          latencyMs: z.number().optional(),
          error: z.string().optional(),
          detail: z.string().optional(),
        }),
      ),
    }),
  })
  .meta({
    id: "ReadinessBreakdown",
    description: "Built by hand so the breakdown survives the failure case (503).",
    example: {
      success: true,
      status: 200,
      message: "All required dependencies are healthy",
      data: {
        status: "healthy",
        checkedAt: "2030-01-15T09:00:00.000Z",
        dependencies: [{ name: "postgres", required: true, status: "healthy", latencyMs: 3 }],
      },
    },
  });

const JobStates = z
  .object({
    success: z.boolean(),
    status: z.number().int(),
    message: z.string(),
    data: z.array(z.object({ job: z.string(), lastOutcome: z.string().nullable(), overdueSince: z.string().nullable().optional() }).loose()),
  })
  .meta({
    id: "ScheduledJobStates",
    example: {
      success: true,
      status: 200,
      message: "No scheduled job is failing or overdue",
      data: [{ job: "certificateExpiry", lastOutcome: "success", overdueSince: null }],
    },
  });

export default defineRouteDocs({
  router: "internal/health.route",
  mount: "",
  tag: "Health",
  tenantScoped: false,
  operations: [
    {
      method: "get",
      path: "/health",
      operationId: "getPublicHealth",
      summary: "Public readiness signal (aggregate only)",
      description: `The compose healthcheck and the Helm readiness and startup probes read it. ${UNHEALTHY}`,
      permission: null,
      audited: false,
      success: {
        status: 200,
        description: "Ready",
        body: z.object({ status: z.enum(["ok", "unavailable"]) }).meta({ example: { status: "ok" } }),
      },
    },
    {
      method: "get",
      path: "/live",
      operationId: "getLiveness",
      summary: "Liveness probe (dependency-free)",
      description: "A database blip never fails it (A-15): a failed liveness probe restarts a healthy process.",
      permission: null,
      audited: false,
      success: { status: 200, description: "`OK`: the process is alive", file: { contentType: "text/plain" } },
    },
    {
      method: "get",
      path: "/ready",
      operationId: "getReadiness",
      summary: "Readiness probe (plain text)",
      description: "`READY`, or `NOT READY` with a 503.",
      permission: null,
      audited: false,
      success: { status: 200, description: "`READY`", file: { contentType: "text/plain" } },
    },
    {
      method: "get",
      path: "/api/v1/health",
      operationId: "getReadinessBreakdown",
      summary: "Per-dependency readiness breakdown (super admin only)",
      description: `JWT only: an API key is refused. ${UNHEALTHY}`,
      permission: PLATFORM,
      audited: false,
      success: { status: 200, description: "All required dependencies are healthy", body: Readiness },
    },
    {
      method: "get",
      path: "/api/v1/health/jobs",
      operationId: "getScheduledJobStates",
      summary: "Scheduled-job outcomes (super admin only)",
      description: "JWT only: an API key is refused. 503 when any job's last run failed or it missed its window (P7-02).",
      permission: PLATFORM,
      audited: false,
      success: { status: 200, description: "No job is failing or overdue", body: JobStates },
    },
    {
      method: "get",
      path: "/api/v1/health/metrics",
      operationId: "getScheduledJobMetrics",
      summary: "Prometheus metrics for the scheduled jobs (bearer METRICS_TOKEN)",
      description:
        "For a scraper, which has no user: the METRICS_TOKEN bearer, not a session (401 without it or with a wrong one; unavailable while METRICS_TOKEN is not configured).",
      permission: null,
      audited: false,
      success: { status: 200, description: "Prometheus text", file: { contentType: "text/plain; version=0.0.4" } },
    },
  ],
});
