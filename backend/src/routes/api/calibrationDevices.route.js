// src/routes/api/calibrationDevices.js
const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { upload } = require("../../utils/upload.util");
const calibrationDevicesController = require("../../controllers/calibrationDevices.controller");

/* ------------------------------------------------------------------ */
/* CALIBRATION DEVICES ROUTES                                         */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/calibration-devices:
 *   get:
 *     summary: Get all calibration devices
 *     description: Requires read access to calibration.
 *     tags: [CalibrationDevices]
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
 *         description: Calibration devices retrieved successfully
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
 *                   example: "Calibration devices retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/CalibrationDevice"
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  auth,
  dynamicAccess("calibration", "read"),
  calibrationDevicesController.getAllCalibrationDevices,
);

/**
 * @swagger
 * /api/v1/calibration-devices:
 *   post:
 *     summary: Create a new calibration device
 *     description: Requires write access to calibration.
 *     tags: [CalibrationDevices]
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
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Digital Multimeter"
 *               model:
 *                 type: string
 *                 example: "DM-100"
 *               manufacturer:
 *                 type: string
 *                 example: "Fluke"
 *               serialNumber:
 *                 type: string
 *                 example: "SN123456"
 *               status:
 *                 type: string
 *                 enum: [available, in_use, maintenance, retired]
 *                 example: "available"
 *               lastCalibrationDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-01-15"
 *               nextCalibrationDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-07-15"
 *     responses:
 *       201:
 *         description: Calibration device created successfully
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
 *                   example: "Calibration device created successfully"
 *                 data:
 *                   $ref: "#/components/schemas/CalibrationDevice"
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
  dynamicAccess("calibration", "write"),
  calibrationDevicesController.createCalibrationDevice,
);

/**
 * @swagger
 * /api/v1/calibration-devices/{calibrationDeviceId}:
 *   get:
 *     summary: Get specific calibration device by ID
 *     description: Requires read access to calibration.
 *     tags: [CalibrationDevices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: calibrationDeviceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Calibration Device UUID
 *     responses:
 *       200:
 *         description: Calibration device retrieved successfully
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
 *                   example: "Calibration device retrieved successfully"
 *                 data:
 *                   $ref: "#/components/schemas/CalibrationDevice"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Calibration device not found
 */
router.get(
  "/:calibrationDeviceId",
  auth,
  validateUuid("calibrationDeviceId"),
  dynamicAccess("calibration", "read"),
  calibrationDevicesController.getSpecificCalibrationDevice,
);

/**
 * @swagger
 * /api/v1/calibration-devices/{calibrationDeviceId}:
 *   put:
 *     summary: Update a calibration device
 *     description: Requires write access to calibration.
 *     tags: [CalibrationDevices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: calibrationDeviceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Calibration Device UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               model:
 *                 type: string
 *               manufacturer:
 *                 type: string
 *               serialNumber:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [available, in_use, maintenance, retired]
 *               lastCalibrationDate:
 *                 type: string
 *                 format: date
 *               nextCalibrationDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Calibration device updated successfully
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
 *                   example: "Calibration device updated successfully"
 *                 data:
 *                   $ref: "#/components/schemas/CalibrationDevice"
 *       400:
 *         description: Validation error or invalid UUID
 *       404:
 *         description: Calibration device not found
 */
router.put(
  "/:calibrationDeviceId",
  auth,
  validateUuid("calibrationDeviceId"),
  dynamicAccess("calibration", "write"),
  calibrationDevicesController.updateCalibrationDevice,
);

/**
 * @swagger
 * /api/v1/calibration-devices/{calibrationDeviceId}:
 *   delete:
 *     summary: Delete a calibration device
 *     description: Requires write access to calibration.
 *     tags: [CalibrationDevices]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: calibrationDeviceId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Calibration Device UUID
 *     responses:
 *       200:
 *         description: Calibration device deleted successfully
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
 *                   example: "Calibration device deleted successfully"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Calibration device not found
 */
router.delete(
  "/:calibrationDeviceId",
  auth,
  validateUuid("calibrationDeviceId"),
  dynamicAccess("calibration", "write"),
  calibrationDevicesController.deleteCalibrationDevice,
);

/**
 * @swagger
 * /api/v1/calibration-devices/bulk-import:
 *   post:
 *     summary: Bulk import calibration devices via CSV file
 *     description: Requires write access to calibration. Accepts a file field containing the CSV.
 *     tags: [CalibrationDevices]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: CSV import completed (success/failure report)
 *       400:
 *         description: Missing file or parsing error
 */
router.post(
  "/bulk-import",
  auth,
  dynamicAccess("calibration", "write"),
  upload({
    folder: "imports",
    allowedMimes: ["text/csv"],
    allowedExtensions: [".csv"],
  }),
  calibrationDevicesController.bulkImportCalibrationDevices,
);

module.exports = router;
