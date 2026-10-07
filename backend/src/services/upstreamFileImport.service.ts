/**
 * The rsync image import: copy the upstream application's device photos from its server into
 * this deployment, in the background, and tell the operator when it is done (owner request
 * 2026-10-07; ADR-130; docs/UPSTREAM/08-FILE-POLICY.md;
 * P24-03's transfer half).
 *
 * THE FLOW (super admin only, every step audited under the PLATFORM tenant):
 *   1. check — scan the source's host keys and show their fingerprints (no login);
 *   2. check with a confirmed fingerprint — log in with the PINNED key, list each class folder
 *      (`rsync --dry-run --stats`), estimate files and bytes;
 *   3. start — the same check again (refused 409 unless it passes), then a queued batch job;
 *   4. the job — rsync each class folder into the staging QUARANTINE (resumable, bandwidth-limited,
 *      cancellable), then the 08-FILE-POLICY ingest into the target tenant's storage, a manifest
 *      for the Phase 24 ETL, and a notification (in-app + e-mail) to the requester: completed,
 *      failed or cancelled, with COUNTS only.
 *
 * THE CREDENTIAL (the password or private key): validated, used, never logged, never in an
 * argument vector, never answered. Stored only for the import's lifetime, KMS-encrypted and bound
 * to the row's id; erased (set to NULL, `secretErasedAt` stamped) in the same transaction as the
 * terminal status, and the database refuses a terminal row that still holds one (0113's CHECK).
 *
 * THE GATE: `UPSTREAM_REAL_DATA_ALLOWED` (config/upstream.ts) — re-checked when the job starts,
 * not only when it is queued, so turning the gate off stops a queued real import.
 */
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { Op, type Transaction } from "sequelize";
import models from "../models";
import { db } from "../config";
import auditService from "./audit.service";
import batchJobService from "./batchJob.service";
import notificationService from "./notification.service";
import kms from "./kms.service";
import storage from "./storage";
import storedFile from "./storedFile.service";
import virusScan from "./virusScan.service";
import { AppError } from "../utils/appError.util";
import { logger } from "../middlewares/activityLog.middleware";
import { runForTenant } from "../utils/jobContext.util";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { SYSTEM_ACTORS } from "../constants/systemActors";
import { isActiveTenantStatus } from "../constants/tenantStatus";
import {
  UPSTREAM_FILE_CLASSES,
  UPSTREAM_FILE_CLASS_NAMES,
  UPSTREAM_FILE_IMPORT_JOB_TYPE,
  type UpstreamFileClass,
} from "../constants/upstreamFileImport";
import { rsyncAllowedHosts, rsyncCheckTimeoutMs, rsyncIoTimeoutSec, upstreamImportDir, upstreamRealDataAllowed } from "../config/upstream";
import { assertSourceAllowed, resolveSource } from "./upstreamFileImport/hostGuard";
import { listRemote, openSession, scanHostKeys, transferRemote, type ConnectionError, type SessionInput } from "./upstreamFileImport/connection";
import type { ScannedHostKey } from "./upstreamFileImport/hostKeys";
import { createRunScratch, ensureDir, importPaths, sourceKey, type RunScratch } from "./upstreamFileImport/workspace";
import { emptyCounts, ingestStaged, listFiles, type IngestCounts, type ManifestEntry } from "./upstreamFileImport/ingest";
import type { CheckConnectionInput, ListImportsInput, StartImportInput } from "../validators/upstreamFileImport.validator";
import type { UpstreamImportEstimate, UpstreamImportProgress, UpstreamImportSummary } from "../utils/jsonShape.util";
import type { ModelInstance } from "../types/models";
import type { UpstreamFileImportStatus } from "@callibrator/contracts/states";

const { UpstreamFileImport, BatchJob, Tenant, User } = models;

type ImportRow = ModelInstance<"UpstreamFileImport">;

/** The operator acting, with the request's address (for the audit row). */
export interface Actor {
  readonly userId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The statuses an import can still leave (the credential exists only in these). */
export const LIVE_STATUSES: readonly UpstreamFileImportStatus[] = Object.freeze(["pending", "transferring", "ingesting"]);

/** How often a running import looks for a cancel request (the row is the channel: any replica can cancel). */
export const CANCEL_POLL_MS = 2_000;

/** How often progress is written to the row and the batch job. */
export const PROGRESS_WRITE_MS = 5_000;

/** How long the job waits for its import row to be linked (createJob may start it before the link). */
const LINK_WAIT_MS = 30_000;
const LINK_POLL_MS = 250;

/** The transfer's overall ceiling (rsync's own I/O timeout ends a stalled one far earlier). */
const TRANSFER_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** A queued import whose job never linked is failed after this long. */
const UNLINKED_AFTER_MS = 5 * 60 * 1000;

/** Check-connection rate limit, per operator, per process: 10 checks (a start is one) per 10 minutes, one at a time. */
export const CHECK_LIMIT = 10;
export const CHECK_WINDOW_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** The additional data a credential envelope is bound to: this import, and nothing else. */
const secretAad = (importId: string): string => `upstream-file-import:${importId}`;

/** The classes a row includes, in the fixed order. */
const classesOf = (row: Pick<ImportRow, "includeFront" | "includeSerial">): UpstreamFileClass[] =>
  UPSTREAM_FILE_CLASS_NAMES.filter((name) => (name === "front" ? row.includeFront : row.includeSerial));

/** A remote class folder. */
const classDir = (remotePath: string, cls: UpstreamFileClass): string => `${remotePath === "/" ? "" : remotePath}/${UPSTREAM_FILE_CLASSES[cls]}`;

const isLive = (status: UpstreamFileImportStatus): boolean => LIVE_STATUSES.includes(status);

/** A stable failure of the job, carried to the row as its errorCode. */
class ImportFailure extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`upstream file import failed: ${code}`);
    this.code = code;
  }
}

