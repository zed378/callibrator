/**
 * The SQL-dump import (P24-06; ADR-129;
 * docs/UPSTREAM/05-DATA-MIGRATION.md § 2, 07-DATA-MINIMISATION.md, 06-DPIA.md).
 *
 * The super admin uploads an upstream mysqldump / MariaDB dump (plain or gzip).
 * It is NEVER executed: a background job PARSES it (upstreamImport/dumpParser.ts)
 * and loads the rows of the tables the minimisation policy allows into the
 * `upstream_import` staging schema, through a connection that runs as the import
 * role (the application role cannot read that schema). Stage 2 — the transform
 * from staging into the application's tables — is upstreamSqlTransform.service.ts
 * (P24-01); a run's view carries its transform state, and the hourly sweep here
 * also reconciles an interrupted transform.
 *
 *   uploaded ──► scanning ──► parsing ──► loaded
 *       │            │            │
 *       └────────────┴────────────┴──► failed ──(retry, file kept)──► uploaded
 *       └────────────┴────────────┴──► cancelled
 *
 * Every transition is a conditional UPDATE with its audit row in ONE transaction
 * (actor: the super admin for upload / cancel / retry, `system:upstream-sql-import`
 * for the worker), under the PLATFORM tenant. The completion notification (in-app
 * and e-mail, to the uploader) is written in the transaction of the final
 * transition and announced after its commit. Counts only, everywhere: no value
 * from the dump reaches a row of this table, an audit row, a notification or a log.
 *
 * THE FILE is personal data. It lands in the upload quarantine, is moved to
 * `uploads/.quarantine/upstream-sql/<run id>.dump` (outside every served root and
 * outside tenant storage), is never served back, is deleted as soon as the run
 * is loaded or cancelled (or infected), and a failed run keeps it only for
 * UPSTREAM_IMPORT_FAILED_RETENTION_DAYS (a retry), then the sweep deletes it.
 *
 * THE DPIA GATE: while UPSTREAM_REAL_DATA_ALLOWED is off (config/upstream.ts, shared
 * with the rsync image import), only a file the uploader declares SYNTHETIC is
 * accepted — and the worker checks again before it parses.
 */
import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import zlib from "zlib";
import { Op, type Transaction } from "sequelize";
import { UPSTREAM_SQL_IMPORT_STATUSES, type UpstreamSqlImportStatus } from "@callibrator/contracts/states";
import {
  uploadUpstreamSqlImportSchema,
  type UpstreamSqlImportDataClass,
  type UpstreamSqlImportErrorCode,
} from "@callibrator/contracts/upstreamSqlImport";
import { validateInput } from "../validators/input";
import models from "../models";
import { db } from "../config";
import { upstreamRealDataAllowed } from "../config/upstream";
import { createStagingDb, importRoleName, upstreamImportSettings, type UpstreamImportSettings } from "../config/upstreamImport";
import { AppError } from "../utils/appError.util";
import { quarantinePath } from "../utils/upload.util";
import { runForTenant } from "../utils/jobContext.util";
import { logger } from "../middlewares/activityLog.middleware";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import auditService from "./audit.service";
import batchJobService from "./batchJob.service";
import notificationService from "./notification.service";
import virusScan from "./virusScan.service";
import { ImportCancelled, ImportFailure, runPipeline, type PipelineResult, type TableReport } from "./upstreamImport/importPipeline";
import { beginStaging, purgeRun } from "./upstreamImport/stagingLoader";
import { isTransformRequestable, reconcileInterruptedTransforms, transformAvailable } from "./upstreamSqlTransform.service";
import type { SqlRunner } from "../utils/sql.util";
import type { ModelInstance } from "../types/models";

const { UpstreamSqlImport, User, BatchJob } = models;

type Run = ModelInstance<"UpstreamSqlImport">;

/** The batch-job type the import runs as. */
export const UPSTREAM_SQL_IMPORT_JOB_TYPE = "upstream-sql-import";

/** The states a run can still move from. */
const ACTIVE: readonly UpstreamSqlImportStatus[] = ["uploaded", "scanning", "parsing"];

/** How much of the file the content sniff reads (decompressed). */
const SNIFF_BYTES = 64 * 1024;

/** A file in the dump directory with no run pointing at it is removed once this old. */
const ORPHAN_AGE_MS = 60 * 60 * 1000;

