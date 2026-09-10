const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const reportingController = require("../../controllers/reporting.controller");

/**
 * @swagger
 * tags:
 *   name: Reports
 *   description: Tenant-scoped analytics and reporting
 */

/**
 * @swagger
 * /api/v1/reports/summary:
 *   get:
 *     summary: Dashboard rollup (devices, certificates, work orders, compliance, inventory)
 *     tags: [Reports]
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Report generated }
 */
router.get("/summary", auth, reportingController.summary);

/**
 * @swagger
 * /api/v1/reports/compliance:
 *   get:
 *     summary: Calibration compliance rate (JSON or CSV via ?format=csv)
 *     tags: [Reports]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, csv] }
 *     responses:
 *       200: { description: Report generated }
 */
router.get("/compliance", auth, reportingController.compliance);

/**
 * @swagger
 * /api/v1/reports/calibration-workload:
 *   get:
 *     summary: Work orders by status/type/priority + upcoming due counts
 *     tags: [Reports]
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Report generated }
 */
router.get("/calibration-workload", auth, reportingController.calibrationWorkload);

/**
 * @swagger
 * /api/v1/reports/overdue-devices:
 *   get:
 *     summary: Devices overdue for calibration (JSON or CSV via ?format=csv)
 *     tags: [Reports]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, csv] }
 *     responses:
 *       200: { description: Report generated }
 */
router.get("/overdue-devices", auth, reportingController.overdueDevices);

/**
 * @swagger
 * /api/v1/reports/inventory:
 *   get:
 *     summary: Inventory summary + low-stock (JSON or CSV via ?format=csv)
 *     tags: [Reports]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, csv] }
 *     responses:
 *       200: { description: Report generated }
 */
router.get("/inventory", auth, reportingController.inventory);

module.exports = router;
