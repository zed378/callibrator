// src/controllers/attachment.controller.js
const attachmentService = require("../services/attachment.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

const baseUrlOf = (req) => `${req.protocol}://${req.get("host")}`;

// POST /api/v1/attachments (multipart: file + resourceType/resourceId)
exports.upload = asyncHandler(async (req, res) => {
  const data = await attachmentService.createAttachment(req.user.tenantId, req.file, {
    resourceType: req.body.resourceType,
    resourceId: req.body.resourceId,
    uploadedBy: req.user.id,
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

// GET /api/v1/attachments/:id
exports.getOne = asyncHandler(async (req, res) => {
  const data = await attachmentService.getAttachment(req.user.tenantId, req.params.id);
  success(res, data, null, "Attachment retrieved", 200);
});

// GET /api/v1/attachments/:id/download
exports.download = asyncHandler(async (req, res) => {
  const { absPath, fileName } = await attachmentService.getDownload(
    req.user.tenantId,
    req.params.id,
  );
  return res.download(absPath, fileName);
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
  const { absPath, fileName } = await attachmentService.getSignedDownload(
    req.params.id,
    req.query.token,
  );
  return res.download(absPath, fileName);
});

// DELETE /api/v1/attachments/:id
exports.remove = asyncHandler(async (req, res) => {
  const data = await attachmentService.deleteAttachment(req.user.tenantId, req.params.id);
  success(res, data, null, "Attachment deleted", 200);
});
