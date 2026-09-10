// src/services/attachment.service.js
//
// Tenant-scoped file/document store. Files are written to disk by multer
// (utils/upload) into uploads/attachments; this service records metadata,
// computes a checksum, runs the virus-scan hook, and issues signed, expiring
// download URLs.

const crypto = require("crypto");
const fs = require("fs");
const { Attachment } = require("../models");
const storagePath = require("../utils/storagePath.util");
const { AppError } = require("../utils/appError.util");
const { getUploadUrl } = require("../utils/upload.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");
const virusScan = require("./virusScan.service");
const { logger } = require("../middlewares/activityLog.middleware");

const ATTACH_FOLDER = "uploads/attachments";
/* istanbul ignore next -- env-selected secret: which side of the `||` wins
   depends on deployment env, so both branches aren't exercised under the fixed
   test env. */
const SIGN_SECRET =
  process.env.ATTACHMENT_URL_SECRET || process.env.CERT_SIGNING_SECRET;
/* istanbul ignore next -- fail-fast startup guard: signed download URLs must
   never be forgeable via a hardcoded default secret. */
if (!SIGN_SECRET) {
  throw new Error(
    "ATTACHMENT_URL_SECRET (or CERT_SIGNING_SECRET) is required (no insecure default)",
  );
}
const DEFAULT_SIGNED_TTL = Number(process.env.ATTACHMENT_URL_TTL_SEC) || 300;

// Resolve the absolute on-disk path for an attachment (guards traversal).
const resolveAbsPath = (attachment) => {
  const folderParts = attachment.folder.split("/").filter(Boolean);
  const abs = storagePath(...folderParts, attachment.fileName);
  const root = storagePath(...folderParts);
  if (!abs.startsWith(root)) {
    throw new AppError(400, "Invalid attachment path");
  }
  return abs;
};

const computeChecksum = (absPath) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(absPath);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });

const toPublic = (a) => ({
  id: a.id,
  tenantId: a.tenantId,
  resourceType: a.resourceType,
  resourceId: a.resourceId,
  fileName: a.fileName,
  originalName: a.originalName,
  mimeType: a.mimeType,
  size: Number(a.size),
  checksum: a.checksum,
  uploadedBy: a.uploadedBy,
  // Stable, permanent, host-relative URL for inline embedding (served
  // statically from /uploads with inline + cross-origin CORP). Used by the
  // CMS WYSIWYG editor to reference pasted/uploaded images.
  url: getUploadUrl(a.fileName, a.folder || ATTACH_FOLDER),
  createdAt: a.createdAt,
});

// ------------------------------------------------------------------
// CREATE (from a multer-uploaded file)
// ------------------------------------------------------------------
exports.createAttachment = async (tenantId, file, meta = {}) => {
  if (!file) {
    throw new AppError(400, "No file uploaded (expected multipart field 'file')");
  }

  const absPath = file.path;

  // Virus-scan hook — reject + remove the file if flagged.
  const scan = await virusScan.scanFile(absPath);
  if (!scan.clean) {
    await fs.promises.unlink(absPath).catch(() => {});
    throw new AppError(422, `File rejected by virus scan: ${scan.reason || "infected"}`);
  }

  const checksum = await computeChecksum(absPath);

  const attachment = await Attachment.create({
    tenantId,
    resourceType: meta.resourceType || "generic",
    resourceId: meta.resourceId || null,
    fileName: file.filename,
    originalName: file.originalname,
    folder: ATTACH_FOLDER,
    mimeType: file.mimetype,
    size: file.size,
    checksum,
    uploadedBy: meta.uploadedBy || null,
  });

  logger.info("Attachment created", {
    attachmentId: attachment.id,
    tenantId,
    resourceType: attachment.resourceType,
    size: file.size,
  });

  return toPublic(attachment);
};

