/**
 * The sweep of soft-deleted attachments' FILES (D-22, ADR-083).
 *
 * A parent's soft delete soft-deletes its attachments and KEEPS their files
 * (ADR-070): deleting a draft certificate is not a decision to destroy the
 * evidence bytes, and a restore of the parent brings them back (A-133). But
 * nothing ever removed them afterwards — every cascaded file stayed on disk
 * for good, unreachable (no gated path serves a deleted row) and uncounted by
 * the quota. This removes them once the row has been deleted for longer than
 * the retention window.
 *
 *  - WHAT: a row that is deleted — `is_deleted = true` last written before the
 *    cutoff, or paranoid `deleted_at` before it — and whose `file_purged_at`
 *    is NULL. A LIVE row is never touched: the where clause says so, and the
 *    row is locked (`FOR UPDATE SKIP LOCKED`) for the whole batch, so a
 *    restore racing the sweep waits for it or is skipped by it.
 *  - WINDOW: `ATTACHMENT_FILE_RETENTION_DAYS`, default 90, never below 30 — the
 *    time a parent's restore can still bring its files back.
 *  - HOW: the legacy disk file (resolved with attachment.service's S-15 guard,
 *    so nothing outside the uploads tree is ever removed) and, when the row was
 *    migrated into pluggable storage, its object too. Then `file_purged_at` is
 *    set and ONE audit row per attachment is written, in the batch's
 *    transaction: action DELETE, `changes.operation = "file-purge"`, actor
 *    `system:attachment-file-sweep` (ADR-051 Q-13). Being the attachment's
 *    latest DELETE row, it also stops a later parent restore from reviving a
 *    row whose bytes are gone (attachment.service#restoreForResource restores
 *    only a row whose latest DELETE is the cascade).
 *  - OUTCOMES recorded per row (`changes.file`): `removed`, `absent` (already
 *    gone — an explicit delete unlinks at once), `outside-uploads` (a row
 *    whose path the S-15 guard refuses: nothing is removed, and it is not
 *    looked at again). A file or object that cannot be removed is NOT marked:
 *    it is logged, counted, and tried again by the next run.
 *  - BOUNDED: `ATTACHMENT_FILE_SWEEP_BATCH` rows (200) per transaction and
 *    `ATTACHMENT_FILE_SWEEP_MAX_ROWS` (5,000) examined per run; each tenant is
 *    walked by keyset on id, so a failing row never blocks the ones after it.
 *    A backlog larger than a run is finished by the following runs, and the
 *    run says it stopped early.
 *  - PER TENANT, in the tenant's context (runForTenant, ADR-060), with the
 *    tenant predicate explicit as well.
 *
 * The bytes are removed INSIDE the batch's transaction, before it commits. A
 * filesystem unlink cannot roll back: if the commit then fails, the file is
 * gone and the row unmarked — the next run finds it `absent` and records that.
 * The reverse order (commit, then unlink) would leave a row marked purged
 * whose bytes remain whenever the unlink failed, and nothing would look again.
 *
 * Run daily by middlewares/attachmentFileSweepScheduler.middleware.js, under
 * the one scheduler switch (SCHEDULERS_ENABLED, ADR-060).
 */
const fs = require("fs");
const { Op } = require("sequelize");
const { Tenant, Attachment } = require("../models");
const { db } = require("../config");
const auditService = require("./audit.service");
const storage = require("./storage");
const { resolveAbsPath } = require("./attachment.service");
const { runForTenant } = require("../utils/jobContext.util");
const { SYSTEM_ACTORS } = require("../constants/systemActors");
const { logger } = require("../middlewares/activityLog.middleware");

const DEFAULT_RETENTION_DAYS = 90;
const MIN_RETENTION_DAYS = 30;
const DEFAULT_BATCH = 200;
const DEFAULT_MAX_ROWS = 5000;
const TENANT_PAGE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

const ATTRIBUTES = Object.freeze([
  "id",
  "tenantId",
  "resourceType",
  "resourceId",
  "folder",
  "fileName",
  "storageKey",
  "originalName",
  "checksum",
  "isDeleted",
  "deletedAt",
  "updatedAt",
]);

/**
 * A positive integer from the environment, or the fallback.
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
const positiveInt = (name, fallback) => {
  const n = Math.floor(Number(process.env[name]));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** The retention window in days: the variable, else 90, never below 30. */
const retentionDays = () =>
  Math.max(positiveInt("ATTACHMENT_FILE_RETENTION_DAYS", DEFAULT_RETENTION_DAYS), MIN_RETENTION_DAYS);

/**
 * Remove one deleted row's bytes. Resolves to the outcome; rejects when a
 * file or object exists and could not be removed (the row is then retried).
 *
 * @param {object} row - an Attachment with ATTRIBUTES
 * @returns {Promise<{file: string, storageObject: boolean}>}
 */
const removeBytes = async (row) => {
  let absPath;
  try {
    absPath = resolveAbsPath(row);
  } catch {
    // The S-15 guard refused the row's path: it names nothing inside the
    // uploads tree, so there is nothing this sweep may remove.
    return { file: "outside-uploads", storageObject: false };
  }
  let file = "removed";
  try {
    await fs.promises.unlink(absPath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      throw err;
    }
    file = "absent";
  }
  if (row.storageKey) {
    const scoped = await storage.getTenantStorage(row.tenantId);
    await scoped.delete(row.storageKey);
  }
  return { file, storageObject: Boolean(row.storageKey) };
};

