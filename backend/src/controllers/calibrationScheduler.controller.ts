/**
 * Calibration scheduler: the due-device preview and the manual scan,
 * `/api/v1/calibration-scheduler`.
 *
 * P9-20 (ADR-087): converted from calibrationScheduler.controller.js, behaviour
 * unchanged. `req.user`, `req.query` and `req.body` are read INLINE as the
 * JavaScript read them (a missing user throws the same TypeError, inside the
 * wrapper). Everything the JavaScript required at load is captured at load, in
 * its order; the service is called through its module object. `export =` keeps
 * the exact object `require()` returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import calibrationScheduler from "../services/calibrationScheduler.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
// N-01: the one super-admin predicate (both spellings).
import { isSuperAdmin as loadedIsSuperAdmin } from "../utils/role.util";
// A-282 (ADR-100): a manual run by an API key is audited as system:api-key.
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const isSuperAdminPrincipal = loadedIsSuperAdmin;
const auditPrincipal = loadedAuditPrincipal;

/** The body a manual run may carry (unvalidated, as before). */
interface ScanBody {
  allTenants?: unknown;
  tenantId?: string | null;
  leadDays?: unknown;
}

/** The query the two routes read (strings at run time). */
interface ScanQuery {
  allTenants?: string;
  leadDays?: string;
}

// Determines which tenant(s) the scan targets. Super admins may target all
// tenants (allTenants=true) or a specific tenant (body.tenantId); everyone else
// is scoped to their own tenant.
const resolveScanScope = (req: Request): { tenantId: string | null } => {
  const isSuperAdmin = isSuperAdminPrincipal(req.user);
  const body = req.body as ScanBody | null | undefined;
  const wantsAll =
    (req.query as ScanQuery).allTenants === "true" || body?.allTenants === true;

  if (isSuperAdmin && wantsAll) {
    return { tenantId: null };
  }
  if (isSuperAdmin && body?.tenantId) {
    return { tenantId: body.tenantId };
  }
  // As before: read without a guard (`auth` ran); a missing user throws inside the wrapper.
  return { tenantId: (req.user as { tenantId: string }).tenantId };
};

const parseLeadDays = (raw: unknown): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

// POST /api/v1/calibration-scheduler/run
const runScan = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = resolveScanScope(req);
  const leadDays = parseLeadDays((req.body as ScanBody | null | undefined)?.leadDays);
  const summary = await calibrationScheduler.runCalibrationScan({
    tenantId,
    leadDays,
    // W-30: a manual run's work orders are the user's, audited as theirs.
    actor: auditPrincipal(req),
  });
  success(res, summary, null, "Calibration scan completed", 200);
});

// GET /api/v1/calibration-scheduler/due
const listDue = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = resolveScanScope(req);
  const leadDays = parseLeadDays((req.query as ScanQuery).leadDays);
  const devices = await calibrationScheduler.getDueDevices({
    tenantId,
    leadDays,
  });
  success(res, devices, null, "Due calibration devices retrieved", 200);
});

export = { runScan, listDue };
