// src/services/batchJob.service.ts
//
// P9-18 (ADR-087, Stage C): converted from batchJob.service.js with no
// behaviour change. `export =` keeps the object `require()` returned (the same
// keys, in the same order). `createJob` reaches `registeredTypes` and `runJob`
// through that object, as the `.js` did through `exports`, so a spy on either
// still intercepts. `BatchJob`, `Op`, `db`, the logger, `AppError`,
// `SYSTEM_ACTORS` and the jobContext helpers are captured at load, as the `.js`
// destructured them; `rabbitmq` and `auditService` are read at call time.

import Sequelize from "sequelize";
import type { Transaction, WhereOptions } from "sequelize";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import rabbitmq from "./rabbitmq.service";
import auditService from "./audit.service";
// `db` from config, NOT from the models barrel (CLAUDE.md, traps).
import { db as loadedDb } from "../config";
import { SYSTEM_ACTORS as LOADED_SYSTEM_ACTORS } from "../constants/systemActors";
import {
  runForTenant as loadedRunForTenant,
  runAsSystem as loadedRunAsSystem,
  SYSTEM_TASKS as LOADED_SYSTEM_TASKS,
} from "../utils/jobContext.util";
import { env } from "../config/env";
import type { ModelInstance } from "../types/models";

const { Op } = Sequelize;
const { BatchJob } = models;
const AppError = LoadedAppError;
const logger = loadedLogger;
const db = loadedDb;
const SYSTEM_ACTORS = LOADED_SYSTEM_ACTORS;
const runForTenant = loadedRunForTenant;
const runAsSystem = loadedRunAsSystem;
const SYSTEM_TASKS = LOADED_SYSTEM_TASKS;

type BatchJobRow = ModelInstance<"BatchJob">;

/** What a handler returns: what it produced. */
interface HandlerResult {
  processedItems?: number;
  resultUrl?: string;
}

/** A per-type processor: receives the PROCESSING row and does the work. */
type BatchJobHandler = (job: BatchJobRow) => Promise<HandlerResult | null | undefined> | HandlerResult | null | undefined;

/** The audit subject of a job: its own tenant, type and requester. */
interface JobSubject {
  id: string;
  tenantId: string;
  type?: string | null;
  userId?: string | null;
}

/** What runJob answers. */
interface RunResult {
  job: BatchJobRow | null;
  ran: boolean;
  reason?: string;
}

/** The message of a caught error, read as the `.js` read `err.message`. */
const messageOf = (err: unknown): string => (err as Error).message;

const BATCH_QUEUE = "batch_jobs";
const BATCH_DLQ = "batch_jobs_dlq";
// Inline mode processes jobs in-process (no broker). Useful for local dev and
// tests; production runs the RabbitMQ worker (src/workers/batchJob.worker.js).
const INLINE = env("BATCH_JOBS_INLINE") === "true";

// As built: an unset, empty or non-numeric value falls back to the default.
/** A running job touches its row this often, so a live job is never "stale". */
const HEARTBEAT_MS = parseInt(env("BATCH_JOB_HEARTBEAT_MS") as string, 10) || 60 * 1000;
/** A PROCESSING row untouched this long belongs to a worker that died (W-07). */
const STALE_MINUTES = parseInt(env("BATCH_JOB_STALE_MINUTES") as string, 10) || 10;

// Registry of real per-type processors (W-08, ADR-060).
//
// A handler receives the BatchJob row (status PROCESSING) and does the work.
// It MAY update processedItems / progress as it goes, and returns what it
// produced: `{ processedItems?: number, resultUrl?: string }`. `resultUrl` is
// set ONLY from that return — a job that wrote nothing has none.
//
// There is NO default. Until 2026-09-24 an unregistered type "simply
// completed (a no-op job)": PENDING -> COMPLETED, progress 100, processedItems
// copied from the caller's own totalItems, and a resultUrl to a download
// route that does not exist — success reported for work that never happened.
// Now an unregistered type is refused when the job is created (400), and a
// queued job of an unregistered type ends FAILED with the reason.
const HANDLERS: Record<string, BatchJobHandler> = {};

