// src/routes/api/stock.js
const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const stockController = require("../../controllers/stock.controller");

/* ------------------------------------------------------------------ */
/* STOCK ROUTES                                                       */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/stocks:
 *   get:
 *     summary: Get all stock items
 *     description: Requires read access to warehouse. Supports pagination and filtering.
 *     tags: [Stock]
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
 *         name: warehouseId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Stocks retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Stocks retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/Stock"
 *                 meta:
 *                   $ref: "#/components/schemas/PaginationMeta"
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  auth,
  dynamicAccess("warehouse", "read"),
  stockController.getAllStocks,
);

/**
 * @swagger
 * /api/v1/stocks/{stockId}:
 *   get:
 *     summary: Get specific stock item by ID
 *     description: Requires read access to warehouse.
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stockId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Stock UUID
 *     responses:
 *       200:
 *         description: Stock retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Stock retrieved successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Stock"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Stock not found
 */
router.get(
  "/:stockId",
  auth,
  validateUuid("stockId"),
  dynamicAccess("warehouse", "read"),
  stockController.getSpecificStock,
);

/**
 * @swagger
 * /api/v1/stocks:
 *   post:
 *     summary: Create a new stock item
 *     description: Requires write access to warehouse. Creates a new inventory item.
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - warehouseId
 *               - sku
 *               - productName
 *               - quantity
 *             properties:
 *               warehouseId:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *               sku:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 100
 *                 example: "PROD-001"
 *               productName:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 200
 *                 example: "Widget A"
 *               quantity:
 *                 type: integer
 *                 minimum: 0
 *                 example: 100
 *               unit:
 *                 type: string
 *                 default: "pcs"
 *                 example: "pcs"
 *               minStock:
 *                 type: integer
 *                 minimum: 0
 *                 default: 10
 *                 example: 10
 *               maxStock:
 *                 type: integer
 *                 minimum: 1
 *                 example: 1000
 *               batchNumber:
 *                 type: string
 *                 maxLength: 100
 *                 example: "BATCH-2026-001"
 *               expiryDate:
 *                 type: string
 *                 format: date
 *                 example: "2027-01-01"
 *               locationId:
 *                 type: string
 *                 format: uuid
 *                 example: "650e8400-e29b-41d4-a716-446655440000"
 *     responses:
 *       201:
 *         description: Stock created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 201
 *                 message:
 *                   type: string
 *                   example: "Stock created successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Stock"
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/",
  auth,
  dynamicAccess("warehouse", "write"),
  stockController.createStock,
);

/**
 * @swagger
 * /api/v1/stocks/{stockId}:
 *   patch:
 *     summary: Update a stock item
 *     description: Requires write access to warehouse.
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stockId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Stock UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               sku:
 *                 type: string
 *               productName:
 *                 type: string
 *               quantity:
 *                 type: integer
 *               unit:
 *                 type: string
 *               minStock:
 *                 type: integer
 *               maxStock:
 *                 type: integer
 *               batchNumber:
 *                 type: string
 *               expiryDate:
 *                 type: string
 *                 format: date
 *               locationId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       200:
 *         description: Stock updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Stock updated successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Stock"
 *       400:
 *         description: Validation error or invalid UUID
 *       404:
 *         description: Stock not found
 */
router.patch(
  "/:stockId",
  auth,
  validateUuid("stockId"),
  dynamicAccess("warehouse", "write"),
  stockController.updateStock,
);

/**
 * @swagger
 * /api/v1/stocks/{stockId}:
 *   delete:
 *     summary: Delete a stock item (soft delete)
 *     description: Requires write access to warehouse. Performs soft delete.
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: stockId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Stock UUID
 *     responses:
 *       200:
 *         description: Stock deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Stock deleted successfully"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Stock not found
 */
router.delete(
  "/:stockId",
  auth,
  validateUuid("stockId"),
  dynamicAccess("warehouse", "write"),
  stockController.deleteStock,
);

