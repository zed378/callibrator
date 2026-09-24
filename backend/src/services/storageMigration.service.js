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
 *     the row's recorded checksum (or, for a row with none, the source file's
 *     own hash, taken before the copy — A-40) before the key is committed. A
 *     byte that changed in transit fails the row instead of silently
 *     corrupting it, and a source that no longer matches its recorded
 *     checksum is refused before it is copied.
 *   - **Non-destructive** — the legacy file is left in place. Reclaiming disk is
 *     a separate, deliberate step once the migration is confirmed.
 *   - **Dry-run** — reports exactly what would move without writing anything.
 *
 * The thin CLI wrapper lives in scripts/migrateStorage.js.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
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

/**
 * Absolute legacy path for a row, refusing one outside the uploads tree.
 *
 * S-15: the root is FIXED — `storagePath("uploads")`. It used to be
 * `storagePath(...parts)`, built from the row's own `folder`, so a folder of
 * `../../etc` moved the root with it and the check passed. Both sides are
 * `path.resolve`d and the prefix carries the separator. A row with an empty
 * folder names a file at the storage root, which is not an upload, and is
 * refused (migrateAll records it as failed and moves on).
 */
const legacyPath = (attachment) => {
  const parts = String(attachment.folder || "")
    .split(/[\\/]/)
    .filter(Boolean);
  const abs = path.resolve(storagePath(...parts, String(attachment.fileName || "")));
  const root = path.resolve(storagePath("uploads"));
  if (!abs.startsWith(root + path.sep)) {
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

  // A-40. The copy is ALWAYS verified. It used to be verified only
  // `if (attachment.checksum && …)`, so a row with no recorded checksum was
  // copied unchecked and still reported `migrated` — the operator-facing
  // claim is "verified copy", and for those rows it was not. The source is
  // hashed first: it is what the copy must match when there is no recorded
  // checksum, and when there is one, a source that no longer matches it is
  // refused BEFORE anything is copied (the file on disk changed since upload,
  // and copying it would launder the change into the new store).
  const sourceHash = await hashStream(fs.createReadStream(source));
  if (attachment.checksum && sourceHash !== attachment.checksum) {
    throw new AppError(
      500,
      `Source file for ${attachment.id} does not match its recorded checksum: on disk ${sourceHash} != recorded ${attachment.checksum}`,
    );
  }
  const expected = attachment.checksum || sourceHash;

  // Copy the bytes into storage.
  await scoped.put(key, fs.createReadStream(source), {
    contentType: attachment.mimeType || "application/octet-stream",
  });

  // Verify the round-trip before trusting the copy.
  const readBack = await hashStream(await scoped.get(key));
  if (readBack !== expected) {
    // Undo the partial copy so a re-run starts clean.
    await scoped.delete(key).catch(() => {});
    throw new AppError(
      500,
      `Checksum mismatch migrating ${attachment.id}: stored ${readBack} != expected ${expected}`,
    );
  }

  attachment.storageKey = key;
  await attachment.save({ hooks: false });

  return {
    ...base,
    status: "migrated",
    key,
    verified: true,
    // What the copy was verified against. `source-file` means the row never
    // had a checksum: the copy matches the file as it is on disk now, which
    // is all that can be proven — not that the file is what was uploaded.
    verifiedAgainst: attachment.checksum ? "recorded-checksum" : "source-file",
  };
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