/** Register a processor for a batch-job type. */
const registerHandler = (type: string, fn: BatchJobHandler): void => {
  HANDLERS[type] = fn;
};

/** Test/introspection helper: the set of registered handler types. */
const registeredTypes = (): string[] => Object.keys(HANDLERS);

const noHandlerReason = (type: string): string =>
  `No handler is registered for batch job type "${type}"; nothing was processed.`;

const createJob = async (
  tenantId: string,
  userId: string | null,
  type: string,
  totalItems: number | null = 0,
): Promise<BatchJobRow> => {
  // W-08: refuse work nothing can do, rather than accept it and "complete" it.
  if (!HANDLERS[type]) {
    const known = service.registeredTypes();
    throw new AppError(
      400,
      `Unknown batch job type "${type}". ${
        known.length ? `Registered types: ${known.join(", ")}.` : "No batch job types are available on this server."
      }`,
    );
  }

  const job = await BatchJob.create({
    // As built: the caller's ids are stored as given.
    tenantId: tenantId as BatchJobRow["tenantId"],
    userId: userId as BatchJobRow["userId"],
    type,
    status: "PENDING",
    progress: 0,
    totalItems,
  });

  const payload = { jobId: job.id, tenantId, type };

  // Prefer the durable queue so work survives restarts and scales horizontally.
  let queued = false;
  if (!INLINE) {
    try {
      await rabbitmq.assertQueue(BATCH_QUEUE, BATCH_DLQ);
      queued = await rabbitmq.publish(BATCH_QUEUE, payload);
    } catch (err) {
      logger.warn("Batch queue unavailable; processing job inline", {
        jobId: job.id,
        error: messageOf(err),
      });
    }
  }

  // No broker (or inline mode): process without blocking the caller. State lives
  // in the DB, so this is restart-observable rather than a fabricated timer.
  if (!queued) {
    // Not awaited, as built: the caller is not blocked, and a failure is logged.
    void service
      .runJob(job.id, tenantId)
      .catch((err: unknown) =>
        logger.error("Inline batch job failed", {
          jobId: job.id,
          error: messageOf(err),
        }),
      );
  }

  return job;
};

/**
 * W-04 (ADR-069) — the audit row of one state change, in that change's
 * transaction. The runner and the sweeps are the actor
 * (`system:batch-job`); the user who queued the job is `requestedBy`.
 *
 * @param transaction
 * @param job
 * @param from
 * @param to
 * @param reason
 */
const auditTransition = (
  transaction: Transaction,
  job: JobSubject,
  from: string,
  to: string,
  reason: string | null = null,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId: job.tenantId,
      systemActor: SYSTEM_ACTORS.BATCH_JOB,
      action: "UPDATE",
      resourceType: "BatchJob",
      resourceId: job.id,
      changes: {
        operation: "BATCH_JOB_STATE",
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty type reads as null
        type: job.type || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id reads as null
        requestedBy: job.userId || null,
        before: { status: from },
        after: { status: to },
        ...(reason ? { reason } : {}),
      },
    },
    { transaction },
  );

/**
 * PROCESSING -> FAILED, with its audit row. Only a row still PROCESSING is
 * touched: a job the sweep has already failed is not failed (or audited) twice.
 */
const fail = (subject: JobSubject, reason: string): Promise<void> =>
  db.transaction(async (transaction) => {
    const [count] = await BatchJob.update(
      { status: "FAILED", errorDetails: reason },
      { where: { id: subject.id, status: "PROCESSING" }, transaction },
    );
    if (count > 0) {
      await auditTransition(transaction, subject, "PROCESSING", "FAILED", reason);
    }
  });

