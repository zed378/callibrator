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
//
// P9-18 (ADR-087): converted from health.route.js. Every route and middleware
// is in the same order as before (checked against the mounted route tables of
// both routers), and `forceHttps` and `PROBE_PATHS` are the same. `export =`
// keeps the object index.js destructures (the same keys, in the same order).
// The contracts are code-first: health.openapi.ts (P9-25, ADR-103).
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  auth,
  superAdminOnly,
  denyApiKey,
} from "../../middlewares/auth.middleware";
import {
  liveness,
  health,
  readiness,
  readinessDetail,
  jobStatus,
  jobMetrics,
} from "../../controllers/health.controller";
import { metricsAuth } from "../../middlewares/metricsAuth.middleware";

// ======================================================
// PUBLIC PROBES
// ======================================================
// `Router` is `express.Router` (the same function).
const publicHealthRoutes = Router();

publicHealthRoutes.get("/health", health);
publicHealthRoutes.get("/live", liveness);
publicHealthRoutes.get("/ready", readiness);

// ======================================================
// GATED DETAIL
// ======================================================
const internalHealthRoutes = Router();
const platformOnly = [auth, denyApiKey, superAdminOnly];

internalHealthRoutes.get("/", ...platformOnly, readinessDetail);
internalHealthRoutes.get("/jobs", ...platformOnly, jobStatus);
internalHealthRoutes.get("/metrics", metricsAuth, jobMetrics);

// ======================================================
// HTTPS REDIRECT — the probe paths are exempt (S-09, ADR-081)
// ======================================================
const PROBE_PATHS = Object.freeze(["/health", "/live", "/ready"]);

const forceHttps = (req: Request, res: Response, next: NextFunction): void => {
  if (req.secure || req.get("X-Forwarded-Proto") === "https" || PROBE_PATHS.includes(req.path)) {
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: the gate answers what `next` answers
    return next();
  }
  // Redirect to HTTPS (preserves path + query)
  // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built
  return res.redirect(301, `https://${String(req.get("Host"))}${req.url}`);
};

const healthRoutes = { publicHealthRoutes, internalHealthRoutes, forceHttps, PROBE_PATHS };

export = healthRoutes;
