// src/routes/api/certificates.js
const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { denyPlatformAuthoring } = require("../../middlewares/denyPlatformAuthoring.middleware"); // A-127, ADR-051 Q-17
const certificateController = require("../../controllers/certificate.controller");
const certificatePdfController = require("../../controllers/certificatePdf.controller");
const { validate } = require("../../middlewares/validation.middleware");
const { approveCertificateSchema } = require("../../validators/certificate.validator");
const { requestBudget } = require("../../middlewares/requestBudget.middleware");

// A-293 (ADR-100): the public verification routes count EVERY request per
// client address against `certificateVerifyToken` (300 / 15 min), before the
// lookup. The verification controller then counts every answer that is not the
// full verdict (no token, a wrong token, an unknown number) against the tighter
// `certificateVerify` (60 / 15 min) — a wrong token cannot be told from no
// token before the lookup, and must not buy the looser budget.
const verifyBudget = requestBudget("certificateVerifyToken");

/* ------------------------------------------------------------------ */
/* CERTIFICATE ROUTES                                                 */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/certificates/verify/{certificateNumber}:
 *   get:
 *     summary: Publicly verify a certificate's authenticity (no auth)
 *     description: >-
 *       Public endpoint (the target of the certificate QR code). Always returns
 *       whether the certificate is found and valid (signed, not revoked, not
 *       expired, not withdrawn). A-293 (ADR-100): certificate numbers are
 *       sequential, so the number alone unlocks only the MINIMAL verdict
 *       (`disclosure: "minimal"` — found, valid, status, revoked, expired,
 *       withdrawn, certificateNumber, type, issuedTo, issueDate, validUntil and
 *       the integrity hashes). With `token` equal to the certificate's
 *       verification token — which its QR code carries — the FULL verdict
 *       (`disclosure: "full"`): also device, signer, the published document,
 *       its verifyUrl and, for a PDF stored before M-11, a short-lived
 *       `documentUrl`. A wrong token answers exactly like no token. A QR code
 *       printed before tokens existed resolves here to the minimal verdict,
 *       with no redirect. An unknown number answers `{ found: false, valid:
 *       false, message }`. Per client address, every request counts against a
 *       budget of 300 per 15 minutes, and every answer that is not the full
 *       verdict also against 60 per 15 minutes; beyond either, 429 with
 *       Retry-After.
 *     tags: [Certificates]
 *     parameters:
 *       - in: path
 *         name: certificateNumber
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: token
 *         required: false
 *         description: The certificate's verification token (32 base64url characters), from its QR code.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Verification result — the full verdict with a matching token, the minimal one otherwise
 *       429:
 *         description: Request budget exhausted for this address (Retry-After header)
 */
// PUBLIC — registered before the parametric `/:certificateId` routes.
router.get("/verify/:certificateNumber", verifyBudget, certificatePdfController.verifyCertificate);

/**
 * @swagger
 * /api/v1/certificates/verify/{certificateNumber}/document:
 *   get:
 *     summary: The PDF of a signed certificate, via the verification capability (no auth)
 *     description: >-
 *       ADR-042 step 4. `token` is minted by the verification endpoint (its
 *       `documentUrl`) for a signed certificate only and expires (default one
 *       hour). The certificate's status is re-checked on every fetch. Served
 *       inline as application/pdf with ETag and Range support. Every request
 *       counts against the verification budget of its client address (300 per
 *       15 minutes, shared with the verification endpoint; A-293).
 *     tags: [Certificates]
 *     parameters:
 *       - in: path
 *         name: certificateNumber
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: PDF }
 *       403: { description: Invalid or expired link }
 *       404: { description: No signed certificate document for this number }
 *       429: { description: Request budget exhausted for this address (Retry-After header) }
 */
// PUBLIC — capability-gated (the token is the gate, as for /storage/object).
router.get("/verify/:certificateNumber/document", verifyBudget, certificatePdfController.verifyDocument);

/**
 * @swagger
 * /api/v1/certificates:
 *   get:
 *     summary: Get all certificates
 *     description: Requires read access to certificate.
 *     tags: [Certificates]
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
 *     responses:
 *       200:
 *         description: Certificates retrieved successfully
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
 *                   example: "Certificates retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/Certificate"
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get(
  "/",
  auth,
  dynamicAccess("certificate", "read"),
  certificateController.getAllCertificates,
);

/**
 * @swagger
 * /api/v1/certificates:
 *   post:
 *     summary: Create a new certificate
 *     description: Requires write access to certificate.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - recordId
 *             properties:
 *               recordId:
 *                 type: string
 *                 format: uuid
 *                 example: "550e8400-e29b-41d4-a716-446655440000"
 *               type:
 *                 type: string
 *                 example: "result"
 *     responses:
 *       201:
 *         description: Certificate created successfully
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
 *                   example: "Certificate created successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Certificate"
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
  dynamicAccess("certificate", "generate"),
  denyPlatformAuthoring, // A-145: issues a numbered certificate
  certificateController.createCertificate,
);

/**
 * @swagger
 * /api/v1/certificates/stats:
 *   get:
 *     summary: Certificate statistics (totals, by status, by type, latest)
 *     description: Requires read access to certificate.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Certificate statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
// NOTE: literal `/stats` MUST be registered before the parametric
// `/:certificateId` route, otherwise Express matches "stats" as an id and
// `validateUuid` returns 400.
router.get(
  "/stats",
  auth,
  dynamicAccess("certificate", "read"),
  certificateController.getCertificateStats,
);

/**
 * @swagger
 * /api/v1/certificates/{certificateId}:
 *   get:
 *     summary: Get specific certificate by ID
 *     description: Requires read access to certificate.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: certificateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Certificate UUID
 *     responses:
 *       200:
 *         description: Certificate retrieved successfully
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
 *                   example: "Certificate retrieved successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Certificate"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Certificate not found
 */