/**
 * Execute a job by id, in its tenant's context (W-12).
 *
 * THE CLAIM (W-07) is the row itself: an atomic `PENDING -> PROCESSING`
 * UPDATE. Exactly one runner wins it — on any replica, with or without Redis
 * — and a redelivered message whose job has already started, finished or
 * failed is a no-op. This replaces a Redis claim taken before the work that
 * lived for a DAY: a worker killed mid-job (an ordinary deploy) left the claim
 * held, so the redelivery was acked as a duplicate and dropped, and the row sat
 * in PROCESSING forever. Now a running job heartbeats its row, and
 * `failAbandonedJobs` ends one whose heartbeat stopped.
 *
 * @param jobId
 * @param tenantId - the tenant the job's message carries
 * @throws the handler's error, after the row is marked FAILED
 */
const runJob = async (jobId: string, tenantId: string | null | undefined): Promise<RunResult> => {
  if (!tenantId) {
    throw new Error(`Batch job ${jobId}: the message carries no tenantId; refusing to run it unscoped`);
  }
  return runForTenant(tenantId, async () => {
    // W-04: the claim and its audit row are one transaction.
    const { claimed, job } = await db.transaction(async (transaction) => {
      const [count] = await BatchJob.update(
        { status: "PROCESSING" },
        { where: { id: jobId, status: "PENDING" }, transaction },
      );
      const row = await BatchJob.findByPk(jobId, { transaction });
      if (count > 0) {
        // A row this transaction just claimed exists.
        await auditTransition(transaction, { ...subjectOf(row as BatchJobRow), id: jobId, tenantId }, "PENDING", "PROCESSING");
      }
      return { claimed: count, job: row };
    });
    if (!claimed) {
      // Not in this tenant, gone, or already started/finished elsewhere.
      return { job, ran: false, reason: job ? `job is ${job.status}` : "job not found" };
    }
    // Claimed, so the row exists.
    const claimedJob = job as BatchJobRow;
    const subject: JobSubject = { ...subjectOf(claimedJob), id: jobId, tenantId };

    const handler = HANDLERS[claimedJob.type];
    if (!handler) {
      const reason = noHandlerReason(claimedJob.type);
      logger.warn("Batch job failed: no handler", { jobId, type: claimedJob.type });
      await fail(subject, reason);
      return { job: await BatchJob.findByPk(jobId), ran: false, reason };
    }

    const heartbeat = setInterval(() => {
      // Not awaited, as built: a failed heartbeat is logged, never thrown.
      void BatchJob.update({ status: "PROCESSING" }, { where: { id: jobId, status: "PROCESSING" } }).catch((err: unknown) =>
        logger.warn("Batch job heartbeat failed", { jobId, error: messageOf(err) }),
      );
    }, HEARTBEAT_MS);
    heartbeat.unref();

    try {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy result reads as nothing produced
      const result: HandlerResult = (await handler(claimedJob)) || {};
      // Re-read: don't clobber a job the handler explicitly failed, or one
      // deleted while it ran (a null row is not a handler error).
      const fresh = await db.transaction(async (transaction) => {
        const current = await BatchJob.findByPk(jobId, { transaction });
        // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
        if (current && current.status === "PROCESSING") {
          await current.update(
            {
              status: "COMPLETED",
              progress: 100,
              processedItems: Number.isInteger(result.processedItems) ? (result.processedItems as number) : current.processedItems,
              // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty url reads as null
              resultUrl: result.resultUrl || null,
            },
            { transaction },
          );
          await auditTransition(transaction, subject, "PROCESSING", "COMPLETED");
        }
        return current;
      });
      return { job: fresh, ran: true };
    } catch (err) {
      logger.error("Batch job failed", { jobId, error: messageOf(err) });
      await fail(subject, messageOf(err));
      throw err;
    } finally {
      clearInterval(heartbeat);
    }
  });
};