/** A queued run with no batch job is lost after this long (the job is created right after the upload commits). */
const QUEUE_GRACE_MS = 10 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The sentence each failure code is reported with (no value, no path). */
const FAILURE_TEXT: Readonly<Record<UpstreamSqlImportErrorCode, string>> = {
  FILE_MISSING: "The uploaded file is no longer on the server.",
  INTEGRITY_MISMATCH: "The file on the server no longer matches the SHA-256 recorded at upload.",
  INFECTED: "The virus scanner found the file infected; it was deleted.",
  SCAN_FAILED: "The virus scan could not run; the file was not parsed (fail-closed).",
  REAL_DATA_NOT_ALLOWED: "The file is declared real upstream data and UPSTREAM_REAL_DATA_ALLOWED is off (DPIA gates R-01, R-03, R-17).",
  TRUNCATED_INPUT: "The dump ends inside a statement, a string or a comment: the file is truncated.",
  DECOMPRESSED_TOO_LARGE: "The file decompresses to more than UPSTREAM_IMPORT_MAX_UNCOMPRESSED_BYTES.",
  CORRUPT_COMPRESSION: "The file is not a readable gzip stream (it is corrupt or not gzip).",
  STAGING_ROLE_INVALID: "The staging connection is not the import role (run the migrations; see UPSTREAM_IMPORT_DB_ROLE).",
  STAGING_FAILED: "A staging statement failed; nothing was kept.",
  INTERRUPTED: "The worker running the import stopped (a restart or a crash); nothing was kept.",
};

/** Who acts on a run from a request. */
export interface Actor {
  readonly userId: string;
  /** The actor's home tenant (where their notification is stored); null for a principal with none. */
  readonly tenantId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

/** The uploaded file as multer left it in the quarantine. */
export interface UploadedDump {
  readonly path: string;
  readonly size: number;
}

/** One table of a run, as the API answers it. */
export interface RunTable extends TableReport {
  readonly table: string;
}

/** A run as the API answers it: never the file's path. */
export interface RunView {
  id: string;
  status: UpstreamSqlImportStatus;
  dataClass: UpstreamSqlImportDataClass;
  compression: "none" | "gzip";
  sizeBytes: number;
  sha256: string;
  bytesRead: number;
  uncompressedBytes: number;
  progress: number;
  rowsLoaded: number;
  rowsRejected: number;
  rowsNotExtracted: number;
  tables: RunTable[];
  parseSummary: Run["parseSummary"];
  errorCode: string | null;
  errorSummary: string | null;
  transformStatus: string;
  /** P24-01: the transform's failure code, its times and its counts. */
  transformErrorCode: string | null;
  transformRequestable: boolean;
  transformRequestedAt: string | null;
  transformStartedAt: string | null;
  transformFinishedAt: string | null;
  transformSummary: Run["transformSummary"];
  attempt: number;
  fileRetained: boolean;
  fileRetainUntil: string | null;
  retryable: boolean;
  cancellable: boolean;
  cancelRequestedAt: string | null;
  uploadedBy: { id: string; name: string | null } | null;
  createdAt: string;
  startedAt: string | null;
  scannedAt: string | null;
  parseStartedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** The run's tables as a list, by name. */
const tableList = (tables: Run["tables"]): RunTable[] =>
  Object.entries(tables ?? {})
    .map(([table, report]) => ({ table, ...report }))
    .sort((a, b) => a.table.localeCompare(b.table));

/** Whether a run's file can still be used by a retry. */
const isRetryable = (run: Run): boolean => run.status === "failed" && Boolean(run.filePath);

const view = (run: Run, names: ReadonlyMap<string, string | null>): RunView => {
  const size = Number(run.sizeBytes);
  const bytesRead = Number(run.bytesRead);
  const end = run.finishedAt ?? null;
  return {
    id: run.id,
    status: run.status,
    dataClass: run.dataClass,
    compression: run.compression,
    sizeBytes: size,
    sha256: run.sha256,
    bytesRead,
    uncompressedBytes: Number(run.uncompressedBytes),
    progress: run.status === "loaded" ? 1 : size > 0 ? Math.min(1, bytesRead / size) : 0,
    rowsLoaded: run.rowsLoaded,
    rowsRejected: run.rowsRejected,
    rowsNotExtracted: run.rowsNotExtracted,
    tables: tableList(run.tables),
    parseSummary: run.parseSummary,
    errorCode: run.errorCode ?? null,
    errorSummary: run.errorCode ? FAILURE_TEXT[run.errorCode as UpstreamSqlImportErrorCode] : null,
    transformStatus: run.transformStatus,
    transformErrorCode: run.transformErrorCode ?? null,
    transformRequestable: isTransformRequestable(run),
    transformRequestedAt: iso(run.transformRequestedAt),
    transformStartedAt: iso(run.transformStartedAt),
    transformFinishedAt: iso(run.transformFinishedAt),
    transformSummary: run.transformSummary ?? null,
    attempt: run.attempt,
    fileRetained: Boolean(run.filePath),
    fileRetainUntil: iso(run.fileRetainUntil),
    retryable: isRetryable(run),
    cancellable: ACTIVE.includes(run.status) && !run.cancelRequestedAt,
    cancelRequestedAt: iso(run.cancelRequestedAt),
    uploadedBy: run.uploadedBy ? { id: run.uploadedBy, name: names.get(run.uploadedBy) ?? null } : null,
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
    scannedAt: iso(run.scannedAt),
    parseStartedAt: iso(run.parseStartedAt),
    finishedAt: iso(end),
    durationMs: run.startedAt && end ? end.getTime() - run.startedAt.getTime() : null,
  };
};

/** The uploaders' display names, read by id (no include: no defaultScope trap). */
const namesOf = async (runs: readonly Run[]): Promise<Map<string, string | null>> => {
  const ids = [...new Set(runs.map((r) => r.uploadedBy).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) {
    return new Map();
  }
  const users = await User.findAll({ where: { id: ids }, attributes: ["id", "firstName", "lastName"], skipTenantScope: true });
  return new Map(users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || null]));
};

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/** The directory the dumps wait in (inside the upload quarantine; never served). */
export const dumpDirectory = (): string => quarantinePath("upstream-sql");

/** Remove a file, ignoring one that is already gone. */
const discard = async (filePath: string | null): Promise<void> => {
  if (filePath === null) {
    return;
  }
  await fs.promises.unlink(filePath).catch((err: unknown) => {
    if ((err as { code?: unknown }).code !== "ENOENT") {
      logger.warn("Could not delete an upstream SQL dump", { code: (err as { code?: unknown }).code });
    }
  });
};

/** The first `SNIFF_BYTES` of the file, decompressed when it is gzip. */
const readHead = async (filePath: string, gzip: boolean): Promise<Buffer> => {
  const file = fs.createReadStream(filePath, { end: gzip ? 4 * SNIFF_BYTES : SNIFF_BYTES - 1 });
  const source = gzip ? file.pipe(zlib.createGunzip()) : file;
  const parts: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of source as AsyncIterable<Buffer>) {
      parts.push(chunk);
      length += chunk.length;
      if (length >= SNIFF_BYTES) {
        break;
      }
    }
  } catch {
    // A gzip stream cut at the sniff window ends early; what was read is the head.
  } finally {
    file.destroy();
  }
  return Buffer.concat(parts).subarray(0, SNIFF_BYTES);
};