// ------------------------------------------------------------------
// LIST (tenant-scoped, optional resource filter)
// ------------------------------------------------------------------
exports.listAttachments = async (tenantId, { resourceType, resourceId, page = 1, limit = DEFAULT_LIMIT } = {}) => {
  const where = { tenantId };
  if (resourceType) {
    where.resourceType = resourceType;
  }
  if (resourceId) {
    where.resourceId = resourceId;
  }

  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = (Number(page) - 1) * safeLimit;

  const { count, rows } = await Attachment.findAndCountAll({
    where,
    limit: safeLimit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return {
    rows: rows.map(toPublic),
    meta: {
      total: count,
      page: Number(page),
      limit: safeLimit,
      totalPages: Math.ceil(count / safeLimit),
    },
  };
};

// ------------------------------------------------------------------
// GET (metadata) + record loader
// ------------------------------------------------------------------
const loadOwned = async (tenantId, id) => {
  const attachment = await Attachment.findOne({ where: { id, tenantId } });
  if (!attachment) {
    throw new AppError(404, "Attachment not found");
  }
  return attachment;
};

exports.getAttachment = async (tenantId, id) => toPublic(await loadOwned(tenantId, id));

// Returns { absPath, fileName, mimeType } for streaming a download.
exports.getDownload = async (tenantId, id) => {
  const attachment = await loadOwned(tenantId, id);
  const absPath = resolveAbsPath(attachment);
  if (!fs.existsSync(absPath)) {
    throw new AppError(410, "Attachment file is no longer available");
  }
  return { absPath, fileName: attachment.originalName, mimeType: attachment.mimeType };
};

// ------------------------------------------------------------------
// DELETE (soft — removes it from listings + storage-quota accounting)
// ------------------------------------------------------------------
exports.deleteAttachment = async (tenantId, id) => {
  const attachment = await loadOwned(tenantId, id);
  await attachment.softDelete();
  return { id };
};

// ------------------------------------------------------------------
// SIGNED URLS (HMAC token with expiry — public download without a session)
// ------------------------------------------------------------------
exports.generateSignedUrl = async (tenantId, id, { baseUrl, expiresInSec } = {}) => {
  const attachment = await loadOwned(tenantId, id);
  const ttl = Number(expiresInSec) > 0 ? Number(expiresInSec) : DEFAULT_SIGNED_TTL;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = crypto
    .createHmac("sha256", SIGN_SECRET)
    .update(`${attachment.id}.${exp}`)
    .digest("hex");
  const token = `${exp}.${sig}`;
  const base = (baseUrl || process.env.PUBLIC_BASE_URL || "http://localhost:5000").replace(/\/$/, "");
  return {
    url: `${base}/api/v1/attachments/${attachment.id}/signed?token=${token}`,
    token,
    expiresAt: new Date(exp * 1000),
    expiresInSec: ttl,
  };
};

const verifySignedToken = (attachmentId, token) => {
  if (!token || typeof token !== "string") {
    return false;
  }
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig) {
    return false;
  }
  if (Math.floor(Date.now() / 1000) > exp) {
    return false; // expired
  }
  const expected = crypto
    .createHmac("sha256", SIGN_SECRET)
    .update(`${attachmentId}.${exp}`)
    .digest("hex");
  if (sig.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
};

// Resolve a download from a signed token (no tenant/session required).
exports.getSignedDownload = async (id, token) => {
  if (!verifySignedToken(id, token)) {
    throw new AppError(403, "Invalid or expired download link");
  }
  const attachment = await Attachment.findByPk(id);
  if (!attachment) {
    throw new AppError(404, "Attachment not found");
  }
  const absPath = resolveAbsPath(attachment);
  if (!fs.existsSync(absPath)) {
    throw new AppError(410, "Attachment file is no longer available");
  }
  return { absPath, fileName: attachment.originalName, mimeType: attachment.mimeType };
};

exports._verifySignedToken = verifySignedToken; // exported for tests
