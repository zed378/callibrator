const { BatchJob } = require("../models");
const { AppError } = require("../utils/appError.util");
const { logger } = require("../middlewares/activityLog.middleware");
const rabbitmq = require("./rabbitmq.service");

const BATCH_QUEUE = "batch_jobs";
const BATCH_DLQ = "batch_jobs_dlq";
// Inline mode processes jobs in-process (no broker). Useful for local dev and
// tests; production runs the RabbitMQ worker (src/workers/batchJob.worker.js).
const INLINE = process.env.BATCH_JOBS_INLINE === "true";

// Registry of real per-type processors. A handler receives the BatchJob
// instance and does the actual work, updating processedItems/progress as it
// goes. Types with no registered handler simply complete (a no-op job).
const HANDLERS = {};

/** Register a processor for a batch-job type. */
exports.registerHandler = (type, fn) => {
  HANDLERS[type] = fn;
};

/** Test/introspection helper: the set of registered handler types. */
exports.registeredTypes = () => Object.keys(HANDLERS);

exports.createJob = async (tenantId, userId, type, totalItems = 0) => {
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
      .runJob(job.id)
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
 * Execute a job by id: mark PROCESSING, run its registered handler (if any),
 * then mark COMPLETED. All state is persisted, so a crashed/restarted worker
 * can be re-driven from the queue. Called by the worker and by the inline
 * fallback.
 */
exports.runJob = async (jobId) => {
  const job = await BatchJob.findByPk(jobId);
  if (!job) {
    return null;
  }

  try {
    await job.update({ status: "PROCESSING" });

    const handler = HANDLERS[job.type];
    if (handler) {
      await handler(job);
    }

    // Re-read to pick up any progress the handler persisted; don't clobber a
    // job the handler explicitly failed.
    const fresh = await BatchJob.findByPk(jobId);
    if (fresh && fresh.status !== "FAILED") {
      await fresh.update({
        status: "COMPLETED",
        progress: 100,
        processedItems: fresh.totalItems || fresh.processedItems || 0,
        resultUrl: `/api/v1/jobs/${jobId}/download`,
      });
    }
    return fresh;
  } catch (err) {
    logger.error("Batch job failed", { jobId, error: err.message });
    await BatchJob.update(
      { status: "FAILED", errorDetails: err.message },
      { where: { id: jobId } },
    );
    throw err;
  }
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