const SQL_START = /^(--|#|\/\*|(create|insert|set|drop|lock|unlock|use|delimiter|start|begin)\b)/i;

/**
 * Whether a file's head is a SQL dump: text (no NUL byte, valid UTF-8 — a
 * sequence cut at the window's end is allowed) whose first token is a comment
 * or a statement keyword.
 */
export const looksLikeSqlDump = (head: Buffer): boolean => {
  if (head.length === 0 || head.includes(0)) {
    return false;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
    return SQL_START.test(text.replace(/^\uFEFF/, "").trimStart());
  } catch {
    return false;
  }
};

/** Sniff the file: gzip by its magic bytes, then a SQL dump by its (decompressed) head. */
const sniff = async (filePath: string): Promise<"none" | "gzip" | null> => {
  const handle = await fs.promises.open(filePath, "r");
  const magic = Buffer.alloc(3);
  try {
    await handle.read(magic, 0, 3, 0);
  } finally {
    await handle.close();
  }
  const gzip = magic[0] === 0x1f && magic[1] === 0x8b && magic[2] === 0x08;
  return looksLikeSqlDump(await readHead(filePath, gzip)) ? (gzip ? "gzip" : "none") : null;
};

/** The file's SHA-256, streamed. */
export const sha256Of = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
};

// ---------------------------------------------------------------------------
// Audit and notification
// ---------------------------------------------------------------------------

/** One state change's audit row, under the PLATFORM tenant, in `transaction`. */
const auditTransition = (
  transaction: Transaction,
  run: Run,
  from: string | null,
  to: string,
  actor: Actor | null,
  extra: Record<string, unknown>,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId: PLATFORM_TENANT_ID,
      ...(actor === null ? { systemActor: SYSTEM_ACTORS.UPSTREAM_SQL_IMPORT } : { userId: actor.userId }),
      action: from === null ? "CREATE" : "UPDATE",
      resourceType: "UpstreamSqlImport",
      resourceId: run.id,
      changes: {
        operation: "UPSTREAM_SQL_IMPORT_STATE",
        before: { status: from },
        after: { status: to },
        attempt: run.attempt,
        ...extra,
      },
      ipAddress: actor?.ipAddress ?? null,
      userAgent: actor?.userAgent ?? null,
    },
    { transaction },
  );

const n = (value: number): string => value.toLocaleString("en-US");