const recentChecks = new Map<string, number[]>();
const checksInFlight = new Set<string>();

/** Take a check slot for `userId`, or refuse with 429. Answers the release function. */
export const takeCheckSlot = (userId: string, now: number = Date.now()): (() => void) => {
  if (checksInFlight.has(userId)) {
    throw new AppError(429, "A connection check is already running; wait for it to finish");
  }
  const recent = (recentChecks.get(userId) ?? []).filter((at) => now - at < CHECK_WINDOW_MS);
  if (recent.length >= CHECK_LIMIT) {
    throw new AppError(429, `At most ${String(CHECK_LIMIT)} connection checks per 10 minutes; try again later`);
  }
  recent.push(now);
  recentChecks.set(userId, recent);
  checksInFlight.add(userId);
  return () => {
    checksInFlight.delete(userId);
  };
};

/** Test helper: forget every rate-limit record. */
export const resetCheckSlots = (): void => {
  recentChecks.clear();
  checksInFlight.clear();
};

// ---------------------------------------------------------------------------
// The answer shapes (never a credential, never a file name)
// ---------------------------------------------------------------------------

/** One import as the API answers it. */
export interface ImportView {
  id: string;
  targetTenantId: string;
  status: UpstreamFileImportStatus;
  host: string;
  port: number;
  username: string;
  remotePath: string;
  fileClasses: UpstreamFileClass[];
  authMethod: string;
  hostKeyType: string;
  hostKeyFingerprint: string;
  syntheticSource: boolean;
  bandwidthLimitKbps: number | null;
  estimate: UpstreamImportEstimate | null;
  progress: UpstreamImportProgress | null;
  summary: UpstreamImportSummary | null;
  errorCode: string | null;
  cancelRequested: boolean;
  /** Whether the encrypted credential still exists (only while the import can run). */
  credentialStored: boolean;
  secretErasedAt: string | null;
  batchJobId: string | null;
  requestedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const iso = (value: Date | null | undefined): string | null => (value ? value.toISOString() : null);

/** The projection: every field named, so a new column never leaks by default. */
export const toView = (row: ImportRow): ImportView => ({
  id: row.id,
  targetTenantId: row.targetTenantId,
  status: row.status,
  host: row.host,
  port: row.port,
  username: row.username,
  remotePath: row.remotePath,
  fileClasses: classesOf(row),
  authMethod: row.authMethod,
  hostKeyType: row.hostKeyType,
  hostKeyFingerprint: row.hostKeyFingerprint,
  syntheticSource: row.syntheticSource,
  bandwidthLimitKbps: row.bandwidthLimitKbps ?? null,
  estimate: row.estimate ?? null,
  progress: row.progress ?? null,
  summary: row.summary ?? null,
  errorCode: row.errorCode ?? null,
  cancelRequested: row.cancelRequestedAt !== null,
  credentialStored: row.secretCiphertext !== null,
  secretErasedAt: iso(row.secretErasedAt),
  batchJobId: row.batchJobId ?? null,
  requestedBy: row.requestedBy,
  startedAt: iso(row.startedAt),
  finishedAt: iso(row.finishedAt),
  createdAt: (row.createdAt as Date).toISOString(),
  updatedAt: (row.updatedAt as Date).toISOString(),
});

/** One class folder's check. */
export interface ClassCheck {
  status: "ok" | "path_not_found" | "path_not_readable";
  files: number;
  bytes: number;
}

/** What check-connection answers. */
export interface CheckAnswer {
  /** `ok`: logged in and every class folder listed. `host_key_unconfirmed`: keys read, confirm one. */
  status: "ok" | "host_key_unconfirmed" | ConnectionError;
  hostKeys: { type: string; fingerprint: string }[];
  confirmedHostKey: { type: string; fingerprint: string } | null;
  classes: Partial<Record<UpstreamFileClass, ClassCheck>>;
  estimate: UpstreamImportEstimate | null;
}

/** The check, with the pinned key the start needs (never answered as is). */
interface ProbeResult {
  answer: CheckAnswer;
  pinned: ScannedHostKey | null;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** The source as an audit row records it: never the credential. */
const sourceForAudit = (source: {
  host: string;
  port: number;
  username: string;
  remotePath: string;
  authMethod: string;
  syntheticSource: boolean;
}): Record<string, unknown> => ({
  host: source.host,
  port: source.port,
  username: source.username,
  remotePath: source.remotePath,
  authMethod: source.authMethod,
  syntheticSource: source.syntheticSource,
});

const auditPlatform = (
  entry: { userId?: string | null; systemActor?: string | null; resourceId: string | null; changes: Record<string, unknown>; action: "CREATE" | "UPDATE" },
  actor: Actor | null,
  transaction?: Transaction,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId: PLATFORM_TENANT_ID,
      userId: entry.userId ?? null,
      systemActor: entry.systemActor ?? null,
      action: entry.action,
      resourceType: "UpstreamFileImport",
      resourceId: entry.resourceId,
      changes: entry.changes,
      ipAddress: actor?.ipAddress ?? null,
      userAgent: actor?.userAgent ?? null,
    },
    transaction ? { transaction } : {},
  );

// ---------------------------------------------------------------------------
// Check connection
// ---------------------------------------------------------------------------

/** The credential of an input. */
const credentialOf = (input: Pick<CheckConnectionInput, "authMethod" | "password" | "privateKey">): Pick<SessionInput, "password" | "privateKey"> =>
  input.authMethod === "password" ? { password: input.password } : { privateKey: input.privateKey };

/**
 * Scan, and — with a confirmed fingerprint — log in and list every class folder. Every external
 * step is bounded by RSYNC_CHECK_TIMEOUT_MS.
 */
const probe = async (input: CheckConnectionInput): Promise<ProbeResult> => {
  const resolved = await resolveSource(input.host);
  const timeoutMs = rsyncCheckTimeoutMs();
  const scratch = await createRunScratch();
  try {
    const empty: CheckAnswer = { status: "host_key_unconfirmed", hostKeys: [], confirmedHostKey: null, classes: {}, estimate: null };
    const scan = await scanHostKeys(resolved.address, input.port, Math.min(timeoutMs, 30_000), scratch.dir);
    if (!scan.ok) {
      return { answer: { ...empty, status: scan.error }, pinned: null };
    }
    const hostKeys = scan.keys.map(({ type, fingerprint }) => ({ type, fingerprint }));
    if (input.confirmedFingerprint === undefined) {
      return { answer: { ...empty, hostKeys }, pinned: null };
    }
    const pinned = scan.keys.find((k) => k.fingerprint === input.confirmedFingerprint) ?? null;
    if (!pinned) {
      return { answer: { ...empty, status: "host_key_mismatch", hostKeys }, pinned: null };
    }
    const confirmedHostKey = { type: pinned.type, fingerprint: pinned.fingerprint };
    const session = await openSession(
      {
        address: resolved.address,
        port: input.port,
        username: input.username,
        authMethod: input.authMethod,
        ...credentialOf(input),
        pinned: { type: pinned.type, key: pinned.key },
      },
      scratch,
    );
    const emptyDir = path.join(scratch.dir, "empty");
    await fs.promises.mkdir(emptyDir, { mode: 0o700 });
    const classes: Partial<Record<UpstreamFileClass, ClassCheck>> = {};
    let status: CheckAnswer["status"] = "ok";
    for (const cls of input.fileClasses) {
      const listed = await listRemote(session, classDir(input.remotePath, cls), emptyDir, timeoutMs, Math.ceil(timeoutMs / 1000));
      if (listed.ok) {
        classes[cls] = { status: "ok", files: listed.files, bytes: listed.bytes };
      } else if (listed.error === "path_not_found" || listed.error === "path_not_readable") {
        classes[cls] = { status: listed.error, files: 0, bytes: 0 };
        status = status === "ok" ? listed.error : status;
      } else {
        // Not a folder problem: the login or the link failed — no class can be listed.
        return { answer: { ...empty, status: listed.error, hostKeys, confirmedHostKey }, pinned };
      }
    }
    const estimate: UpstreamImportEstimate = {
      files: Object.values(classes).reduce((sum, c) => sum + c.files, 0),
      bytes: Object.values(classes).reduce((sum, c) => sum + c.bytes, 0),
      classes: Object.fromEntries(Object.entries(classes).map(([name, c]) => [name, { files: c.files, bytes: c.bytes }])),
    };
    return { answer: { status, hostKeys, confirmedHostKey, classes, estimate }, pinned };
  } finally {
    await scratch.dispose();
  }
};

/**
 * POST /admin/upstream-file-imports/check-connection. A failed connection is an ANSWER (`status`),
 * not an error: the operator sees why. Input and policy refusals are errors (400, 403, 429).
 */
export const checkConnection = async (input: CheckConnectionInput, actor: Actor): Promise<CheckAnswer> => {
  assertSourceAllowed(input.host, input.syntheticSource);
  const release = takeCheckSlot(actor.userId);
  try {
    const { answer } = await probe(input);
    await auditPlatform(
      {
        action: "UPDATE",
        userId: actor.userId,
        resourceId: null,
        changes: {
          operation: "UPSTREAM_CONNECTION_CHECK",
          ...sourceForAudit(input),
          fileClasses: input.fileClasses,
          confirmedFingerprint: input.confirmedFingerprint ?? null,
          outcome: answer.status,
          estimate: answer.estimate ? { files: answer.estimate.files, bytes: answer.estimate.bytes } : null,
        },
      },
      actor,
    );
    return answer;
  } finally {
    release();
  }
};

// ---------------------------------------------------------------------------
// Start, cancel, read
// ---------------------------------------------------------------------------

/** The 409 a failed pre-start check answers, as a state explanation. */
const START_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  host_key_mismatch: "The server no longer presents the confirmed host key. Check the connection again and confirm the key shown.",
  host_key_unconfirmed: "Confirm the server's host key first.",
  auth_failed: "The server refused the user name and credential.",
  path_not_found: "A selected file class folder does not exist under the remote path.",
  path_not_readable: "A selected file class folder is not readable by this user.",
  unreachable: "The server cannot be reached.",
  timeout: "The server did not answer in time.",
  tool_missing: "rsync, ssh or sshpass is not installed in this server image.",
});

