const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const calibrationSchedulerController = require("../../controllers/calibrationScheduler.controller");

/**
 * @swagger
 * /api/v1/calibration-scheduler/due:
 *   get:
 *     summary: List devices due (or overdue) for calibration
 *     description: >-
 *       Read-only preview of calibration devices the scheduler would act on.
 *       Scoped to the caller's tenant (super admins may pass allTenants=true).
 *       Requires read access to the Maintenance resource.
 *     tags: [Calibration Scheduler]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: leadDays
 *         schema:
 *           type: integer
 *         description: Include devices due within this many days from now.
 *       - in: query
 *         name: allTenants
 *         schema:
 *           type: boolean
 *         description: Super admin only — scan across all tenants.
 *     responses:
 *       200:
 *         description: Due calibration devices retrieved
 */
router.get(
  "/due",
  auth,
  dynamicAccess("Maintenance", "read", { checkTenant: true }),
  calibrationSchedulerController.listDue,
);

/**
 * @swagger
 * /api/v1/calibration-scheduler/run:
 *   post:
 *     summary: Manually run the calibration scan
 *     description: >-
 *       Creates a Preventative work order and a CALIBRATION notification for
 *       each due device (idempotent — devices with an open preventative work
 *       order are skipped). Scoped to the caller's tenant unless a super admin
 *       passes allTenants=true or a specific tenantId. Requires create access
 *       to the Maintenance resource.
 *     tags: [Calibration Scheduler]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               leadDays:
 *                 type: integer
 *               allTenants:
 *                 type: boolean
 *               tenantId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Calibration scan completed
 */
router.post(
  "/run",
  auth,
  dynamicAccess("Maintenance", "create", { checkTenant: true }),
  calibrationSchedulerController.runScan,
);

module.exports = router;
