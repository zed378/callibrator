/**
 * The job BACKUP_SCHEDULER runs (S-03, S-14).
 *
 * WHAT IT BACKS UP. docs/DEVOPS/04-DATABASE-BACKUP.md places
 * "Scheduled by `BACKUP_SCHEDULER`" under Layer 1, **Tenant Backup**, and lists
 * `./backup` as the tenant-backup volume. Layer 2 (the whole database) is a
 * host-level `pg_dump` + WAL procedure outside this process: the backend image
 * carries no `pg_dump`, and a database dump belongs off the application host.
 * So this job takes a tenant backup — `tenantBackup.service#createBackup`, the
 * same code the HTTP route runs — for every tenant that is not offboarded, and
 * then prunes expired ones.
 *
 * What it replaced: a job that zipped `data/` and `log/` from beside
 * `__dirname` — inside the read-only pkg snapshot in every container — with a
 * `mysql.sock` filter left over from before ADR-039, and swallowed every
 * failure into a log file production does not surface. It wrote nothing, to a
 * directory nothing read (S-03).
 *
 * ONE DIRECTORY. The writer and the pruner both use
 * `tenantBackup.service#BACKUP_DIR` (`storagePath("backup", "tenant-backups")`).
 * The old pruner iterated `storagePath("backup")` and `fse.remove`d every
 * ENTRY older than 30 days by mtime — directories included — so the moment no
 * tenant backup had been written for a month it deleted `tenant-backups/` and
 * every backup inside it, leaving `tenant_backups` rows pointing at nothing
 * (S-14).
 *
 * PRUNING is driven by the rows, never by a directory listing:
 *  - a backup is expired at `expiresAt`, or — for a row that never had one
 *    stamped (the HTTP path does not set it) — at `createdAt + retentionDays`;
 *  - the newest `BACKUP_KEEP_MIN` completed backups of every tenant are kept
 *    whatever their age, so a tenant is never left with none;
 *  - a file is deleted only when its path resolves INSIDE the backup
 *    directory; a row pointing elsewhere is refused and reported, not followed;
 *  - the row is marked `deleted` and soft-deleted, with its audit row, in one
 *    transaction; the file is unlinked after that commits.
 *
 * ATTRIBUTION. Every row this job writes, and every audit row, names the
 * system actor `system:scheduled-backup` (constants/systemActors.js).
 *
 * FAILURE IS VISIBLE. Production has no Console transport on the winston
 * logger (A-14), so a failure only logged is a failure nobody sees. Each run
 * writes its outcome to `<backup root>/last-scheduled-backup.json` — on the
 * host's backup volume — and a failed run also goes to stderr, which
 * `docker logs` shows.
 */
const fs = require("fs");
const path = require("path");
const { Op } = require("sequelize");
const { db } = require("../config");
const { logger } = require("../middlewares/activityLog.middleware");
const { runForTenant } = require("../utils/jobContext.util");
const { SYSTEM_ACTORS } = require("../constants/systemActors");
const auditService = require("./audit.service");
const tenantBackupService = require("./tenantBackup.service");

/** The actor on every row this job writes. */
const SCHEDULED_BACKUP_ACTOR = SYSTEM_ACTORS.SCHEDULED_BACKUP;

/** The newest completed backups of a tenant that pruning never removes. */
const DEFAULT_KEEP_MIN = 3;
/** Rows (tenants, or completed backups) read per page by the scheduled job (W-17). */
const DEFAULT_PAGE_SIZE = 500;

/** Tenants whose data the job backs up: every one not offboarded. */
const BACKED_UP_TENANT_STATUSES = Object.freeze(["active", "suspended"]);

const DAY_MS = 24 * 60 * 60 * 1000;