/** POST /admin/upstream-file-imports — check again, store the import, queue the job. */
export const startImport = async (input: StartImportInput, actor: Actor): Promise<ImportView> => {
  assertSourceAllowed(input.host, input.syntheticSource);
  const tenant = await Tenant.findByPk(input.targetTenantId, { attributes: ["id", "status"] });
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }
  if (!isActiveTenantStatus(tenant.status)) {
    throw new AppError(409, `The tenant is ${String(tenant.status)}; photos can be imported only into an active tenant`);
  }
  const live = await UpstreamFileImport.count({
    where: { targetTenantId: input.targetTenantId, host: input.host, port: input.port, remotePath: input.remotePath, status: { [Op.in]: [...LIVE_STATUSES] } },
  });
  if (live > 0) {
    throw new AppError(409, "An import of this source into this tenant is already running; wait for it or cancel it");
  }

  const release = takeCheckSlot(actor.userId);
  let probed: ProbeResult;
  try {
    probed = await probe(input);
  } finally {
    release();
  }
  const { answer, pinned } = probed;
  if (answer.status !== "ok" || !pinned || !answer.estimate) {
    throw new AppError(409, START_REFUSALS[answer.status] ?? `The connection check did not pass (${answer.status})`, true, {
      status: answer.status,
    });
  }
  const estimate = answer.estimate;

  const id = randomUUID();
  const secret = input.authMethod === "password" ? input.password : input.privateKey;
  const row = await db.transaction(async (transaction) => {
    const created = await UpstreamFileImport.create(
      {
        id,
        targetTenantId: input.targetTenantId,
        requestedBy: actor.userId,
        status: "pending",
        host: input.host,
        port: input.port,
        username: input.username,
        remotePath: input.remotePath,
        includeFront: input.fileClasses.includes("front"),
        includeSerial: input.fileClasses.includes("serial"),
        authMethod: input.authMethod,
        secretCiphertext: kms.encryptData(secretAad(id), secret),
        hostKeyType: pinned.type,
        hostKey: pinned.key,
        hostKeyFingerprint: pinned.fingerprint,
        syntheticSource: input.syntheticSource,
        bandwidthLimitKbps: input.bandwidthLimitKbps ?? null,
        estimate,
        progress: { filesTransferred: 0, bytesTransferred: 0, filesProcessed: 0, filesToProcess: 0 },
      },
      { transaction },
    );
    await auditPlatform(
      {
        action: "CREATE",
        userId: actor.userId,
        resourceId: id,
        changes: {
          operation: "UPSTREAM_FILE_IMPORT_START",
          targetTenantId: input.targetTenantId,
          ...sourceForAudit(input),
          fileClasses: input.fileClasses,
          hostKeyFingerprint: pinned.fingerprint,
          bandwidthLimitKbps: input.bandwidthLimitKbps ?? null,
          estimate: { files: estimate.files, bytes: estimate.bytes },
        },
      },
      actor,
      transaction,
    );
    return created;
  });

  let jobId: string;
  try {
    const job = await batchJobService.createJob(input.targetTenantId, actor.userId, UPSTREAM_FILE_IMPORT_JOB_TYPE, estimate.files);
    jobId = job.id;
  } catch (err) {
    logger.error("Upstream file import: the batch job could not be queued", { importId: id, error: (err as Error).message });
    await finish(id, "failed", { errorCode: "job_not_queued" }, { userId: actor.userId }, actor);
    throw new AppError(503, "The import could not be queued; nothing was copied. Try again later.");
  }
  await row.update({ batchJobId: jobId });
  return toView(row);
};

