// src/routes/api/calibrationRecords.js
const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { denyPlatformAuthoring } = require("../../middlewares/denyPlatformAuthoring.middleware"); // A-127, ADR-051 Q-17
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
 *       - in: query
 *         name: includeSuperseded
 *         description: Include records a correction has superseded (default false — the list shows the record in force)
 *         schema:
 *           type: boolean
 *           default: false
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
  denyPlatformAuthoring,
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

/*
 * P6-03 (PR-2, BR-7) — there is NO `PUT` and NO `DELETE` here. A calibration
 * record is append-only: the database trigger from migration 0057 refuses a
 * content change or a delete for every role, and the application role has
 * no UPDATE/DELETE on the table beyond the lifecycle columns. The two routes
 * below replace them; both require a reason and write audit rows inside the
 * transaction.
 */

/**
 * @swagger
 * /api/v1/calibration-records/{calibrationRecordId}/corrections:
 *   post:
 *     summary: Correct a calibration record (writes a superseding record)
 *     description: |
 *       Requires write access to calibration. The original record is never
 *       changed: a NEW record is written with the corrected content (fields
 *       omitted here are carried over from the original), `supersedesId` set to
 *       the original and the reason recorded. The original is marked as
 *       superseded. A record can be corrected once; correct the latest
 *       correction to correct again.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 2000
 *                 description: Why the original is wrong. Blank is refused.
 *               deviceId:
 *                 type: string
 *                 format: uuid
 *               calibrationDate:
 *                 type: string
 *                 format: date-time
 *               dueDate:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *               standard:
 *                 type: string
 *               results:
 *                 type: object
 *               measurementUncertainty:
 *                 type: number
 *               isCompliant:
 *                 type: boolean
 *               certificateNumber:
 *                 type: string
 *               certificateFileUrl:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: The superseding record
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: "#/components/schemas/CalibrationRecord"
 *       400:
 *         description: Validation error (including a missing or blank reason)
 *       404:
 *         description: Calibration record not found (including another tenant's)
 *       409:
 *         description: The record was voided, or already corrected
 */
router.post(
  "/:calibrationRecordId/corrections",
  auth,
  validateUuid("calibrationRecordId"),
  dynamicAccess("calibration", "write"),
  denyPlatformAuthoring,
  calibrationRecordsController.correctCalibrationRecord,
);

/**
 * @swagger
 * /api/v1/calibration-records/{calibrationRecordId}/void:
 *   post:
 *     summary: Void a calibration record entered in error
 *     description: |
 *       Requires write access to calibration. The record is kept and hidden from
 *       ordinary reads, with the reason and who voided it. A void is final —
 *       there is no restore.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 2000
 *     responses:
 *       200:
 *         description: Calibration record voided
 *       400:
 *         description: Validation error (including a missing or blank reason)
 *       404:
 *         description: Calibration record not found (including another tenant's)
 *       409:
 *         description: The record was already voided, or has been corrected
 */
router.post(
  "/:calibrationRecordId/void",
  auth,
  validateUuid("calibrationRecordId"),
  dynamicAccess("calibration", "write"),
  denyPlatformAuthoring,
  calibrationRecordsController.voidCalibrationRecord,
);

module.exports = router;
