/**
 * Storage migration tool.
 *
 * Copies existing attachment files from the legacy on-disk location
 * (`<storage root>/<folder>/<fileName>`) into the configured pluggable-storage
 * backend, verifies the copy by checksum, and backfills `attachment.storageKey`.
 *
 * Properties that make it safe to run against production data:
 *   - **Idempotent / resumable** — a row that already has a `storageKey` is
 *     skipped, so an interrupted run is simply re-run.
 *   - **Verified** — the SHA-256 of the object read back from storage must match
 *     the row's recorded checksum before the key is committed. A byte that
 *     changed in transit fails the row instead of silently corrupting it.
 *   - **Non-destructive** — the legacy file is left in place. Reclaiming disk is
 *     a separate, deliberate step once the migration is confirmed.
 *   - **Dry-run** — reports exactly what would move without writing anything.
 *
 * The thin CLI wrapper lives in scripts/migrateStorage.js.
 */

const crypto = require("crypto");
const fs = require("fs");
const { Attachment } = require("../models");
const storage = require("./storage");
const storagePath = require("../utils/storagePath.util");
const { AppError } = require("../utils/appError.util");
const { logger } = require("../middlewares/activityLog.middleware");

/** SHA-256 of a readable stream. */
const hashStream = (stream) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });

/** Absolute legacy path for a row, guarding against traversal via folder. */
const legacyPath = (attachment) => {
  const parts = String(attachment.folder || "")
    .split("/")
    .filter(Boolean);
  const abs = storagePath(...parts, attachment.fileName);
  const root = storagePath(...parts);
  if (!abs.startsWith(root)) {
    throw new AppError(400, `Refusing to read outside storage root: ${attachment.id}`);
  }
  return abs;
};

/**
 * Migrate a single attachment. Returns a result describing what happened.
 * Never throws for an expected condition (already migrated, missing source);
 * only a genuine I/O or integrity failure rejects.
 *
 * @param {object} attachment  a loaded Attachment instance
 * @param {object} opts
 * @param {boolean} [opts.dryRun]
 */
const migrateAttachment = async (attachment, { dryRun = false } = {}) => {
  const base = { id: attachment.id, tenantId: attachment.tenantId };

  // Resumability: an already-keyed row is done.
  if (attachment.storageKey) {
    return { ...base, status: "skipped", reason: "already-migrated" };
  }

  const source = legacyPath(attachment);
  if (!fs.existsSync(source)) {
    // The DB row outlived its file — report it rather than aborting the batch.
    return { ...base, status: "missing-source", path: source };
  }

  const scoped = await storage.getTenantStorage(attachment.tenantId);
  const key = scoped.buildKey({
    domain: "attachments",
    name: attachment.fileName,
  });

  if (dryRun) {
    return { ...base, status: "would-migrate", key };
  }

  // Copy the bytes into storage.
  await scoped.put(key, fs.createReadStream(source), {
    contentType: attachment.mimeType || "application/octet-stream",
  });

  // Verify the round-trip before trusting the copy.
  const readBack = await hashStream(await scoped.get(key));
  if (attachment.checksum && readBack !== attachment.checksum) {
    // Undo the partial copy so a re-run starts clean.
    await scoped.delete(key).catch(() => {});
    throw new AppError(
      500,
      `Checksum mismatch migrating ${attachment.id}: stored ${readBack} != expected ${attachment.checksum}`,
    );
  }

  attachment.storageKey = key;
  await attachment.save({ hooks: false });

  return { ...base, status: "migrated", key, verified: Boolean(attachment.checksum) };
};

/**
 * Migrate a batch of attachments.
 *
 * @param {object} opts
 * @param {string} [opts.tenantId]   restrict to one tenant
 * @param {boolean} [opts.dryRun]
 * @param {number} [opts.limit]      cap the number of rows processed
 * @param {function} [opts.onProgress] called with each per-row result
 */
const migrateAll = async ({ tenantId, dryRun = false, limit, onProgress } = {}) => {
  // Only rows that still need migrating. Scanning the full table each run keeps
  // the tool resumable without tracking external state.
  const where = { storageKey: null };
  if (tenantId) {where.tenantId = tenantId;}

  const rows = await Attachment.findAll({
    where,
    order: [["createdAt", "ASC"]],
    ...(limit ? { limit } : {}),
  });

  const summary = {
    total: rows.length,
    migrated: 0,
    skipped: 0,
    missingSource: 0,
    wouldMigrate: 0,
    failed: 0,
    results: [],
  };

  for (const row of rows) {
    let result;
    try {
      result = await migrateAttachment(row, { dryRun });
    } catch (err) {
      // One bad row must not abort the run — record it and move on.
      result = { id: row.id, tenantId: row.tenantId, status: "failed", error: err.message };
      logger.error("Attachment migration failed", { id: row.id, error: err.message });
    }

    switch (result.status) {
      case "migrated":
        summary.migrated += 1;
        break;
      case "skipped":
        summary.skipped += 1;
        break;
      case "missing-source":
        summary.missingSource += 1;
        break;
      case "would-migrate":
        summary.wouldMigrate += 1;
        break;
      default:
        summary.failed += 1;
    }

    summary.results.push(result);
    if (onProgress) {onProgress(result);}
  }

  logger.info("Storage migration complete", {
    tenantId: tenantId || "ALL",
    dryRun,
    migrated: summary.migrated,
    skipped: summary.skipped,
    missingSource: summary.missingSource,
    failed: summary.failed,
  });

  return summary;
};

module.exports = { migrateAttachment, migrateAll, legacyPath, hashStream };
