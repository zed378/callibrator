// src/controllers/storage.controller.js
//
// Tenant storage settings (bring-your-own bucket) + the public signed-object
// stream that local/NFS download URLs point at.

const storageSettingsService = require("../services/storageSettings.service");
const storage = require("../services/storage");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");
const path = require("path");
const { contentTypeFor, applyFileHeaders } = require("../utils/fileResponse.util");

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
//
// ADR-042 step 5: this used to set a hardcoded `Content-Disposition:
// attachment`, no ETag, no Last-Modified, and ignore Range — so it could back
// neither an <img>/<iframe> nor a resumed download. It now answers
//   - If-None-Match / If-Modified-Since with 304 (req.fresh),
//   - a single `bytes=` Range with 206 + Content-Range, an unsatisfiable one
//     with 416, and a malformed or multi-range request with the whole object
//     (RFC 9110 §14.2 lets a server ignore Range), honouring If-Range,
//   - a Content-Disposition chosen by the Content-Type (fileResponse.util):
//     inline only for raster images and PDF.
exports.getObject = asyncHandler(async (req, res) => {
  const { key, token } = req.query;
  // Token is verified and the object stat'ed BEFORE any header is written.
  const { meta, open } = await storage.openSignedObject(key, token);

  const objectKey = String(meta.key || key);
  const contentType = contentTypeFor(meta.contentType, objectKey);
  applyFileHeaders(res, { contentType, fileName: path.posix.basename(objectKey) });

  const size = typeof meta.size === "number" ? meta.size : null;
  const etag = entityTag(meta);
  if (etag) {res.setHeader("ETag", etag);}
  const lastModified = meta.modifiedAt ? new Date(meta.modifiedAt).toUTCString() : null;
  if (lastModified) {res.setHeader("Last-Modified", lastModified);}

  if ((etag || lastModified) && req.fresh) {
    return res.status(304).end();
  }

  let range = null;
  if (size !== null) {
    res.setHeader("Accept-Ranges", "bytes");
    const ifRange = req.headers["if-range"];
    const rangeApplies = !ifRange || ifRange === etag || ifRange === lastModified;
    const parsed = rangeApplies ? req.range(size, { combine: true }) : undefined;
    if (parsed === -1) {
      res.setHeader("Content-Range", `bytes */${size}`);
      return res.status(416).end();
    }
    if (Array.isArray(parsed) && parsed.type === "bytes" && parsed.length === 1) {
      range = { start: parsed[0].start, end: parsed[0].end };
    }
  }

  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    res.setHeader("Content-Length", range.end - range.start + 1);
  } else if (size !== null) {
    res.setHeader("Content-Length", size);
  }

  if (req.method === "HEAD") {
    return res.end();
  }

  const stream = await open(range);
  stream.on("error", () => {
    // The object vanished mid-stream (concurrent delete). Headers may already
    // be sent, so we can only abort the connection.
    if (!res.headersSent) {res.status(410).end();}
    else {res.destroy();}
  });
  stream.pipe(res);
});

/**
 * A validator for the object: the driver's own ETag when it has one (S3),
 * otherwise a weak tag from size + mtime (local/NFS) — the same inputs
 * express.static uses. Null when there is nothing stable to derive it from.
 */
const entityTag = (meta) => {
  if (meta.etag) {return String(meta.etag);}
  if (typeof meta.size === "number" && meta.modifiedAt) {
    const mtime = new Date(meta.modifiedAt).getTime();
    return `W/"${meta.size.toString(16)}-${mtime.toString(16)}"`;
  }
  return null;
};
exports._entityTag = entityTag; // exported for tests
