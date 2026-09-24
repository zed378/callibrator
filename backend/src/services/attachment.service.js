// src/services/attachment.service.js
//
// Tenant-scoped file/document store. Files are written to disk by multer
// (utils/upload) into uploads/attachments; this service records metadata,
// computes a checksum, runs the virus-scan hook, and issues signed, expiring
// download URLs.

const crypto = require("crypto");
const fs = require("fs");
const { Attachment, Certificate } = require("../models");
// NOT `db` from the models barrel — that export is the models registry's
// sequelize handle under a different name; the config module is the one that
// exports the Sequelize instance.
const { db } = require("../config");
const storagePath = require("../utils/storagePath.util");
const { AppError } = require("../utils/appError.util");
const { getUploadUrl } = require("../utils/upload.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");
const virusScan = require("./virusScan.service");
const auditService = require("./audit.service");
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
// LINK TARGET (A-97)
// ------------------------------------------------------------------

/**
 * A-97. The resource types an attachment may be LINKED to (a `resourceId`),
 * keyed by lowercased `resourceType`, with the model that holds the record.
 * The keys are the values the frontend sends (UploadAttachmentModal:
 * device / certificate / workorder / calibration; the kanban card modal:
 * KanbanCard) plus their model names. Every model here carries `tenantId`.
 *
 * Any other type — `generic`, the CMS `post` (posts are platform content, not
 * a tenant's record) — is a standalone upload and may not carry a resourceId.
 */
