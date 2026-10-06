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
 * P8-01 (ADR-086 Amendment 1): since the request paths were cut over to the
 * storage layer, the tool also copies the other classes of file the
 * application kept on disk before — certificate PDFs, the public image class
 * (avatars, tenant logos, CMS images) and tenant backups — each with the same
 * three properties (resumable, verified, non-destructive). GDPR exports are
 * not migrated: they live seven days, and the legacy directory is still read
 * and swept until the last one expires.
 *
 * The thin CLI wrapper lives in scripts/migrateStorage.ts.
 *
 * P9-18 (ADR-087, Stage C): converted from storageMigration.service.js with no
 * behaviour change, under the four isolation gates. `export =` keeps the
 * object `require()` returned (the same keys, in the same order); `migrateAll`
 * still calls the local `migrateAttachment`, as the `.js` did. `Attachment`,
 * `storagePath`, `AppError` and the logger are captured at load; `storage` is
 * read at call time through its object.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { Readable } from "stream";
import type { WhereOptions } from "sequelize";
import models from "../models";
import storage from "./storage";
import loadedStoragePath from "../utils/storagePath.util";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { Op } from "sequelize";
import type { Transaction } from "sequelize";
import { db } from "../config";
import auditService from "./audit.service";
import { runForTenant } from "../utils/jobContext.util";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import storedFile from "./storedFile.service";
import { PUBLIC_STORAGE_DOMAINS, PUBLIC_IMAGE_TYPES, publicStorageKey } from "../utils/upload.util";
import type { ModelInstance } from "../types/models";

const { Attachment, Certificate, TenantBackup } = models;
const storagePath = loadedStoragePath;
const AppError = LoadedAppError;
const logger = loadedLogger;

type AttachmentRow = ModelInstance<"Attachment">;

/** A row whose location field the tool rewrites. */
interface MovableRow {
  id: string;
  tenantId: string;
  save(options: { hooks: false; transaction: Transaction }): Promise<unknown>;
  [field: string]: unknown;
}

/**
 * P8-01 (ADR-086 Amendment 1) — the row now names its storage key, and ONE
 * audit row (`system:storage-migration`, in the row's tenant) records the
 * move, in one transaction: a backfill that commits without its row would
 * change where tenant evidence is read from with nobody able to say when or
 * why. The verified copy happened before; the transaction holds only the two
 * database writes. If it fails, the copy stays (a re-run finds it and skips
 * the copy) and the row is unchanged.
 */
const recordMove = async (
  row: MovableRow,
  resourceType: string,
  field: "storageKey" | "filePath",
  key: string,
  detail: Record<string, unknown>,
): Promise<void> => {
  const before = row[field] ?? null;
  await runForTenant(row.tenantId, () =>
    db.transaction(async (transaction: Transaction) => {
      row[field] = key;
      await row.save({ hooks: false, transaction });
      await auditService.logAction(
        {
          tenantId: row.tenantId,
          systemActor: SYSTEM_ACTORS.STORAGE_MIGRATION,
          action: "UPDATE",
          resourceType,
          resourceId: row.id,
          changes: {
            operation: "STORAGE_MIGRATE",
            actor: SYSTEM_ACTORS.STORAGE_MIGRATION,
            [field]: { before, after: key },
            ...detail,
          },
        },
        { transaction },
      );
    }),
  );
};

/** One row's outcome. */
type MigrationResult = Record<string, unknown> & { id: unknown; tenantId: unknown; status: string };

/** SHA-256 of a readable stream. */
const hashStream = (stream: Readable): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.on("end", () => { resolve(hash.digest("hex")); });
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
const legacyPath = (attachment: { id?: unknown; folder?: unknown; fileName?: unknown }): string => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: any falsy folder reads as none; String() of the stored value
  const parts = String(attachment.folder || "")
    .split(/[\\/]/)
    .filter(Boolean);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/no-base-to-string -- as built: any falsy name reads as none; String() of the stored value
  const abs = path.resolve(storagePath(...parts, String(attachment.fileName || "")));
  const root = path.resolve(storagePath("uploads"));
  if (!abs.startsWith(root + path.sep)) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the id as given
    throw new AppError(400, `Refusing to read outside storage root: ${attachment.id}`);
  }
  return abs;
};

/**
 * Migrate a single attachment. Returns a result describing what happened.
 * Never throws for an expected condition (already migrated, missing source);
 * only a genuine I/O or integrity failure rejects.
 *
 * @param attachment  a loaded Attachment instance
 * @param opts.dryRun
 */
