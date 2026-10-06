/**
 * Dashboard Controller
 *
 * Serves aggregated dashboard metrics.
 * SUPERADMIN gets global metrics (with per-tenant breakdown);
 * every other role gets metrics scoped to their own tenant.
 *
 * P9-18 (ADR-087): converted from dashboard.controller.js, behaviour
 * unchanged. `req.user` is read without a guard (`auth` runs first), as
 * before; the utilities are captured at load, as the `.js` destructured them,
 * and the service is read through its module object at call time. `export =`
 * keeps the exact object `require()` returned.
 *
 * U-06b (ADR-120): the result is served from a 30-second cache per scope
 * (services/dashboardCache.service): the key names the caller's kind and
 * tenant and the scope asked for, so no two tenants share an entry. The
 * payload's `generatedAt` says when the figures were computed.
 */
import type { Request, Response } from "express";
import dashboardService from "../services/dashboard.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
// N-01: the one super-admin predicate (both spellings).
import { isSuperAdmin as loadedIsSuperAdmin } from "../utils/role.util";
import { cachedDashboard, dashboardCacheKey } from "../services/dashboardCache.service";

const asyncHandler = loadedAsyncHandler;
const success = loadedSuccess;
const isSuperAdminPrincipal = loadedIsSuperAdmin;

/** The principal `auth` set (read without a guard, as before). */
interface DashboardPrincipal {
  tenantId: string;
}

const getDashboardMetrics = asyncHandler(async (req: Request, res: Response) => {
  const isSuperAdmin = isSuperAdminPrincipal(req.user);

  // SUPERADMIN may optionally inspect a single tenant via ?tenantId=...;
  // otherwise they get the global view. Non-superadmins are ALWAYS pinned
  // to their own tenant — the query param is ignored for them.
  const tenantId = isSuperAdmin
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty ?tenantId= reads as the global view
    ? (req.query["tenantId"] as string | undefined) || null
    : (req.user as DashboardPrincipal).tenantId;

  const key = dashboardCacheKey(
    { superAdmin: isSuperAdmin, tenantId: (req.user as DashboardPrincipal).tenantId },
    tenantId,
  );
  const result = await cachedDashboard(key, () => dashboardService.getDashboardMetrics(tenantId));

  success(res, result.data, null, result.message, result.status);
});

const controller = { getDashboardMetrics };

export = controller;
