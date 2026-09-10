const express = require("express");
const router = express.Router();
const tenantLifecycleController = require("../../controllers/tenantLifecycle.controller");
const { auth, superAdminOnly } = require("../../middlewares/auth.middleware");

router.use(auth);

/**
 * @swagger
 * /api/v1/tenants/{tenantId}/status:
 *   get:
 *     summary: Get lifecycle status
 *     description: Returns the lifecycle status of the tenant.
 *     tags: [TenantLifecycle]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Lifecycle status returned
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 */
router.get("/:tenantId/status", tenantLifecycleController.getTenantLifecycleStatus);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/suspend:
 *   post:
 *     summary: Suspend tenant
 *     description: Suspends the tenant. Super admin only.
 *     tags: [TenantLifecycle]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Tenant suspended
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.post("/:tenantId/suspend", superAdminOnly, tenantLifecycleController.suspendTenant);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/resume:
 *   post:
 *     summary: Resume tenant
 *     description: Resumes the tenant. Super admin only.
 *     tags: [TenantLifecycle]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Tenant resumed
 *       401:
 *         description: Unauthorized
 */
router.post("/:tenantId/resume", superAdminOnly, tenantLifecycleController.resumeTenant);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/grace-period:
 *   post:
 *     summary: Start grace period
 *     description: Starts the grace period for the tenant. Super admin only.
 *     tags: [TenantLifecycle]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Grace period started
 *       401:
 *         description: Unauthorized
 */
router.post("/:tenantId/grace-period", superAdminOnly, tenantLifecycleController.enterGracePeriod);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/offboard:
 *   post:
 *     summary: Offboard tenant (schedule deletion)
 *     description: Schedules deletion of the tenant. Super admin only.
 *     tags: [TenantLifecycle]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Tenant offboarding scheduled
 *       400:
 *         description: Bad request
 *       401:
 *         description: Unauthorized
 */
router.post("/:tenantId/offboard", superAdminOnly, tenantLifecycleController.offboardTenant);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/offboard/cancel:
 *   post:
 *     summary: Cancel offboarding
 *     description: Cancels a scheduled offboarding for the tenant. Super admin only.
 *     tags: [TenantLifecycle]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Offboarding cancelled
 *       401:
 *         description: Unauthorized
 */
router.post("/:tenantId/offboard/cancel", superAdminOnly, tenantLifecycleController.cancelOffboarding);
/**
 * @swagger
 * /api/v1/tenants/{tenantId}/export:
 *   get:
 *     summary: Export all tenant data
 *     description: Exports all data for the tenant. Super admin only.
 *     tags: [TenantLifecycle]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: tenantId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Tenant data exported
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Not found
 */
router.get("/:tenantId/export", superAdminOnly, tenantLifecycleController.exportTenantData);

module.exports = router;
