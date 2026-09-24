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
 *     summary: Export the caller's personal data
 *     description: >-
 *       Builds an archive of the authenticated user's own personal data (GDPR
 *       Article 20, data portability). Takes no request body — any body sent is
 *       ignored. Acts on the caller only. P6-08: aligned with the controller.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Export built
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         exportId: { type: string }
 *                         downloadUrl: { type: string }
 *                         expiresAt: { type: string, format: date-time }
 *                         fileSize: { type: integer }
 *       400:
 *         description: Data export is disabled for this deployment
 *       401:
 *         description: Unauthorized
 */
router.post("/export", auth, exportUserData);

/**
 * @swagger
 * /api/v1/gdpr/erasure:
 *   post:
 *     summary: Request erasure of the caller's personal data
 *     description: >-
 *       Records an erasure request (GDPR Article 17, CCPA 1798.105) for the
 *       compliance team to action. Validated by `gdpr.validator#requestErasure`:
 *       `reason` and `confirm: true` are both required; unknown fields are
 *       stripped. P6-08: this previously documented `confirmDeletion`, which the
 *       validator strips, so a client written from the spec always got 400.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason, confirm]
 *             properties:
 *               reason:
 *                 type: string
 *                 maxLength: 500
 *                 description: Why erasure is requested
 *               confirm:
 *                 type: boolean
 *                 enum: [true]
 *                 description: Must be `true` — the caller confirms the data will be erased
 *     responses:
 *       201:
 *         description: Erasure request recorded
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         dsarId:
 *                           type: string
 *                           format: uuid
 *                           description: "The id to poll at GET /gdpr/erasure/{requestId}"
 *       400:
 *         description: Validation failed (missing `reason`, or `confirm` not `true`)
 *       401:
 *         description: Unauthorized
 */
router.post("/erasure", auth, validate(erasureValidator), requestErasure);

/**
 * @swagger
 * /api/v1/gdpr/erasure/{requestId}:
 *   get:
 *     summary: Get the status of an erasure request
 *     description: >-
 *       The data subject reads their own request; a holder of `gdpr` read (the
 *       tenant's privacy officer) reads any request in the tenant. An unknown
 *       id, another tenant's, and another member's all answer the same 404
 *       (A-252).
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
 *         description: The request
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         id: { type: string, format: uuid }
 *                         userId: { type: string, format: uuid }
 *                         type: { type: string, enum: [export, erasure, rectification, restriction] }
 *                         status: { type: string, enum: [pending, in_progress, completed, rejected] }
 *                         details: { type: object }
 *                         requestedAt: { type: string, format: date-time }
 *                         completedAt: { type: string, format: date-time, nullable: true }
 *       400:
 *         description: requestId is not a UUID
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Erasure request not found
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
 *     summary: Grant or withdraw consent for processing categories
 *     description: >-
 *       GDPR Article 7. Validated by `gdpr.validator#updateConsent`: `categories`
 *       (from a fixed list) and `consent` are both required. P6-08: this
 *       previously documented `consents` / `withdrawAll`, neither of which the
 *       validator accepts.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [categories, consent]
 *             properties:
 *               categories:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [analytics, marketing, functional, necessary]
 *               consent:
 *                 type: boolean
 *                 description: true grants, false withdraws, for every listed category
 *     responses:
 *       200:
 *         description: Consent recorded
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         updated: { type: integer }
 *                         consent: { type: boolean }
 *                         categories: { type: array, items: { type: string } }
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Unauthorized
 */
router.put("/consent", auth, validate(consentValidator), updateConsent);

/**
 * @swagger
 * /api/v1/gdpr/consent/history:
 *   get:
 *     summary: Get the caller's consent history
 *     description: The caller's consent records, newest first.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Consent history (rows in `data`)
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id: { type: string, format: uuid }
 *                           purpose: { type: string }
 *                           version: { type: string }
 *                           status: { type: string, enum: [granted, withdrawn] }
 *                           consentedAt: { type: string, format: date-time }
 *       401:
 *         description: Unauthorized
 */
router.get("/consent/history", auth, getConsentHistory);

/**
 * @swagger
 * /api/v1/gdpr/processing:
 *   get:
 *     summary: Get the processing register as it applies to the caller
 *     description: GDPR Article 30 records of processing, for the caller as data subject.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Processing activities
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         controller: { type: string }
 *                         tenantId: { type: string, format: uuid }
 *                         subjectId: { type: string, format: uuid }
 *                         generatedAt: { type: string, format: date-time }
 *                         activities:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               purpose: { type: string }
 *                               legalBasis: { type: string }
 *                               dataCategories: { type: array, items: { type: string } }
 *                               retention: { type: string }
 *       401:
 *         description: Unauthorized
 */
router.get("/processing", auth, getProcessingActivities);

/**
 * @swagger
 * /api/v1/gdpr/rectify:
 *   put:
 *     summary: Correct one field of the caller's personal data
 *     description: >-
 *       GDPR Article 16. Validated by `gdpr.validator#rectifyData`: one `field`
 *       and its new `value`, both required. The service accepts only
 *       firstName, lastName, phone and email; an email change is confirmed by
 *       mail before it applies. P6-08: this previously documented
 *       `corrections` / `justification`, which the validator strips.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [field, value]
 *             properties:
 *               field:
 *                 type: string
 *                 maxLength: 100
 *                 enum: [firstName, lastName, phone, email]
 *               value:
 *                 description: The corrected value
 *     responses:
 *       200:
 *         description: Rectified (or, for email, verification sent)
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         rectified: { type: boolean }
 *                         field: { type: string }
 *                         emailVerificationRequired: { type: boolean }
 *       400:
 *         description: Validation failed, or the field cannot be rectified
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: The new email address is already in use
 */
router.put("/rectify", auth, validate(rectifyValidator), rectifyData);

/**
 * @swagger
 * /api/v1/gdpr/restrict:
 *   post:
 *     summary: Restrict processing of the caller's personal data
 *     description: >-
 *       GDPR Article 18. Validated by `gdpr.validator#restrictProcessing`:
 *       `reason` only. P6-08: this previously documented a `scope` array the
 *       validator strips — restriction applies to the whole account.
 *     tags: [GDPR/CCPA]
 *     security:
 *       - bearerAuth: []
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
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Restriction recorded
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         restricted: { type: boolean }
 *                         requestId: { type: string, format: uuid }
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Unauthorized
 */
router.post("/restrict", auth, validate(restrictValidator), restrictProcessing);

module.exports = router;