/** The statuses list/detail reconcile: a live row whose job ended without it (a dead worker). */
const reconcile = async (row: ImportRow, now: number = Date.now()): Promise<ImportRow> => {
  if (!isLive(row.status)) {
    return row;
  }
  if (row.batchJobId) {
    const job = await BatchJob.findByPk(row.batchJobId, { attributes: ["id", "status"], skipTenantScope: true });
    if (job && (job.status === "FAILED" || job.status === "COMPLETED")) {
      await finish(row.id, "failed", { errorCode: "worker_interrupted" }, { systemActor: SYSTEM_ACTORS.BATCH_JOB }, null);
      return (await UpstreamFileImport.findByPk(row.id)) as ImportRow;
    }
    return row;
  }
  if (now - (row.createdAt as Date).getTime() > UNLINKED_AFTER_MS) {
    await finish(row.id, "failed", { errorCode: "job_not_queued" }, { systemActor: SYSTEM_ACTORS.BATCH_JOB }, null);
    return (await UpstreamFileImport.findByPk(row.id)) as ImportRow;
  }
  return row;
};

/** GET /admin/upstream-file-imports — newest first; rows in `data`, pagination in `meta`. */
export const listImports = async (
  query: ListImportsInput,
): Promise<{ rows: ImportView[]; meta: { total: number; page: number; limit: number; totalPages: number } }> => {
  const { count, rows } = await UpstreamFileImport.findAndCountAll({
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });
  const fresh: ImportRow[] = [];
  for (const row of rows) {
    fresh.push(await reconcile(row));
  }
  return {
    rows: fresh.map(toView),
    meta: { total: count, page: query.page, limit: query.limit, totalPages: Math.ceil(count / query.limit) },
  };
};

