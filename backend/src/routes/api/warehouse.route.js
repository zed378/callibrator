// src/routes/api/warehouse.js
const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const warehouseController = require("../../controllers/warehouse.controller");

/* ------------------------------------------------------------------ */
/* WAREHOUSE ROUTES                                                   */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/warehouses:
 *   get:
 *     summary: Get all warehouses
 *     description: Requires read access to warehouse with tenant scope. Uses dynamic RBAC/ABAC.
 *     tags: [Warehouse]
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
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Warehouses retrieved successfully
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
 *                   example: "Warehouses retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/Warehouse"
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
  warehouseController.getAllWarehouses,
);

/**
 * @swagger
 * /api/v1/warehouses/{warehouseId}:
 *   get:
 *     summary: Get specific warehouse by ID
 *     description: Requires read access to warehouse with tenant scope.
 *     tags: [Warehouse]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Warehouse UUID
 *     responses:
 *       200:
 *         description: Warehouse retrieved successfully
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
 *                   example: "Warehouse retrieved successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Warehouse"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Warehouse not found
 */
router.get(
  "/:warehouseId",
  auth,
  validateUuid("warehouseId"),
  dynamicAccess("warehouse", "read"),
  warehouseController.getSpecificWarehouse,
);

/**
 * @swagger
 * /api/v1/warehouses:
 *   post:
 *     summary: Create a new warehouse
 *     description: Requires write access to warehouse. Uses dynamic RBAC/ABAC.
 *     tags: [Warehouse]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - code
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 200
 *                 example: "Main Distribution Center"
 *               code:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *                 example: "MDC-001"
 *               address:
 *                 type: string
 *                 maxLength: 500
 *                 example: "123 Main Street, Jakarta"
 *               city:
 *                 type: string
 *                 maxLength: 100
 *                 example: "Jakarta Selatan"
 *               province:
 *                 type: string
 *                 maxLength: 100
 *                 example: "DKI Jakarta"
 *               country:
 *                 type: string
 *                 maxLength: 100
 *                 example: "Indonesia"
 *               postalCode:
 *                 type: string
 *                 maxLength: 10
 *                 example: "12345"
 *               latitude:
 *                 type: number
 *                 format: float
 *                 example: -6.2088
 *               longitude:
 *                 type: number
 *                 format: float
 *                 example: 106.8456
 *               isActive:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Warehouse created successfully
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
 *                   example: "Warehouse created successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Warehouse"
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
  warehouseController.createWarehouse,
);

/**
 * @swagger
 * /api/v1/warehouses/{warehouseId}:
 *   patch:
 *     summary: Update a warehouse
 *     description: Requires write access to warehouse. Uses dynamic RBAC/ABAC.
 *     tags: [Warehouse]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Warehouse UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               code:
 *                 type: string
 *               address:
 *                 type: string
 *               city:
 *                 type: string
 *               province:
 *                 type: string
 *               country:
 *                 type: string
 *               postalCode:
 *                 type: string
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Warehouse updated successfully
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
 *                   example: "Warehouse updated successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Warehouse"
 *       400:
 *         description: Validation error or invalid UUID
 *       404:
 *         description: Warehouse not found
 */
router.patch(
  "/:warehouseId",
  auth,
  validateUuid("warehouseId"),
  dynamicAccess("warehouse", "write"),
  warehouseController.updateWarehouse,
);

/**
 * @swagger
 * /api/v1/warehouses/{warehouseId}:
 *   delete:
 *     summary: Delete a warehouse (soft delete)
 *     description: Requires write access to warehouse. Performs soft delete.
 *     tags: [Warehouse]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Warehouse UUID
 *     responses:
 *       200:
 *         description: Warehouse deleted successfully
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
 *                   example: "Warehouse deleted successfully"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Warehouse not found
 */
router.delete(
  "/:warehouseId",
  auth,
  validateUuid("warehouseId"),
  dynamicAccess("warehouse", "write"),
  warehouseController.deleteWarehouse,
);

/* ------------------------------------------------------------------ */
/* STORAGE LOCATION ROUTES                                            */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/warehouses/{warehouseId}/locations:
 *   get:
 *     summary: Get storage locations in a warehouse
 *     description: Requires read access to warehouse. Returns all locations within the specified warehouse.
 *     tags: [Warehouse]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: warehouseId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Warehouse UUID
 *     responses:
 *       200:
 *         description: Locations retrieved successfully
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
 *                   example: "Locations retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/Location"
 *       400:
 *         description: Invalid UUID
 */
router.get(
  "/:warehouseId/locations",
  auth,
  validateUuid("warehouseId"),
  dynamicAccess("warehouse", "read"),
  warehouseController.getLocations,
);

/**
 * @swagger
 * /api/v1/warehouses/locations:
 *   post:
 *     summary: Create a new storage location
 *     description: Requires write access to warehouse. Creates a new storage location within a warehouse.
 *     tags: [Warehouse]
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
 *               - code
 *               - name
 *             properties:
 *               warehouseId:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *               code:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *                 example: "A-01-01"
 *               name:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 200
 *                 example: "Aisle A, Rack 1, Shelf 1"
 *               type:
 *                 type: string
 *                 enum: [shelf, rack, aisle, zone, room]
 *                 default: shelf
 *                 example: "shelf"
 *               capacity:
 *                 type: integer
 *                 minimum: 1
 *                 example: 100
 *               isActive:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       201:
 *         description: Location created successfully
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
 *                   example: "Location created successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Location"
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.post(
  "/locations",
  auth,
  dynamicAccess("warehouse", "write"),
  warehouseController.createLocation,
);

/**
 * @swagger
 * /api/v1/warehouses/locations/{locationId}:
 *   patch:
 *     summary: Update a storage location
 *     description: Requires write access to warehouse.
 *     tags: [Warehouse]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Location UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               code:
 *                 type: string
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [shelf, rack, aisle, zone, room]
 *               capacity:
 *                 type: integer
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Location updated successfully
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
 *                   example: "Location updated successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Location"
 *       400:
 *         description: Validation error or invalid UUID
 *       404:
 *         description: Location not found
 */
router.patch(
  "/locations/:locationId",
  auth,
  validateUuid("locationId"),
  dynamicAccess("warehouse", "write"),
  warehouseController.updateLocation,
);

/**
 * @swagger
 * /api/v1/warehouses/locations/{locationId}:
 *   delete:
 *     summary: Delete a storage location (soft delete)
 *     description: Requires write access to warehouse. Performs soft delete.
 *     tags: [Warehouse]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: locationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Location UUID
 *     responses:
 *       200:
 *         description: Location deleted successfully
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
 *                   example: "Location deleted successfully"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Location not found
 */
router.delete(
  "/locations/:locationId",
  auth,
  validateUuid("locationId"),
  dynamicAccess("warehouse", "write"),
  warehouseController.deleteLocation,
);

module.exports = router;
