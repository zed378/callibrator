// A-06 — what a public probe is allowed to say.
//
// The old handler answered every caller with `node: process.version`, `pid`,
// `memory` and `uptime`. nginx proxies /health straight through, so that was
// published to the internet: the Node version tells an attacker which CVEs to
// try, and the pid/memory pair is free reconnaissance. Nothing that reads these
// endpoints (a load balancer, a container healthcheck, an uptime monitor) needs
// any of it — they read the STATUS CODE.
//
// So: the public endpoints carry an aggregate verdict and nothing else, and the
// per-dependency breakdown is super-admin only (see routes/internal/health.route.ts).
//
// P9-18 (ADR-087): converted from health.controller.js, behaviour unchanged.
// The handlers are plain (no wrapper), as before; the two services are read
// through their module objects at call time. `export =` keeps the exact object
// `require()` returned (the same keys, in the same order).
import type { Request, Response } from "express";
import healthService from "../services/health.service";
import jobMonitor from "../services/jobMonitor.service";

/**
 * GET /live — liveness.
 *
 * Dependency-free by design (A-15): liveness answers "is this process able to
 * serve?", and a liveness probe that fails on a database blip restarts a
 * healthy process and turns a brief outage into a crash loop.
 */
const liveness = (_req: Request, res: Response): Response => res.status(200).send("OK");

/**
 * GET /health — public readiness signal, aggregate only.
 *
 * Kept as a 200/503 readiness answer because the compose healthcheck and the
 * Helm readiness and startup probes already point here and act on the code.
 * What changed is that the verdict now covers Redis and RabbitMQ too, and the
 * body says nothing beyond the verdict.
 */
const health = async (_req: Request, res: Response): Promise<Response> => {
  const ready = await healthService.isReady();
  const statusCode = ready ? 200 : 503;

  return res.status(statusCode).json({ status: ready ? "ok" : "unavailable" });
};

/**
 * GET /ready — public readiness, plain text, unchanged contract.
 */
const readiness = async (_req: Request, res: Response): Promise<Response> => {
  const ready = await healthService.isReady();

  return ready
    ? res.status(200).send("READY")
    : res.status(503).send("NOT READY");
};

/**
 * GET /api/v1/health — the per-dependency breakdown. Super-admin only.
 *
 * Answers 503 when a required dependency is down so an orchestrator or an
 * on-call script can act on the status code without parsing the body.
 *
 * Built by hand rather than through `response.util#error`, which forces
 * `data: null` — the breakdown is exactly what the caller asked for, and it has
 * to survive the failure case.
 */
const readinessDetail = async (_req: Request, res: Response): Promise<Response> => {
  const current = await healthService.getReadiness({ fresh: true });
  const healthy = current.status === healthService.STATUS.HEALTHY;
  const statusCode = healthy ? 200 : 503;

  return res.status(statusCode).json({
    success: healthy,
    status: statusCode,
    message: healthy
      ? "All required dependencies are healthy"
      : "One or more required dependencies are unhealthy",
    data: current,
  });
};

/**
 * GET /api/v1/health/jobs — every scheduled job's recorded state (P7-02).
 * Super-admin only. Answers 503 when any job's last run failed or it missed
 * its window, so an on-call script can act on the code alone.
 */
const jobStatus = (_req: Request, res: Response): Response => {
  const jobs = jobMonitor.getJobStates();
  const failing = jobs.filter(
    (job) => job.lastOutcome === "failure" || Boolean(job.overdueSince),
  );
  const healthy = failing.length === 0;
  const statusCode = healthy ? 200 : 503;

  return res.status(statusCode).json({
    success: healthy,
    status: statusCode,
    message: healthy
      ? "No scheduled job is failing or overdue"
      : `Failing or overdue: ${failing.map((job) => job.job).join(", ")}`,
    data: jobs,
  });
};

/**
 * GET /api/v1/health/metrics — Prometheus text for the scheduled jobs (P7-02).
 * Gated by metricsAuth (METRICS_TOKEN), not by a user session, because a
 * scraper has no user.
 */
const jobMetrics = (_req: Request, res: Response): Response =>
  res
    .status(200)
    .type("text/plain; version=0.0.4; charset=utf-8")
    .send(jobMonitor.renderMetrics());

const controller = {
  liveness,
  health,
  readiness,
  readinessDetail,
  jobStatus,
  jobMetrics,
};

export = controller;
