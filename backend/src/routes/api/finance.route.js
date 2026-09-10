/**
 * @swagger
 * tags:
 *   name: Finance
 *   description: Asset finance records and depreciation reporting for calibration devices
 */

const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const financeValidator = require("../../validators/finance.validator");
const financeController = require("../../controllers/finance.controller");

/**
 * @swagger
 * /api/v1/finance/reports/depreciation:
 *   get:
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     summary: Depreciation report (capex, accumulated depreciation, book value)
 *     parameters:
 *       - in: query
 *         name: asOf
 *         schema: { type: string, format: date }
 *         description: Report date (defaults to today)
 *       - in: query
 *         name: format
 *         schema: { type: string, enum: [json, csv] }
 *     responses:
 *       200:
 *         description: Depreciation report generated successfully
 */
// NOTE: registered before /:financeId so "reports" isn't captured as an id.
router.get(
  "/reports/depreciation",
  auth,
  dynamicAccess(["Finance", "Billing"], "read", { checkTenant: true }),
  financeController.getDepreciationReport,
);

/**
 * @swagger
 * /api/v1/finance:
 *   get:
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     summary: List asset finance records (with computed depreciation)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 25 }
 *       - in: query
 *         name: deviceId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: method
 *         schema: { type: string, enum: [straight_line, declining_balance] }
 *     responses:
 *       200:
 *         description: Fetch asset finance records successful
 */
router.get(
  "/",
  auth,
  dynamicAccess(["Finance", "Billing"], "read", { checkTenant: true }),
  financeController.fetchAssetFinances,
);

/**
 * @swagger
 * /api/v1/finance:
 *   post:
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     summary: Create an asset finance record for a device
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deviceId, purchasePrice, purchaseDate, usefulLifeYears]
 *             properties:
 *               deviceId: { type: string, format: uuid }
 *               purchasePrice: { type: number, minimum: 0 }
 *               purchaseDate: { type: string, format: date }
 *               salvageValue: { type: number, minimum: 0, default: 0 }
 *               usefulLifeYears: { type: integer, minimum: 1, maximum: 50 }
 *               depreciationMethod: { type: string, enum: [straight_line, declining_balance] }
 *               vendorId: { type: string, format: uuid, nullable: true }
 *               invoiceNumber: { type: string, nullable: true }
 *               notes: { type: string, nullable: true }
 *     responses:
 *       201:
 *         description: Asset finance record created successfully
 *       409:
 *         description: Record already exists for this device
 */
router.post(
  "/",
  auth,
  dynamicAccess(["Finance", "Billing"], "create", { checkTenant: true }),
  validate(financeValidator.createAssetFinance),
  financeController.createAssetFinance,
);

/**
 * @swagger
 * /api/v1/finance/{financeId}:
 *   get:
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     summary: Get one asset finance record
 *     parameters:
 *       - in: path
 *         name: financeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Asset finance record retrieved successfully
 *       404:
 *         description: Not found
 */
router.get(
  "/:financeId",
  validateUuid("financeId"),
  auth,
  dynamicAccess(["Finance", "Billing"], "read", { checkTenant: true }),
  financeController.getAssetFinanceById,
);

/**
 * @swagger
 * /api/v1/finance/{financeId}:
 *   patch:
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     summary: Update an asset finance record
 *     parameters:
 *       - in: path
 *         name: financeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Asset finance record updated successfully
 *       404:
 *         description: Not found
 */
router.patch(
  "/:financeId",
  validateUuid("financeId"),
  auth,
  dynamicAccess(["Finance", "Billing"], "update", { checkTenant: true }),
  validate(financeValidator.updateAssetFinance),
  financeController.updateAssetFinance,
);

/**
 * @swagger
 * /api/v1/finance/{financeId}:
 *   delete:
 *     tags: [Finance]
 *     security:
 *       - bearerAuth: []
 *     summary: Delete (soft) an asset finance record
 *     parameters:
 *       - in: path
 *         name: financeId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Asset finance record deleted successfully
 *       404:
 *         description: Not found
 */
router.delete(
  "/:financeId",
  validateUuid("financeId"),
  auth,
  dynamicAccess(["Finance", "Billing"], "delete", { checkTenant: true }),
  financeController.deleteAssetFinance,
);

module.exports = router;
