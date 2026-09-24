// src/routes/internal/health.route.js
//
// Two routers, deliberately separate (A-06):
//
//   publicHealthRoutes   — mounted at the host root. /health, /live, /ready.
//                          Aggregate verdict only, no runtime or dependency
//                          detail. nginx proxies /health straight through, so
//                          anything these say is public.
//
//   internalHealthRoutes — mounted at /api/v1/health. The per-dependency
//                          breakdown, gated the way this codebase gates
//                          platform operations: auth + denyApiKey +
//                          superAdminOnly (same chain as tenantHierarchy's
//                          platformOnly).

const express = require("express");

const {
  auth,
  superAdminOnly,
  denyApiKey,
} = require("../../middlewares/auth.middleware");

const {
  liveness,
  health,
  readiness,
  readinessDetail,
  jobStatus,
  jobMetrics,
} = require("../../controllers/health.controller");
const { metricsAuth } = require("../../middlewares/metricsAuth.middleware");

// ======================================================
// PUBLIC PROBES
// ======================================================

const publicHealthRoutes = express.Router();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Public readiness signal (aggregate only)
 *     description: >
 *       Returns 200 when every REQUIRED dependency (PostgreSQL, Redis,
 *       RabbitMQ) is healthy and 503 otherwise. The body carries the verdict
 *       and nothing else — no runtime detail and no dependency breakdown.
 *       The breakdown is at GET /api/v1/health (super admin only).
 *     tags:
 *       - Health
 *     responses:
 *       '200':
 *         description: Ready
 *       '503':
 *         description: A required dependency is unavailable
 */
publicHealthRoutes.get("/health", health);

/**
 * @swagger
 * /live:
 *   get:
 *     summary: Liveness probe (dependency-free)
 *     tags:
 *       - Health
 *     responses:
 *       '200':
 *         description: The process is alive
 */
publicHealthRoutes.get("/live", liveness);

/**
 * @swagger
 * /ready:
 *   get:
 *     summary: Readiness probe (plain text)
 *     tags:
 *       - Health
 *     responses:
 *       '200':
 *         description: READY
 *       '503':
 *         description: NOT READY
 */
publicHealthRoutes.get("/ready", readiness);

// ======================================================
// GATED DETAIL
// ======================================================

const internalHealthRoutes = express.Router();

const platformOnly = [auth, denyApiKey, superAdminOnly];

/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Per-dependency readiness breakdown (super admin only)
 *     description: >
 *       Reports PostgreSQL, Redis, RabbitMQ, MQTT and ClamAV separately. A
 *       dependency switched off by configuration reports "not configured", not
 *       "healthy". Answers 503 when any REQUIRED dependency is unhealthy.
 *     tags:
 *       - Health
 *     responses:
 *       '200':
 *         description: All required dependencies are healthy
 *       '401':
 *         description: Not authenticated
 *       '403':
 *         description: Not a super admin, or an API key
 *       '503':
 *         description: One or more required dependencies are unhealthy
 */
internalHealthRoutes.get("/", ...platformOnly, readinessDetail);

/**
 * @swagger
 * /api/v1/health/jobs:
 *   get:
 *     summary: Scheduled-job outcomes (super admin only)
 *     description: >
 *       The recorded state of every scheduled job — last run, outcome, error,
 *       consecutive failures, next expected run, overdue flag (P7-02).
 *       Answers 503 when any job's last run failed or it missed its window.
 *     tags:
 *       - Health
 *     responses:
 *       '200':
 *         description: No job failing or overdue
 *       '401':
 *         description: Not authenticated
 *       '403':
 *         description: Not a super admin, or an API key
 *       '503':
 *         description: A job is failing or overdue
 */
internalHealthRoutes.get("/jobs", ...platformOnly, jobStatus);

/**
 * @swagger
 * /api/v1/health/metrics:
 *   get:
 *     summary: Prometheus metrics for scheduled jobs (bearer METRICS_TOKEN)
 *     description: >
 *       Text exposition format. Authenticated with `Authorization: Bearer
 *       <METRICS_TOKEN>`, not a user session. Answers 404 while METRICS_TOKEN
 *       is unset, so the endpoint does not exist until an operator enables it.
 *     tags:
 *       - Health
 *     responses:
 *       '200':
 *         description: Metrics
 *       '401':
 *         description: Missing or wrong token
 *       '404':
 *         description: METRICS_TOKEN is not configured
 */
internalHealthRoutes.get("/metrics", metricsAuth, jobMetrics);

module.exports = { publicHealthRoutes, internalHealthRoutes };