/** The audit subject of a job row (its own tenant, type and requester). */
const subjectOf = (row: BatchJobRow): JobSubject => ({ id: row.id, tenantId: row.tenantId, type: row.type, userId: row.userId });

/**
 * Fail every PROCESSING row matching `where`, and audit each one in the same
 * transaction, in ITS OWN tenant (W-04). `RETURNING` names the rows the
 * UPDATE actually changed, so a row another sweep got first is not audited.
 *
 * @param reason - errorDetails, and the audit row's reason
 * @param where - must include `status: "PROCESSING"`
 */
const failWithAudit = (reason: string, where: WhereOptions<BatchJobRow>): Promise<number> =>
  db.transaction(async (transaction) => {
    const [count, rows] = await BatchJob.update(
      { status: "FAILED", errorDetails: reason },
      { where, returning: true, transaction },
    );
    for (const row of rows) {
      await auditTransition(transaction, subjectOf(row), "PROCESSING", "FAILED", reason);
    }
    return count;
  });

/**
 * End every job whose worker died: PROCESSING with no heartbeat for
 * STALE_MINUTES becomes FAILED with a reason (W-07). Idempotent and safe on
 * every replica (one conditional UPDATE). Cross-tenant by nature, and says so.
 *
 * @param now
 * @returns how many were failed
 */
const failAbandonedJobs = async (now: Date = new Date()): Promise<number> => {
  const cutoff = new Date(now.getTime() - STALE_MINUTES * 60 * 1000);
  const count = await runAsSystem(SYSTEM_TASKS.BATCH_JOB_SWEEP, () =>
    failWithAudit(
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a number interpolated as its decimal string
      `Interrupted: the worker running this job stopped (a restart or a crash) and it made no progress for ${STALE_MINUTES} minutes. ` +
        "It was not re-run automatically; start it again if it is still needed.",
      { status: "PROCESSING", updatedAt: { [Op.lt]: cutoff } },
    ),
  );
  if (count > 0) {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a number interpolated as its decimal string
    logger.warn(`Failed ${count} abandoned batch job(s) stuck in PROCESSING`);
  }
  return count;
};

/**
 * Fail the given jobs NOW because this process is shutting down with them
 * still running (W-07). Only rows still PROCESSING are touched.
 *
 * @param jobIds
 */
const failInterruptedJobs = async (jobIds: string[]): Promise<number> => {
  if (jobIds.length === 0) {
    return 0;
  }
  return runAsSystem(SYSTEM_TASKS.BATCH_JOB_SHUTDOWN, () =>
    failWithAudit(
      "Interrupted: the server shut down while this job was running. It was not re-run automatically; start it again if it is still needed.",
      { id: { [Op.in]: jobIds }, status: "PROCESSING" },
    ),
  );
};

const getJobs = async (
  tenantId: string,
  page: number | string = 1,
  limit: number | string = 10,
): Promise<{ total: number; page: number; limit: number; totalPages: number; jobs: BatchJobRow[] }> => {
  // As built: page and limit arrive as given (numbers, or query strings Sequelize and arithmetic coerce).
  const pageN = page as number;
  const limitN = limit as number;
  const offset = (pageN - 1) * limitN;
  const { count, rows } = await BatchJob.findAndCountAll({
    where: { tenantId },
    limit: limitN,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / limitN),
    jobs: rows,
  };
};

const getJobStatus = async (tenantId: string, jobId: string): Promise<BatchJobRow> => {
  const job = await BatchJob.findOne({
    where: { id: jobId, tenantId },
  });

  if (!job) {
    throw new AppError(404, "Job not found");
  }

  return job;
};

const service = {
  registerHandler,
  registeredTypes,
  createJob,
  runJob,
  failAbandonedJobs,
  failInterruptedJobs,
  getJobs,
  getJobStatus,
  // Queue names exported for the worker.
  BATCH_QUEUE,
  BATCH_DLQ,
  STALE_MINUTES,
};

export = service;
