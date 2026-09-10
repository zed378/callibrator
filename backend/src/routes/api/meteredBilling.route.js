/**
 * Metered Billing Routes
 *
 * Routes for metered billing and usage analytics.
 * Mounted at /api/v1/metered-billing
 */

const express = require("express");
const router = express.Router();

const { auth } = require("../../middlewares/auth.middleware");
const { rbac } = require("../../middlewares/rbac.middleware");
const {
  getUsageMetrics,
  getBillingHistory,
  estimateCost,
  getPlanDetails,
  getUsageAlerts,
  createUsageAlert,
  deleteUsageAlert,
  getAnalytics,
} = require("../../controllers/meteredBilling.controller");
const meteredValidator = require("../../validators/meteredBilling.validator");
const {
  createUsageAlert: createAlertValidator,
  estimateCost: estimateCostValidator,
  getAnalytics: getAnalyticsValidator,
  getBillingHistory: billingHistoryValidator,
} = meteredValidator;
const { validateUuid } = require("../../middlewares/validateUuid.middleware");

// All routes require authentication and billing permissions
const billingGuard = [auth, rbac(["TENANT_ADMIN", "BILLING_ADMIN"])];

/**
 * @swagger
 * /api/v1/metered-billing/usage:
 *   get:
 *     summary: Get current usage metrics
 *     description: Retrieves current usage metrics for the tenant including API calls, storage, and active users. Requires read access to MeteredBilling.
 *     tags: [MeteredBilling]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Usage metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     apiCalls:
 *                       type: integer
 *                     storageUsed:
 *                       type: integer
 *                     activeUsers:
 *                       type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/usage", ...billingGuard, getUsageMetrics);

/**
 * @swagger
 * /api/v1/metered-billing/history:
 *   get:
 *     summary: Get billing history
 *     description: Retrieves paginated billing history for the tenant. Requires read access to MeteredBilling.
 *     tags: [MeteredBilling]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Billing history retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/history",
  ...billingGuard,
  meteredValidator.validateQuery(billingHistoryValidator),
  getBillingHistory,
);

/**
 * @swagger
 * /api/v1/metered-billing/estimate:
 *   post:
 *     summary: Estimate cost for planned usage
 *     description: Estimates the cost for planned usage based on current pricing tiers. Requires write access to MeteredBilling.
 *     tags: [MeteredBilling]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - metrics
 *               - quantity
 *             properties:
 *               metrics:
 *                 type: object
 *                 description: Usage metrics to estimate
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 description: Quantity of usage
 *               period:
 *                 type: string
 *                 enum: [hourly, daily, monthly, yearly]
 *                 default: monthly
 *     responses:
 *       200:
 *         description: Cost estimation calculated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 estimatedCost:
 *                   type: number
 *                 currency:
 *                   type: string
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/estimate",
  ...billingGuard,
  meteredValidator.validateBody(estimateCostValidator),
  estimateCost,
);

/**
 * @swagger
 * /api/v1/metered-billing/plan:
 *   get:
 *     summary: Get current plan details
 *     description: Retrieves current subscription plan details, limits, and overage pricing. Requires read access to MeteredBilling.
 *     tags: [MeteredBilling]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Plan details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 planName:
 *                   type: string
 *                 limits:
 *                   type: object
 *                 overagePricing:
 *                   type: object
 *       401:
 *         description: Unauthorized
 */
router.get("/plan", ...billingGuard, getPlanDetails);

/**
 * @swagger
 * /api/v1/metered-billing/alerts:
 *   get:
 *     summary: Get usage alerts
 *     description: Retrieves configured usage alerts for the tenant. Requires read access to MeteredBilling.
 *     tags: [MeteredBilling]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Usage alerts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 alerts:
 *                   type: array
 *                   items:
 *                     type: object
 *       401:
 *         description: Unauthorized
 */
router.get("/alerts", ...billingGuard, getUsageAlerts);

/**
 * @swagger
 * /api/v1/metered-billing/alerts:
 *   post:
 *     summary: Create a usage alert
 *     description: Creates a new usage alert for the tenant. Requires write access to MeteredBilling.
 *     tags: [MeteredBilling]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - metricName
 *               - threshold
 *             properties:
 *               metricName:
 *                 type: string
 *                 description: Name of the metric to monitor
 *               threshold:
 *                 type: number
 *                 minimum: 0
 *                 description: Alert threshold value
 *               comparison:
 *                 type: string
 *                 enum: [gte, lte, eq, gt, lt]
 *                 default: gte
 *               notificationChannels:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [email, webhook]
 *                 default: [email]
 *               isEnabled:
 *                 type: boolean
 *                 default: true
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Usage alert created successfully
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/alerts",
  ...billingGuard,
  meteredValidator.validateBody(createAlertValidator),
  createUsageAlert,
);

/**
 * @swagger
 * /api/v1/metered-billing/alerts/{alertId}:
 *   delete:
 *     summary: Delete a usage alert
 *     description: Deletes an existing usage alert. Requires write access to MeteredBilling.
 *     tags: [MeteredBilling]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: alertId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Usage alert deleted successfully
 *       404:
 *         description: Alert not found
 *       401:
 *         description: Unauthorized
 */
router.delete(
  "/alerts/:alertId",
  ...billingGuard,
  validateUuid("alertId"),
  deleteUsageAlert,
);

/**
 * @swagger
 * /api/v1/metered-billing/analytics:
 *   get:
 *     summary: Get analytics dashboard data
 *     description: Retrieves analytics dashboard data for usage trends and billing insights. Requires read access to MeteredBilling.
 *     tags: [MeteredBilling]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d, 1y]
 *           default: 30d
 *       - in: query
 *         name: metrics
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 trends:
 *                   type: array
 *                 insights:
 *                   type: object
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/analytics",
  ...billingGuard,
  meteredValidator.validateQuery(getAnalyticsValidator),
  getAnalytics,
);

module.exports = router;
