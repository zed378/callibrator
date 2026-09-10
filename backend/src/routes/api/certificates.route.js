// src/routes/api/certificates.js
const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const certificateController = require("../../controllers/certificate.controller");
const certificatePdfController = require("../../controllers/certificatePdf.controller");

/* ------------------------------------------------------------------ */
/* CERTIFICATE ROUTES                                                 */
/* ------------------------------------------------------------------ */

/**
 * @swagger
 * /api/v1/certificates/verify/{certificateNumber}:
 *   get:
 *     summary: Publicly verify a certificate's authenticity (no auth)
 *     description: >-
 *       Public endpoint (the target of the certificate QR code). Returns whether
 *       the certificate is found and valid (signed, not revoked, not expired),
 *       plus its integrity hash and issuance details.
 *     tags: [Certificates]
 *     parameters:
 *       - in: path
 *         name: certificateNumber
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Verification result
 */
// PUBLIC — registered before the parametric `/:certificateId` routes.
router.get("/verify/:certificateNumber", certificatePdfController.verifyCertificate);

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
 *         description: Validation error or invalid UUID
 *       404:
 *         description: Certificate not found
 */
router.put(
  "/:certificateId",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "generate"),
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
  certificateController.approveCertificate,
);

// Submit a DRAFT certificate for approval (DRAFT -> PENDING_APPROVAL). Without
// this transition the approve action is unreachable. Same access as approve.
router.post(
  "/:certificateId/submit",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "approve"),
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
 * /api/v1/certificates/{certificateId}/pdf:
 *   get:
 *     summary: Download the certificate PDF (generated on demand)
 *     description: Requires read access to certificate. Renders the PDF (with a
 *       verification QR code) if it has not been generated yet.
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
 *   post:
 *     summary: (Re)generate the certificate PDF
 *     description: Requires generate access to certificate.
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
 *         description: PDF generated
 */
router.get(
  "/:certificateId/pdf",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "read"),
  certificatePdfController.downloadPdf,
);

/**
 * @swagger
 * /api/v1/certificates/{certificateId}/pdf:
 *   post:
 *     summary: Generate (or regenerate) the certificate PDF document
 *     description: Requires generate access to certificate. Renders the formal PDF and stores it against the certificate.
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
 *       201:
 *         description: Certificate PDF generated successfully
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
router.post(
  "/:certificateId/pdf",
  auth,
  validateUuid("certificateId"),
  dynamicAccess("certificate", "generate"),
  certificatePdfController.generatePdf,
);

module.exports = router;
