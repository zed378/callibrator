/**
 * Metered Billing Controller
 *
 * Handles metered billing and usage analytics endpoints.
 *
 * P9-20 (ADR-087): converted from meteredBilling.controller.js, behaviour
 * unchanged. As the JavaScript did: the tenant comes from `req.user` (read
 * inline, so a request without a user throws the same TypeError); the history
 * and analytics read `req.query` RAW (their `validate(…, { from: "query" })`
 * checks it and leaves it as it is), with the same defaults and `parseInt`s;
 * the estimate and alert bodies are read with `|| {}`; each handler answers
 * through `success()` with the same argument shapes (a string third argument
 * is the message, ADR-074's overload).
 */
import type { Request, Response } from "express";
// The JavaScript destructured `logger` from here and never used it; the module still loads at this point.
import "../middlewares/activityLog.middleware";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
// The service exports its functions at the top level, so import the module
// object — NOT `{ meteredBillingService }` (which was undefined and made every
// endpoint throw at runtime).
import meteredBillingService from "../services/meteredBilling.service";
import { success as loadedSuccess } from "../utils/response.util";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
import type { TenantId } from "../types/ids";

// Captured at load, as the JavaScript destructured them (its `error` was never used).
const auditPrincipal = loadedAuditPrincipal;
const success = loadedSuccess;
const asyncHandler = loadedAsyncHandler;

/** The principal `auth` set, destructured inline from `req.user` as before. */
interface Principal {
  tenantId: TenantId;
}

/** `:alertId`, read without a schema (`validateUuid` on the route checked its shape). */
interface AlertParams {
  alertId: string;
}

/** The history query, read RAW with the JavaScript's defaults. */
interface HistoryQuery {
  page?: string;
  limit?: string;
  startDate?: unknown;
  endDate?: unknown;
}

/** The estimate body, read with `|| {}`. */
interface EstimateBody {
  metrics?: unknown;
  quantity?: string;
}

type AlertBody = Parameters<typeof meteredBillingService.createUsageAlert>[1];

/**
 * Get usage metrics for current tenant
 */
export const getUsageMetrics = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;

  const metrics = await meteredBillingService.getTenantUsage(tenantId);

  return success(res, metrics, "Usage metrics retrieved");
});

/**
 * Get billing history
 */
export const getBillingHistory = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { page = 1, limit = 20, startDate, endDate } = req.query as HistoryQuery;

  const history = await meteredBillingService.getBillingHistory(
    tenantId,
    parseInt(page as string),
    parseInt(limit as string),
    startDate,
    endDate,
  );

  // F-13 (ADR-074): the house envelope — the invoices in `data`, the
  // pagination in a TOP-LEVEL `meta`. This used to send the service's
  // `{ rows, meta }` whole as `data`, and the frontend read `data.rows`.
  return success(res, history.rows, history.meta, "Billing history retrieved");
});

/**
 * Estimate cost for planned usage
 */
export const estimateCost = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const { metrics, quantity } = (req.body as EstimateBody | undefined) || {};

  const estimate = await meteredBillingService.estimateCost(
    tenantId,
    metrics,
    parseInt(quantity as string),
  );

  return success(res, estimate, "Cost estimate calculated");
});

/**
 * Get plan details and limits
 */
export const getPlanDetails = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;

  const plan = await meteredBillingService.getPlanDetails(tenantId);

  return success(res, plan, "Plan details retrieved");
});

/**
 * Get usage alerts
 */
export const getUsageAlerts = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;

  const alerts = await meteredBillingService.getUsageAlerts(tenantId);

  return success(res, alerts, "Usage alerts retrieved");
});

/**
 * Create usage alert
 */
export const createUsageAlert = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `req.body || {}`
  const alertData = (req.body as AlertBody | undefined) || {};

  const alert = await meteredBillingService.createUsageAlert(
    tenantId,
    alertData,
    auditPrincipal(req),
  );

  return success(res, alert, null, "Usage alert created", 201);
});

/**
 * Delete usage alert
 */
export const deleteUsageAlert = asyncHandler(async (req: Request, res: Response) => {
  const { alertId } = req.params as unknown as AlertParams;
  const { tenantId } = req.user as Principal;

  await meteredBillingService.deleteUsageAlert(tenantId, alertId, auditPrincipal(req));

  return success(res, null, "Usage alert deleted");
});

/**
 * Get analytics dashboard data
 */
export const getAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const { tenantId } = req.user as Principal;
  const { period = "30d" } = req.query as { period?: string };

  const analytics = await meteredBillingService.getAnalytics(tenantId, period);

  return success(res, analytics, "Analytics data retrieved");
});