router.get(
  "/:certificateId",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "read"),
  certificateController.getSpecificCertificate,
);

/**
 * @swagger
 * /api/v1/certificates/{certificateId}:
 *   put:
 *     summary: Update a certificate
 *     description: Requires write access to certificate.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: certificateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Certificate UUID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Certificate updated successfully
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
 *                   example: "Certificate updated successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Certificate"
 *       400:
 *         description: Validation error or invalid UUID, or the certificate is signed/revoked
 *       404:
 *         description: Certificate not found
 *       409:
 *         description: >-
 *           The body tried to change `status`. Status changes only through
 *           /submit, /approve, /sign and /revoke (A-64); the message names the
 *           certificate's state and the route to use.
 */
router.put(
  "/:certificateId",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "generate"),
  denyPlatformAuthoring, // A-145: edits certificate content, approved ones included
  certificateController.updateCertificate,
);

/**
 * @swagger
 * /api/v1/certificates/{certificateId}:
 *   delete:
 *     summary: Delete a certificate
 *     description: Requires write access to certificate.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: certificateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Certificate UUID
 *     responses:
 *       200:
 *         description: Certificate deleted successfully
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
 *                   example: "Certificate deleted successfully"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Certificate not found
 */
router.delete(
  "/:certificateId",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "generate"),
  denyPlatformAuthoring, // A-145: withdraws an issued certificate number
  certificateController.deleteCertificate,
);

/**
 * @swagger
 * /api/v1/certificates/{certificateId}/approve:
 *   post:
 *     summary: Approve a certificate
 *     description: Requires approve access to certificate.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: certificateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Certificate UUID
 *     responses:
 *       200:
 *         description: Certificate approved successfully
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
 *                   example: "Certificate approved successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Certificate"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Certificate not found
 */
router.post(
  "/:certificateId/approve",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "approve"),
  denyPlatformAuthoring,
  // A-62: strips a body `approvedBy` before the controller sees it. The schema
  // is body-only — the certificateId path param is validated separately
  // (validateUuid here, certificateIdSchema in the controller).
  validate(approveCertificateSchema),
  certificateController.approveCertificate,
);

// Submit a DRAFT certificate for approval (DRAFT -> PENDING_APPROVAL). Without
// this transition the approve action is unreachable. Same access as approve.
router.post(
  "/:certificateId/submit",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "approve"),
  denyPlatformAuthoring,
  certificateController.submitCertificate,
);

/**
 * @swagger
 * /api/v1/certificates/{certificateId}/sign:
 *   post:
 *     summary: Sign a certificate digitally
 *     description: Requires sign access to certificate.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: certificateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Certificate UUID
 *     responses:
 *       200:
 *         description: Certificate signed successfully
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
 *                   example: "Certificate signed successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Certificate"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Certificate not found
 */
router.post(
  "/:certificateId/sign",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "sign"),
  denyPlatformAuthoring,
  certificateController.signCertificate,
);

/**
 * @swagger
 * /api/v1/certificates/{certificateId}/revoke:
 *   post:
 *     summary: Revoke a certificate
 *     description: Requires write access to certificate.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: certificateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Certificate UUID
 *     responses:
 *       200:
 *         description: Certificate revoked successfully
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
 *                   example: "Certificate revoked successfully"
 *                 data:
 *                   $ref: "#/components/schemas/Certificate"
 *       400:
 *         description: Invalid UUID
 *       404:
 *         description: Certificate not found
 */
router.post(
  "/:certificateId/revoke",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "generate"),
  denyPlatformAuthoring,
  certificateController.revokeCertificate,
);

/**
 * @swagger
 * /api/v1/certificates/stats:
 *   get:
 *     summary: Get certificate statistics
 *     description: Requires read access to certificate.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Certificate statistics retrieved successfully
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
 *                   example: "Statistics retrieved successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     byStatus:
 *                       type: object
 *                     byType:
 *                       type: object
 */
/**
 * @swagger
 * /api/v1/certificates/{certificateId}/document:
 *   get:
 *     summary: The certificate document — the data its PDF prints
 *     description: >-
 *       M-11 (ADR-095). The backend renders no PDF: the application renders it
 *       from this. Every printed field, the verification URL the QR code
 *       carries, and `integrity` (the `certificate-content-v2` SHA-256 hash the
 *       PDF prints and the public verification endpoint recomputes, the
 *       pre-M-11 `legacyHash`, and the server HMAC over the v2 hash with its
 *       key id). Requires read access to certificate; another tenant's
 *       certificate is a 404.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: certificateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: The certificate document
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Certificate not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/:certificateId/document",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "read"),
  certificatePdfController.getDocument,
);

/**
 * @swagger
 * /api/v1/certificates/{certificateId}/pdf:
 *   get:
 *     summary: Download the PDF the backend stored for a certificate before M-11
 *     description: >-
 *       Requires read access to certificate. Serves only a PDF rendered and
 *       stored before 2026-09-29 (ADR-095); nothing is rendered here. A
 *       certificate with no stored PDF is a 404 — its PDF is rendered by the
 *       application from GET /certificates/{certificateId}/document.
 *     tags: [Certificates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: certificateId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: PDF file
 *       404:
 *         description: Certificate not found, or it has no stored PDF
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get(
  "/:certificateId/pdf",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "read"),
  certificatePdfController.downloadPdf,
);

module.exports = router;