/** GET /admin/upstream-file-imports/:id */
export const getImport = async (id: string): Promise<ImportView> => {
  const row = await UpstreamFileImport.findByPk(id);
  if (!row) {
    throw new AppError(404, "Import not found");
  }
  return toView(await reconcile(row));
};

/** POST /admin/upstream-file-imports/:id/cancel — a pending import ends now; a running one at its next check. */
export const cancelImport = async (id: string, actor: Actor): Promise<ImportView> => {
  const row = await UpstreamFileImport.findByPk(id);
  if (!row) {
    throw new AppError(404, "Import not found");
  }
  if (!isLive(row.status)) {
    throw new AppError(409, `This import is already ${row.status}; there is nothing to cancel`);
  }
  if (row.status === "pending") {
    const ended = await finish(id, "cancelled", { cancelledBy: actor.userId }, { userId: actor.userId }, actor, "pending");
    if (ended) {
      return getImport(id);
    }
    // The job claimed it in between: fall through to a cancel request.
  }
  await db.transaction(async (transaction) => {
    const [count] = await UpstreamFileImport.update(
      { cancelRequestedAt: new Date(), cancelledBy: actor.userId },
      { where: { id, status: { [Op.in]: ["transferring", "ingesting"] }, cancelRequestedAt: null }, transaction },
    );
    if (count > 0) {
      await auditPlatform(
        { action: "UPDATE", userId: actor.userId, resourceId: id, changes: { operation: "UPSTREAM_FILE_IMPORT_CANCEL_REQUESTED" } },
        actor,
        transaction,
      );
    }
  });
  return getImport(id);
};

/** GET /admin/upstream-file-imports/config — what the page shows in its banner. */
export const getImportConfig = (): {
  realDataAllowed: boolean;
  allowListedHostCount: number;
  heicConversion: boolean;
  fileClasses: { name: UpstreamFileClass; folder: string }[];
} => ({
  realDataAllowed: upstreamRealDataAllowed(),
  allowListedHostCount: rsyncAllowedHosts().length,
  // No HEIC decoder in the backend yet (08 § 4.1, P21-02): a HEIC file is quarantined with a reason.
  heicConversion: false,
  fileClasses: UPSTREAM_FILE_CLASS_NAMES.map((name) => ({ name, folder: UPSTREAM_FILE_CLASSES[name] })),
});

// ---------------------------------------------------------------------------
// Ending an import: status, credential erasure, audit — one transaction — then the notification
// ---------------------------------------------------------------------------

type TerminalStatus = "completed" | "failed" | "cancelled";

/**
 * Move a live import to a terminal status, erase its credential and audit it, in ONE transaction
 * (in the PLATFORM tenant's context: the audit row is the platform's); then notify the requester.
 *
 * @param onlyFrom - end it only from this status (a pending cancel must not end a claimed import)
 * @returns whether this call ended it (false: it had already ended, or moved on)
 */
