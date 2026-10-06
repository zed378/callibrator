// src/services/attachment.service.ts
//
// Tenant-scoped file/document store. multer (utils/upload) writes an upload to
// the local quarantine; this service checks its link, runs the virus-scan
// hook, computes a checksum, and only then puts it into the tenant's storage
// (P8-01: `t/<tenantId>/attachments/<file>` on the local, NFS or S3 driver),
// records its metadata, and issues signed, expiring download URLs.
//
// P8-01 (ADR-086 Amendment 1): a row with a `storageKey` is read, served and
// deleted through the storage layer. A row without one predates the cut-over
// and is still on the legacy disk path (`<folder>/<fileName>`); it is served
// from there exactly as before until `npm run migrate:storage` copies it.
//
// ADR-042 step 4 (S-01): uploads/attachments is NOT served statically. An
// attachment is reached only through GET /attachments/:id/download (auth +
// equipment:read + tenant + soft delete) or a signed, expiring
// /attachments/:id/signed link — both of which answer 404 for a deleted row.
//
// P9-18 (ADR-087): converted from attachment.service.js. Its interim `.d.ts`
// is deleted with it; the types it declared are the floor kept here. The
// export is the same object, its keys in the JavaScript's order. What the
// JavaScript destructured at load is captured at load; crypto, fs, path,
// virusScan and audit.service stay module objects, read at call time; the
// models barrel is still required lazily where the JavaScript required it.
// One change of MECHANISM, not of behaviour: listOrphans' two raw statements
// run through `sql()` with BOUND parameters ($1…$3) instead of named
// replacements (ADR-087 §P9-07: a direct `sequelize.query` in TypeScript is a
// lint error) — the same statements, the same tenant predicate, the same rows.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Op as loadedOp, fn as loadedFn, col as loadedCol, where as loadedSqlWhere } from "sequelize";
import type { CreationAttributes, Transaction, WhereOptions } from "sequelize";
import models from "../models";
import type * as ModelsModule from "../models";
// NOT `db` from the models barrel — that export is the models registry's
// sequelize handle under a different name; the config module is the one that
// exports the Sequelize instance.
import config from "../config";
import storagePath from "../utils/storagePath.util";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { DEFAULT_LIMIT as loadedDefaultLimit, MAX_LIMIT as loadedMaxLimit } from "../constants";
import virusScan from "./virusScan.service";
import { assertInQuarantine as loadedAssertInQuarantine } from "../utils/upload.util";
import storage from "./storage";
import storedFile from "./storedFile.service";
import type { StorageObject } from "../utils/fileResponse.util";
import auditService from "./audit.service";
import { auditEntryActor as loadedAuditEntryActor, actorChanges as loadedActorChanges } from "../utils/auditPrincipal.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { env } from "../config/env";
import { sql } from "../utils/sql.util";
import type { SqlRunner } from "../utils/sql.util";
import {
  LINKABLE_RESOURCES as loadedLinkableResources,
  ATTACHMENT_RESOURCE_TYPES as loadedAttachmentResourceTypes,
  isAttachmentResourceType as loadedIsAttachmentResourceType,
} from "../constants/attachmentResources";

const Op = loadedOp;
const fn = loadedFn;
const col = loadedCol;
const sqlWhere = loadedSqlWhere;
const { Attachment, Certificate } = models;
const { db } = config;
const AppError = LoadedAppError;
const assertInQuarantine = loadedAssertInQuarantine;
const DEFAULT_LIMIT = loadedDefaultLimit;
const MAX_LIMIT = loadedMaxLimit;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const logger = loadedLogger;