/* ------------------------------------------------------------------ */
/* ADJUSTMENT ROUTES                                                  */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/stocks/adjustment:
 *   post:
 *     summary: Create a stock adjustment
 *     description: Requires write access to warehouse. Adjusts stock quantity with reason.
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stockId
 *               - adjustmentType
 *               - quantity
 *               - reason
 *             properties:
 *               stockId:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *               adjustmentType:
 *                 type: string
 *                 enum: [add, remove, correct]
 *                 example: "add"
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 50
 *               reason:
 *                 type: string
 *                 minLength: 10
 *                 maxLength: 500
 *                 example: "Received new batch from supplier"
 *               referenceNumber:
 *                 type: string
 *                 maxLength: 100
 *                 example: "PO-2026-001"
 *     responses:
 *       201:
 *         description: Adjustment created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 201
 *                 message:
 *                   type: string
 *                   example: "Adjustment created successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Adjustment"
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/adjustment",
  auth,
  dynamicAccess("warehouse", "write"),
  stockController.createAdjustment,
);

/**
 * @swagger
 * /api/v1/stocks/adjustment/history:
 *   get:
 *     summary: Get stock adjustment history
 *     description: Requires read access to warehouse. Returns all adjustments with optional filtering.
 *     tags: [Stock]
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
 *         name: stockId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: adjustmentType
 *         schema:
 *           type: string
 *           enum: [add, remove, correct]
 *     responses:
 *       200:
 *         description: Adjustments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Adjustments retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/Adjustment"
 *                 meta:
 *                   $ref: "#/components/schemas/PaginationMeta"
 */
router.get(
  "/adjustment/history",
  auth,
  dynamicAccess("warehouse", "read"),
  stockController.getAdjustments,
);

/* ------------------------------------------------------------------ */
/* TRANSFER ROUTES                                                    */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/stocks/transfer:
 *   post:
 *     summary: Create a stock transfer
 *     description: Requires write access to warehouse. Transfers stock between locations/warehouses.
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stockId
 *               - fromLocationId
 *               - toLocationId
 *               - quantity
 *             properties:
 *               stockId:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *               fromLocationId:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440001"
 *               toLocationId:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440002"
 *               quantity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 100
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 example: "Rebalancing stock levels"
 *               expectedDeliveryDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-30"
 *     responses:
 *       201:
 *         description: Transfer created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 201
 *                 message:
 *                   type: string
 *                   example: "Transfer created successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Transfer"
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/transfer",
  auth,
  dynamicAccess("warehouse", "write"),
  stockController.createTransfer,
);

/**
 * @swagger
 * /api/v1/stocks/transfer/{transferId}:
 *   patch:
 *     summary: Update transfer status
 *     description: Requires write access to warehouse. Updates transfer status (shipped, delivered, cancelled).
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: transferId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Transfer UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending, shipped, delivered, cancelled]
 *                 example: "shipped"
 *               note:
 *                 type: string
 *                 maxLength: 500
 *                 example: "Shipped via expedited courier"
 *     responses:
 *       200:
 *         description: Transfer status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Transfer status updated successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Transfer"
 *       400:
 *         description: Validation error or invalid UUID
 *       404:
 *         description: Transfer not found
 */
router.patch(
  "/transfer/:transferId",
  auth,
  validateUuid("transferId"),
  dynamicAccess("warehouse", "write"),
  stockController.updateTransferStatus,
);

/**
 * @swagger
 * /api/v1/stocks/transfer/history:
 *   get:
 *     summary: Get stock transfer history
 *     description: Requires read access to warehouse. Returns all transfers with optional filtering.
 *     tags: [Stock]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, shipped, delivered, cancelled]
 *       - in: query
 *         name: stockId
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Transfers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Transfers retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/Transfer"
 *                 meta:
 *                   $ref: "#/components/schemas/PaginationMeta"
 */