/** A positive integer from the environment, or the fallback. */
const positiveIntEnv = (name, fallback) => {
  const n = Number.parseInt(process.env[name], 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** The retention a scheduled backup is created with. */
const DEFAULT_RETENTION = () =>
  positiveIntEnv(
    "BACKUP_RETENTION_DAYS",
    require("../models").TenantBackup.DEFAULT_RETENTION_DAYS,
  );

/** The directory every tenant backup lives in — the writer's own constant. */
const backupDir = () => path.resolve(tenantBackupService.BACKUP_DIR);

/** Where each run records its outcome, beside the tenant-backups directory. */
const statusFilePath = () => path.join(path.dirname(backupDir()), "last-scheduled-backup.json");

/**
 * True only when `filePath` resolves strictly inside the backup directory.
 * @param {string|null|undefined} filePath
 * @returns {boolean}
 */
const isInsideBackupDir = (filePath) => {
  if (!filePath) {
    return false;
  }
  return path.resolve(filePath).startsWith(backupDir() + path.sep);
};

/**
 * When a backup row expires: its `expiresAt`, else `createdAt + retentionDays`.
 * @param {{expiresAt?: Date|null, createdAt: Date, retentionDays?: number|null}} row
 * @returns {Date}
 */
const effectiveExpiry = (row) => {
  if (row.expiresAt) {
    return new Date(row.expiresAt);
  }
  const days = Number(row.retentionDays) > 0 ? Number(row.retentionDays) : DEFAULT_RETENTION();
  return new Date(new Date(row.createdAt).getTime() + days * DAY_MS);
};

/**
 * Take one tenant's scheduled backup, then stamp its expiry and write its
 * CREATE audit row in one transaction.
 *
 * @param {string} tenantId
 * @param {Date} now
 * @returns {Promise<{tenantId: string, backupId: string, expiresAt: Date}>}
 */
async function backupTenant(tenantId, now) {
  const models = require("../models");
  const { TenantBackup } = models;
  const retentionDays = DEFAULT_RETENTION();

  const result = await tenantBackupService.createBackup({
    tenantId,
    createdById: null,
    name: `Scheduled backup ${now.toISOString().slice(0, 10)}`,
    description: `Taken by ${SCHEDULED_BACKUP_ACTOR}`,
    backupType: TenantBackup.BACKUP_TYPES.FULL,
    retentionDays,
    tag: "scheduled",
    models,
  });
  const backup = result && result.data;
  if (!backup || !backup.id) {
    throw new Error("createBackup returned no backup row");
  }

  const expiresAt = new Date(now.getTime() + retentionDays * DAY_MS);
  await db.transaction(async (transaction) => {
    await TenantBackup.update(
      { expiresAt },
      { where: { id: backup.id, tenantId }, transaction },
    );
    await auditService.logAction(
      {
        tenantId,
        systemActor: SCHEDULED_BACKUP_ACTOR,
        action: "CREATE",
        resourceType: "TenantBackup",
        resourceId: backup.id,
        changes: {
          operation: "SCHEDULED_BACKUP",
          actor: SCHEDULED_BACKUP_ACTOR,
          backupType: TenantBackup.BACKUP_TYPES.FULL,
          fileName: path.basename(String(backup.filePath || backup.backupPath || "")),
          fileSize: backup.fileSize ?? null,
          recordCount: backup.recordCount ?? null,
          retentionDays,
          expiresAt: expiresAt.toISOString(),
        },
      },
      { transaction },
    );
  });

  return { tenantId, backupId: backup.id, expiresAt };
}

/**
 * Prune expired completed backups, keeping the newest `keepMin` of every
 * tenant, deleting only files inside the backup directory.
 *
 * @param {object} [opts]
 * @param {Date} [opts.now]
 * @param {number} [opts.keepMin]
 * @returns {Promise<{pruned: object[], kept: number, refused: object[], errors: object[]}>}
 */
async function pruneExpiredBackups({
  now = new Date(),
  keepMin = positiveIntEnv("BACKUP_KEEP_MIN", DEFAULT_KEEP_MIN),
  pageSize = positiveIntEnv("BACKUP_PRUNE_PAGE_SIZE", DEFAULT_PAGE_SIZE),
} = {}) {
  const { TenantBackup } = require("../models");
  const summary = { pruned: [], kept: 0, refused: [], errors: [] };

  // W-17: the completed backups are read in keyset pages on (tenantId ASC,
  // createdAt DESC, id DESC) — the order the "newest keepMin" rule needs —
  // with the tenant and its rank carried across pages, never all at once.
  let cursor = null;
  let currentTenant = null;
  let rank = 0;
  for (;;) {
    const rows = await TenantBackup.findAll({
      where: {
        status: TenantBackup.STATUS.COMPLETED,
        ...(cursor ? afterBackupCursor(cursor) : {}),
      },
      order: [
        ["tenantId", "ASC"],
        ["createdAt", "DESC"],
        ["id", "DESC"],
      ],
      limit: pageSize,
      skipTenantScope: true,
    });

    for (const row of rows) {
      if (row.tenantId !== currentTenant) {
        currentTenant = row.tenantId;
        rank = 0;
      }
      rank += 1;
      // Newest first: the first keepMin are kept whatever their age.
      if (rank <= keepMin) {
        summary.kept += 1;
        continue;
      }
      if (effectiveExpiry(row) < now) {
        await pruneRow(row, keepMin, summary);
      }
    }

    if (rows.length < pageSize) {
      break;
    }
    const last = rows[rows.length - 1];
    cursor = { tenantId: last.tenantId, createdAt: last.createdAt, id: last.id };
  }

  return summary;
}

/**
 * The keyset predicate for "after `cursor`" in (tenantId ASC, createdAt DESC,
 * id DESC) order.
 *
 * @param {{tenantId: string, createdAt: Date, id: string}} cursor
 * @returns {object} a where fragment
 */
function afterBackupCursor({ tenantId, createdAt, id }) {
  return {
    [Op.or]: [
      { tenantId: { [Op.gt]: tenantId } },
      { tenantId, createdAt: { [Op.lt]: createdAt } },
      { tenantId, createdAt, id: { [Op.lt]: id } },
    ],
  };
}

/**
 * Prune one expired backup: the row (soft-deleted, audited, in its tenant's
 * context and one transaction), then its file.
 *
 * @param {object} row
 * @param {number} keepMin
 * @param {object} summary - updated in place
 */
async function pruneRow(row, keepMin, summary) {
  const { TenantBackup } = require("../models");
  const tenantId = row.tenantId;
  const filePath = row.filePath || row.backupPath || null;
  if (filePath && !isInsideBackupDir(filePath)) {
    summary.refused.push({ tenantId, backupId: row.id, filePath });
    logger.error("Scheduled backup prune: refusing a path outside the backup directory", {
      tenantId,
      backupId: row.id,
      filePath,
      backupDir: backupDir(),
    });
    return;
  }
  try {
    await runForTenant(tenantId, () =>
      db.transaction(async (transaction) => {
        await row.update({ status: TenantBackup.STATUS.DELETED }, { transaction });
        await row.destroy({ transaction });
        await auditService.logAction(
          {
            tenantId,
            systemActor: SCHEDULED_BACKUP_ACTOR,
            action: "DELETE",
            resourceType: "TenantBackup",
            resourceId: row.id,
            changes: {
              operation: "BACKUP_PRUNE",
              actor: SCHEDULED_BACKUP_ACTOR,
              fileName: filePath ? path.basename(filePath) : null,
              expiredAt: effectiveExpiry(row).toISOString(),
              keepMin,
              before: { status: TenantBackup.STATUS.COMPLETED },
              after: { status: TenantBackup.STATUS.DELETED },
            },
          },
          { transaction },
        );
      }),
    );
  } catch (err) {
    summary.errors.push({ tenantId, backupId: row.id, stage: "row", error: err.message });
    return;
  }
  // The row is committed as deleted; only now does the file go. A file
  // that outlives a failed unlink is an orphan on disk, never a row
  // pointing at nothing.
  if (filePath) {
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        summary.errors.push({ tenantId, backupId: row.id, stage: "file", error: err.message });
      }
    }
  }
  summary.pruned.push({ tenantId, backupId: row.id });
}

