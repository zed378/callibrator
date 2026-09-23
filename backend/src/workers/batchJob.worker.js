// src/workers/batchJob.worker.js
//
// RabbitMQ consumer that drives batch jobs. Replaces the old in-process
// setInterval simulation: work is pulled from the durable `batch_jobs` queue,
// executed via batchJob.service.runJob (which persists state), and acked on
// success / dead-lettered on failure. Restart-safe and horizontally scalable.

const rabbitmq = require("../services/rabbitmq.service");
const batchJobService = require("../services/batchJob.service");
const { logger } = require("../middlewares/activityLog.middleware");

const startBatchJobWorker = async () => {
  if (process.env.BATCH_JOBS_INLINE === "true") {
    logger.info("Batch jobs in inline mode; RabbitMQ worker not started");
    return;
  }

  try {
    await rabbitmq.assertQueue(
      batchJobService.BATCH_QUEUE,
      batchJobService.BATCH_DLQ,
    );

    const prefetch = parseInt(process.env.BATCH_PREFETCH, 10) || 5;

    await rabbitmq.consume(
      batchJobService.BATCH_QUEUE,
      async (msg) => {
        if (!msg) {
          return;
        }

        let payload;
        try {
          payload = JSON.parse(msg.content.toString());
        } catch {
          logger.error("Invalid batch job message; dropping");
          return channelNack(msg);
        }

        // DEDUPLICATION (A-26). `payload.jobId` is the BatchJob row's UUID,
        // written once when the job was created and carried in the persisted
        // message body, so a redelivery presents the same value. Running a
        // batch job twice re-does its side effects, which is the defect.
        let claim = null;
        if (payload.jobId) {
          claim = await rabbitmq.claimMessage(`batch:${payload.jobId}`);
          if (!claim.claimed) {
            logger.info("Duplicate batch job message ignored", {
              jobId: payload.jobId,
            });
            return ackMsg(msg); // done already — ack, do not redeliver
          }
        } else {
          logger.warn("Batch job message has no jobId; not deduplicated");
        }

        try {
          await batchJobService.runJob(payload.jobId);
          ackMsg(msg);
        } catch (err) {
          logger.error("Batch worker job failed", {
            jobId: payload.jobId,
            error: err.message,
          });
          // Give the claim back so a DLQ replay of this job can run.
          if (claim) {
            await claim.release();
          }
          channelNack(msg); // route to DLQ
        }
      },
      prefetch,
    );

    logger.info("Batch job worker started (RabbitMQ)");
  } catch (err) {
    logger.warn("Failed to start batch job worker", { error: err.message });
  }
};

// ack/nack via the shared channel; kept tiny so the consumer body reads clean.
async function ackMsg(msg) {
  const ch = await rabbitmq.getChannel();
  ch.ack(msg);
}
async function channelNack(msg) {
  const ch = await rabbitmq.getChannel();
  ch.nack(msg, false, false);
}

module.exports = { startBatchJobWorker };
