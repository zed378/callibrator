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
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { denyPlatformAuthoring } = require("../../middlewares/denyPlatformAuthoring.middleware"); // A-145, ADR-051 Q-17
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
//
// A-145 (ADR-051 Q-17, ADR-052) — publishing and acknowledging are Part 11
// authoring acts and carry denyPlatformAuthoring:
//  - publishing releases a controlled procedure under ISO 13485 §4.2.4 document
//    control; the audit row names the publisher as the approver, and
//    separation of duties compares that person with the author. A platform
//    operator impersonating a member would release it in the member's name.
//  - acknowledging training writes the member's ISO 13485 §6.2 training
//    record: it attests that THIS person read THIS revision. Nobody may
//    attest that for someone else — under impersonation the record would name
//    the member while an operator clicked.
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
 *         description: >-
 *           Insufficient permission, an API key, or a platform operator
 *           (impersonating, or acting in another tenant — A-145, ADR-051 Q-17)
 *       404:
 *         description: SOP document not found (including another tenant's)
 *       409:
 *         description: >-
 *           Separation of duties — the caller authored this SOP, or the SOP is
 *           already published or archived
 */
// Releasing a controlled procedure is a human act (21 CFR 11.10(d)), so no
// API key may perform it, and the publisher may not be the author.
router.patch(
  "/:id/publish",
  validateUuid("id"),
  denyApiKey,
  dynamicAccess(MENU_SLUGS.SOP, "write"),
  denyPlatformAuthoring,
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
 *       403:
 *         description: >
 *           A training record attests the caller's own reading — refused to an
 *           API key and to a platform operator (impersonating, or acting in
 *           another tenant) (A-145, ADR-051 Q-17)
 *       404:
 *         description: No training assigned to the caller for this SOP (including another tenant's SOP)
 *       409:
 *         description: The caller already acknowledged this SOP — the recorded acknowledgement is not overwritten
 */
router.post("/:id/acknowledge", validateUuid("id"), denyApiKey, denyPlatformAuthoring, acknowledgeTraining);

module.exports = router;
