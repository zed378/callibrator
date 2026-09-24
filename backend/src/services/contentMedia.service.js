// src/services/contentMedia.service.js
//
// ADR-042 step 3 (S-01) — CMS images join the deliberately PUBLIC class.
//
// The blog/news editor used to upload its images as ATTACHMENTS
// (resourceType "post") and embed the attachment's permanent `/uploads/...`
// URL into published HTML. That only worked because every attachment was on
// the unauthenticated static mount — the same mount that exposed tenant
// evidence. With attachments behind gated routes (step 4), a CMS image must be
// public on purpose: uploaded by someone holding `content:create`, written to
// `uploads/public/cms/`, recorded in the audit log, and served by the public
// mount with its image-only Content-Type allowlist.

const fs = require("fs");
const auditService = require("./audit.service");
const { AppError } = require("../utils/appError.util");
const { PUBLIC_UPLOADS_URL } = require("../utils/upload.util");

/**
 * Record a CMS image upload that multer + the magic-byte check have already
 * placed in `uploads/public/cms/`, and return its public URL.
 *
 * The audit row is the only database write, so there is no transaction to
 * share: if it cannot be written the file is removed and the upload refused —
 * a public file nobody can be held to account for is not kept.
 *
 * @param {{path: string, filename: string, originalname: string, mimetype: string, size: number}} file
 * @param {{userId: string, tenantId?: string|null, ipAddress?: string, userAgent?: string}} actor
 * @returns {Promise<{url: string, fileName: string, mimeType: string, size: number}>}
 * @throws {AppError} 400 with no file; 500 when the audit row could not be written
 */
exports.recordMediaUpload = async (file, actor = {}) => {
  if (!file) {
    throw new AppError(400, "No file uploaded (expected multipart field 'file')");
  }
  const url = `${PUBLIC_UPLOADS_URL}/cms/${file.filename}`;

  const row = await auditService.logAction({
    tenantId: actor.tenantId || null,
    userId: actor.userId || null,
    action: "CREATE",
    resourceType: "ContentMedia",
    resourceId: null,
    changes: {
      url,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      public: true,
    },
    ipAddress: actor.ipAddress || null,
    userAgent: actor.userAgent || null,
  });
  if (!row) {
    await fs.promises.unlink(file.path).catch(() => {});
    throw new AppError(500, "The upload could not be recorded in the audit log, so it was not published");
  }

  return { url, fileName: file.filename, mimeType: file.mimetype, size: Number(file.size) };
};
