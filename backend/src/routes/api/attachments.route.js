const express = require("express");
const router = express.Router();
const { auth } = require("../../middlewares/auth.middleware");
const { dynamicAccess } = require("../../middlewares/dynamicAccess.middleware");
const { MENU_SLUGS } = require("../../constants");
const { validateUuid } = require("../../middlewares/validateUuid.middleware");
const { upload } = require("../../utils/upload.util");
const { enforceStorageQuota } = require("../../middlewares/enforceQuota.middleware");
const attachmentController = require("../../controllers/attachment.controller");

// Documents + images. SVG intentionally excluded (stored-XSS risk).
const ATTACH_MIMES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
];
const ATTACH_EXTS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
];

// A-28 — authorization.
//
// There is NO `attachments` slug in MENU_SLUGS (roleConstants.js). Naming one
// here would produce an A-07 instance: a `dynamicAccess` resource that matches
// no menu, which denies everyone but SUPER_ADMIN and does so silently. The
// closest slug that actually exists is `equipment`, and it fits: attachments
// are evidence hanging off devices, calibration records and certificates.
//
//   read  — every seeded role has `equipment:read`, so reading and ATTACHING
//           evidence stays open to the technicians who do the work. Raising
//           upload to `write` would lock a TECHNICIAN out of recording its own
//           calibration evidence, which is the opposite of the compliance goal.
//   write — only the tenant-admin roles (SUPERADMIN, HEALTHCARE ADMIN,
//           CALIBRATOR ADMIN) hold `equipment:write`. Destroying evidence is
//           theirs alone.
//
// Recommendation recorded with A-28: add a dedicated `attachments` slug to
// MENU_SLUGS and re-point these gates at it, so evidence retention can be
// granted independently of equipment editing.

/**
 * @swagger
 * tags:
 *   name: Attachments
 *   description: Tenant-scoped file/document storage
 */

/**
 * @swagger
 * /api/v1/attachments/{id}/signed:
 *   get:
 *     summary: Download an attachment via a signed, expiring URL (no auth)
 *     tags: [Attachments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: File stream }
 *       403: { description: Invalid or expired link }
 */
// PUBLIC — token-gated; registered before the auth'd routes.
router.get("/:id/signed", validateUuid("id"), attachmentController.downloadSigned);

/**
 * @swagger
 * /api/v1/attachments:
 *   post:
 *     summary: Upload a file (multipart form-data, field "file")
 *     tags: [Attachments]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *               resourceType: { type: string }
 *               resourceId: { type: string, format: uuid }
 *     responses:
 *       201: { description: Attachment uploaded }
 *       413: { description: Storage quota exceeded }
 *       422: { description: File flagged by virus scan }
 */
router.post(
  "/",
  auth,
  dynamicAccess(MENU_SLUGS.EQUIPMENT, "read"),
  enforceStorageQuota(),
  upload({
    folder: "uploads/attachments",
    allowedMimes: ATTACH_MIMES,
    allowedExtensions: ATTACH_EXTS,
    maxFileSize: 25 * 1024 * 1024, // 25MB
    // S-17: the file stays in quarantine until attachment.service has
    // virus-scanned it; the service moves it into uploads/attachments.
    holdInQuarantine: true,
  }),
  attachmentController.upload,
);

/**
 * @swagger
 * /api/v1/attachments:
 *   get:
 *     summary: List attachments (tenant-scoped)
 *     tags: [Attachments]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: resourceType
 *         schema: { type: string }
 *       - in: query
 *         name: resourceId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 25 }
 *     responses:
 *       200: { description: Attachments retrieved }
 */
router.get("/", auth, dynamicAccess(MENU_SLUGS.EQUIPMENT, "read"), attachmentController.list);

/**
 * @swagger
 * /api/v1/attachments/{id}:
 *   get:
 *     summary: Get attachment metadata
 *     tags: [Attachments]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Attachment retrieved }
 *       404: { description: Attachment not found }
 */
router.get(
  "/:id",
  auth,
  dynamicAccess(MENU_SLUGS.EQUIPMENT, "read"),
  validateUuid("id"),
  attachmentController.getOne,
);

/**
 * @swagger
 * /api/v1/attachments/{id}/download:
 *   get:
 *     summary: Download the attachment file (authenticated)
 *     tags: [Attachments]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: File stream (Content-Disposition attachment) }
 *       404: { description: Attachment not found }
 *       410: { description: File missing from storage }
 */
router.get(
  "/:id/download",
  auth,
  dynamicAccess(MENU_SLUGS.EQUIPMENT, "read"),
  validateUuid("id"),
  attachmentController.download,
);

/**
 * @swagger
 * /api/v1/attachments/{id}/signed-url:
 *   post:
 *     summary: Create a signed, expiring download URL (for sharing without auth)
 *     tags: [Attachments]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expiresInSec: { type: integer, default: 300 }
 *     responses:
 *       200: { description: "Signed URL created: { url, token, expiresAt, expiresInSec }" }
 *       404: { description: Attachment not found }
 */
router.post(
  "/:id/signed-url",
  auth,
  dynamicAccess(MENU_SLUGS.EQUIPMENT, "read"),
  validateUuid("id"),
  attachmentController.createSignedUrl,
);

/**
 * @swagger
 * /api/v1/attachments/{id}:
 *   delete:
 *     summary: Delete an attachment (soft-delete; frees storage quota)
 *     tags: [Attachments]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Attachment deleted (soft) }
 *       403: { description: Insufficient permission }
 *       404: { description: Attachment not found }
 *       409: { description: Parent certificate is approved or signed }
 */
// A-28: evidence destruction is a tenant-admin act. The delete is a SOFT
// delete (isDeleted — NOT is_deleted, which silently does nothing) written
// with its audit row in one transaction, and is refused outright once the
// parent certificate is approved or signed. See attachment.service.js.
router.delete(
  "/:id",
  auth,
  dynamicAccess(MENU_SLUGS.EQUIPMENT, "write"),
  validateUuid("id"),
  attachmentController.remove,
);

module.exports = router;
