/**
 * Metered Billing Controller
 *
 * Handles metered billing and usage analytics endpoints.
 */

const { logger } = require("../middlewares/activityLog.middleware");
// The service exports its functions at the top level, so import the module
// object — NOT `{ meteredBillingService }` (which was undefined and made every
// endpoint throw at runtime).
const meteredBillingService = require("../services/meteredBilling.service");
const { success, error } = require("../utils/response.util");
const { asyncHandler } = require("../utils/controllerWrapper.util");

/**
 * Get usage metrics for current tenant
 */
exports.getUsageMetrics = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const metrics = await meteredBillingService.getTenantUsage(tenantId);

  return success(res, metrics, "Usage metrics retrieved");
});

/**
 * Get billing history
 */
exports.getBillingHistory = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { page = 1, limit = 20, startDate, endDate } = req.query;

  const history = await meteredBillingService.getBillingHistory(
    tenantId,
    parseInt(page),
    parseInt(limit),
    startDate,
    endDate,
  );

  return success(res, history, "Billing history retrieved");
});

/**
 * Estimate cost for planned usage
 */
exports.estimateCost = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { metrics, quantity } = req.body;

  const estimate = await meteredBillingService.estimateCost(
    tenantId,
    metrics,
    parseInt(quantity),
  );

  return success(res, estimate, "Cost estimate calculated");
});

/**
 * Get plan details and limits
 */
exports.getPlanDetails = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const plan = await meteredBillingService.getPlanDetails(tenantId);

  return success(res, plan, "Plan details retrieved");
});

/**
 * Get usage alerts
 */
exports.getUsageAlerts = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;

  const alerts = await meteredBillingService.getUsageAlerts(tenantId);

  return success(res, alerts, "Usage alerts retrieved");
});

/**
 * Create usage alert
 */
exports.createUsageAlert = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const alertData = req.body;

  const alert = await meteredBillingService.createUsageAlert(
    tenantId,
    alertData,
  );

  return success(res, alert, null, "Usage alert created", 201);
});

/**
 * Delete usage alert
 */
exports.deleteUsageAlert = asyncHandler(async (req, res) => {
  const { alertId } = req.params;
  const { tenantId } = req.user;

  await meteredBillingService.deleteUsageAlert(tenantId, alertId);

  return success(res, null, "Usage alert deleted");
});

/**
 * Get analytics dashboard data
 */
exports.getAnalytics = asyncHandler(async (req, res) => {
  const { tenantId } = req.user;
  const { period = "30d" } = req.query;

  const analytics = await meteredBillingService.getAnalytics(tenantId, period);

  return success(res, analytics, "Analytics data retrieved");
});