/** The notification's text: counts, codes and the checksum — never a value from the dump. */
export const summaryText = (run: Run): { title: string; message: string } => {
  const title = { loaded: "SQL dump import loaded", failed: "SQL dump import failed", cancelled: "SQL dump import cancelled" }[
    run.status as "loaded" | "failed" | "cancelled"
  ];
  const lines: string[] = [];
  const seconds = run.startedAt && run.finishedAt ? Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000) : 0;
  lines.push(`Run ${run.id.slice(0, 8)} (attempt ${String(run.attempt)}), ${String(seconds)} s. SHA-256 ${run.sha256}.`);
  if (run.errorCode) {
    lines.push(`${run.errorCode}: ${FAILURE_TEXT[run.errorCode as UpstreamSqlImportErrorCode]}`);
  }
  lines.push(`Rows: ${n(run.rowsLoaded)} loaded, ${n(run.rowsRejected)} rejected, ${n(run.rowsNotExtracted)} not extracted (minimisation policy).`);
  const rejected: Record<string, number> = {};
  for (const { table, rowsLoaded, rowsRejected, rowsNotExtracted, rejections, reason } of tableList(run.tables)) {
    for (const [why, count] of Object.entries(rejections)) {
      rejected[why] = (rejected[why] ?? 0) + count;
    }
    const parts = [`${n(rowsLoaded)} loaded`];
    if (rowsRejected > 0) {
      parts.push(`${n(rowsRejected)} rejected`);
    }
    if (rowsNotExtracted > 0) {
      parts.push(`${n(rowsNotExtracted)} not extracted`);
    }
    lines.push(`- ${table}: ${parts.join(", ")}${reason === null ? "" : ` (${reason})`}`);
  }
  const reasons = Object.entries(rejected).sort(([a], [b]) => a.localeCompare(b));
  if (reasons.length > 0) {
    lines.push(`Rejected by reason: ${reasons.map(([why, count]) => `${why} ${n(count)}`).join(", ")}.`);
  }
  if (run.status === "loaded") {
    lines.push("The staged rows wait for stage 2 (the transform), which is not available yet.");
  }
  return { title, message: lines.join("\n") };
};

/**
 * The uploader's notification for a finished run, in `transaction` (announced
 * after its commit), stored in the uploader's home tenant.
 * @returns the notification's id, or null when the uploader is gone
 */
const notifyUploader = async (transaction: Transaction, run: Run): Promise<string | null> => {
  if (!run.uploadedBy) {
    return null;
  }
  const { title, message } = summaryText(run);
  const notification = await runForTenant(run.notifyTenantId, () =>
    notificationService.emitNotification(
      {
        tenantId: run.notifyTenantId,
        userId: run.uploadedBy,
        type: "SYSTEM",
        title,
        message,
        actionUrl: `/dashboard/upstream-sql-import?run=${run.id}`,
        channels: ["realtime", "email"],
      },
      { transaction },
    ),
  );
  // With a transaction, emitNotification re-throws instead of answering null.
  return (notification as { id: string }).id;
};

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** What the page needs before an upload. */
export const getSettings = (): {
  maxUploadBytes: number;
  maxUncompressedBytes: number;
  failedRetentionDays: number;
  realDataAllowed: boolean;
  transformAvailable: boolean;
} => {
  const settings: UpstreamImportSettings = upstreamImportSettings();
  return {
    maxUploadBytes: settings.maxUploadBytes,
    maxUncompressedBytes: settings.maxUncompressedBytes,
    failedRetentionDays: settings.failedRetentionDays,
    realDataAllowed: upstreamRealDataAllowed(),
    transformAvailable: transformAvailable(),
  };
};

const notFound = (): AppError => new AppError(404, "Import run not found");

const loadRun = async (id: string): Promise<Run> => {
  const run = await UpstreamSqlImport.findByPk(id);
  if (run === null) {
    throw notFound();
  }
  return run;
};

const anotherActive = async (): Promise<AppError | null> => {
  const active = await UpstreamSqlImport.findOne({ where: { status: { [Op.in]: [...ACTIVE] } }, attributes: ["id", "status"] });
  return active === null
    ? null
    : new AppError(409, `Another import is in progress (run ${active.id.slice(0, 8)}, ${active.status}). Wait for it to finish, or cancel it first.`);
};

const isUniqueViolation = (err: unknown): boolean => (err as { name?: unknown }).name === "SequelizeUniqueConstraintError";

/** Queue the run's job, and remember which job it is (unless the job has already claimed the run). */
const enqueue = async (run: Run, userId: string): Promise<void> => {
  const job = await batchJobService.createJob(PLATFORM_TENANT_ID, userId, UPSTREAM_SQL_IMPORT_JOB_TYPE, 0);
  await UpstreamSqlImport.update({ batchJobId: job.id }, { where: { id: run.id, batchJobId: null } });
  run.batchJobId = job.id;
};

