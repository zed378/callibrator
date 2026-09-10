const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
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
 *       404:
 *         description: Tenant not found
 */
router.get("/", auth, quotaController.getUsage);

module.exports = router;