export const finish = async (
  id: string,
  status: TerminalStatus,
  extra: { summary?: UpstreamImportSummary | null; errorCode?: string | null; cancelledBy?: string | null },
  by: { userId?: string; systemActor?: string },
  actor: Actor | null,
  onlyFrom?: UpstreamFileImportStatus,
): Promise<boolean> => {
  const ended = await runForTenant(PLATFORM_TENANT_ID, () =>
    db.transaction(async (transaction) => {
      const row = await UpstreamFileImport.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row || !isLive(row.status) || (onlyFrom !== undefined && row.status !== onlyFrom)) {
        return null;
      }
      const before = row.status;
      const now = new Date();
      await row.update(
        {
          status,
          finishedAt: now,
          secretCiphertext: null,
          secretErasedAt: now,
          ...(extra.summary !== undefined ? { summary: extra.summary } : {}),
          ...(extra.errorCode !== undefined ? { errorCode: extra.errorCode } : {}),
          ...(extra.cancelledBy !== undefined ? { cancelledBy: extra.cancelledBy, cancelRequestedAt: row.cancelRequestedAt ?? now } : {}),
        },
        { transaction },
      );
      await auditPlatform(
        {
          action: "UPDATE",
          userId: by.userId ?? null,
          systemActor: by.systemActor ?? null,
          resourceId: id,
          changes: {
            operation: `UPSTREAM_FILE_IMPORT_${status.toUpperCase()}`,
            targetTenantId: row.targetTenantId,
            requestedBy: row.requestedBy,
            before: { status: before },
            after: { status },
            credentialErased: true,
            ...(extra.errorCode ? { errorCode: extra.errorCode } : {}),
            ...(extra.summary ? { summary: extra.summary } : {}),
          },
        },
        actor,
        transaction,
      );
      return row;
    }),
  );
  if (ended) {
    await notifyRequester(ended);
  }
  return ended !== null;
};

/** Bytes as people read them. */
export const formatBytes = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? String(value) : value.toFixed(1)} ${units[unit] as string}`;
};

/** A duration as people read it. */
export const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${String(h)} h ${String(m)} min` : m > 0 ? `${String(m)} min ${String(s)} s` : `${String(s)} s`;
};

const TITLES: Readonly<Record<TerminalStatus, string>> = Object.freeze({
  completed: "Impor foto selesai / Image import completed",
  failed: "Impor foto gagal / Image import failed",
  cancelled: "Impor foto dibatalkan / Image import cancelled",
});

/** The notification text: counts only — never a file name, a path segment of a file, or a person. */
export const notificationMessage = (status: TerminalStatus, summary: UpstreamImportSummary | null, errorCode: string | null): string => {
  const s = summary ?? zeroSummary(0);
  const reasons = Object.entries(s.quarantinedByReason)
    .map(([reason, n]) => `${reason} ${String(n)}`)
    .join(", ");
  const lines = [
    `Files copied: ${String(s.filesCopied)} (${formatBytes(s.bytesCopied)})`,
    `Ingested: ${String(s.ingested)} (${formatBytes(s.bytesIngested)})`,
    `Skipped (already present): ${String(s.skippedPresent)}`,
    `Quarantined: ${String(s.quarantined)}${reasons ? ` — ${reasons}` : ""}`,
    `Failed: ${String(s.failed)}`,
    `Duration: ${formatDuration(s.durationMs)}`,
  ];
  if (status === "failed" && errorCode) {
    lines.unshift(`Reason: ${errorCode}`);
  }
  return lines.join("\n");
};

/** The requester's in-app notification and e-mail. Best effort: a failure is logged, never thrown. */
const notifyRequester = async (row: ImportRow): Promise<void> => {
  try {
    if (!row.requestedBy) {
      return;
    }
    const requester = await User.findByPk(row.requestedBy, { attributes: ["id", "tenantId"], skipTenantScope: true });
    if (!requester?.tenantId) {
      logger.warn("Upstream file import: the requester has no tenant to be notified in", { importId: row.id });
      return;
    }
    const status = row.status as TerminalStatus;
    await runForTenant(requester.tenantId, () =>
      notificationService.emitNotification({
        tenantId: requester.tenantId,
        userId: requester.id,
        type: "SYSTEM",
        title: TITLES[status],
        message: notificationMessage(status, row.summary ?? null, row.errorCode ?? null),
        actionUrl: `/dashboard/upstream-import?import=${row.id}`,
        channels: ["realtime", "email"],
      }),
    );
  } catch (err) {
    logger.warn("Upstream file import: the notification could not be sent", { importId: row.id, error: (err as Error).message });
  }
};

// ---------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------

/** A summary of nothing (an import that failed before copying). */
const zeroSummary = (durationMs: number): UpstreamImportSummary => ({
  filesCopied: 0,
  bytesCopied: 0,
  ingested: 0,
  bytesIngested: 0,
  skippedPresent: 0,
  duplicateContent: 0,
  metadataStripped: 0,
  quarantined: 0,
  quarantinedByReason: {},
  failed: 0,
  durationMs,
});