/** One page: rows, and the pagination the house envelope puts in `meta`. */
interface AttachmentPage {
  rows: Record<string, unknown>[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/**
 * A stored file to send: a storage object (`fileResponse.util#sendStorageObject`)
 * or, for a row written before P8-01, a legacy file on this host's disk
 * (`fileResponse.util#sendStoredFile`). Exactly one of the two is set.
 */
interface StoredDownload {
  object?: StorageObject;
  absPath?: string;
  fileName: string;
  mimeType: string | null;
}

/** Who acts, and from where (auditActor / auditPrincipal of the request). */
interface AttachmentActor {
  userId?: string | null;
  apiKeyId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** An attachment row as these functions read it. */
interface AttachmentRow {
  id: string;
  tenantId: string;
  resourceType: string;
  resourceId: string | null;
  fileName: string;
  originalName: string;
  folder: string;
  mimeType: string | null;
  size: number | string;
  checksum: string | null;
  storageKey?: string | null;
  uploadedBy: string | null;
  isDeleted?: boolean;
  createdAt: Date;
  save(options: object): Promise<unknown>;
}

/** The multer file createAttachment takes. */
interface UploadedFile {
  path: string;
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
}

/** createAttachment's metadata. */
interface AttachmentMeta {
  resourceType?: unknown;
  resourceId?: unknown;
  uploadedBy?: string | null | undefined;
  apiKeyId?: string | null | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

/** The message of a thrown value, read as the JavaScript read it. */
const messageOf = (err: unknown): unknown => (err as { message?: unknown }).message;

const ATTACH_FOLDER = "uploads/attachments";
/* istanbul ignore next -- env-selected secret: which side of the `||` wins
   depends on deployment env, so both branches aren't exercised under the fixed
   test env. */
const SIGN_SECRET =
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty secret falls through to the next
  env("ATTACHMENT_URL_SECRET") || env("CERT_SIGNING_SECRET");
/* istanbul ignore next -- fail-fast startup guard: signed download URLs must
   never be forgeable via a hardcoded default secret. */
if (!SIGN_SECRET) {
  throw new Error(
    "ATTACHMENT_URL_SECRET (or CERT_SIGNING_SECRET) is required (no insecure default)",
  );
}
const SIGNING_KEY: string = SIGN_SECRET;
const DEFAULT_SIGNED_TTL = Number(env("ATTACHMENT_URL_TTL_SEC")) || 300;

/**
 * Resolve the absolute on-disk path for an attachment, refusing one outside
 * the uploads tree.
 *
 * S-15: the root is FIXED — `storagePath("uploads")`, derived from nothing on
 * the row. It used to be `storagePath(...folderParts)`, built from the same
 * `folder` value it was meant to constrain: with `folder = "../../etc"` the
 * root moved outside storage with it and the prefix check passed. Both sides
 * are `path.resolve`d, and the prefix carries the separator, so a sibling
 * such as `uploads-evil` does not pass as inside `uploads`.
 *
 * @param attachment - `{ folder, fileName }`
 * @returns the absolute path
 * @throws {AppError} 400 when the path resolves outside the uploads tree
 */
const resolveAbsPath = (attachment: { folder?: unknown; fileName?: unknown }): string => {
  const root = path.resolve(storagePath("uploads"));
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: an empty folder is ""; the column is a string
  const folderParts = String(attachment.folder || "").split(/[\\/]/).filter(Boolean);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: an empty file name is ""; the column is a string
  const abs = path.resolve(storagePath(...folderParts, String(attachment.fileName || "")));
  if (!abs.startsWith(root + path.sep)) {
    throw new AppError(400, "Invalid attachment path");
  }
  return abs;
};

const computeChecksum = (absPath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(absPath);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
    stream.on("error", reject);
  });

const toPublic = (a: AttachmentRow): Record<string, unknown> => ({
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
  // ADR-042 step 4 (S-01). This used to be `/uploads/attachments/<file>` —
  // a permanent, unauthenticated bearer link to tenant evidence, handed out in
  // every response and not revoked by the delete. It is now the GATED,
  // host-relative download route: it works same-origin for a signed-in member
  // of the tenant (the frontend proxy injects the session) and for nobody
  // else, and it stops working when the attachment is deleted. Images and
  // PDFs are served inline, so it can back an <img>. A link for someone
  // without a session is an explicit act: POST /attachments/:id/signed-url.
  // (CMS images are no longer attachments: POST /content/media.)
  url: `/api/v1/attachments/${a.id}/download`,
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
 *
 * D-22 (ADR-083): the map, and the standalone types, live in
 * constants/attachmentResources — the one list the model validates too.
 */
const LINKABLE_RESOURCES: Readonly<Record<string, string>> = loadedLinkableResources;
const ATTACHMENT_RESOURCE_TYPES = loadedAttachmentResourceTypes;
const isAttachmentResourceType = loadedIsAttachmentResourceType;

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
 * D-22 (ADR-083): the type itself is checked first, linked or not — a free
 * string used to be stored as given on an unlinked upload.
 *
 * @param tenantId - the principal's tenant
 * @param resourceType - the type sent
 * @param resourceId - the id sent
 * @throws {AppError} 400 for an unknown type, a malformed id or an unlinkable type; 404 when no such record
 */
const assertLinkTarget = async (tenantId: string, resourceType: unknown, resourceId: unknown): Promise<void> => {
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string -- as built: an empty type is "generic", and the type is interpolated as sent */
  if (!isAttachmentResourceType(resourceType || "generic")) {
    throw new AppError(
      400,
      `resourceType "${resourceType}" is not an attachment type — use one of: ${ATTACHMENT_RESOURCE_TYPES.join(", ")}`,
    );
  }
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
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string */
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: the id is tested as the string it was sent as
  if (!UUID_RE.test(String(resourceId))) {
    throw new AppError(400, "resourceId must be a UUID");
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: the barrel, required per call, indexed by the linked model's name
  const Model = (require("../models") as Record<string, unknown>)[modelName] as {
    rawAttributes?: Record<string, unknown>;
    findOne(options: object): Promise<unknown>;
  };
  const where: Record<string, unknown> = { id: resourceId, tenantId };
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `Model.rawAttributes && Model.rawAttributes.isDeleted`
  if (Model.rawAttributes && Model.rawAttributes["isDeleted"]) {
    where["isDeleted"] = false;
  }
  const record = await Model.findOne({ where, attributes: ["id"] });
  if (!record) {
    throw new AppError(404, "Resource not found");
  }
};

// ------------------------------------------------------------------
// PARENT DELETE CASCADE (D-22, ADR-070)
// ------------------------------------------------------------------

/**
 * The lower-cased `resourceType` spellings that link to `modelName`.
 * @param modelName - a value of LINKABLE_RESOURCES
 * @returns the spellings
 */
const typesLinkingTo = (modelName: string): string[] =>
  Object.keys(LINKABLE_RESOURCES).filter((type) => LINKABLE_RESOURCES[type] === modelName);

/**
 * D-22 (ADR-070) — a parent's soft delete soft-deletes its attachments, in the
 * parent's transaction, with one DELETE audit row per attachment that names
 * the parent (`changes.cascade`). It used to leave them live: listed, counted
 * against the tenant's storage and downloadable, attached to a record nobody
 * could open any more.
 *
 * The FILE is kept, unlike an explicit delete (deleteAttachment unlinks it
 * after commit): deleting a draft certificate is not a decision to destroy the
 * evidence bytes, and a later restore of the parent can restore these rows —
 * exactly the ones whose DELETE row names it in `changes.cascade` — only while
 * the bytes exist. No gated path serves a soft-deleted row, so a kept file is
 * unreachable, not exposed.
 *
 * Matching is case-insensitive over every spelling that links to the model
 * (`device` and `CalibrationDevice` alike), with the tenant predicate explicit.
 *
 * D-22 (ADR-083): `resourceId` may be an ARRAY of parent ids — a kanban
 * project's delete passes a page of its cards. Each audit row still names its
 * own parent in `changes.cascade.id`, so restoring one card restores exactly
 * its files; `options.via` (the project) is recorded as `changes.cascade.via`.
 *
 * @param tenantId - the parent's tenant
 * @param modelName - the parent model, a value of LINKABLE_RESOURCES
 * @param resourceId - the parent's id, or a page of parent ids
 * @param options - `transaction` (required), `actor`, `via`
 * @returns the ids of the attachments soft-deleted
 * @throws {Error} a model that is not linkable, or no transaction — both are
 *   programming errors, never a caller's input
 */
const softDeleteForResource = async (
  tenantId: string,
  modelName: string,
  resourceId: string | string[],
  { transaction, actor = {}, via }: { transaction: Transaction; actor?: AttachmentActor; via?: { type: string; id: string } } = {} as unknown as {
    transaction: Transaction;
  },
): Promise<string[]> => {
  const types = typesLinkingTo(modelName);
  if (types.length === 0) {
    throw new Error(`softDeleteForResource: ${modelName} is not a linkable resource`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a JavaScript caller may pass none
  if (!transaction) {
    throw new Error("softDeleteForResource runs inside the parent delete's transaction");
  }

  const rows = (await Attachment.findAll({
    where: {
      tenantId,
      resourceId,
      [Op.and]: [sqlWhere(fn("lower", col("resource_type")), { [Op.in]: types })],
    } as unknown as WhereOptions,
    attributes: ["id", "resourceType", "resourceId", "originalName", "checksum"],
    transaction,
  })) as unknown as AttachmentRow[];
  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);
  await Attachment.update({ isDeleted: true }, { where: { id: ids, tenantId }, transaction });
  for (const row of rows) {
    await auditService.logAction(
      {
        tenantId,
        // A-282 (ADR-100): a key is system:api-key, its id in changes.
        ...auditEntryActor(actor),
        action: "DELETE",
        resourceType: "Attachment",
        resourceId: row.id,
        changes: {
          ...actorChanges(actor),
          operation: "cascade-soft-delete",
          before: { isDeleted: false },
          after: { isDeleted: true },
          originalName: row.originalName,
          checksum: row.checksum,
          resource: { type: row.resourceType, id: row.resourceId },
          cascade: {
            type: modelName,
            id: Array.isArray(resourceId) ? row.resourceId : resourceId,
            ...(via ? { via } : {}),
          },
        },
      },
      { transaction },
    );
  }
  return ids;
};

/**
 * A-133 (ADR-075) — the other half of D-22: restoring a parent restores exactly
 * the attachments its delete took with it, in the restore's transaction, with
 * one UPDATE audit row each (`operation: "cascade-restore"`, naming the parent).
 *
 * "Exactly" is read from the audit trail, as ADR-070 designed it: an
 * attachment is restored when it is still deleted AND its most recent DELETE
 * row is a `cascade-soft-delete` naming this parent. An attachment deleted on
 * its own — before the parent's delete (the cascade then never touched it) or
 * after an earlier restore — has a later explicit DELETE row and stays
 * deleted: a restore must not undo a decision somebody else took. The tenant
 * predicate is explicit on both reads.
 *
 * @param tenantId - the parent's tenant
 * @param modelName - the parent model, a value of LINKABLE_RESOURCES
 * @param resourceId - the parent's id
 * @param options - `transaction` (required), `actor`
 * @returns the ids of the attachments restored
 * @throws {Error} a model that is not linkable, or no transaction — both are
 *   programming errors, never a caller's input
 */
const restoreForResource = async (
  tenantId: string,
  modelName: string,
  resourceId: string,
  { transaction, actor = {} }: { transaction: Transaction; actor?: AttachmentActor } = {} as unknown as { transaction: Transaction },
): Promise<string[]> => {
  if (typesLinkingTo(modelName).length === 0) {
    throw new Error(`restoreForResource: ${modelName} is not a linkable resource`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a JavaScript caller may pass none
  if (!transaction) {
    throw new Error("restoreForResource runs inside the parent restore's transaction");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required here, per call
  const { AuditLog } = require("../models") as typeof ModelsModule;

  // Every attachment this parent's deletes ever cascaded to.
  const cascaded = (await AuditLog.findAll({
    where: {
      tenantId,
      resourceType: "Attachment",
      action: "DELETE",
      changes: { operation: "cascade-soft-delete", cascade: { type: modelName, id: resourceId } },
    } as unknown as WhereOptions,
    attributes: ["resourceId"],
    transaction,
  })) as unknown as { resourceId: string | null }[];
  const candidateIds = [...new Set(cascaded.map((row) => row.resourceId).filter(Boolean))];
  if (candidateIds.length === 0) {
    return [];
  }

  // Lock the candidates still deleted BEFORE reading their history. The
  // deleted-file sweep (D-22, attachmentFileSweep.service) locks the rows it purges and writes their
  // `file-purge` DELETE row in the same transaction: a sweep that got there
  // first is therefore visible to the read below (its row is then the latest
  // DELETE, and the attachment stays deleted — its bytes are gone), and one
  // that comes later skips the rows locked here.
  const locked = (await Attachment.unscoped().findAll({
    where: { id: candidateIds, tenantId, isDeleted: true } as unknown as WhereOptions,
    attributes: ["id", "resourceType", "resourceId", "originalName", "checksum"],
    lock: true,
    transaction,
  })) as unknown as AttachmentRow[];
  if (locked.length === 0) {
    return [];
  }

  // The most recent DELETE row of each decides it.
  const deletes = (await AuditLog.findAll({
    where: { tenantId, resourceType: "Attachment", action: "DELETE", resourceId: locked.map((row) => row.id) },
    attributes: ["resourceId", "changes", "createdAt"],
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    transaction,
  })) as unknown as { resourceId: string; changes: Record<string, unknown> | null }[];
  const latest = new Map<string, Record<string, unknown>>();
  for (const row of deletes) {
    if (!latest.has(row.resourceId)) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `row.changes || {}`
      latest.set(row.resourceId, row.changes || {});
    }
  }
  const rows = locked.filter((row) => {
    /* eslint-disable @typescript-eslint/prefer-optional-chain -- as built: `changes && changes.operation … && changes.cascade && …` */
    const changes = latest.get(row.id) as { operation?: unknown; cascade?: { type?: unknown; id?: unknown } } | undefined;
    return (
      changes &&
      changes.operation === "cascade-soft-delete" &&
      changes.cascade &&
      changes.cascade.type === modelName &&
      changes.cascade.id === resourceId
    );
    /* eslint-enable @typescript-eslint/prefer-optional-chain */
  });
  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);
  await Attachment.unscoped().update(
    { isDeleted: false },
    { where: { id: ids, tenantId, isDeleted: true }, transaction },
  );
  for (const row of rows) {
    await auditService.logAction(
      {
        tenantId,
        // A-282 (ADR-100): a key is system:api-key, its id in changes.
        ...auditEntryActor(actor),
        action: "UPDATE",
        resourceType: "Attachment",
        resourceId: row.id,
        changes: {
          ...actorChanges(actor),
          operation: "cascade-restore",
          before: { isDeleted: true },
          after: { isDeleted: false },
          originalName: row.originalName,
          checksum: row.checksum,
          resource: { type: row.resourceType, id: row.resourceId },
          cascade: { type: modelName, id: resourceId },
        },
      },
      { transaction },
    );
  }
  return ids;
};

// ------------------------------------------------------------------
// ORPHAN REPORT (D-22, ADR-070)
// ------------------------------------------------------------------

/**
 * D-22 — for each linkable model, its table and what makes a parent row LIVE.
 * A calibration record's `is_deleted` is a VOID (P6-03), not a delete: a voided
 * record is retained evidence, and so are its files — not orphans. A device's
 * `is_deleted` is its delete. A test holds every LINKABLE_RESOURCES model here.
 */
const LIVE_PARENTS = Object.freeze({
  Certificate: { table: "certificates", live: "p.deleted_at IS NULL" },
  CalibrationDevice: { table: "calibration_devices", live: "p.deleted_at IS NULL AND p.is_deleted = false" },
  CalibrationRecord: { table: "calibration_records", live: "p.deleted_at IS NULL" },
  MaintenanceWorkOrder: { table: "maintenance_work_orders", live: "p.deleted_at IS NULL" },
  KanbanCard: { table: "kanban_cards", live: "p.deleted_at IS NULL" },
});

const quoteList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(", ");

/**
 * The predicate "this attachment's parent is a live record of its tenant",
 * one EXISTS per linkable model. Built only from the two constant maps above —
 * never from input — so interpolating it is safe.
 */
const LIVE_PARENT_SQL = Object.entries(LIVE_PARENTS)
  .map(
    ([modelName, { table, live }]) =>
      `(lower(a.resource_type) IN (${quoteList(typesLinkingTo(modelName))}) AND EXISTS (` +
      `SELECT 1 FROM ${table} p WHERE p.id = a.resource_id AND p.tenant_id = a.tenant_id AND ${live}))`,
  )
  .join("\n        OR ");

// $1 is the caller's tenant (bound), in both statements.
const ORPHAN_FROM = `
    FROM attachments a
   WHERE a.tenant_id = $1
     AND a.is_deleted = false
     AND a.deleted_at IS NULL
     AND a.resource_id IS NOT NULL
     AND NOT (
        ${LIVE_PARENT_SQL}
     )`;

const ORPHAN_ROWS_SQL = `
  SELECT a.id, a.resource_type AS "resourceType", a.resource_id AS "resourceId",
         a.original_name AS "originalName", a.mime_type AS "mimeType", a.size,
         a.uploaded_by AS "uploadedBy", a.created_at AS "createdAt",
         CASE WHEN lower(a.resource_type) IN (${quoteList(Object.keys(LINKABLE_RESOURCES))})
              THEN 'parent_missing_or_deleted' ELSE 'unlinkable_type' END AS reason
  ${ORPHAN_FROM}
   ORDER BY a.created_at DESC, a.id
   LIMIT $2 OFFSET $3`;

const ORPHAN_COUNT_SQL = `SELECT count(*)::int AS total ${ORPHAN_FROM}`;

/** One orphan row as the statement answers it. */
type OrphanRow = Record<string, unknown> & { size: unknown };

/**
 * D-22 (ADR-070) — the caller's tenant's LIVE attachments whose link resolves
 * to no live record: the parent was deleted before the cascade existed, was
 * removed outside the application, or the type cannot be linked at all
 * (`unlinkable_type` — rows written before A-97). Read-only; what to do with an
 * orphan (delete it, or re-link it) is an administrator's decision, made
 * through the ordinary audited routes.
 *
 * Raw SQL (a polymorphic anti-join has no model form), so the tenant predicate
 * is explicit — and it is the attachment's tenant AND the parent's, so another
 * tenant's record never counts as a live parent.
 *
 * @param tenantId - the caller's tenant
 * @param query - `{ page, limit }`, coerced
 * @returns the page
 */
const listOrphans = async (
  tenantId: string,
  { page = 1, limit = DEFAULT_LIMIT }: { page?: unknown; limit?: unknown } = {},
): Promise<AttachmentPage> => {
  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const safePage = Math.max(Number(page) || 1, 1);
  const runner = db as unknown as SqlRunner;
  const [[countRow], rows] = await Promise.all([
    sql<{ total: number }>(runner, ORPHAN_COUNT_SQL, [tenantId]),
    sql<OrphanRow>(runner, ORPHAN_ROWS_SQL, [tenantId, safeLimit, (safePage - 1) * safeLimit]),
  ]);
  const { total } = countRow as { total: number };
  return {
    rows: rows.map((row) => ({ ...row, size: Number(row.size) })),
    meta: {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
};

// ------------------------------------------------------------------
// CREATE (from a multer-uploaded file)
// ------------------------------------------------------------------
const createAttachment = async (tenantId: string, file: unknown, meta: AttachmentMeta = {}): Promise<Record<string, unknown>> => {
  if (!file) {
    throw new AppError(400, "No file uploaded (expected multipart field 'file')");
  }
  const upload = file as UploadedFile;

  // S-17: multer wrote the file to the upload QUARANTINE (the attachments
  // route holds it there). P8-01: it is put into the tenant's storage only
  // after the link check and the virus scan pass — an object that failed
  // either never exists in storage, so it is never reachable.
  const absPath = upload.path;

  // A-97: multer has already written the file. A refused link must not leave
  // it on disk, or in the tenant's storage accounting.
  try {
    await assertLinkTarget(tenantId, meta.resourceType, meta.resourceId);
  } catch (err) {
    await fs.promises.unlink(absPath).catch(() => undefined);
    throw err;
  }

  // Virus-scan hook — reject + remove the file if flagged.
  const scan = (await virusScan.scanFile(absPath)) as { clean: boolean; reason?: unknown };
  if (!scan.clean) {
    await fs.promises.unlink(absPath).catch(() => undefined);
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string -- as built: an empty reason is "infected"
    throw new AppError(422, `File rejected by virus scan: ${scan.reason || "infected"}`);
  }

  let checksum: string;
  let scoped: Awaited<ReturnType<typeof storage.getTenantStorage>> | null = null;
  let storageKey: string | null = null;
  try {
    checksum = await computeChecksum(absPath);
    // S-17 + P8-01: out of quarantine only now that it has been scanned, and
    // straight into storage. Only a file IN the quarantine may leave it;
    // putLocalFile removes the quarantine copy once the object is written.
    assertInQuarantine(absPath);
    scoped = await storage.getTenantStorage(tenantId);
    storageKey = scoped.buildKey({ domain: "attachments", name: upload.filename });
    await storedFile.putLocalFile(scoped, storageKey, absPath, upload.mimetype);
  } catch (err) {
    await fs.promises.unlink(absPath).catch(() => undefined);
    // A put that failed part-way must not leave a partial object behind.
    if (scoped && storageKey) {
      await scoped.delete(storageKey).catch(() => undefined);
    }
    throw err;
  }
  const stored = scoped;
  const key = storageKey;

  // A-117: the row and its CREATE audit row commit together, or neither does
  // — as deleteAttachment (A-28). An upload used to leave no audit row at
  // all: evidence could be added to a certificate unattributably. If the
  // transaction fails, the stored object is removed too, so a refused upload
  // leaves nothing in the tenant's storage or its storage accounting.
  let attachment: AttachmentRow;
  try {
    attachment = await db.transaction(async (transaction) => {
      const created = (await Attachment.create(
        {
          tenantId,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty type is "generic"
          resourceType: meta.resourceType || "generic",
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id is null
          resourceId: meta.resourceId || null,
          fileName: upload.filename,
          originalName: upload.originalname,
          folder: ATTACH_FOLDER,
          // P8-01: where the bytes are. `folder` is kept for the legacy reader
          // and the migration tool; a keyed row is never read from it.
          storageKey: key,
          mimeType: upload.mimetype,
          size: upload.size,
          checksum,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty uploader is null
          uploadedBy: meta.uploadedBy || null,
        } as unknown as CreationAttributes<InstanceType<typeof Attachment>>,
        { transaction },
      )) as unknown as AttachmentRow;
      await auditService.logAction(
        {
          tenantId,
          // A-282 (ADR-100): an upload by an API key is system:api-key, its
          // id in changes (meta.uploadedBy is then null: it references users).
          ...auditEntryActor({
            userId: meta.uploadedBy,
            apiKeyId: meta.apiKeyId,
            ipAddress: meta.ipAddress,
            userAgent: meta.userAgent,
          } as unknown as Parameters<typeof auditEntryActor>[0]),
          action: "CREATE",
          resourceType: "Attachment",
          resourceId: created.id,
          changes: {
            ...actorChanges({ apiKeyId: meta.apiKeyId } as unknown as Parameters<typeof actorChanges>[0]),
            originalName: upload.originalname,
            mimeType: upload.mimetype,
            size: upload.size,
            checksum,
            resource: {
              type: created.resourceType,
              id: created.resourceId,
            },
          },
        },
        { transaction },
      );
      return created;
    });
  } catch (err) {
    await stored.delete(key).catch(() => undefined);
    throw err;
  }

  logger.info("Attachment created", {
    attachmentId: attachment.id,
    tenantId,
    resourceType: attachment.resourceType,
    size: upload.size,
  });

  return toPublic(attachment);
};

// ------------------------------------------------------------------
// LIST (tenant-scoped, optional resource filter)
// ------------------------------------------------------------------
const listAttachments = async (
  tenantId: string,
  { resourceType, resourceId, page = 1, limit = DEFAULT_LIMIT }: { resourceType?: unknown; resourceId?: unknown; page?: unknown; limit?: unknown } = {},
): Promise<AttachmentPage> => {
  const where: Record<string, unknown> = { tenantId };
  if (resourceType) {
    where["resourceType"] = resourceType;
  }
  if (resourceId) {
    where["resourceId"] = resourceId;
  }

  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = (Number(page) - 1) * safeLimit;

  const { count, rows } = await Attachment.findAndCountAll({
    where: where as WhereOptions,
    limit: safeLimit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return {
    rows: (rows as unknown as AttachmentRow[]).map(toPublic),
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
const loadOwned = async (tenantId: string, id: string): Promise<AttachmentRow> => {
  const attachment = (await Attachment.findOne({ where: { id, tenantId } })) as unknown as AttachmentRow | null;
  if (!attachment) {
    throw new AppError(404, "Attachment not found");
  }
  return attachment;
};

const getAttachment = async (tenantId: string, id: string): Promise<Record<string, unknown>> => toPublic(await loadOwned(tenantId, id));

/**
 * The bytes of a loaded, live row, ready to send. P8-01: a keyed row is opened
 * in its OWN tenant's storage (the row's tenant, never the caller's input), so
 * a key naming another tenant's namespace is refused by the storage guard. A
 * row without a key is a legacy file on disk, served as before.
 *
 * @throws {AppError} 410 when the bytes are gone
 */
const openAttachmentFile = async (attachment: AttachmentRow): Promise<StoredDownload> => {
  const fileName = attachment.originalName;
  const { mimeType } = attachment;
  if (attachment.storageKey) {
    const scoped = await storage.getTenantStorage(attachment.tenantId);
    try {
      return { object: await storedFile.openObject(scoped, attachment.storageKey), fileName, mimeType };
    } catch (err) {
      if (storedFile.isMissing(err)) {
        throw new AppError(410, "Attachment file is no longer available");
      }
      throw err;
    }
  }
  const absPath = resolveAbsPath(attachment);
  if (!fs.existsSync(absPath)) {
    throw new AppError(410, "Attachment file is no longer available");
  }
  return { absPath, fileName, mimeType };
};

// Returns the object (or legacy path), file name and type for a download.
const getDownload = async (tenantId: string, id: string): Promise<StoredDownload> =>
  openAttachmentFile(await loadOwned(tenantId, id));

// ------------------------------------------------------------------
// DELETE (soft row + unlinked file — removes it from listings, storage-quota
// accounting, and every download path)
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
/**
 * Remove a deleted attachment's file. Never throws: the delete has committed,
 * so a file that cannot be removed is logged (it is unreachable, not exposed)
 * rather than turning a completed delete into an error.
 *
 * @param attachment - `{ id, folder, fileName }`
 * @returns whether the file is gone
 */
const unlinkAttachmentFile = async (attachment: AttachmentRow): Promise<boolean> => {
  try {
    if (attachment.storageKey) {
      // P8-01: the object, in the row's own tenant's storage.
      await storedFile.removeObject(await storage.getTenantStorage(attachment.tenantId), attachment.storageKey);
    } else {
      await fs.promises.rm(resolveAbsPath(attachment), { force: true });
    }
    return true;
  } catch (err) {
    logger.warn("Deleted attachment's file could not be removed", {
      attachmentId: attachment.id,
      error: messageOf(err),
    });
    return false;
  }
};

const CERTIFICATE_RESOURCE = "certificate";
const LOCKED_CERTIFICATE_STATES = ["approved", "signed"];

const deleteAttachment = async (tenantId: string, id: string, actor: AttachmentActor = {}): Promise<{ id: string }> => {
  const attachment = await loadOwned(tenantId, id);

  if (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a legacy row's type is compared as a string
    String(attachment.resourceType).toLowerCase() === CERTIFICATE_RESOURCE &&
    attachment.resourceId
  ) {
    const parent = (await Certificate.findOne({
      where: { id: attachment.resourceId, tenantId },
      attributes: ["id", "status", "certificateNumber"],
    })) as unknown as { status: string; certificateNumber: string } | null;
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
        // A-282 (ADR-100): a key is system:api-key, its id in changes.
        ...auditEntryActor(actor),
        action: "DELETE",
        resourceType: "Attachment",
        resourceId: attachment.id,
        changes: {
          ...actorChanges(actor),
          before: { isDeleted: false },
          after: { isDeleted: true },
          originalName: attachment.originalName,
          checksum: attachment.checksum,
          resource: {
            type: attachment.resourceType,
            id: attachment.resourceId,
          },
        },
      },
      { transaction },
    );
  });

  // ADR-042 step 6 (S-01): the delete revokes the BYTES too, not just the
  // row. The file is unlinked AFTER the transaction has committed — not inside
  // it. A filesystem unlink cannot be rolled back: done inside, a transaction
  // that then failed (the audit insert, the commit itself) would leave a live
  // row whose evidence is gone. Done after, the worst case is the reverse — a
  // crash between commit and unlink leaves an orphan file — and an orphan is
  // harmless now that no route serves a deleted attachment (both download
  // paths read through the row, and the row is soft-deleted). The unlink is
  // only reached once the delete is permitted: evidence of an approved or
  // signed certificate is refused above with a 409 and keeps its file.
  await unlinkAttachmentFile(attachment);

  logger.info("Attachment soft-deleted", {
    attachmentId: attachment.id,
    tenantId,
    // A-124: the audit row above refused a delete with no actor.
    deletedBy: actor.userId,
  });

  return { id };
};

// ------------------------------------------------------------------
// SIGNED URLS (HMAC token with expiry — public download without a session)
// ------------------------------------------------------------------
const generateSignedUrl = async (
  tenantId: string,
  id: string,
  { baseUrl, expiresInSec }: { baseUrl?: string | undefined; expiresInSec?: unknown } = {},
): Promise<{ url: string; token: string; expiresAt: Date; expiresInSec: number }> => {
  const attachment = await loadOwned(tenantId, id);
  const ttl = Number(expiresInSec) > 0 ? Number(expiresInSec) : DEFAULT_SIGNED_TTL;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = crypto
    .createHmac("sha256", SIGNING_KEY)
    .update(`${attachment.id}.${String(exp)}`)
    .digest("hex");
  const token = `${String(exp)}.${sig}`;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty base URL falls through
  const base = (baseUrl || env("PUBLIC_BASE_URL") || "http://localhost:5000").replace(/\/$/, "");
  return {
    url: `${base}/api/v1/attachments/${attachment.id}/signed?token=${token}`,
    token,
    expiresAt: new Date(exp * 1000),
    expiresInSec: ttl,
  };
};

const verifySignedToken = (attachmentId: string, token: unknown): boolean => {
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
    .createHmac("sha256", SIGNING_KEY)
    .update(`${attachmentId}.${String(exp)}`)
    .digest("hex");
  if (sig.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
};

// Resolve a download from a signed token (no tenant/session required).
const getSignedDownload = async (id: string, token: unknown): Promise<StoredDownload> => {
  if (!verifySignedToken(id, token)) {
    throw new AppError(403, "Invalid or expired download link");
  }
  const attachment = (await Attachment.findByPk(id)) as unknown as AttachmentRow | null;
  if (!attachment) {
    throw new AppError(404, "Attachment not found");
  }
  return openAttachmentFile(attachment);
};

// The exported object, its keys in the JavaScript's order (`exports.x = …`).
// `_verifySignedToken` is exported for tests; `resolveAbsPath` for the
// deleted-file sweep (D-22, ADR-083), which resolves a row's file with the same
// S-15 guard, so it can never remove anything outside the uploads tree.
export = {
  softDeleteForResource,
  restoreForResource,
  listOrphans,
  LINKABLE_RESOURCES,
  LIVE_PARENTS,
  createAttachment,
  listAttachments,
  getAttachment,
  getDownload,
  deleteAttachment,
  generateSignedUrl,
  getSignedDownload,
  _verifySignedToken: verifySignedToken,
  resolveAbsPath,
};
