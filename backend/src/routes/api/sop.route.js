/**
 * @swagger
 * tags:
 *   name: SOP
 *   description: Document Control and Training System
 */

const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const {
  createDocument,
  getDocuments,
  publishDocument,
  acknowledgeTraining,
} = require("../../controllers/sop.controller");

router.use(auth);

// Document Routes
/**
 * @swagger
 * /api/v1/sop:
 *   post:
 *     summary: Create an SOP document
 *     description: Creates a standard operating procedure document. Requires authentication.
 *     tags: [SOP]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title]
 *             properties:
 *               documentNumber:
 *                 type: string
 *               title:
 *                 type: string
 *               version:
 *                 type: string
 *               contentUrl:
 *                 type: string
 *               requiresTraining:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: SOP document created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post("/", createDocument);
/**
 * @swagger
 * /api/v1/sop:
 *   get:
 *     summary: List SOP documents
 *     description: Returns standard operating procedure documents. Requires authentication.
 *     tags: [SOP]
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
 *         description: List of SOP documents
 *       401:
 *         description: Unauthorized
 */
router.get("/", getDocuments);
/**
 * @swagger
 * /api/v1/sop/{id}/publish:
 *   patch:
 *     summary: Publish an SOP and assign training
 *     description: Publishes a standard operating procedure and assigns training. Requires authentication.
 *     tags: [SOP]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: SOP document ID
 *     responses:
 *       200:
 *         description: SOP published
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: SOP document not found
 */
router.patch("/:id/publish", publishDocument);

// Training Routes
/**
 * @swagger
 * /api/v1/sop/{id}/acknowledge:
 *   post:
 *     summary: Acknowledge SOP training
 *     description: Records acknowledgement of SOP training for the authenticated user. Requires authentication.
 *     tags: [SOP]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: SOP document ID
 *     responses:
 *       200:
 *         description: Training acknowledged
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: SOP document not found
 */
router.post("/:id/acknowledge", acknowledgeTraining);

module.exports = router;
