// src/workers/batchJob.worker.js
//
// RabbitMQ consumer that drives batch jobs. Work is pulled from the durable
// `batch_jobs` queue, executed via batchJob.service.runJob (which persists
// state), and acked on success / dead-lettered on failure.
//
// W-06: the consumer is SUPERVISED (rabbitmq.service#startConsumer) — a broker
// that is down at boot or restarts later is retried and the consumer
// re-registered, instead of the worker silently never (re)starting.
// W-31: a message is settled on the channel it ARRIVED on. It used to be acked
// through the shared publishing channel, where its delivery tag means nothing —
// a protocol error that closes that channel.
// W-07: the claim is the job row's PENDING -> PROCESSING transition (see
// runJob); shutdown drains in-flight jobs and fails the ones it has to abandon;
// and a sweep fails jobs whose worker died without saying so.

const rabbitmq = require("../services/rabbitmq.service");
const batchJobService = require("../services/batchJob.service");
const { logger } = require("../middlewares/activityLog.middleware");

/** How often the abandoned-job sweep runs (every replica; it is idempotent). */
const SWEEP_INTERVAL_MS =
  parseInt(process.env.BATCH_JOB_SWEEP_INTERVAL_MS, 10) || 5 * 60 * 1000;

/** The job ids this process is running right now. */
const running = new Set();
let sweepTimer = null;

const sweep = () =>
  batchJobService.failAbandonedJobs().catch((err) => {
    logger.error("Abandoned batch-job sweep failed", { error: err.message });
    return 0;
  });

/**
 * Handle one batch-job message delivered on `ch`. Never throws.
 * @param {object} msg
 * @param {object} ch - the channel the message arrived on
 */
const handleMessage = async (msg, ch) => {
  let payload;
  try {
    payload = JSON.parse(msg.content.toString());
  } catch {
    logger.error("Invalid batch job message; dropping");
    rabbitmq.nack(ch, msg);
    return;
  }

  running.add(payload.jobId);
  try {
    const outcome = await batchJobService.runJob(payload.jobId, payload.tenantId);
    if (outcome && !outcome.ran) {
      logger.info("Batch job message settled without running", {
        jobId: payload.jobId,
        reason: outcome.reason,
      });
    }
    rabbitmq.ack(ch, msg);
  } catch (err) {
    logger.error("Batch worker job failed", {
      jobId: payload.jobId,
      error: err.message,
    });
    rabbitmq.nack(ch, msg); // route to DLQ
  } finally {
    running.delete(payload.jobId);
  }
};

const startBatchJobWorker = async () => {
  // The sweep runs in inline mode too: an inline job dies with its process.
  if (!sweepTimer) {
    await sweep();
    sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
    sweepTimer.unref();
  }

  if (process.env.BATCH_JOBS_INLINE === "true") {
    logger.info("Batch jobs in inline mode; RabbitMQ worker not started");
    return false;
  }

  const prefetch = parseInt(process.env.BATCH_PREFETCH, 10) || 5;
  const registered = await rabbitmq.startConsumer(batchJobService.BATCH_QUEUE, handleMessage, {
    prefetch,
    setup: (ch) => rabbitmq.assertQueue(batchJobService.BATCH_QUEUE, batchJobService.BATCH_DLQ, ch),
  });
  logger.info(
    registered
      ? "Batch job worker started (RabbitMQ)"
      : "Batch job worker not registered yet; retrying in the background",
  );
  return registered;
};

/**
 * Shutdown (W-07): stop consuming, wait for the jobs in flight, and fail the
 * ones still running when the wait ends — rather than leave them PROCESSING
 * with their messages to be redelivered into a row that already started.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{drained: boolean, failed: number}>}
 */
const stopBatchJobWorker = async (options = {}) => {
  clearInterval(sweepTimer);
  sweepTimer = null;
  const { drained } = await rabbitmq.stopConsumers(options);
  const abandoned = [...running];
  let failed = 0;
  if (abandoned.length > 0) {
    try {
      failed = await batchJobService.failInterruptedJobs(abandoned);
    } catch (err) {
      logger.error("Could not mark interrupted batch jobs FAILED; the sweep will", { error: err.message });
    }
  }
  return { drained, failed };
};

module.exports = { startBatchJobWorker, stopBatchJobWorker, handleMessage };
