/**
 * GDPR/CCPA Compliance Routes
 *
 * Routes for data subject requests and privacy compliance.
 * Mounted at /api/v1/gdpr
 */

const express = require("express");
const router = express.Router();

const { auth } = require("../../middlewares/auth.middleware");
const {
  exportUserData,
  requestErasure,
  getErasureStatus,
  updateConsent,
  getConsentHistory,
  getProcessingActivities,
  rectifyData,
  restrictProcessing,
} = require("../../controllers/gdpr.controller");
const {
  requestErasure: erasureValidator,
  updateConsent: consentValidator,
  rectifyData: rectifyValidator,
  restrictProcessing: restrictValidator,
} = require("../../validators/gdpr.validator");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
// These are Joi SCHEMAS. They were passed as `schema.validate`, i.e. Joi's own
// (value, options) method, which express called as (req, res, next) — it threw
// and 500'd every write route. `validate(schema)` is the router-facing factory.
const { validate } = require("../../middlewares/validation.middleware");

/**
 * @swagger
 * /api/v1/gdpr/export:
 *   post:
 *     summary: Export user data
 *     description: Initiates a data export request for the authenticated user's personal data. Complies with GDPR Article 20 (Data Portability). Requires authentication.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               format:
 *                 type: string
 *                 enum: [json, csv, xml]
 *                 default: json
 *     responses:
 *       200:
 *         description: Data export request processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requestId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [processing, completed]
 *                 downloadUrl:
 *                   type: string
 *       401:
 *         description: Unauthorized
 */
router.post("/export", auth, exportUserData);

/**
 * @swagger
 * /api/v1/gdpr/erasure:
 *   post:
 *     summary: Request data erasure
 *     description: Submits a request to erase all personal data for the authenticated user. Complies with GDPR Article 17 (Right to Erasure) and CCPA Section 1798.105. Requires authentication.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for erasure request
 *               confirmDeletion:
 *                 type: boolean
 *                 description: Confirmation that user understands data will be permanently deleted
 *     responses:
 *       201:
 *         description: Erasure request submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requestId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [pending, in_progress, completed]
 *       401:
 *         description: Unauthorized
 */
router.post("/erasure", auth, validate(erasureValidator), requestErasure);

/**
 * @swagger
 * /api/v1/gdpr/erasure/{requestId}:
 *   get:
 *     summary: Get erasure request status
 *     description: Retrieves the current status of a data erasure request. Requires authentication.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: requestId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Erasure request status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requestId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [pending, in_progress, completed, failed]
 *                 submittedAt:
 *                   type: string
 *                   format: date-time
 *                 completedAt:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Erasure request not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/erasure/:requestId",
  auth,
  validateUuid("requestId"),
  getErasureStatus,
);

/**
 * @swagger
 * /api/v1/gdpr/consent:
 *   put:
 *     summary: Update consent preferences
 *     description: Updates the user's consent preferences for various data processing activities. Complies with GDPR Article 7 (Conditions for Consent). Requires authentication.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - consents
 *             properties:
 *               consents:
 *                 type: object
 *                 description: Key-value pairs of consent identifiers and their status
 *               withdrawAll:
 *                 type: boolean
 *                 description: If true, withdraws all consents
 *     responses:
 *       200:
 *         description: Consent preferences updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 consents:
 *                   type: object
 *                 updatedAt:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Unauthorized
 */
router.put("/consent", auth, validate(consentValidator), updateConsent);

/**
 * @swagger
 * /api/v1/gdpr/consent/history:
 *   get:
 *     summary: Get consent history
 *     description: Retrieves the complete consent history for the authenticated user. Complies with GDPR accountability principle. Requires authentication.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Consent history retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 history:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       consentId:
 *                         type: string
 *                       version:
 *                         type: string
 *                       action:
 *                         type: string
 *                         enum: [granted, withdrawn, updated]
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *       401:
 *         description: Unauthorized
 */
router.get("/consent/history", auth, getConsentHistory);

/**
 * @swagger
 * /api/v1/gdpr/processing:
 *   get:
 *     summary: Get processing activities
 *     description: Retrieves the list of personal data processing activities for the tenant. Required under GDPR Article 30 (Records of Processing Activities). Requires authentication.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Processing activities retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 activities:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       purpose:
 *                         type: string
 *                       legalBasis:
 *                         type: string
 *                         enum: [consent, contract, legal_obligation, vital_interests, public_task, legitimate_interests]
 *                       dataCategories:
 *                         type: array
 *                       recipients:
 *                         type: array
 *       401:
 *         description: Unauthorized
 */
router.get("/processing", auth, getProcessingActivities);

/**
 * @swagger
 * /api/v1/gdpr/rectify:
 *   put:
 *     summary: Rectify personal data
 *     description: Submits a request to correct or rectify inaccurate personal data. Complies with GDPR Article 16 (Right to Rectification). Requires authentication.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - corrections
 *             properties:
 *               corrections:
 *                 type: object
 *                 description: Key-value pairs of data fields and their corrected values
 *               justification:
 *                 type: string
 *                 description: Justification for the correction
 *     responses:
 *       200:
 *         description: Data rectification request submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requestId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [pending, in_progress, completed]
 *       401:
 *         description: Unauthorized
 */
router.put("/rectify", auth, validate(rectifyValidator), rectifyData);

/**
 * @swagger
 * /api/v1/gdpr/restrict:
 *   post:
 *     summary: Restrict data processing
 *     description: Submits a request to restrict the processing of personal data. Complies with GDPR Article 18 (Right to Restriction of Processing). Requires authentication.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for restriction request
 *               scope:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Specific data categories to restrict
 *     responses:
 *       201:
 *         description: Processing restriction request submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 requestId:
 *                   type: string
 *                   format: uuid
 *                 status:
 *                   type: string
 *                   enum: [pending, in_progress, completed]
 *       401:
 *         description: Unauthorized
 */
router.post("/restrict", auth, validate(restrictValidator), restrictProcessing);

module.exports = router;