const LINKABLE_RESOURCES = Object.freeze({
  certificate: "Certificate",
  device: "CalibrationDevice",
  calibrationdevice: "CalibrationDevice",
  calibration: "CalibrationRecord",
  calibrationrecord: "CalibrationRecord",
  workorder: "MaintenanceWorkOrder",
  maintenanceworkorder: "MaintenanceWorkOrder",
  kanbancard: "KanbanCard",
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A-97. Refuse a `resourceId` that is not a live record of the caller's tenant
 * for its `resourceType`. It used to be stored as given: it could not cross
 * tenants (the row's tenant is the principal's) but it could name another
 * tenant's record, a deleted one, or nothing — and deleteAttachment follows a
 * certificate link to decide whether evidence is locked.
 *
 * Missing, soft-deleted and another tenant's are the SAME 404 (CLAUDE.md). The
 * tenant predicate is explicit, not left to the global hooks.
 *
 * @param {string} tenantId - the principal's tenant
 * @param {string|undefined} resourceType
 * @param {string|undefined|null} resourceId
 * @throws {AppError} 400 for a malformed id or an unlinkable type; 404 when no such record
 */
const assertLinkTarget = async (tenantId, resourceType, resourceId) => {
  if (resourceId === undefined || resourceId === null || resourceId === "") {
    return;
  }
  const modelName = LINKABLE_RESOURCES[String(resourceType || "generic").toLowerCase()];
  if (!modelName) {
    throw new AppError(
      400,
      `resourceType "${resourceType || "generic"}" cannot be linked to a record — omit resourceId for a standalone file, or use one of: ${Object.keys(LINKABLE_RESOURCES).join(", ")}`,
    );
  }
  if (!UUID_RE.test(String(resourceId))) {
    throw new AppError(400, "resourceId must be a UUID");
  }

  const Model = require("../models")[modelName];
  const where = { id: resourceId, tenantId };
  if (Model.rawAttributes && Model.rawAttributes.isDeleted) {
    where.isDeleted = false;
  }
  const record = await Model.findOne({ where, attributes: ["id"] });
  if (!record) {
    throw new AppError(404, "Resource not found");
  }
};

// ------------------------------------------------------------------
// CREATE (from a multer-uploaded file)
// ------------------------------------------------------------------
exports.createAttachment = async (tenantId, file, meta = {}) => {
  if (!file) {
    throw new AppError(400, "No file uploaded (expected multipart field 'file')");
  }

  const absPath = file.path;

  // A-97: multer has already written the file. A refused link must not leave
  // it on disk, or in the tenant's storage accounting.
  try {
    await assertLinkTarget(tenantId, meta.resourceType, meta.resourceId);
  } catch (err) {
    await fs.promises.unlink(absPath).catch(() => {});
    throw err;
  }

  // Virus-scan hook — reject + remove the file if flagged.
  const scan = await virusScan.scanFile(absPath);
  if (!scan.clean) {
    await fs.promises.unlink(absPath).catch(() => {});
    throw new AppError(422, `File rejected by virus scan: ${scan.reason || "infected"}`);
  }

  const checksum = await computeChecksum(absPath);

  // A-117: the row and its CREATE audit row commit together, or neither does
  // — as deleteAttachment (A-28). An upload used to leave no audit row at
  // all: evidence could be added to a certificate unattributably. If the
  // transaction fails, the file multer wrote is removed too, so a refused
  // upload leaves nothing on disk or in the tenant's storage accounting.
  let attachment;
  try {
    attachment = await db.transaction(async (transaction) => {
      const created = await Attachment.create(
        {
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
        },
        { transaction },
      );
      await auditService.logAction(
        {
          tenantId,
          userId: meta.uploadedBy || null,
          action: "CREATE",
          resourceType: "Attachment",
          resourceId: created.id,
          changes: {
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            checksum,
            resource: {
              type: created.resourceType,
              id: created.resourceId,
            },
          },
          ipAddress: meta.ipAddress || null,
          userAgent: meta.userAgent || null,
        },
        { transaction },
      );
      return created;
    });
  } catch (err) {
    await fs.promises.unlink(absPath).catch(() => {});
    throw err;
  }

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
// A-28. Two compliance properties the previous two-line implementation did not
// have:
//
//  1. Evidence attached to a certificate that is already APPROVED or SIGNED is
//     part of a released record (ISO 17025 §7.8, 21 CFR 11.10(e)). It is
//     refused with a 409 that explains the state, not a generic error — revoke
//     the certificate first if the file genuinely must go.
//  2. The soft delete and its audit row are written in ONE transaction. An
//     audit row that survives a rolled-back delete records something that did
//     not happen; a delete that commits without one is unattributable.
//
// The soft-delete flag is `isDeleted`. Writing `is_deleted` here would set a
// property Sequelize does not map and silently do nothing.
const CERTIFICATE_RESOURCE = "certificate";
const LOCKED_CERTIFICATE_STATES = ["approved", "signed"];

exports.deleteAttachment = async (tenantId, id, actor = {}) => {
  const attachment = await loadOwned(tenantId, id);

  if (
    String(attachment.resourceType).toLowerCase() === CERTIFICATE_RESOURCE &&
    attachment.resourceId
  ) {
    const parent = await Certificate.findOne({
      where: { id: attachment.resourceId, tenantId },
      attributes: ["id", "status", "certificateNumber"],
    });
    if (parent && LOCKED_CERTIFICATE_STATES.includes(parent.status)) {
      throw new AppError(
        409,
        `This file is evidence for certificate ${parent.certificateNumber}, which is ${parent.status}. Evidence for an approved or signed certificate cannot be deleted — revoke the certificate first.`,
      );
    }
  }

  await db.transaction(async (transaction) => {
    attachment.isDeleted = true;
    await attachment.save({ hooks: false, transaction });
    await auditService.logAction(
      {
        tenantId,
        userId: actor.userId || null,
        action: "DELETE",
        resourceType: "Attachment",
        resourceId: attachment.id,
        changes: {
          before: { isDeleted: false },
          after: { isDeleted: true },
          originalName: attachment.originalName,
          checksum: attachment.checksum,
          resource: {
            type: attachment.resourceType,
            id: attachment.resourceId,
          },
        },
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );
  });

  logger.info("Attachment soft-deleted", {
    attachmentId: attachment.id,
    tenantId,
    deletedBy: actor.userId || null,
  });

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
