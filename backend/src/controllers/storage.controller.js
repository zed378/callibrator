// src/controllers/storage.controller.js
//
// Tenant storage settings (bring-your-own bucket) + the public signed-object
// stream that local/NFS download URLs point at.

const storageSettingsService = require("../services/storageSettings.service");
const storage = require("../services/storage");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

// GET /api/v1/storage/settings
exports.getSettings = asyncHandler(async (req, res) => {
  const data = await storageSettingsService.getSettings(req.user.tenantId);
  success(res, data, null, "Storage settings retrieved", 200);
});

// PUT /api/v1/storage/settings
exports.updateSettings = asyncHandler(async (req, res) => {
  const data = await storageSettingsService.updateSettings(
    req.user.tenantId,
    req.body,
  );
  success(res, data, null, "Storage settings updated", 200);
});

// DELETE /api/v1/storage/settings  (revert to the platform default)
exports.clearSettings = asyncHandler(async (req, res) => {
  const data = await storageSettingsService.clearSettings(req.user.tenantId);
  success(res, data, null, "Storage settings reset to platform default", 200);
});

// POST /api/v1/storage/settings/test  (health-check the active storage)
exports.testConnection = asyncHandler(async (req, res) => {
  const data = await storageSettingsService.testConnection(req.user.tenantId);
  success(res, data, null, "Storage connection tested", 200);
});

// GET /api/v1/storage/usage
exports.getUsage = asyncHandler(async (req, res) => {
  const data = await storageSettingsService.getUsage(req.user.tenantId);
  success(res, data, null, "Storage usage retrieved", 200);
});

// GET /api/v1/storage/object?key=...&token=...  (PUBLIC, HMAC-gated)
// This is where local/NFS signed URLs resolve; S3 URLs never reach the app.
exports.getObject = asyncHandler(async (req, res) => {
  const { key, token } = req.query;
  const { stream, meta } = await storage.openSignedObject(key, token);

  if (meta.contentType) {
    res.setHeader("Content-Type", meta.contentType);
  }
  if (typeof meta.size === "number") {
    res.setHeader("Content-Length", meta.size);
  }
  // Downloaded objects are opaque blobs served from a signed URL; force a
  // download rather than letting the browser sniff and render (stored-XSS).
  res.setHeader("Content-Disposition", "attachment");
  res.setHeader("X-Content-Type-Options", "nosniff");

  stream.on("error", () => {
    // The object vanished mid-stream (concurrent delete). Headers may already
    // be sent, so we can only abort the connection.
    if (!res.headersSent) {res.status(410).end();}
    else {res.destroy();}
  });
  stream.pipe(res);
});