/**
 * One batch of one tenant: lock up to `limit` expired rows after `after`,
 * remove their bytes, mark and audit them, in one transaction.
 *
 * @returns {Promise<{examined: number, last: string|null, counts: object}>}
 */
const sweepBatch = async (tenantId, cutoff, days, after, limit, now) =>
  db.transaction(async (transaction) => {
    const rows = await Attachment.unscoped().findAll({
      where: {
        tenantId,
        filePurgedAt: null,
        ...(after ? { id: { [Op.gt]: after } } : {}),
        [Op.or]: [
          { isDeleted: true, updatedAt: { [Op.lt]: cutoff } },
          { deletedAt: { [Op.lt]: cutoff } },
        ],
      },
      attributes: [...ATTRIBUTES],
      order: [["id", "ASC"]],
      limit,
      paranoid: false,
      lock: true,
      skipLocked: true,
      transaction,
    });
    const counts = { removed: 0, absent: 0, outsideUploads: 0, failed: 0 };
    for (const row of rows) {
      let outcome;
      try {
        outcome = await removeBytes(row);
      } catch (err) {
        counts.failed += 1;
        logger.warn("Deleted attachment's file could not be removed; the next sweep retries", {
          attachmentId: row.id,
          tenantId,
          error: err.message,
        });
        continue;
      }
      counts[outcome.file === "outside-uploads" ? "outsideUploads" : outcome.file] += 1;
      await Attachment.unscoped().update(
        { filePurgedAt: now },
        { where: { id: row.id, tenantId }, paranoid: false, transaction },
      );
      await auditService.logAction(
        {
          tenantId,
          systemActor: SYSTEM_ACTORS.ATTACHMENT_FILE_SWEEP,
          action: "DELETE",
          resourceType: "Attachment",
          resourceId: row.id,
          changes: {
            operation: "file-purge",
            file: outcome.file,
            storageObject: outcome.storageObject,
            deletedSince: (row.deletedAt || row.updatedAt).toISOString(),
            olderThan: cutoff.toISOString(),
            retentionDays: days,
            originalName: row.originalName,
            checksum: row.checksum,
            resource: { type: row.resourceType, id: row.resourceId },
          },
        },
        { transaction },
      );
    }
    return { examined: rows.length, last: rows.length ? rows[rows.length - 1].id : null, counts };
  });

/**
 * Sweep one tenant until nothing is left or `budget` rows were examined.
 * @returns {Promise<{examined: number, removed: number, absent: number, outsideUploads: number, failed: number}>}
 */
const sweepTenant = async (tenantId, cutoff, days, batch, budget, now) => {
  const total = { examined: 0, removed: 0, absent: 0, outsideUploads: 0, failed: 0 };
  let after = null;
  while (total.examined < budget) {
    const limit = Math.min(batch, budget - total.examined);
    const { examined, last, counts } = await sweepBatch(tenantId, cutoff, days, after, limit, now);
    total.examined += examined;
    for (const key of Object.keys(counts)) {
      total[key] += counts[key];
    }
    if (examined < limit) {
      break;
    }
    after = last;
  }
  return total;
};

/**
 * One sweep over every tenant, soft-deleted tenants included (their deleted
 * attachments' files are removed like any other's), read a page at a time.
 *
 * @param {{now?: Date}} [options]
 * @returns {Promise<{tenants: number, examined: number, removed: number, absent: number, outsideUploads: number, failed: number, retentionDays: number, cutoff: string, stoppedEarly: boolean}>}
 */
const sweepDeletedAttachmentFiles = async ({ now = new Date() } = {}) => {
  const days = retentionDays();
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const batch = positiveInt("ATTACHMENT_FILE_SWEEP_BATCH", DEFAULT_BATCH);
  const maxRows = positiveInt("ATTACHMENT_FILE_SWEEP_MAX_ROWS", DEFAULT_MAX_ROWS);

  const summary = { tenants: 0, examined: 0, removed: 0, absent: 0, outsideUploads: 0, failed: 0 };
  let after = null;
  outer: for (;;) {
    // `tenants` carries no tenant column: listing them needs no opt-out.
    const tenants = await Tenant.findAll({
      where: after ? { id: { [Op.gt]: after } } : {},
      attributes: ["id"],
      order: [["id", "ASC"]],
      limit: TENANT_PAGE,
      paranoid: false,
    });
    for (const { id: tenantId } of tenants) {
      if (summary.examined >= maxRows) {
        break outer;
      }
      summary.tenants += 1;
      const result = await runForTenant(tenantId, () =>
        sweepTenant(tenantId, cutoff, days, batch, maxRows - summary.examined, now),
      );
      for (const key of Object.keys(result)) {
        summary[key] += result[key];
      }
    }
    if (tenants.length < TENANT_PAGE) {
      break;
    }
    after = tenants[tenants.length - 1].id;
  }

  return {
    ...summary,
    retentionDays: days,
    cutoff: cutoff.toISOString(),
    stoppedEarly: summary.examined >= maxRows,
  };
};

module.exports = {
  sweepDeletedAttachmentFiles,
  retentionDays,
  DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
};
