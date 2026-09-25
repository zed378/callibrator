const { Op } = require("sequelize");
const { BatchJob } = require("../models");
const { AppError } = require("../utils/appError.util");
const { logger } = require("../middlewares/activityLog.middleware");
const rabbitmq = require("./rabbitmq.service");
const auditService = require("./audit.service");
// `db` from config, NOT from the models barrel (CLAUDE.md, traps).
const { db } = require("../config");
const { SYSTEM_ACTORS } = require("../constants/systemActors");
const { runForTenant, runAsSystem, SYSTEM_TASKS } = require("../utils/jobContext.util");

const BATCH_QUEUE = "batch_jobs";
const BATCH_DLQ = "batch_jobs_dlq";
// Inline mode processes jobs in-process (no broker). Useful for local dev and
// tests; production runs the RabbitMQ worker (src/workers/batchJob.worker.js).
const INLINE = process.env.BATCH_JOBS_INLINE === "true";

/** A running job touches its row this often, so a live job is never "stale". */
const HEARTBEAT_MS = parseInt(process.env.BATCH_JOB_HEARTBEAT_MS, 10) || 60 * 1000;
/** A PROCESSING row untouched this long belongs to a worker that died (W-07). */
const STALE_MINUTES = parseInt(process.env.BATCH_JOB_STALE_MINUTES, 10) || 10;

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
const HANDLERS = {};

/** Register a processor for a batch-job type. */
exports.registerHandler = (type, fn) => {
  HANDLERS[type] = fn;
};

/** Test/introspection helper: the set of registered handler types. */
exports.registeredTypes = () => Object.keys(HANDLERS);

const noHandlerReason = (type) =>
  `No handler is registered for batch job type "${type}"; nothing was processed.`;

exports.createJob = async (tenantId, userId, type, totalItems = 0) => {
  // W-08: refuse work nothing can do, rather than accept it and "complete" it.
  if (!HANDLERS[type]) {
    const known = exports.registeredTypes();
    throw new AppError(
      400,
      `Unknown batch job type "${type}". ${
        known.length ? `Registered types: ${known.join(", ")}.` : "No batch job types are available on this server."
      }`,
    );
  }

  const job = await BatchJob.create({
    tenantId,
    userId,
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
        error: err.message,
      });
    }
  }

  // No broker (or inline mode): process without blocking the caller. State lives
  // in the DB, so this is restart-observable rather than a fabricated timer.
  if (!queued) {
    exports
      .runJob(job.id, tenantId)
      .catch((err) =>
        logger.error("Inline batch job failed", {
          jobId: job.id,
          error: err.message,
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
 * @param {object} transaction
 * @param {{id: string, tenantId: string, type?: string, userId?: string}} job
 * @param {string} from
 * @param {string} to
 * @param {string|null} [reason]
 */
const auditTransition = (transaction, job, from, to, reason = null) =>
  auditService.logAction(
    {
      tenantId: job.tenantId,
      systemActor: SYSTEM_ACTORS.BATCH_JOB,
      action: "UPDATE",
      resourceType: "BatchJob",
      resourceId: job.id,
      changes: {
        operation: "BATCH_JOB_STATE",
        type: job.type || null,
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
const fail = (subject, reason) =>
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
 * @param {string} jobId
 * @param {string} tenantId - the tenant the job's message carries
 * @returns {Promise<{job: object|null, ran: boolean, reason?: string}>}
 * @throws the handler's error, after the row is marked FAILED
 */
exports.runJob = async (jobId, tenantId) => {
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
        await auditTransition(transaction, { ...subjectOf(row), id: jobId, tenantId }, "PENDING", "PROCESSING");
      }
      return { claimed: count, job: row };
    });
    if (!claimed) {
      // Not in this tenant, gone, or already started/finished elsewhere.
      return { job, ran: false, reason: job ? `job is ${job.status}` : "job not found" };
    }
    const subject = { ...subjectOf(job), id: jobId, tenantId };

    const handler = HANDLERS[job.type];
    if (!handler) {
      const reason = noHandlerReason(job.type);
      logger.warn("Batch job failed: no handler", { jobId, type: job.type });
      await fail(subject, reason);
      return { job: await BatchJob.findByPk(jobId), ran: false, reason };
    }

    const heartbeat = setInterval(() => {
      BatchJob.update({ status: "PROCESSING" }, { where: { id: jobId, status: "PROCESSING" } }).catch((err) =>
        logger.warn("Batch job heartbeat failed", { jobId, error: err.message }),
      );
    }, HEARTBEAT_MS);
    heartbeat.unref();

    try {
      const result = (await handler(job)) || {};
      // Re-read: don't clobber a job the handler explicitly failed, or one
      // deleted while it ran (a null row is not a handler error).
      const fresh = await db.transaction(async (transaction) => {
        const current = await BatchJob.findByPk(jobId, { transaction });
        if (current && current.status === "PROCESSING") {
          await current.update(
            {
              status: "COMPLETED",
              progress: 100,
              processedItems: Number.isInteger(result.processedItems) ? result.processedItems : current.processedItems,
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
      logger.error("Batch job failed", { jobId, error: err.message });
      await fail(subject, err.message);
      throw err;
    } finally {
      clearInterval(heartbeat);
    }
  });
};

/** The audit subject of a job row (its own tenant, type and requester). */
const subjectOf = (row) => ({ id: row.id, tenantId: row.tenantId, type: row.type, userId: row.userId });

/**
 * Fail every PROCESSING row matching `where`, and audit each one in the same
 * transaction, in ITS OWN tenant (W-04). `RETURNING` names the rows the
 * UPDATE actually changed, so a row another sweep got first is not audited.
 *
 * @param {string} reason - errorDetails, and the audit row's reason
 * @param {object} where - must include `status: "PROCESSING"`
 * @returns {Promise<number>}
 */
const failWithAudit = (reason, where) =>
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
 * @param {Date} [now]
 * @returns {Promise<number>} how many were failed
 */
exports.failAbandonedJobs = async (now = new Date()) => {
  const cutoff = new Date(now.getTime() - STALE_MINUTES * 60 * 1000);
  const count = await runAsSystem(SYSTEM_TASKS.BATCH_JOB_SWEEP, () =>
    failWithAudit(
      `Interrupted: the worker running this job stopped (a restart or a crash) and it made no progress for ${STALE_MINUTES} minutes. ` +
        "It was not re-run automatically; start it again if it is still needed.",
      { status: "PROCESSING", updatedAt: { [Op.lt]: cutoff } },
    ),
  );
  if (count > 0) {
    logger.warn(`Failed ${count} abandoned batch job(s) stuck in PROCESSING`);
  }
  return count;
};

/**
 * Fail the given jobs NOW because this process is shutting down with them
 * still running (W-07). Only rows still PROCESSING are touched.
 *
 * @param {string[]} jobIds
 * @returns {Promise<number>}
 */
exports.failInterruptedJobs = async (jobIds) => {
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

exports.getJobs = async (tenantId, page = 1, limit = 10) => {
  const offset = (page - 1) * limit;
  const { count, rows } = await BatchJob.findAndCountAll({
    where: { tenantId },
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / limit),
    jobs: rows,
  };
};

exports.getJobStatus = async (tenantId, jobId) => {
  const job = await BatchJob.findOne({
    where: { id: jobId, tenantId },
  });

  if (!job) {
    throw new AppError(404, "Job not found");
  }

  return job;
};

// Queue names exported for the worker.
exports.BATCH_QUEUE = BATCH_QUEUE;
exports.BATCH_DLQ = BATCH_DLQ;
exports.STALE_MINUTES = STALE_MINUTES;