const summaryOf = (copied: { files: number; bytes: number }, counts: IngestCounts, durationMs: number): UpstreamImportSummary => ({
  filesCopied: copied.files,
  bytesCopied: copied.bytes,
  ingested: counts.ingested,
  bytesIngested: counts.bytesIngested,
  skippedPresent: counts.skippedPresent,
  duplicateContent: counts.duplicateContent,
  metadataStripped: counts.metadataStripped,
  quarantined: counts.quarantined,
  quarantinedByReason: { ...counts.quarantinedByReason },
  failed: counts.failed,
  durationMs,
});

/** The import a job runs: linked right after the job is created, so wait for the link. */
const waitForImport = async (jobId: string): Promise<ImportRow | null> => {
  const deadline = Date.now() + LINK_WAIT_MS;
  for (;;) {
    const row = await UpstreamFileImport.findOne({ where: { batchJobId: jobId } });
    if (row || Date.now() >= deadline) {
      return row;
    }
    await new Promise((resolve) => setTimeout(resolve, LINK_POLL_MS));
  }
};

/** What earlier, completed imports of the same source already put into this tenant: source path → SHA-256. */
export const previouslyIngested = async (row: ImportRow): Promise<Map<string, string>> => {
  const earlier = await UpstreamFileImport.findAll({
    where: {
      targetTenantId: row.targetTenantId,
      host: row.host,
      port: row.port,
      remotePath: row.remotePath,
      status: "completed",
      id: { [Op.ne]: row.id },
    },
    attributes: ["id"],
    order: [
      ["createdAt", "ASC"],
      ["id", "ASC"],
    ],
    limit: 1000,
  });
  const map = new Map<string, string>();
  for (const { id } of earlier) {
    let text: string;
    try {
      text = await fs.promises.readFile(importPaths(id, "").manifest, "utf8");
    } catch {
      continue; // its manifest was removed: nothing to compare against
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") {
        continue;
      }
      try {
        const entry = JSON.parse(line) as ManifestEntry;
        if ((entry.outcome === "ingested" || entry.outcome === "skipped_present") && entry.sourceSha256) {
          map.set(entry.sourcePath, entry.sourceSha256);
        }
      } catch {
        // A torn line (a crash mid-write) is skipped: that file is ingested again, never lost.
      }
    }
  }
  return map;
};

/** The storage side of the ingest, bound to the target tenant's storage. */
const ingestDepsFor = async (targetTenantId: string): Promise<Parameters<typeof ingestStaged>[1]> => {
  const scoped = await storage.getTenantStorage(targetTenantId);
  return {
    scanFile: (absPath) => virusScan.scanFile(absPath),
    buildKey: (name) => scoped.buildKey({ domain: "attachments", name }),
    putObject: async (key, bytes, contentType) => {
      await scoped.put(key, bytes, { contentType });
    },
    readObject: (key) => storedFile.readObject(scoped, key),
    removeObject: (key) => storedFile.removeObject(scoped, key),
    newId: () => randomUUID(),
  };
};

/** A best-effort write: progress and clean-up never fail an import. */
export const quietly = (work: Promise<unknown>): void => {
  work.catch(() => undefined);
};

/** Whether the operator asked to cancel (the row is the channel). A failed read is "not yet". */
export const cancelRequested = async (id: string): Promise<boolean> => {
  try {
    const fresh = await UpstreamFileImport.findByPk(id, { attributes: ["id", "cancelRequestedAt"] });
    return Boolean(fresh?.cancelRequestedAt);
  } catch {
    return false;
  }
};

