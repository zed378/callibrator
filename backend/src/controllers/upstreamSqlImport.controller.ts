/**
 * The SQL-dump import (P24-06) — the super admin's console routes, mounted on
 * the admin router (`auth` + `rbac(SUPER_ADMIN)`, and `superAdminOnly` on each
 * route besides). Bodies and parameters arrive validated (`validate(schema)` on
 * the route) and are read with `validated(req, schema)`; the upload's multipart
 * fields are checked by the service, which deletes a refused file.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { asyncHandler } from "../utils/controllerWrapper.util";
import { success } from "../utils/response.util";
import { AppError } from "../utils/appError.util";
import { validated } from "../middlewares/validation.middleware";
import { actorIdOf, requestOriginOf } from "../utils/requestOrigin.util";
import { upstreamImportSettings } from "../config/upstreamImport";
import { listUpstreamSqlImportsSchema, upstreamSqlImportIdSchema } from "../validators/upstreamSqlImport.validator";
import { cancelRun, getRun, getSettings, listRuns, retryRun, uploadDump, type Actor } from "../services/upstreamSqlImport.service";

/** The super admin acting. */
const actorOf = (req: Request): Actor => {
  const { ip, userAgent } = requestOriginOf(req);
  const tenantId = (req.user as { tenantId?: unknown }).tenantId;
  return { userId: actorIdOf(req), tenantId: typeof tenantId === "string" ? tenantId : null, ipAddress: ip, userAgent };
};

/** A request with connect-timeout's handle on it (index.ts `timeout("30s")`). */
type TimedRequest = Request & { clearTimeout?: () => void; timedout?: boolean };

/**
 * The upload's own time budget (UPSTREAM_IMPORT_UPLOAD_TIMEOUT_MS, default 15 minutes)
 * instead of the application's 30 s: a 200 MB dump over an ordinary uplink takes
 * longer than that to arrive. Past it the request ends exactly as an outrun 30 s
 * one does — connect-timeout's own `timeout` listener answers 408.
 */
export const uploadTimeBudget: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const timed = req as TimedRequest;
  timed.clearTimeout?.();
  const ms = upstreamImportSettings().uploadTimeoutMs;
  const timer = setTimeout(() => {
    timed.timedout = true;
    req.emit("timeout", ms);
  }, ms);
  timer.unref();
  res.on("close", () => {
    clearTimeout(timer);
  });
  next();
};

/** GET /admin/upstream-sql-imports/settings — the limits and the DPIA gate, for the page. */
export const settings = asyncHandler((_req: Request, res: Response) => {
  success(res, getSettings(), "Upstream SQL import settings", 200);
  return Promise.resolve();
});

/** GET /admin/upstream-sql-imports — rows in `data`, pagination in a top-level `meta`. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const { rows, meta } = await listRuns(validated(req, listUpstreamSqlImportsSchema));
  success(res, rows, meta, "Upstream SQL imports retrieved", 200);
});

/** GET /admin/upstream-sql-imports/:id */
export const detail = asyncHandler(async (req: Request, res: Response) => {
  const { id } = validated(req, upstreamSqlImportIdSchema);
  success(res, await getRun(id), "Upstream SQL import retrieved", 200);
});

/** POST /admin/upstream-sql-imports — multipart: `file` and `dataClass`. */
export const upload = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError(400, "A dump file is required (multipart field `file`)");
  }
  const run = await uploadDump({ path: req.file.path, size: req.file.size }, req.body, actorOf(req));
  success(res, run, "Upstream SQL dump accepted; the import is queued", 201);
});

/** POST /admin/upstream-sql-imports/:id/cancel */
export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const { id } = validated(req, upstreamSqlImportIdSchema);
  success(res, await cancelRun(id, actorOf(req)), "Upstream SQL import cancellation recorded", 200);
});

/** POST /admin/upstream-sql-imports/:id/retry */
export const retry = asyncHandler(async (req: Request, res: Response) => {
  const { id } = validated(req, upstreamSqlImportIdSchema);
  success(res, await retryRun(id, actorOf(req)), "Upstream SQL import queued again", 200);
});