const migrateAttachment = async (
  attachment: AttachmentRow,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<MigrationResult> => {
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
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty checksum reads as none
  const expected = attachment.checksum || sourceHash;

  // Copy the bytes into storage.
  await scoped.put(key, fs.createReadStream(source), {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty type also falls back
    contentType: attachment.mimeType || "application/octet-stream",
  });

  // Verify the round-trip before trusting the copy.
  // A driver's get answers a readable stream.
  const readBack = await hashStream((await scoped.get(key)) as Readable);
  if (readBack !== expected) {
    // Undo the partial copy so a re-run starts clean.
    await scoped.delete(key).catch(() => undefined);
    throw new AppError(
      500,
      `Checksum mismatch migrating ${attachment.id}: stored ${readBack} != expected ${expected}`,
    );
  }

  await recordMove(attachment as unknown as MovableRow, "Attachment", "storageKey", key, {
    verifiedAgainst: attachment.checksum ? "recorded-checksum" : "source-file",
  });

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
 * @param opts.tenantId   restrict to one tenant
 * @param opts.dryRun
 * @param opts.limit      cap the number of rows processed
 * @param opts.onProgress called with each per-row result
 */
const migrateAll = async (
  {
    tenantId,
    dryRun = false,
    limit,
    onProgress,
  }: { tenantId?: string | null; dryRun?: boolean; limit?: number | null; onProgress?: ((result: MigrationResult) => void) | null } = {},
): Promise<{
  total: number;
  migrated: number;
  skipped: number;
  missingSource: number;
  wouldMigrate: number;
  failed: number;
  results: MigrationResult[];
}> => {
  // Only rows that still need migrating. Scanning the full table each run keeps
  // the tool resumable without tracking external state.
  const where: Record<string, unknown> = { storageKey: null };
  if (tenantId) {where["tenantId"] = tenantId;}

  const rows = await Attachment.findAll({
    where: where as WhereOptions<AttachmentRow>,
    order: [["createdAt", "ASC"], ["id", "ASC"]],
    ...(limit ? { limit } : {}),
  });

  const summary = {
    total: rows.length,
    migrated: 0,
    skipped: 0,
    missingSource: 0,
    wouldMigrate: 0,
    failed: 0,
    results: [] as MigrationResult[],
  };

  for (const row of rows) {
    let result: MigrationResult;
    try {
      result = await migrateAttachment(row, { dryRun });
    } catch (err) {
      // One bad row must not abort the run — record it and move on.
      result = { id: row.id, tenantId: row.tenantId, status: "failed", error: (err as Error).message };
      logger.error("Attachment migration failed", { id: row.id, error: (err as Error).message });
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
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as ALL
    tenantId: tenantId || "ALL",
    dryRun,
    migrated: summary.migrated,
    skipped: summary.skipped,
    missingSource: summary.missingSource,
    failed: summary.failed,
  });

  return summary;
};

// ------------------------------------------------------------------
// P8-01 — THE OTHER CLASSES OF FILE
// ------------------------------------------------------------------

/** The storage-bound object the copies go through (ScopedStorage). */
type Scoped = Awaited<ReturnType<typeof storage.getTenantStorage>>;

/** Rows read per query by the classes below (D-24). */
const PAGE = 500;

/**
 * Every row a keyset-paged query answers: pages of PAGE rows, each after the
 * last id of the one before, until a short page.
 */
const keysetPages = async <T extends { id: string }>(page: (after: string | null) => Promise<unknown>): Promise<T[]> => {
  const out: T[] = [];
  let after: string | null = null;
  for (;;) {
    const rows = (await page(after)) as T[];
    out.push(...rows);
    if (rows.length < PAGE) {return out;}
    after = (rows[rows.length - 1] as T).id;
  }
};

/** `where`, narrowed to the ids after `after` when there is one. */
const afterId = (where: Record<string | symbol, unknown>, after: string | null): WhereOptions => {
  const narrowed: Record<string | symbol, unknown> = after ? { ...where, id: { [Op.gt]: after } } : where;
  return narrowed;
};

/** A per-class summary, the shape migrateAll reports. */
interface ClassSummary {
  total: number;
  migrated: number;
  skipped: number;
  missingSource: number;
  wouldMigrate: number;
  failed: number;
  results: MigrationResult[];
}

const emptySummary = (): ClassSummary => ({
  total: 0,
  migrated: 0,
  skipped: 0,
  missingSource: 0,
  wouldMigrate: 0,
  failed: 0,
  results: [],
});

/** Count one result into a summary, and report it. */
const tally = (summary: ClassSummary, result: MigrationResult, onProgress?: ((r: MigrationResult) => void) | null): void => {
  summary.total += 1;
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
};

/**
 * Copy one file on disk to `key`, verified, unless it is already there.
 *
 *  - An object already at `key` whose bytes match the source is `skipped`
 *    (a re-run). One whose bytes DIFFER is a failure, and is not overwritten:
 *    something else wrote that key, and a person has to look.
 *  - `expected` (a recorded checksum) is checked against the source BEFORE
 *    anything is copied, as migrateAttachment does (A-40).
 *  - The copy is read back and hashed; a mismatch deletes it and fails.
 */
const copyVerified = async (
  scoped: Scoped,
  key: string,
  source: string,
  contentType: string,
  { dryRun, expected }: { dryRun: boolean; expected?: string | null | undefined },
): Promise<{ status: string; reason?: string }> => {
  const sourceHash = await hashStream(fs.createReadStream(source));
  if (expected && sourceHash !== expected) {
    throw new AppError(500, `Source ${path.basename(source)} does not match its recorded checksum: on disk ${sourceHash} != recorded ${expected}`);
  }
  if (await scoped.exists(key)) {
    const present = await hashStream((await scoped.get(key)) as Readable);
    if (present !== sourceHash) {
      throw new AppError(500, `An object already at ${key} does not match its source: stored ${present} != source ${sourceHash}`);
    }
    return { status: "skipped", reason: "already-migrated" };
  }
  if (dryRun) {
    return { status: "would-migrate" };
  }
  await scoped.put(key, fs.createReadStream(source), { contentType });
  const readBack = await hashStream((await scoped.get(key)) as Readable);
  if (readBack !== sourceHash) {
    await scoped.delete(key).catch(() => undefined);
    throw new AppError(500, `Checksum mismatch copying ${path.basename(source)} to ${key}: stored ${readBack} != source ${sourceHash}`);
  }
  return { status: "migrated" };
};

/** Run one item, turning a thrown failure into a `failed` result (one bad item never aborts the run). */
const attempt = async (base: { id: unknown; tenantId: unknown }, run: () => Promise<MigrationResult>): Promise<MigrationResult> => {
  try {
    return await run();
  } catch (err) {
    logger.error("Storage migration failed", { ...base, error: (err as Error).message });
    return { ...base, status: "failed", error: (err as Error).message };
  }
};

/**
 * Certificate PDFs rendered before M-11, at `uploads/certificates/<file>`.
 * Copied to `t/<tenantId>/certificates/<file>` — the key certificatePdf.service
 * looks for first. The (signed) certificate row is never rewritten: the key is
 * derived from its `filePath`.
 */
const migrateCertificates = async (
  { tenantId, dryRun = false, onProgress }: { tenantId?: string | null; dryRun?: boolean; onProgress?: ((r: MigrationResult) => void) | null } = {},
): Promise<ClassSummary> => {
  const summary = emptySummary();
  const where: Record<string | symbol, unknown> = { filePath: { [Op.ne]: null } };
  if (tenantId) {where["tenantId"] = tenantId;}
  // Withdrawn (soft-deleted) certificates included: their PDFs are retained
  // evidence. Read a page at a time, by id (D-24: no unbounded findAll).
  const rows = await keysetPages<{ id: string; tenantId: string; filePath: string }>((after) =>
    Certificate.findAll({
      where: afterId(where, after),
      attributes: ["id", "tenantId", "filePath"],
      order: [["id", "ASC"]],
      limit: PAGE,
      paranoid: false,
    }),
  );
  for (const row of rows) {
    const base = { id: row.id, tenantId: row.tenantId };
    const result = await attempt(base, async () => {
      if (storedFile.isStorageKey(row.filePath)) {
        return { ...base, status: "skipped", reason: "already-a-key" };
      }
      const name = path.basename(row.filePath);
      const source = storagePath("uploads", "certificates", name);
      if (!fs.existsSync(source)) {
        return { ...base, status: "missing-source", path: source };
      }
      const scoped = await storage.getTenantStorage(row.tenantId);
      const key = scoped.buildKey({ domain: "certificates", name });
      return { ...base, key, ...(await copyVerified(scoped, key, source, "application/pdf", { dryRun })) };
    });
    tally(summary, result, onProgress);
  }
  return summary;
};

/**
 * Tenant backups taken before the cut-over, in the legacy backup directory.
 * Copied to `t/<tenantId>/backups/<file>`, verified against the checksum the
 * backup recorded, and the row's `filePath` then names the key (as
 * migrateAttachment backfills `storageKey`). A row whose path is outside the
 * backup directory is refused, as the scheduled pruner refuses it.
 */
const migrateBackups = async (
  { tenantId, dryRun = false, onProgress }: { tenantId?: string | null; dryRun?: boolean; onProgress?: ((r: MigrationResult) => void) | null } = {},
): Promise<ClassSummary> => {
  const summary = emptySummary();
  const where: Record<string | symbol, unknown> = { filePath: { [Op.ne]: null } };
  if (tenantId) {where["tenantId"] = tenantId;}
  const rows = await keysetPages<BackupLike & { save(options: object): Promise<unknown> }>((after) =>
    TenantBackup.findAll({
      where: afterId(where, after),
      order: [["id", "ASC"]],
      limit: PAGE,
    }),
  );
  const backupRoot = path.resolve(storagePath("backup", "tenant-backups"));
  for (const row of rows) {
    const base = { id: row.id, tenantId: row.tenantId };
    const result = await attempt(base, async () => {
      if (storedFile.isStorageKey(row.filePath)) {
        return { ...base, status: "skipped", reason: "already-a-key" };
      }
      const source = path.resolve(row.filePath);
      if (!source.startsWith(backupRoot + path.sep)) {
        throw new AppError(400, `Refusing to read a backup outside the backup directory: ${row.id}`);
      }
      if (!fs.existsSync(source)) {
        return { ...base, status: "missing-source", path: source };
      }
      const scoped = await storage.getTenantStorage(row.tenantId);
      const key = scoped.buildKey({ domain: "backups", name: path.basename(source) });
      const outcome = await copyVerified(scoped, key, source, "application/zip", {
        dryRun,
        expected: (row.metadata as { checksum?: string | null } | null | undefined)?.checksum ?? null,
      });
      if (!dryRun) {
        await recordMove(row as unknown as MovableRow, "TenantBackup", "filePath", key, { verifiedAgainst: outcome.status });
      }
      return { ...base, key, ...outcome };
    });
    tally(summary, result, onProgress);
  }
  return summary;
};

/** A backup row, as migrateBackups reads it. */
interface BackupLike {
  id: string;
  tenantId: string;
  filePath: string;
  metadata?: unknown;
}

/**
 * The public image class (avatars, tenant logos, CMS images) in its legacy
 * folders. Copied to the platform keys the public mount reads first
 * (`global/<domain>/<file>`, upload.util#publicStorageKey). A file the public
 * mount would never serve (an extension outside the image allow-list, a name
 * the key grammar refuses — the placeholder `default.svg`, for one) is not a
 * public image and is left alone.
 */
const migratePublicImages = async (
  { dryRun = false, onProgress }: { dryRun?: boolean; onProgress?: ((r: MigrationResult) => void) | null } = {},
): Promise<ClassSummary> => {
  const summary = emptySummary();
  const scoped = await storage.getGlobalStorage();
  for (const folder of Object.keys(PUBLIC_STORAGE_DOMAINS)) {
    const dir = storagePath(...folder.split("/"));
    const names = fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort()
      : [];
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      const key = publicStorageKey(folder, name);
      if (!key || !Object.prototype.hasOwnProperty.call(PUBLIC_IMAGE_TYPES, ext)) {
        continue;
      }
      const base = { id: `${folder}/${name}`, tenantId: null };
      const result = await attempt(base, async () => ({
        ...base,
        key,
        ...(await copyVerified(scoped, key, path.join(dir, name), PUBLIC_IMAGE_TYPES[ext] as string, { dryRun })),
      }));
      tally(summary, result, onProgress);
    }
  }
  return summary;
};

/**
 * Every class, in turn: attachments (migrateAll), certificate PDFs, tenant
 * backups and — unless the run is limited to one tenant — the public image
 * class, which is the platform's.
 */
const migrateEverything = async (
  opts: { tenantId?: string | null; dryRun?: boolean; limit?: number | null; onProgress?: ((r: MigrationResult) => void) | null } = {},
): Promise<{
  attachments: Awaited<ReturnType<typeof migrateAll>>;
  certificates: ClassSummary;
  backups: ClassSummary;
  publicImages: ClassSummary | null;
}> => ({
  attachments: await migrateAll(opts),
  certificates: await migrateCertificates(opts),
  backups: await migrateBackups(opts),
  publicImages: opts.tenantId ? null : await migratePublicImages(opts),
});

export = {
  migrateAttachment,
  migrateAll,
  legacyPath,
  hashStream,
  copyVerified,
  migrateCertificates,
  migrateBackups,
  migratePublicImages,
  migrateEverything,
};
