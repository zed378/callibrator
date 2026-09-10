/**
 * @swagger
 * tags:
 *   name: Dashboard
 *   description: Aggregated dashboard metrics (tenant-scoped; global for SUPERADMIN)
 */

const express = require("express");
const router = express.Router();
const dashboardController = require("../../controllers/dashboard.controller");
const { auth } = require("../../middlewares/auth.middleware");

/**
 * @swagger
 * /api/v1/dashboard/metrics:
 *   get:
 *     tags: [Dashboard]
 *     security:
 *       - bearerAuth: []
 *     summary: Get dashboard metrics
 *     description: >
 *       Returns aggregated metrics for the dashboard. Non-superadmin users
 *       always receive metrics scoped to their own tenant. SUPERADMIN receives
 *       global metrics with a per-tenant breakdown, and may optionally scope to
 *       a single tenant with the tenantId query parameter.
 *     parameters:
 *       - in: query
 *         name: tenantId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: (SUPERADMIN only) scope metrics to one tenant
 *     responses:
 *       200:
 *         description: Dashboard metrics fetched successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/metrics", auth, dashboardController.getDashboardMetrics);

module.exports = router;
