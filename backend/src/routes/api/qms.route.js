/**
 * @swagger
 * tags:
 *   name: QMS
 *   description: Quality Management System endpoints (CAPA, Non-Conformance)
 */

const express = require("express");
const router = express.Router();
const { auth, denyApiKey } = require("../../middlewares/auth.middleware");
const { validate } = require("../../middlewares/validation.middleware");
const { updateNCSchema, updateCapaSchema } = require("../../validators/qms.validator");
const {
  createNC,
  getNCs,
  updateNC,
  createCapa,
  getCapas,
  updateCapa,
} = require("../../controllers/qms.controller");

router.use(auth);

// Non-Conformance Routes
// Mutations require an interactive user session (denyApiKey): a scoped service
// account must not be able to create/modify quality records (CAPA/NC).
/**
 * @swagger
 * /api/v1/qms/nc:
 *   post:
 *     summary: Create a non-conformance
 *     description: Creates a non-conformance record. Requires authentication. Scoped API keys are rejected (denyApiKey).
 *     tags: [QMS]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, description]
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               severity:
 *                 type: string
 *                 enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *               deviceId:
 *                 type: string
 *                 format: uuid
 *               dateIdentified:
 *                 type: string
 *                 format: date
 *               rootCause:
 *                 type: string
 *     responses:
 *       201:
 *         description: Non-conformance created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/nc", denyApiKey, createNC);
/**
 * @swagger
 * /api/v1/qms/nc:
 *   get:
 *     summary: List non-conformances
 *     description: Returns non-conformance records. Requires authentication.
 *     tags: [QMS]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: List of non-conformances
 *       401:
 *         description: Unauthorized
 */
router.get("/nc", getNCs);
/**
 * @swagger
 * /api/v1/qms/nc/{id}:
 *   patch:
 *     summary: Update a non-conformance
 *     description: Updates a non-conformance record. Requires authentication. Scoped API keys are rejected (denyApiKey).
 *     tags: [QMS]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Non-conformance ID
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
 *               status:
 *                 type: string
 *               severity:
 *                 type: string
 *                 enum: [LOW, MEDIUM, HIGH, CRITICAL]
 *               rootCause:
 *                 type: string
 *     responses:
 *       200:
 *         description: Non-conformance updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Non-conformance not found
 */
router.patch("/nc/:id", denyApiKey, validate(updateNCSchema), updateNC);

// CAPA Routes
/**
 * @swagger
 * /api/v1/qms/capa:
 *   post:
 *     summary: Create a CAPA
 *     description: Creates a corrective/preventive action record. Requires authentication. Scoped API keys are rejected (denyApiKey).
 *     tags: [QMS]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ncId, title, actionPlan]
 *             properties:
 *               ncId:
 *                 type: string
 *                 format: uuid
 *               title:
 *                 type: string
 *               actionPlan:
 *                 type: string
 *               status:
 *                 type: string
 *               assignedTo:
 *                 type: string
 *                 format: uuid
 *               dueDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: CAPA created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/capa", denyApiKey, createCapa);
/**
 * @swagger
 * /api/v1/qms/capa:
 *   get:
 *     summary: List CAPAs
 *     description: Returns corrective/preventive action records. Requires authentication.
 *     tags: [QMS]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: List of CAPAs
 *       401:
 *         description: Unauthorized
 */
router.get("/capa", getCapas);
/**
 * @swagger
 * /api/v1/qms/capa/{id}:
 *   patch:
 *     summary: Update a CAPA
 *     description: Updates a corrective/preventive action record. Requires authentication. Scoped API keys are rejected (denyApiKey).
 *     tags: [QMS]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: CAPA ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               actionPlan:
 *                 type: string
 *               status:
 *                 type: string
 *               assignedTo:
 *                 type: string
 *                 format: uuid
 *               dueDate:
 *                 type: string
 *                 format: date
 *               completedDate:
 *                 type: string
 *                 format: date
 *               approvedBy:
 *                 type: string
 *                 format: uuid
 *               verificationNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: CAPA updated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: CAPA not found
 */
router.patch("/capa/:id", denyApiKey, validate(updateCapaSchema), updateCapa);

module.exports = router;
