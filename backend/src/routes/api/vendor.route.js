const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const vendorValidator = require("../../validators/vendor.validator");
const vendorController = require("../../controllers/vendor.controller");

/**
 * @swagger
 * /api/v1/vendors:
 *   get:
 *     summary: Get all vendors
 *     description: Retrieves all vendors for the current tenant. Requires read access to the Vendors resource.
 *     tags: [Vendors]
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
 *           enum: [Active, Inactive]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [CalibrationLab, PartsSupplier, Other]
 *     responses:
 *       200:
 *         description: Vendors retrieved successfully
 */
router.get(
  "/",
  auth,
  dynamicAccess("Vendors", "read", { checkTenant: true }),
  vendorController.fetchVendors
);

/**
 * @swagger
 * /api/v1/vendors/{vendorId}:
 *   get:
 *     summary: Get specific vendor
 *     description: Retrieves a specific vendor by ID. Requires read access to the Vendors resource.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Vendor retrieved successfully
 *       404:
 *         description: Vendor not found
 */
router.get(
  "/:vendorId",
  auth,
  validateUuid("vendorId"),
  dynamicAccess("Vendors", "read", { checkTenant: true }),
  vendorController.getVendorById
);

/**
 * @swagger
 * /api/v1/vendors:
 *   post:
 *     summary: Create a new vendor
 *     description: Creates a new vendor. Requires create access to the Vendors resource.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [CalibrationLab, PartsSupplier, Other]
 *               contactPerson:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               rating:
 *                 type: number
 *               status:
 *                 type: string
 *                 enum: [Active, Inactive]
 *     responses:
 *       201:
 *         description: Vendor created successfully
 */
router.post(
  "/",
  auth,
  dynamicAccess("Vendors", "create", { checkTenant: true }),
  validate(vendorValidator.createVendor),
  vendorController.createVendor
);

/**
 * @swagger
 * /api/v1/vendors/{vendorId}:
 *   patch:
 *     summary: Update an existing vendor
 *     description: Updates an existing vendor. Requires update access to the Vendors resource.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vendorId
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
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [CalibrationLab, PartsSupplier, Other]
 *               contactPerson:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               rating:
 *                 type: number
 *               status:
 *                 type: string
 *                 enum: [Active, Inactive]
 *     responses:
 *       200:
 *         description: Vendor updated successfully
 *       404:
 *         description: Vendor not found
 */
router.patch(
  "/:vendorId",
  auth,
  validateUuid("vendorId"),
  dynamicAccess("Vendors", "update", { checkTenant: true }),
  validate(vendorValidator.updateVendor),
  vendorController.updateVendor
);

/**
 * @swagger
 * /api/v1/vendors/{vendorId}:
 *   delete:
 *     summary: Delete a vendor
 *     description: Deletes an existing vendor. Requires delete access to the Vendors resource.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Vendor deleted successfully
 *       404:
 *         description: Vendor not found
 */
router.delete(
  "/:vendorId",
  auth,
  validateUuid("vendorId"),
  dynamicAccess("Vendors", "delete", { checkTenant: true }),
  vendorController.deleteVendor
);

/**
 * @swagger
 * /api/v1/vendors/{vendorId}/qualify:
 *   patch:
 *     summary: Qualify a vendor
 *     description: Update a vendor's qualification status.
 *     tags: [Vendors]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: vendorId
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
 *               approvalStatus:
 *                 type: string
 *               scorecard:
 *                 type: integer
 *               lastAuditDate:
 *                 type: string
 *                 format: date
 *               nextAuditDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Vendor qualification updated
 */
router.patch(
  "/:vendorId/qualify",
  auth,
  dynamicAccess("Vendors", "update"),
  validateUuid("vendorId"),
  vendorController.qualifyVendor
);
module.exports = router;