/**
 * POST /admin/upstream-sql-imports — accept a dump into the quarantine and queue its run.
 * The multipart fields are checked here, after multer, so a refused upload's file is deleted.
 * @throws a 400 validation failure for a missing or unknown `dataClass`; {AppError} 403 for a real file while the DPIA gate is off;
 *   409 for another active run; 400 for an empty file or one that is not a SQL dump (plain or gzip)
 */
export const uploadDump = async (file: UploadedDump, body: unknown, actor: Actor): Promise<RunView> => {
  let filePath: string | null = file.path;
  try {
    const { dataClass } = validateInput(body, uploadUpstreamSqlImportSchema);
    if (dataClass === "real" && !upstreamRealDataAllowed()) {
      // 403, as the rsync image import answers the same gate (ADR-130): a deployment policy, not a state.
      throw new AppError(
        403,
        "Real upstream data cannot be imported on this deployment yet: UPSTREAM_REAL_DATA_ALLOWED is off until the DPIA gates " +
          "(R-01, R-03, R-17) and the legal review are closed. Upload a synthetic dump, declared synthetic.",
      );
    }
    const busy = await anotherActive();
    if (busy !== null) {
      throw busy;
    }
    if (file.size === 0) {
      throw new AppError(400, "The file is empty");
    }
    const compression = await sniff(file.path);
    if (compression === null) {
      throw new AppError(400, "The file is not a SQL dump: upload a mysqldump / MariaDB dump as .sql text, or gzip-compressed (.sql.gz)");
    }
    const sha256 = await sha256Of(file.path);
    const id = randomUUID();
    const target = path.join(dumpDirectory(), `${id}.dump`);
    await fs.promises.mkdir(dumpDirectory(), { recursive: true });
    await fs.promises.rename(file.path, target);
    filePath = target;

    const run = await db.transaction(async (transaction) => {
      const created = await UpstreamSqlImport.create(
        {
          id,
          dataClass,
          compression,
          sizeBytes: file.size,
          sha256,
          filePath: target,
          uploadedBy: actor.userId,
          notifyTenantId: actor.tenantId ?? PLATFORM_TENANT_ID,
        },
        { transaction },
      );
      await auditTransition(transaction, created, null, "uploaded", actor, {
        operation: "UPSTREAM_SQL_IMPORT_UPLOAD",
        sha256,
        sizeBytes: file.size,
        compression,
        dataClass,
      });
      return created;
    });
    filePath = null; // the run owns it now
    await enqueue(run, actor.userId);
    return view(run, await namesOf([run]));
  } catch (err) {
    await discard(filePath);
    throw isUniqueViolation(err) ? ((await anotherActive()) ?? new AppError(409, "Another import is in progress.")) : err;
  }
};

/** GET /admin/upstream-sql-imports — newest first; a run whose worker died is reconciled first. */
export const listRuns = async ({
  status,
  page,
  limit,
}: {
  status?: UpstreamSqlImportStatus | undefined;
  page: number;
  limit: number;
}): Promise<{ rows: RunView[]; meta: { total: number; page: number; limit: number; totalPages: number } }> => {
  await reconcileInterrupted();
  const { count, rows } = await UpstreamSqlImport.findAndCountAll({
    where: status === undefined ? {} : { status },
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
    limit,
    offset: (page - 1) * limit,
  });
  const names = await namesOf(rows);
  return { rows: rows.map((r) => view(r, names)), meta: { total: count, page, limit, totalPages: Math.ceil(count / limit) } };
};

/** GET /admin/upstream-sql-imports/:id */
export const getRun = async (id: string): Promise<RunView> => {
  const run = await loadRun(id);
  return view(run, await namesOf([run]));
};

/**
 * POST /admin/upstream-sql-imports/:id/cancel — a queued run is cancelled at once (its file
 * deleted); a scanning or parsing run is asked to stop, and the worker stops it.
 * @throws {AppError} 404; 409 for a finished run (with its state)
 */
export const cancelRun = async (id: string, actor: Actor): Promise<RunView> => {
  const run = await loadRun(id);
  if (!ACTIVE.includes(run.status)) {
    throw new AppError(409, `The run is ${run.status}; only an uploaded, scanning or parsing run can be cancelled.`);
  }
  if (run.cancelRequestedAt) {
    return getRun(id);
  }
  const fileToDelete = run.status === "uploaded" ? run.filePath : null;
  await db.transaction(async (transaction) => {
    const now = new Date();
    if (run.status === "uploaded") {
      const [count] = await UpstreamSqlImport.update(
        { status: "cancelled", cancelRequestedAt: now, cancelledBy: actor.userId, finishedAt: now, filePath: null, fileDeletedAt: now },
        { where: { id, status: "uploaded" }, transaction },
      );
      if (count === 0) {
        throw new AppError(409, "The run has just started; ask again to stop it while it runs.");
      }
      await run.reload({ transaction });
      const notificationId = await notifyUploader(transaction, run);
      await auditTransition(transaction, run, "uploaded", "cancelled", actor, { notificationId, fileDeleted: true });
      return;
    }
    const [count] = await UpstreamSqlImport.update(
      { cancelRequestedAt: now, cancelledBy: actor.userId },
      { where: { id, status: { [Op.in]: ["scanning", "parsing"] }, cancelRequestedAt: null }, transaction },
    );
    if (count === 0) {
      throw new AppError(409, "The run has just finished; it can no longer be cancelled.");
    }
    await auditTransition(transaction, run, run.status, run.status, actor, { operation: "UPSTREAM_SQL_IMPORT_CANCEL_REQUESTED" });
  });
  await discard(fileToDelete);
  return getRun(id);
};

