const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const maintenanceValidator = require("../../validators/maintenance.validator");
const maintenanceController = require("../../controllers/maintenance.controller");

/**
 * @swagger
 * /api/v1/maintenance:
 *   get:
 *     summary: Get all maintenance work orders
 *     description: Retrieves all maintenance work orders for the current tenant. Requires read access to the Maintenance resource.
 *     tags: [Maintenance]
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
 *           default: 25
 *       - in: query
 *         name: find
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Open, InProgress, Completed, Cancelled]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [Preventative, Breakdown, Repair]
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [Low, Medium, High, Critical]
 *       - in: query
 *         name: deviceId
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Maintenance work orders retrieved successfully
 */
router.get(
  "/",
  auth,
  dynamicAccess("Maintenance", "read", { checkTenant: true }),
  maintenanceController.fetchWorkOrders
);

/**
 * @swagger
 * /api/v1/maintenance/{orderId}:
 *   get:
 *     summary: Get specific maintenance work order
 *     description: Retrieves a specific maintenance work order by ID. Requires read access to the Maintenance resource.
 *     tags: [Maintenance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Maintenance work order retrieved successfully
 *       404:
 *         description: Maintenance work order not found
 */
router.get(
  "/:orderId",
  auth,
  validateUuid("orderId"),
  dynamicAccess("Maintenance", "read", { checkTenant: true }),
  maintenanceController.getWorkOrderById
);

/**
 * @swagger
 * /api/v1/maintenance:
 *   post:
 *     summary: Create a new maintenance work order
 *     description: Creates a new maintenance work order. Requires create access to the Maintenance resource.
 *     tags: [Maintenance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deviceId, title, type, priority]
 *             properties:
 *               deviceId:
 *                 type: string
 *                 format: uuid
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [Preventative, Breakdown, Repair]
 *               status:
 *                 type: string
 *                 enum: [Open, InProgress, Completed, Cancelled]
 *               priority:
 *                 type: string
 *                 enum: [Low, Medium, High, Critical]
 *               vendorId:
 *                 type: string
 *                 format: uuid
 *               assignedTo:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Maintenance work order created successfully
 */
router.post(
  "/",
  auth,
  dynamicAccess("Maintenance", "create", { checkTenant: true }),
  validate(maintenanceValidator.createWorkOrder),
  maintenanceController.createWorkOrder
);

/**
 * @swagger
 * /api/v1/maintenance/{orderId}:
 *   patch:
 *     summary: Update an existing maintenance work order
 *     description: Updates an existing maintenance work order. Requires update access to the Maintenance resource.
 *     tags: [Maintenance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
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
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [Preventative, Breakdown, Repair]
 *               status:
 *                 type: string
 *                 enum: [Open, InProgress, Completed, Cancelled]
 *               priority:
 *                 type: string
 *                 enum: [Low, Medium, High, Critical]
 *               vendorId:
 *                 type: string
 *                 format: uuid
 *               assignedTo:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Maintenance work order updated successfully
 *       404:
 *         description: Maintenance work order not found
 */
router.patch(
  "/:orderId",
  auth,
  validateUuid("orderId"),
  dynamicAccess("Maintenance", "update", { checkTenant: true }),
  validate(maintenanceValidator.updateWorkOrder),
  maintenanceController.updateWorkOrder
);

/**
 * @swagger
 * /api/v1/maintenance/{orderId}:
 *   delete:
 *     summary: Delete a maintenance work order
 *     description: Deletes an existing maintenance work order. Requires delete access to the Maintenance resource.
 *     tags: [Maintenance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Maintenance work order deleted successfully
 *       404:
 *         description: Maintenance work order not found
 */
router.delete(
  "/:orderId",
  auth,
  validateUuid("orderId"),
  dynamicAccess("Maintenance", "delete", { checkTenant: true }),
  maintenanceController.deleteWorkOrder
);

module.exports = router;
