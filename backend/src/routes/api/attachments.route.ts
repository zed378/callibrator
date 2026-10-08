/**
 * Attachments (evidence files): `/api/v1/attachments` (index.js mounts it).
 *
 * P9-18 (ADR-087): converted from attachments.route.js. Every route and
 * middleware is in the same order as before (checked against the mounted route
 * table). The contract is code-first: attachments.openapi.ts (P9-25, ADR-103);
 * the `@swagger` JSDoc this file carried is gone.
 */
import { Router } from "express";
import { auth } from "../../middlewares/auth.middleware";
import { boundUploadGate } from "../../middlewares/boundUploadGate.middleware";
import { dynamicAccess } from "../../middlewares/dynamicAccess.middleware";
import { MENU_SLUGS, ROLE_NAMES } from "../../constants";
import { rbac } from "../../middlewares/rbac.middleware";
import { validateUuid } from "../../middlewares/validateUuid.middleware";
import { upload } from "../../utils/upload.util";
import { enforceStorageQuota } from "../../middlewares/enforceQuota.middleware";
import attachmentController from "../../controllers/attachment.controller";
import { validate } from "../../middlewares/validation.middleware";
import { createSignedUrlSchema } from "../../validators/attachment.validator";
import { idempotency } from "../../middlewares/idempotency.middleware";

// `Router` is `express.Router` (the same function).
const router = Router();

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
// V-12 (2026-09-30): the gates use `equipment`, NOT the `attachments` slug —
// and the reason is the role assignments, not a missing slug. `attachments`
// IS a seeded menu group (seedMenuGroups.util.js, id …-210, parent
// `mgmt-content`) and, since ADR-102 (migration 0097), MENU_SLUGS.ATTACHMENTS
// in roleConstants.ts. But ROLE_MENU_ASSIGNMENTS grants it only to HEALTHCARE
// ADMIN and CALIBRATOR ADMIN (write) and ENGINEERING MANAGER (read): no
// technician, supervisor or user holds it. Re-pointing these gates at it would
// lock every TECHNICIAN out of reading and attaching its own calibration
// evidence. `equipment` fits: attachments are evidence hanging off devices,
// calibration records and certificates, and every seeded role holds
// `equipment:read`.
//
//   read  — every seeded role has `equipment:read`, so reading and ATTACHING
//           evidence stays open to the technicians who do the work. Raising
//           upload to `write` would lock a TECHNICIAN out of recording its own
//           calibration evidence, which is the opposite of the compliance goal.
//   write — only the tenant-admin roles (SUPERADMIN, HEALTHCARE ADMIN,
//           CALIBRATOR ADMIN) hold `equipment:write`. Destroying evidence is
//           theirs alone.
//
// Recommendation recorded with A-28, corrected by V-12: to re-point these
// gates at `attachments` (so evidence retention can be granted independently
// of equipment editing), FIRST seed `attachments` read for every role that
// holds `equipment:read` today (ROLE_MENU_ASSIGNMENTS + a data migration for
// seeded tenants) — the constant alone is not the change.

// PUBLIC — token-gated; registered before the auth'd routes.
router.get("/:id/signed", validateUuid("id"), attachmentController.downloadSigned);

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
  // P21-09e (P18-03 § 8.2 A-5): a facility-bound uploader attaches device photos only.
  boundUploadGate,
  // P21-03 (P19-08 § 9.5, G-O8): a replayed photo upload stores one file — the request hash covers
  // the file's SHA-256 and the fields.
  idempotency({ slug: MENU_SLUGS.EQUIPMENT, read: attachmentController.readForReplay }),
  attachmentController.upload,
);

router.get("/", auth, dynamicAccess(MENU_SLUGS.EQUIPMENT, "read"), attachmentController.list);

// Declared before `/:id`, which would otherwise take "orphans" as an id.
router.get(
  "/orphans",
  auth,
  rbac([ROLE_NAMES.TENANT_ADMIN]),
  dynamicAccess(MENU_SLUGS.EQUIPMENT, "read"),
  attachmentController.listOrphans,
);

router.get(
  "/:id",
  auth,
  dynamicAccess(MENU_SLUGS.EQUIPMENT, "read"),
  validateUuid("id"),
  attachmentController.getOne,
);

router.get(
  "/:id/download",
  auth,
  dynamicAccess(MENU_SLUGS.EQUIPMENT, "read"),
  validateUuid("id"),
  attachmentController.download,
);

router.post(
  "/:id/signed-url",
  auth,
  dynamicAccess(MENU_SLUGS.EQUIPMENT, "read"),
  validateUuid("id"),
  // A-365: the lifetime is bounded (30 s … the configured cap); above it, 400.
  validate(createSignedUrlSchema),
  attachmentController.createSignedUrl,
);

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

export = router;