/**
 * POST /admin/upstream-sql-imports/:id/retry — a failed run whose file is still kept runs again;
 * its staging rows are replaced, never added to.
 * @throws {AppError} 404; 409 with the reason it cannot
 */
export const retryRun = async (id: string, actor: Actor): Promise<RunView> => {
  const run = await loadRun(id);
  if (run.status !== "failed") {
    throw new AppError(409, `The run is ${run.status}; only a failed run can be retried.`);
  }
  if (!isRetryable(run)) {
    throw new AppError(409, "The run's file has been deleted (it was infected, or its retention ended); upload the dump again.");
  }
  if (run.dataClass === "real" && !upstreamRealDataAllowed()) {
    throw new AppError(403, "The run is declared real upstream data and UPSTREAM_REAL_DATA_ALLOWED is off (DPIA gates R-01, R-03, R-17).");
  }
  const busy = await anotherActive();
  if (busy !== null) {
    throw busy;
  }
  try {
    await db.transaction(async (transaction) => {
      const [count] = await UpstreamSqlImport.update(
        {
          status: "uploaded",
          attempt: run.attempt + 1,
          errorCode: null,
          batchJobId: null,
          fileRetainUntil: null,
          cancelRequestedAt: null,
          cancelledBy: null,
          startedAt: null,
          scannedAt: null,
          parseStartedAt: null,
          finishedAt: null,
          bytesRead: 0,
          uncompressedBytes: 0,
          rowsLoaded: 0,
          rowsRejected: 0,
          rowsNotExtracted: 0,
          tables: null,
          parseSummary: null,
        },
        { where: { id, status: "failed" }, transaction },
      );
      if (count === 0) {
        throw new AppError(409, "The run has just changed state; reload it.");
      }
      await run.reload({ transaction });
      await auditTransition(transaction, run, "failed", "uploaded", actor, { operation: "UPSTREAM_SQL_IMPORT_RETRY" });
    });
  } catch (err) {
    throw isUniqueViolation(err) ? ((await anotherActive()) ?? new AppError(409, "Another import is in progress.")) : err;
  }
  await enqueue(run, actor.userId);
  return getRun(id);
};

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

/** A conditional transition by the worker, with its audit row (and, when final, the notification). */
const workerTransition = async (
  run: Run,
  from: UpstreamSqlImportStatus,
  to: UpstreamSqlImportStatus,
  values: Partial<Run["_attributes"]>,
  extra: Record<string, unknown> = {},
): Promise<boolean> =>
  db.transaction(async (transaction) => {
    const [count] = await UpstreamSqlImport.update({ ...values, status: to }, { where: { id: run.id, status: from }, transaction });
    if (count === 0) {
      return false;
    }
    await run.reload({ transaction });
    const final = to === "loaded" || to === "failed" || to === "cancelled";
    const notificationId = final ? await notifyUploader(transaction, run) : null;
    await auditTransition(transaction, run, from, to, null, final ? { ...extra, notificationId } : extra);
    return true;
  });

/** The counts a finished pipeline (or a progress snapshot) writes on the run. */
const countsOf = (tables: Record<string, TableReport>): Pick<Run["_attributes"], "rowsLoaded" | "rowsRejected" | "rowsNotExtracted"> => {
  const all = Object.values(tables);
  return {
    rowsLoaded: all.reduce((sum, t) => sum + t.rowsLoaded, 0),
    rowsRejected: all.reduce((sum, t) => sum + t.rowsRejected, 0),
    rowsNotExtracted: all.reduce((sum, t) => sum + t.rowsNotExtracted, 0),
  };
};

/** The SQLSTATE of a database error, or null. */
const sqlStateOf = (err: unknown): string | null => {
  const code = (err as { parent?: { code?: unknown } }).parent?.code;
  return typeof code === "string" ? code : null;
};

/** The run's failure for an error thrown while it ran. */
const failureOf = (err: unknown): ImportFailure =>
  err instanceof ImportFailure ? err : new ImportFailure("STAGING_FAILED", `SQLSTATE ${sqlStateOf(err) ?? "unknown"}`);

