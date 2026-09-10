const express = require("express");
const router = express.Router();
const predictiveMaintenanceController = require("../../controllers/predictiveMaintenance.controller");
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");

// All endpoints require authentication and "predictiveMaintenance" menu permissions
router.use(auth);

/**
 * @swagger
 * /api/v1/predictive-maintenance/analyze/{deviceId}:
 *   post:
 *     summary: Run IoT anomaly analysis for a device
 *     description: Runs IoT anomaly analysis for the specified device. Requires authentication.
 *     tags: [PredictiveMaintenance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Device ID
 *     responses:
 *       200:
 *         description: Analysis completed
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 */
router.post(
  "/analyze/:deviceId",
  validateUuid("deviceId"),
  dynamicAccess("calibration", "write", { checkTenant: true }),
  predictiveMaintenanceController.analyzeDevice
);

/**
 * @swagger
 * /api/v1/predictive-maintenance/recommendations:
 *   get:
 *     summary: List devices with a pending recommendation
 *     description: Returns devices that have a pending calibration recommendation. Requires authentication.
 *     tags: [PredictiveMaintenance]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of devices with pending recommendations
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/recommendations",
  dynamicAccess("calibration", "read", { checkTenant: true }),
  predictiveMaintenanceController.getRecommendations
);

/**
 * @swagger
 * /api/v1/predictive-maintenance/recommendations/{deviceId}/approve:
 *   post:
 *     summary: Apply the recommended calibration interval
 *     description: Applies the recommended calibration interval for the specified device. Requires authentication.
 *     tags: [PredictiveMaintenance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: deviceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Device ID
 *     responses:
 *       200:
 *         description: Recommendation applied
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Device not found
 */
router.post(
  "/recommendations/:deviceId/approve",
  validateUuid("deviceId"),
  dynamicAccess("calibration", "write", { checkTenant: true }),
  predictiveMaintenanceController.approveRecommendation
);

module.exports = router;
