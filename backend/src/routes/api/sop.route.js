/**
 * @swagger
 * tags:
 *   name: SOP
 *   description: Document Control and Training System
 */

const express = require("express");
const router = express.Router();
const { auth, denyApiKey } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants");
const {
  createDocument,
  getDocuments,
  publishDocument,
  acknowledgeTraining,
} = require("../../controllers/sop.controller");

// A-28 — authorization.
//
// Until 2026-09-23 every route here carried `auth` alone, so any role could
// author AND publish a controlled procedure with no review at all.
//
// Authoring and publishing are now gated on `sop` (MENU_SLUGS.SOP): write is
// held by SUPERADMIN, HEALTHCARE ADMIN and CALIBRATOR ADMIN; ENGINEERING
// MANAGER holds read. Publishing additionally requires a signer distinct from
// the author — separation of duties, enforced in sop.service#publishDocument
// and refused with a 409 state explanation, not a generic error.
//
// POST /:id/acknowledge is deliberately left on `auth`: acknowledging training
// is a self-service act on the caller's OWN acknowledgment row (the service
// filters by req.user.id), and the roles that must acknowledge an SOP —
// technicians, warehouse, room users — hold no `sop` menu at all. Gating it
// would make assigned training impossible to complete.
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
router.post("/", dynamicAccess(MENU_SLUGS.SOP, "write"), createDocument);
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
router.get("/", dynamicAccess(MENU_SLUGS.SOP, "read"), getDocuments);
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
 *       403:
 *         description: Insufficient permission
 *       404:
 *         description: SOP document not found
 *       409:
 *         description: >-
 *           Separation of duties — the caller authored this SOP, or the SOP is
 *           already published or archived
 */
// Releasing a controlled procedure is a human act (21 CFR 11.10(d)), so no
// API key may perform it, and the publisher may not be the author.
router.patch(
  "/:id/publish",
  denyApiKey,
  dynamicAccess(MENU_SLUGS.SOP, "write"),
  publishDocument,
);

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