/**
 * Record the run's outcome on the backup volume, and on stderr when it failed.
 * @param {object} outcome
 */
async function reportOutcome(outcome) {
  const file = statusFilePath();
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, `${JSON.stringify(outcome, null, 2)}\n`);
  } catch (err) {
    outcome.statusFileError = err.message;
  }
  if (outcome.ok) {
    logger.info("Scheduled backup complete", outcome);
  } else {
    logger.error("Scheduled backup FAILED", outcome);
    // A-14: production's winston has no Console transport — stderr is what
    // `docker logs` shows.
    process.stderr.write(`[scheduled-backup] FAILED ${JSON.stringify(outcome)}\n`);
  }
}

/**
 * One run of the BACKUP_SCHEDULER job: back up every tenant that is not
 * offboarded, then prune. A failure for one tenant does not stop the others;
 * any failure makes the run `ok: false`, which is recorded and surfaced.
 *
 * @param {object} [opts]
 * @param {Date} [opts.now]
 * @returns {Promise<object>} the outcome written to the status file
 */
async function runScheduledBackup({ now = new Date() } = {}) {
  const outcome = {
    ok: false,
    actor: SCHEDULED_BACKUP_ACTOR,
    startedAt: now.toISOString(),
    finishedAt: null,
    backupDir: backupDir(),
    tenants: 0,
    backedUp: [],
    failed: [],
    prune: null,
    error: null,
  };

  try {
    const { Tenant } = require("../models");
    const pageSize = positiveIntEnv("BACKUP_PRUNE_PAGE_SIZE", DEFAULT_PAGE_SIZE);
    // W-17: tenants in keyset pages of ids.
    let afterId = null;
    for (;;) {
      const where = { status: { [Op.in]: [...BACKED_UP_TENANT_STATUSES] } };
      if (afterId) {
        where.id = { [Op.gt]: afterId };
      }
      const tenants = await Tenant.findAll({
        where,
        attributes: ["id"],
        order: [["id", "ASC"]],
        limit: pageSize,
        skipTenantScope: true,
      });
      outcome.tenants += tenants.length;

      for (const tenant of tenants) {
        try {
          const done = await runForTenant(tenant.id, () => backupTenant(tenant.id, now));
          outcome.backedUp.push({ tenantId: done.tenantId, backupId: done.backupId });
        } catch (err) {
          outcome.failed.push({ tenantId: tenant.id, error: err.message });
        }
      }

      if (tenants.length < pageSize) {
        break;
      }
      afterId = tenants[tenants.length - 1].id;
    }

    outcome.prune = await pruneExpiredBackups({ now });
    outcome.ok =
      outcome.failed.length === 0 &&
      outcome.prune.errors.length === 0 &&
      outcome.prune.refused.length === 0;
  } catch (err) {
    outcome.error = err.message;
  }

  outcome.finishedAt = new Date().toISOString();
  await reportOutcome(outcome);
  return outcome;
}

module.exports = {
  SCHEDULED_BACKUP_ACTOR,
  DEFAULT_KEEP_MIN,
  BACKED_UP_TENANT_STATUSES,
  runScheduledBackup,
  pruneExpiredBackups,
  backupTenant,
  effectiveExpiry,
  isInsideBackupDir,
  statusFilePath,
};
