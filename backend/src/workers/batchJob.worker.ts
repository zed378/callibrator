// src/workers/batchJob.worker.ts
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
//
// P9-21 (ADR-087): converted from batchJob.worker.js, behaviour unchanged.
// `rabbitmq` and `batchJobService` stay module objects, read at call time;
// `logger` is captured at load. The environment is read through config/env,
// at the same moments as before: the sweep interval at load, the inline switch
// and the prefetch per start.
import type { Channel, ConsumeMessage } from "amqplib";
import rabbitmq from "../services/rabbitmq.service";
import batchJobService from "../services/batchJob.service";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { env } from "../config/env";

const logger = loadedLogger;

/** How often the abandoned-job sweep runs (every replica; it is idempotent). */
const SWEEP_INTERVAL_MS =
  // As built: NaN and 0 fall back to five minutes.
  parseInt(env("BATCH_JOB_SWEEP_INTERVAL_MS") as string, 10) || 5 * 60 * 1000;

/** The job ids this process is running right now. */
const running = new Set<unknown>();
let sweepTimer: NodeJS.Timeout | null = null;

const sweep = (): Promise<number> =>
  batchJobService.failAbandonedJobs().catch((err: unknown) => {
    logger.error("Abandoned batch-job sweep failed", { error: (err as { message?: unknown }).message });
    return 0;
  });

/** A message body as the worker reads it (`jobId`, `tenantId`; anything parsed). */
interface JobMessage {
  jobId?: unknown;
  tenantId?: unknown;
}

/**
 * Handle one batch-job message delivered on `ch`. Never throws.
 *
 * @param msg - the delivered message
 * @param ch - the channel the message arrived on
 */
const handleMessage = async (msg: ConsumeMessage, ch: Channel): Promise<void> => {
  let payload: unknown;
  try {
    payload = JSON.parse(msg.content.toString());
  } catch {
    payload = null;
  }
  // A body that parses to a non-object ("null", a number) is as invalid as
  // one that does not parse: reading `.jobId` off it would throw, and the
  // message would sit unsettled, holding a prefetch slot, until the channel
  // closed.
  if (!payload || typeof payload !== "object") {
    logger.error("Invalid batch job message; dropping");
    rabbitmq.nack(ch, msg);
    return;
  }
  const job = payload as JobMessage;

  running.add(job.jobId);
  try {
    const outcome = await batchJobService.runJob(job.jobId as string, job.tenantId as string | null | undefined);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a double may answer nothing
    if (outcome && !outcome.ran) {
      logger.info("Batch job message settled without running", {
        jobId: job.jobId,
        reason: outcome.reason,
      });
    }
    rabbitmq.ack(ch, msg);
  } catch (err) {
    logger.error("Batch worker job failed", {
      jobId: job.jobId,
      error: (err as { message?: unknown }).message,
    });
    rabbitmq.nack(ch, msg); // route to DLQ
  } finally {
    running.delete(job.jobId);
  }
};

/** The `setup` callback startConsumer takes. */
type ConsumerSetup = (ch: Channel) => Promise<void>;

const startBatchJobWorker = async (): Promise<boolean> => {
  // The sweep runs in inline mode too: an inline job dies with its process.
  if (!sweepTimer) {
    await sweep();
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- as built: the sweep never rejects (it catches), so the interval ignores a settled promise
    sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
    sweepTimer.unref();
  }

  if (env("BATCH_JOBS_INLINE") === "true") {
    logger.info("Batch jobs in inline mode; RabbitMQ worker not started");
    return false;
  }

  // As built: NaN and 0 fall back to 5.
  const prefetch = parseInt(env("BATCH_PREFETCH") as string, 10) || 5;
  const registered = await rabbitmq.startConsumer(batchJobService.BATCH_QUEUE, handleMessage, {
    prefetch,
    // As built: the setup returns assertQueue's promise (of the channel); the supervisor awaits it.
    setup: ((ch: Channel) => rabbitmq.assertQueue(batchJobService.BATCH_QUEUE, batchJobService.BATCH_DLQ, ch)) as unknown as ConsumerSetup,
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
 * @param options - `timeoutMs`: how long to wait for the jobs in flight
 * @returns whether the consumers drained, and how many jobs were failed
 */
const stopBatchJobWorker = async (options: { timeoutMs?: number } = {}): Promise<{ drained: boolean; failed: number }> => {
  // As built: clearInterval(null) is a no-op.
  clearInterval(sweepTimer as NodeJS.Timeout);
  sweepTimer = null;
  const { drained } = await rabbitmq.stopConsumers(options);
  const abandoned = [...running];
  let failed = 0;
  if (abandoned.length > 0) {
    try {
      failed = await batchJobService.failInterruptedJobs(abandoned as string[]);
    } catch (err) {
      logger.error("Could not mark interrupted batch jobs FAILED; the sweep will", { error: (err as { message?: unknown }).message });
    }
  }
  return { drained, failed };
};

export = { startBatchJobWorker, stopBatchJobWorker, handleMessage };
