// src/routes/api/calibrationRecords.js
const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const calibrationRecordsController = require("../../controllers/calibrationRecords.controller");

/* ------------------------------------------------------------------ */
/* CALIBRATION RECORDS ROUTES                                         */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/calibration-records:
 *   get:
 *     summary: Get all calibration records
 *     description: Requires read access to calibration.
 *     tags: [CalibrationRecords]
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
 *       - in: query
 *         name: deviceId
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Calibration records retrieved successfully
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
 *                   example: "Calibration records retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/CalibrationRecord"
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  auth,
  dynamicAccess("calibration", "read"),
  calibrationRecordsController.getAllCalibrationRecords,
);

/**
 * @swagger
 * /api/v1/calibration-records:
 *   post:
 *     summary: Create a new calibration record
 *     description: Requires write access to calibration.
 *     tags: [CalibrationRecords]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deviceId
 *             properties:
 *               deviceId:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *               calibrator:
 *                 type: string
 *                 example: "John Doe"
 *               calibrationDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-15"
 *               dueDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-12-15"
 *               status:
 *                 type: string
 *                 enum: [pending, completed, failed, overdue]
 *                 example: "completed"
 *               results:
 *                 type: string
 *                 example: "All parameters within tolerance"
 *               nextCalibrationDate:
 *                 type: string
 *                 format: date
 *                 example: "2026-12-15"
 *     responses:
 *       201:
 *         description: Calibration record created successfully
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
 *                   example: "Calibration record created successfully"
 *                 data:
 *                   $ref: "#/components/schemas/CalibrationRecord"
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
  calibrationRecordsController.createCalibrationRecord,
);

/**
 * @swagger
 * /api/v1/calibration-records/{calibrationRecordId}:
 *   get:
 *     summary: Get specific calibration record by ID
 *     description: Requires read access to calibration.
 *     tags: [CalibrationRecords]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: calibrationRecordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Calibration Record UUID
 *     responses:
 *       200:
 *         description: Calibration record retrieved successfully
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
 *                   example: "Calibration record retrieved successfully"
 *                 data:
 *                   $ref: "#/components/schemas/CalibrationRecord"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Calibration record not found
 */
router.get(
  "/:calibrationRecordId",
  auth,
  validateUuid("calibrationRecordId"),
  dynamicAccess("calibration", "read"),
  calibrationRecordsController.getSpecificCalibrationRecord,
);

/**
 * @swagger
 * /api/v1/calibration-records/{calibrationRecordId}:
 *   put:
 *     summary: Update a calibration record
 *     description: Requires write access to calibration.
 *     tags: [CalibrationRecords]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: calibrationRecordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Calibration Record UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               calibrator:
 *                 type: string
 *               calibrationDate:
 *                 type: string
 *                 format: date
 *               dueDate:
 *                 type: string
 *                 format: date
 *               status:
 *                 type: string
 *                 enum: [pending, completed, failed, overdue]
 *               results:
 *                 type: string
 *               nextCalibrationDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Calibration record updated successfully
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
 *                   example: "Calibration record updated successfully"
 *                 data:
 *                   $ref: "#/components/schemas/CalibrationRecord"
 *       400:
 *         description: Validation error or invalid UUID
 *       404:
 *         description: Calibration record not found
 */
router.put(
  "/:calibrationRecordId",
  auth,
  validateUuid("calibrationRecordId"),
  dynamicAccess("calibration", "write"),
  calibrationRecordsController.updateCalibrationRecord,
);

/**
 * @swagger
 * /api/v1/calibration-records/{calibrationRecordId}:
 *   delete:
 *     summary: Delete a calibration record
 *     description: Requires write access to calibration.
 *     tags: [CalibrationRecords]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: calibrationRecordId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Calibration Record UUID
 *     responses:
 *       200:
 *         description: Calibration record deleted successfully
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
 *                   example: "Calibration record deleted successfully"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Calibration record not found
 */
router.delete(
  "/:calibrationRecordId",
  auth,
  validateUuid("calibrationRecordId"),
  dynamicAccess("calibration", "write"),
  calibrationRecordsController.deleteCalibrationRecord,
);

module.exports = router;