router.get(
  "/transfer/history",
  auth,
  dynamicAccess("warehouse", "read"),
  stockController.getTransfers,
);

/* ------------------------------------------------------------------ */
/* OPNAME ROUTES                                                      */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/stocks/opname:
 *   post:
 *     summary: Create a stock opname (inventory count)
 *     description: Requires write access to warehouse. Starts a new inventory counting session.
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - warehouseId
 *             properties:
 *               warehouseId:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *               type:
 *                 type: string
 *                 enum: [full, partial, cycle]
 *                 default: full
 *                 example: "cycle"
 *               note:
 *                 type: string
 *                 maxLength: 500
 *                 example: "Monthly cycle count for Zone A"
 *     responses:
 *       201:
 *         description: Opname created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 201
 *                 message:
 *                   type: string
 *                   example: "Opname created successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Opname"
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/opname",
  auth,
  dynamicAccess("warehouse", "write"),
  stockController.createOpname,
);

/**
 * @swagger
 * /api/v1/stocks/opname/{opnameId}:
 *   patch:
 *     summary: Update stock opname status/results
 *     description: Requires write access to warehouse. Updates counted quantities and finalizes opname.
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: opnameId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Opname UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [in_progress, completed, cancelled]
 *                 example: "completed"
 *               results:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     stockId:
 *                       type: string
 *                       format: uuid
 *                     counted:
 *                       type: integer
 *                     difference:
 *                       type: integer
 *                     note:
 *                       type: string
 *                 example:
 *                   - stockId: "550e8400-e29b-41d4-a716-446655440000"
 *                     counted: 150
 *                     difference: 50
 *                     note: "Additional items found in back storage"
 *     responses:
 *       200:
 *         description: Opname updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Opname updated successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Opname"
 *       400:
 *         description: Validation error or invalid UUID
 *       404:
 *         description: Opname not found
 */
router.patch(
  "/opname/:opnameId",
  auth,
  validateUuid("opnameId"),
  dynamicAccess("warehouse", "write"),
  stockController.updateOpnameStatus,
);

/**
 * @swagger
 * /api/v1/stocks/opname/history:
 *   get:
 *     summary: Get stock opname history
 *     description: Requires read access to warehouse. Returns all inventory counting sessions.
 *     tags: [Stock]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [in_progress, completed, cancelled]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [full, partial, cycle]
 *     responses:
 *       200:
 *         description: Opnames retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Opnames retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/Opname"
 *                 meta:
 *                   $ref: "#/components/schemas/PaginationMeta"
 */
router.get(
  "/opname/history",
  auth,
  dynamicAccess("warehouse", "read"),
  stockController.getOpnames,
);

/**
 * @swagger
 * /api/v1/stocks/reports/summary:
 *   get:
 *     summary: Get inventory summary report
 *     description: Requires read access to warehouse. Returns aggregated stock metrics under tenant isolation.
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Report summary retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 message:
 *                   type: string
 *                   example: "Get inventory report successful"
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalItems:
 *                       type: integer
 *                     totalUnits:
 *                       type: integer
 *                     lowStockCount:
 *                       type: integer
 *                     warehouseDistribution:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                           code:
 *                             type: string
 *                           itemCount:
 *                             type: integer
 *                           unitCount:
 *                             type: integer
 */
router.get(
  "/reports/summary",
  auth,
  dynamicAccess("warehouse", "read"),
  stockController.getInventoryReport,
);

/**
 * @swagger
 * /api/v1/stocks/reports/export:
 *   get:
 *     summary: Export inventory stock levels to CSV
 *     description: Requires read access to warehouse. Compiles tenant stock levels into CSV.
 *     tags: [Stock]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: CSV report exported successfully
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 */
router.get(
  "/reports/export",
  auth,
  dynamicAccess("warehouse", "read"),
  stockController.exportInventoryCsv,
);

module.exports = router;
