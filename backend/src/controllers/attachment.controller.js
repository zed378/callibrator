// src/controllers/attachment.controller.js
const attachmentService = require("../services/attachment.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
// A-189: the configured public origin, never the proxy-facing Host header.
const { baseUrlOf } = require("../utils/publicBaseUrl.util");
const { sendStoredFile } = require("../utils/fileResponse.util");

// POST /api/v1/attachments (multipart: file + resourceType/resourceId)
exports.upload = asyncHandler(async (req, res) => {
  // A-09: multer only populates req.body for a multipart request; a POST with
  // no body at all leaves it `undefined` under Express 5, and reading
  // `.resourceType` off it threw a TypeError (500) instead of reaching the
  // service's own 400.
  const { resourceType, resourceId } = req.body || {};
  const data = await attachmentService.createAttachment(req.user.tenantId, req.file, {
    resourceType,
    resourceId,
    uploadedBy: req.user.id,
    // A-117: for the CREATE audit row written with the attachment.
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
  success(res, data, null, "Attachment uploaded", 201);
});

// GET /api/v1/attachments
exports.list = asyncHandler(async (req, res) => {
  const { resourceType, resourceId, page, limit } = req.query;
  const result = await attachmentService.listAttachments(req.user.tenantId, {
    resourceType,
    resourceId,
    page,
    limit,
  });
  success(res, result.rows, result.meta, "Attachments retrieved", 200);
});

// GET /api/v1/attachments/orphans — D-22 (ADR-070): the tenant's live
// attachments whose linked record is gone. Rows in `data`, a top-level `meta`.
exports.listOrphans = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const result = await attachmentService.listOrphans(req.user.tenantId, { page, limit });
  success(res, result.rows, result.meta, "Orphaned attachments retrieved", 200);
});

// GET /api/v1/attachments/:id
exports.getOne = asyncHandler(async (req, res) => {
  const data = await attachmentService.getAttachment(req.user.tenantId, req.params.id);
  success(res, data, null, "Attachment retrieved", 200);
});

// GET /api/v1/attachments/:id/download
// ADR-042 step 4/5: this is now THE url an attachment response carries, so it
// must do what the static mount did — ETag/304, Range/206, and inline for
// images and PDF (anything else stays a download) — see fileResponse.util.
exports.download = asyncHandler(async (req, res) => {
  const { absPath, fileName, mimeType } = await attachmentService.getDownload(
    req.user.tenantId,
    req.params.id,
  );
  await sendStoredFile(res, absPath, { contentType: mimeType || "application/octet-stream", fileName });
});

// POST /api/v1/attachments/:id/signed-url
exports.createSignedUrl = asyncHandler(async (req, res) => {
  const data = await attachmentService.generateSignedUrl(req.user.tenantId, req.params.id, {
    baseUrl: baseUrlOf(req),
    expiresInSec: req.body?.expiresInSec,
  });
  success(res, data, null, "Signed URL generated", 200);
});

// GET /api/v1/attachments/:id/signed?token=... (PUBLIC, token-gated)
exports.downloadSigned = asyncHandler(async (req, res) => {
  const { absPath, fileName, mimeType } = await attachmentService.getSignedDownload(
    req.params.id,
    req.query.token,
  );
  await sendStoredFile(res, absPath, { contentType: mimeType || "application/octet-stream", fileName });
});

// DELETE /api/v1/attachments/:id
// A-28: the actor is carried into the service so the audit row written inside
// the delete transaction is attributable.
exports.remove = asyncHandler(async (req, res) => {
  const data = await attachmentService.deleteAttachment(req.user.tenantId, req.params.id, {
    userId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.get("user-agent"),
  });
  success(res, data, null, "Attachment deleted", 200);
});
