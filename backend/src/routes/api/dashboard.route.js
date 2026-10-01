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
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants/roleConstants");

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
// A-304 (ADR-100): the metrics are the load call of the home page (the
// `home` menu entry). Every role holds `home` read (ROLE_MENU_ASSIGNMENTS),
// so the gate takes the page from nobody; it was `auth` alone (ADR-058's
// ACCEPTED exemption), open to every role and every API key.
router.get("/metrics", auth, dynamicAccess(MENU_SLUGS.HOME, "read"), dashboardController.getDashboardMetrics);

module.exports = router;