/** Stream the file into staging, on the import role's connection, in one transaction. */
const stage = async (run: Run, settings: UpstreamImportSettings): Promise<PipelineResult> => {
  const staging = createStagingDb();
  try {
    const transaction = await staging.transaction();
    // The staging instance is a Sequelize instance: `sql()`'s runner (as config/index.ts types its bootstrap one).
    const session = { runner: staging as unknown as SqlRunner, transaction };
    try {
      try {
        await beginStaging(session, importRoleName());
      } catch {
        throw new ImportFailure("STAGING_ROLE_INVALID", FAILURE_TEXT.STAGING_ROLE_INVALID);
      }
      await purgeRun(session, run.id);
      const result = await runPipeline({
        filePath: run.filePath as string,
        compression: run.compression,
        maxUncompressedBytes: settings.maxUncompressedBytes,
        session,
        runId: run.id,
        onProgress: async (progress) => {
          await UpstreamSqlImport.update(
            { bytesRead: progress.bytesRead, uncompressedBytes: progress.uncompressedBytes, tables: progress.tables, ...countsOf(progress.tables) },
            { where: { id: run.id, status: "parsing" } },
          );
          const current = await UpstreamSqlImport.findByPk(run.id, { attributes: ["cancelRequestedAt"] });
          return Boolean(current?.cancelRequestedAt);
        },
      });
      await transaction.commit();
      return result;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } finally {
    await staging.close();
  }
};

/**
 * Fail or cancel a run that stopped. A cancelled run's file goes; a failed run keeps its file
 * for a retry until its retention ends — unless it is infected or already gone.
 * @returns whether the caller must delete the file now
 */
const stop = async (run: Run, from: UpstreamSqlImportStatus, err: unknown, settings: UpstreamImportSettings): Promise<boolean> => {
  const now = new Date();
  if (err instanceof ImportCancelled) {
    await workerTransition(run, from, "cancelled", { finishedAt: now, filePath: null, fileDeletedAt: now }, { fileDeleted: true });
    return true;
  }
  const failure = failureOf(err);
  const deleteNow = failure.code === "INFECTED" || failure.code === "FILE_MISSING";
  const retainUntil = new Date(now.getTime() + settings.failedRetentionDays * DAY_MS);
  await workerTransition(
    run,
    from,
    "failed",
    {
      errorCode: failure.code,
      finishedAt: now,
      ...(deleteNow ? { filePath: null, fileDeletedAt: now } : { fileRetainUntil: retainUntil }),
    },
    { errorCode: failure.code, fileDeleted: deleteNow },
  );
  return deleteNow;
};

/**
 * The batch-job handler: claim the queued run, scan it, parse it into staging.
 * A failed run ends its job FAILED (the code in errorDetails); a cancelled or
 * already-claimed one completes it.
 */
export const runImportJob = async (job: { id: string }): Promise<{ processedItems: number }> => {
  const settings = upstreamImportSettings();
  const run = await UpstreamSqlImport.findOne({
    where: { status: "uploaded", [Op.or]: [{ batchJobId: null }, { batchJobId: job.id }] },
    order: [["createdAt", "ASC"]],
  });
  if (run === null) {
    return { processedItems: 0 };
  }
  if (!(await workerTransition(run, "uploaded", "scanning", { batchJobId: job.id, startedAt: new Date() }))) {
    return { processedItems: 0 };
  }
  const filePath = run.filePath as string;
  let from: UpstreamSqlImportStatus = "scanning";
  try {
    if (run.dataClass === "real" && !upstreamRealDataAllowed()) {
      throw new ImportFailure("REAL_DATA_NOT_ALLOWED", FAILURE_TEXT.REAL_DATA_NOT_ALLOWED);
    }
    const present = await fs.promises.stat(filePath).then(
      () => true,
      () => false,
    );
    if (!present) {
      throw new ImportFailure("FILE_MISSING", FAILURE_TEXT.FILE_MISSING);
    }
    if ((await sha256Of(filePath)) !== run.sha256) {
      throw new ImportFailure("INTEGRITY_MISMATCH", FAILURE_TEXT.INTEGRITY_MISMATCH);
    }
    const scan = await virusScan.scanFile(filePath);
    if (!scan.clean) {
      // virusScan answers "scan-error: …" or "provider-not-implemented" when it could not scan (fail-closed).
      const unscanned = /^(scan-error|provider-not-implemented)/.test(String(scan.reason));
      throw new ImportFailure(unscanned ? "SCAN_FAILED" : "INFECTED", unscanned ? FAILURE_TEXT.SCAN_FAILED : FAILURE_TEXT.INFECTED);
    }
    await run.reload();
    if (run.cancelRequestedAt) {
      throw new ImportCancelled();
    }
    const now = new Date();
    if (!(await workerTransition(run, "scanning", "parsing", { scannedAt: now, parseStartedAt: now }, { scanProvider: scan.provider }))) {
      return { processedItems: 0 };
    }
    from = "parsing";
    const result = await stage(run, settings);
    const finished = new Date();
    await workerTransition(
      run,
      "parsing",
      "loaded",
      {
        finishedAt: finished,
        bytesRead: result.bytesRead,
        uncompressedBytes: result.uncompressedBytes,
        tables: result.tables,
        parseSummary: { ...result.summary, statements: { ...result.summary.statements } },
        ...countsOf(result.tables),
        filePath: null,
        fileDeletedAt: finished,
      },
      { ...countsOf(result.tables), tables: Object.keys(result.tables).length, fileDeleted: true },
    );
    await discard(filePath);
    return { processedItems: countsOf(result.tables).rowsLoaded };
  } catch (err) {
    if (await stop(run, from, err, settings)) {
      await discard(filePath);
    }
    if (err instanceof ImportCancelled) {
      return { processedItems: 0 };
    }
    const failure = failureOf(err);
    logger.warn("Upstream SQL import failed", { runId: run.id, code: failure.code, sqlState: sqlStateOf(err) });
    throw new Error(`Upstream SQL import ${run.id} failed: ${failure.code}`);
  }
};

batchJobService.registerHandler(UPSTREAM_SQL_IMPORT_JOB_TYPE, (job) => runImportJob(job));

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * A run still active whose batch job has ended (batchJob.service's sweep failed it, or it
 * finished without moving the run) or never existed: FAILED, INTERRUPTED, its file kept for a
 * retry. A queued run with no job yet is given QUEUE_GRACE_MS before it counts as lost.
 * @returns how many runs were failed
 */
export const reconcileInterrupted = async (now: Date = new Date()): Promise<number> => {
  const active = await UpstreamSqlImport.findAll({ where: { status: { [Op.in]: [...ACTIVE] } } });
  let failed = 0;
  for (const run of active) {
    const job = run.batchJobId ? await BatchJob.findByPk(run.batchJobId, { attributes: ["status"], skipTenantScope: true }) : null;
    const running = job !== null && (job.status === "PENDING" || job.status === "PROCESSING");
    const waiting = !run.batchJobId && now.getTime() - run.updatedAt.getTime() < QUEUE_GRACE_MS;
    if (running || waiting) {
      continue;
    }
    const moved = await workerTransition(
      run,
      run.status,
      "failed",
      { errorCode: "INTERRUPTED", finishedAt: now, fileRetainUntil: new Date(now.getTime() + upstreamImportSettings().failedRetentionDays * DAY_MS) },
      { errorCode: "INTERRUPTED", jobStatus: job?.status ?? null },
    );
    failed += moved ? 1 : 0;
  }
  return failed;
};

/** What one sweep did. */
export interface SweepSummary {
  interrupted: number;
  /** P24-01: transforms whose job ended without moving them. */
  interruptedTransforms: number;
  purged: number;
  orphans: number;
}

/**
 * The hourly sweep: reconcile interrupted runs, delete the files of failed runs past their
 * retention, and delete a file in the dump directory that no run points at.
 */
export const sweepUpstreamSqlImports = (now: Date = new Date()): Promise<SweepSummary> =>
  runForTenant(PLATFORM_TENANT_ID, async () => {
    const interrupted = await reconcileInterrupted(now);
    const interruptedTransforms = await reconcileInterruptedTransforms(now);
    const expired = await UpstreamSqlImport.findAll({
      where: { status: "failed", filePath: { [Op.ne]: null }, fileRetainUntil: { [Op.lt]: now } },
    });
    let purged = 0;
    for (const run of expired) {
      const filePath = run.filePath;
      await db.transaction(async (transaction) => {
        await run.update({ filePath: null, fileDeletedAt: now }, { transaction });
        await auditTransition(transaction, run, "failed", "failed", null, { operation: "UPSTREAM_SQL_IMPORT_FILE_PURGED", fileDeleted: true });
      });
      await discard(filePath);
      purged += 1;
    }
    const referenced = new Set(
      (await UpstreamSqlImport.findAll({ where: { filePath: { [Op.ne]: null } }, attributes: ["filePath"] })).map((r) => r.filePath),
    );
    let orphans = 0;
    const entries = await fs.promises.readdir(dumpDirectory(), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dumpDirectory(), entry.name);
      if (!entry.isFile() || referenced.has(full)) {
        continue;
      }
      const stat = await fs.promises.lstat(full);
      if (now.getTime() - stat.mtimeMs > ORPHAN_AGE_MS) {
        await discard(full);
        orphans += 1;
      }
    }
    return { interrupted, interruptedTransforms, purged, orphans };
  });

/** The statuses, re-exported for the controller's schema checks. */
export { UPSTREAM_SQL_IMPORT_STATUSES };