/** Remove the staging folder when nothing is left in it (a refused file was moved out; a partial stays). */
const pruneStaging = async (staging: string): Promise<void> => {
  if ((await listFiles(staging)).length === 0) {
    await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
};

/**
 * The batch-job handler (`upstream-file-import`). Runs in the TARGET tenant's context
 * (batchJob.service#runJob). Throws when the import did not complete, so the batch job ends FAILED
 * with the reason; the import row has already been ended (and its credential erased) by then.
 */
export const runImportJob = async (job: { id: string }): Promise<{ processedItems: number }> => {
  const imported = await waitForImport(job.id);
  if (!imported) {
    throw new Error("No upstream file import is linked to this batch job");
  }
  const id = imported.id;
  const startedAt = Date.now();
  const [claimed] = await UpstreamFileImport.update(
    { status: "transferring", startedAt: new Date(startedAt) },
    { where: { id, status: "pending", cancelRequestedAt: null } },
  );
  if (claimed === 0) {
    // Cancelled before it started, or already run by another delivery of the message.
    return { processedItems: 0 };
  }
  const row = (await UpstreamFileImport.findByPk(id)) as ImportRow;
  const controller = new AbortController();
  const cancelWatch = setInterval(() => {
    void cancelRequested(id).then((requested) => {
      if (requested) {
        controller.abort();
      }
    });
  }, CANCEL_POLL_MS);
  cancelWatch.unref();

  const progress: UpstreamImportProgress = { filesTransferred: 0, bytesTransferred: 0, filesProcessed: 0, filesToProcess: 0 };
  let lastWrite = 0;
  const estimateBytes = row.estimate?.bytes ?? 0;
  const writeProgress = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastWrite < PROGRESS_WRITE_MS) {
      return;
    }
    lastWrite = now;
    const transferShare = estimateBytes > 0 ? Math.min(1, progress.bytesTransferred / estimateBytes) : 1;
    const ingestShare = progress.filesToProcess > 0 ? progress.filesProcessed / progress.filesToProcess : 0;
    const percent = Math.min(99, Math.floor(transferShare * 50 + ingestShare * 50));
    quietly(UpstreamFileImport.update({ progress: { ...progress } }, { where: { id } }));
    quietly(BatchJob.update({ progress: percent, processedItems: progress.filesProcessed }, { where: { id: job.id } }));
  };

  let scratch: RunScratch | null = null;
  const copied = { files: 0, bytes: 0 };
  let counts = emptyCounts();
  try {
    scratch = await createRunScratch();
    // The gate is the gate when the work starts, not only when it was queued.
    assertSourceAllowed(row.host, row.syntheticSource);
    const secret = kms.decryptData(secretAad(id), row.secretCiphertext);
    if (typeof secret !== "string" || secret === "") {
      throw new ImportFailure("credential_unavailable");
    }
    const resolved = await resolveSource(row.host);
    const session = await openSession(
      {
        address: resolved.address,
        port: row.port,
        username: row.username,
        authMethod: row.authMethod,
        ...(row.authMethod === "password" ? { password: secret } : { privateKey: secret }),
        pinned: { type: row.hostKeyType, key: row.hostKey },
      },
      scratch,
    );
    const paths = importPaths(id, sourceKey(row.targetTenantId, row.host, row.port, row.remotePath));
    await ensureDir(paths.staging);
    const classes = classesOf(row);
    for (const cls of classes) {
      const localDir = path.join(paths.staging, UPSTREAM_FILE_CLASSES[cls]);
      await ensureDir(localDir);
      const base = { ...copied };
      const result = await transferRemote(session, {
        remoteDir: classDir(row.remotePath, cls),
        localDir,
        ioTimeoutSec: rsyncIoTimeoutSec(),
        timeoutMs: TRANSFER_TIMEOUT_MS,
        bandwidthLimitKbps: row.bandwidthLimitKbps ?? null,
        signal: controller.signal,
        onProgress: (p) => {
          progress.bytesTransferred = base.bytes + p.bytes;
          progress.filesTransferred = base.files + p.files;
          writeProgress();
        },
      });
      if (!result.ok) {
        throw new ImportFailure(result.error);
      }
      copied.files += result.files;
      copied.bytes += result.bytes;
      progress.filesTransferred = copied.files;
      progress.bytesTransferred = copied.bytes;
    }
    // The credential is not needed past the transfer: the scratch (key file, known_hosts) goes now.
    await scratch.dispose();
    if (controller.signal.aborted) {
      throw new ImportFailure("cancelled");
    }

    await UpstreamFileImport.update({ status: "ingesting", progress: { ...progress } }, { where: { id, status: "transferring" } });
    counts = await ingestStaged(
      {
        stagingRoot: paths.staging,
        classes: classes.map((name) => ({ name, folder: UPSTREAM_FILE_CLASSES[name] })),
        refusedRoot: paths.refused,
        manifestPath: paths.manifest,
        previouslyIngested: await previouslyIngested(row),
        shouldStop: () => controller.signal.aborted,
        onProgress: (processed, total) => {
          progress.filesProcessed = processed;
          progress.filesToProcess = total;
          writeProgress();
        },
      },
      await ingestDepsFor(row.targetTenantId),
    );
    writeProgress(true);
    if (counts.stopped) {
      throw new ImportFailure("cancelled");
    }
    await pruneStaging(paths.staging);
    await finish(id, "completed", { summary: summaryOf(copied, counts, Date.now() - startedAt) }, { systemActor: SYSTEM_ACTORS.BATCH_JOB }, null);
    return { processedItems: counts.ingested };
  } catch (err) {
    const code = err instanceof ImportFailure ? err.code : err instanceof AppError ? "source_refused" : "internal_error";
    const cancelled = code === "cancelled" || controller.signal.aborted;
    if (!(err instanceof ImportFailure)) {
      logger.error("Upstream file import failed", { importId: id, error: (err as Error).message });
    }
    await finish(
      id,
      cancelled ? "cancelled" : "failed",
      { summary: summaryOf(copied, counts, Date.now() - startedAt), errorCode: cancelled ? null : code },
      { systemActor: SYSTEM_ACTORS.BATCH_JOB },
      null,
    );
    throw new Error(cancelled ? "Cancelled by the operator" : `Upstream file import failed: ${code}`);
  } finally {
    clearInterval(cancelWatch);
    await scratch?.dispose();
  }
};

batchJobService.registerHandler(UPSTREAM_FILE_IMPORT_JOB_TYPE, runImportJob);

/** Where the import keeps its files (for the operator's documentation and tests). */
export const importWorkDir = (): string => upstreamImportDir();
