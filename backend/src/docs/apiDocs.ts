/**
 * P9-25 (ADR-103) — where the API reference is mounted, and whether at all.
 * Replaces `docs/swagger.js` (Swagger UI, published unauthenticated).
 *
 * `SWAGGER_ENABLED` keeps its name and its defaults (S-23, A-253) — on outside
 * production, OFF in production unless `SWAGGER_ENABLED=true` — and its
 * meaning narrows: it decides whether the SIGNED-IN reference is mounted. No
 * setting publishes the contract to an anonymous caller any more; every route
 * the switch mounts carries `auth` + `denyApiKey` + `rbac([TENANT_ADMIN])`
 * (`routes/internal/apiDocs.route.ts`). The name is kept because deployments
 * already set it (helm values, compose overlays); renaming it would silently
 * turn the reference off where it was deliberately on.
 */
import type { Express } from "express";
import { env, isProduction } from "../config/env";
import { apiDocsRoutes, apiDocsSpecRoutes } from "../routes/internal/apiDocs.route";
import appPath from "../utils/appPath.util";

/** Whether the signed-in API reference (and the developer pages) are mounted. */
export const apiDocsEnabled = (): boolean => {
  const flag = env("SWAGGER_ENABLED");
  return flag === "true" || (flag !== "false" && !isProduction());
};

/**
 * Mount the API reference on `app`, before the API routers.
 *
 * @returns whether anything was mounted
 */
export const apiDocs = (app: Express): boolean => {
  if (!apiDocsEnabled()) {
    return false;
  }
  app.use("/docs.json", apiDocsSpecRoutes);
  app.use("/docs", apiDocsRoutes);
  // The path a signed-in browser reaches through the frontend's /api/v1 proxy,
  // which turns the session cookie into the Bearer header (ADR-103).
  app.use("/api/v1/docs", apiDocsRoutes);

  // A-253 — the developer HTML pages, under the same switch. Unchanged by
  // P9-25: still unauthenticated where mounted (off in production).
  app.get("/documentation", (_req, res) => {
    res.sendFile(appPath("docs", "DOCUMENTATION.html"));
  });
  app.get("/standards", (_req, res) => {
    res.sendFile(appPath("docs", "CODING_STANDARDS.html"));
  });
  return true;
};
