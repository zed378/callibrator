const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants");
const quotaController = require("../../controllers/quota.controller");

/**
 * @swagger
 * /api/v1/quota:
 *   get:
 *     summary: Get the current tenant's plan, quota usage, and features
 *     description: >-
 *       Returns the authenticated tenant's plan, seat usage vs limit, storage
 *       usage vs limit, and the feature set unlocked by the plan.
 *     tags: [Quota]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Quota usage retrieved
 *       403:
 *         description: No `billing` read permission in the caller's tenant
 *       404:
 *         description: Tenant not found
 */
// AZ-01 / G-03 (ADR-088): plan, seats, storage and entitlements are the billing
// page's data (PlanQuotaCard is the only consumer), so they carry its gate.
router.get("/", auth, dynamicAccess(MENU_SLUGS.BILLING, "read"), quotaController.getUsage);

module.exports = router;
