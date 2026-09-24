// src/services/emailQueue.service.js
//
// The email queue: a producer (addEmailJob) and a supervised consumer
// (processEmailQueue), both on the process's ONE AMQP connection in
// rabbitmq.service (W-18). This module used to keep a private connection and
// channel of its own — two connections per process, and shutdown closed one.
//
// RETRIES LIVE IN THE BROKER (W-09). A failed send used to be re-published
// from an in-process setTimeout AND nacked to the dead-letter queue, so:
//  - the DLQ received a copy of EVERY failed attempt, not the exhausted job;
//  - a restart inside the backoff window lost the retry (the original was
//    already dead-lettered, and nothing replays the DLQ);
//  - the timer captured the channel, and a send on a channel that closed in
//    the meantime threw INSIDE the timer — an uncaughtException, which calls
//    shutdown(). One failed email during a broker blip stopped the server.
// Now a failed attempt with retries left is published to a delay queue —
// `email_retry_<ms>`, whose `x-message-ttl` dead-letters it back onto
// email_queue when the delay has passed — and the original is ACKED. Only the
// last failure is nacked, so the DLQ holds exactly one message per exhausted
// job, and a restart loses nothing: the delay lives in a durable queue.
const rabbitmq = require("./rabbitmq.service");
const {
  sendOtpEmail,
  sendActivationEmail,
  sendNotificationEmail,
} = require("./email.service");
const { logger } = require("../middlewares/activityLog.middleware");

const { claimMessage } = rabbitmq;

// ==========================================
// QUEUE DECLARATION
// ==========================================

const EMAIL_QUEUE = "email_queue";
const EMAIL_DLQ = "email_dlq";

const RABBITMQ_PREFETCH_COUNT = parseInt(process.env.RABBITMQ_PREFETCH_COUNT) || 10;
/** Retry n waits EMAIL_RETRY_BASE_MS * 2^n: 2 s, 4 s, 8 s by default. */
const EMAIL_RETRY_BASE_MS = parseInt(process.env.EMAIL_RETRY_BASE_MS, 10) || 1000;
/** Retry tiers declared; a job asking for more retries reuses the last tier. */
const RETRY_TIERS = 3;

/** The delay before retry `n` (1-based), in ms. */
const retryDelayMs = (n) => EMAIL_RETRY_BASE_MS * 2 ** Math.min(Math.max(n, 1), RETRY_TIERS);

/** The delay queue a retry waits in. */
const retryQueueOf = (n) => `email_retry_${retryDelayMs(n)}`;

/**
 * Declare the email queue, its DLQ and its retry (delay) queues on `ch`.
 * Idempotent, and re-run on every consumer (re-)registration, so a broker
 * that lost its non-mirrored state gets them back.
 * @param {object} ch
 */
const declareEmailQueues = async (ch) => {
  await rabbitmq.assertQueue(EMAIL_QUEUE, EMAIL_DLQ, ch);
  for (let n = 1; n <= RETRY_TIERS; n += 1) {
    await ch.assertQueue(retryQueueOf(n), {
      durable: true,
      arguments: {
        "x-message-ttl": retryDelayMs(n),
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": EMAIL_QUEUE,
      },
    });
  }
};

// Channels the queues have been declared on, so a publish declares them once
// per channel rather than once per email.
const declaredOn = new WeakSet();

const publishingChannel = async () => {
  const ch = await rabbitmq.getChannel();
  if (!declaredOn.has(ch)) {
    await declareEmailQueues(ch);
    declaredOn.add(ch);
  }
  return ch;
};

// ==========================================
// EMAIL JOB QUEUE
// ==========================================

/**
 * A-186 — what of a recipient may be logged: the address's DOMAIN, never the
 * mailbox. The log is shipped off-box and kept for 30 days (activityLog
 * middleware); a patient-facing hospital's staff addresses are personal data
 * (GDPR Art. 5(1)(c)), and the job id already correlates a line with its
 * message. The domain still shows a provider-specific delivery failure.
 *
 * @param {*} email
 * @returns {string|null} the lower-cased domain, or null when there is none
 */
const recipientDomain = (email) => {
  const at = typeof email === "string" ? email.lastIndexOf("@") : -1;
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
};

/**
 * Add email job to RabbitMQ queue
 * @param {Object} job - Email job data
 * @returns {Promise<boolean>}
 */
const addEmailJob = async (job) => {
  try {
    const ch = await publishingChannel();

    const jobData = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: job.type,
      data: job.data,
      createdAt: new Date().toISOString(),
      retries: 0,
      // A-32: every caller of addEmailJob (queueActivationEmail / queueOtpEmail
      // / queueNotificationEmail) passes maxRetries: 3; the unreachable `|| 3`
      // fallback is gone.
      maxRetries: job.maxRetries,
    };

    ch.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify(jobData)), {
      persistent: true,
      // Same value the consumer deduplicates on (jobData.id). Carried in the
      // AMQP properties so it is visible in the management UI and the DLQ.
      messageId: jobData.id,
    });

    logger.info("Email job added to queue", {
      jobId: jobData.id,
      type: job.type,
      recipientDomain: recipientDomain(job.data.email),
    });

    return true;
  } catch (error) {
    // A-186: never the job itself — its data is the address, and the OTP or
    // the activation link (whose token the redaction format does not catch
    // under the key `activationLink`).
    logger.error("Failed to add email job to queue", {
      error: error.message,
      type: job.type,
      recipientDomain: recipientDomain(job.data.email),
    });
    // Fallback: send synchronously.
    // A-158 — the fallback's own outcome is returned. This returned `true`
    // even when the direct send failed, so a caller that checks the result
    // (e-signature requests) was told a mail that went nowhere was sent.
    logger.warn("RabbitMQ unavailable, sending email synchronously");
    return sendEmailDirectly(job);
  }
};

/**
 * Send email directly (fallback or actual sending)
 * @param {Object} job
 */
const sendEmailDirectly = async (job) => {
  try {
    switch (job.type) {
      case "activation":
        await sendActivationEmail(job.data);
        break;
      case "otp":
        await sendOtpEmail(job.data);
        break;
      case "notification":
        await sendNotificationEmail(job.data);
        break;
      // istanbul ignore next -- unreachable: sendEmailDirectly is only called
      // from the addEmailJob fallback, and addEmailJob's three callers always
      // pass one of the literal types above, so `default` never runs.
      default:
        logger.warn("Unknown email job type", { type: job.type });
        return false;
    }

    logger.info("Email sent successfully", {
      type: job.type,
      recipientDomain: recipientDomain(job.data.email),
    });

    return true;
  } catch (error) {
    logger.error("Failed to send email", {
      error: error.message,
      type: job.type,
      recipientDomain: recipientDomain(job.data.email),
    });
    return false;
  }
};

/**
 * Handle one email job delivered on `ch`. Never throws: every failure is a
 * settlement on `ch` (or none, when `ch` has closed and the broker will
 * redeliver) plus a log line.
 *
 * @param {object} msg
 * @param {object} ch - the channel the message arrived on; the only one that may settle it
 */
const processJob = async (msg, ch) => {
  let job;
  try {
    job = JSON.parse(msg.content.toString());
  } catch {
    logger.error("Invalid email job data");
    rabbitmq.nack(ch, msg); // Drop invalid message (to the DLQ)
    return;
  }

  // DEDUPLICATION (A-26). `job.id` is minted once in addEmailJob and lives in
  // the persisted message body, so every redelivery of this message — an
  // unacked message returned after a channel or connection loss, a retry
  // coming back from its delay queue — carries the same value. The AMQP
  // delivery tag does NOT: it is per-channel and changes on redelivery.
  let claim = null;
  if (job.id) {
    claim = await claimMessage(`email:${job.id}`);
    if (!claim.claimed) {
      // Already sent. ACK it: nacking would redeliver or dead-letter a
      // message whose work is done.
      logger.info("Duplicate email job ignored", {
        jobId: job.id,
        type: job.type,
      });
      rabbitmq.ack(ch, msg);
      return;
    }
  } else {
    logger.warn("Email job has no id; processing without deduplication");
  }

  try {
    let success = false;

    switch (job.type) {
      case "activation":
        success = await sendActivationEmail(job.data);
        break;
      case "otp":
        success = await sendOtpEmail(job.data);
        break;
      case "notification":
        success = await sendNotificationEmail(job.data);
        break;
      default:
        logger.warn("Unknown email job type", { type: job.type });
    }

    if (!success) {
      throw new Error("Email sending returned false");
    }
    rabbitmq.ack(ch, msg);
    logger.info("Email sent successfully", {
      jobId: job.id,
      type: job.type,
      recipientDomain: recipientDomain(job.data && job.data.email),
    });
  } catch (error) {
    logger.error("Error processing email job", {
      error: error.message,
      jobId: job.id,
      retries: job.retries,
    });

    // The retry carries the SAME job.id, so the claim has to go back or the
    // retry would be read as a duplicate and dropped.
    if (claim) {
      await claim.release();
    }

    const retries = Number(job.retries) || 0;
    const maxRetries = Number(job.maxRetries) || 3;
    if (retries >= maxRetries) {
      // Exhausted: dead-letter it — the ONE DLQ message for this job.
      logger.warn(`Email job exhausted its ${maxRetries} retries; dead-lettered`, { jobId: job.id });
      rabbitmq.nack(ch, msg);
      return;
    }

    const retry = { ...job, retries: retries + 1 };
    try {
      // On the channel the message came on, BEFORE acking it: if this send
      // fails the original is left unacked and the broker redelivers it.
      ch.sendToQueue(retryQueueOf(retry.retries), Buffer.from(JSON.stringify(retry)), {
        persistent: true,
        messageId: job.id,
      });
    } catch (sendError) {
      logger.warn("Email retry not scheduled (channel closed); the broker redelivers the job", {
        jobId: job.id,
        error: sendError.message,
      });
      return;
    }
    logger.info(
      `Retrying email job ${retry.retries}/${maxRetries} after ${retryDelayMs(retry.retries)}ms`,
      { jobId: job.id },
    );
    rabbitmq.ack(ch, msg);
  }
};

/**
 * Start the email queue consumer — supervised (W-06): a broker that is down
 * at boot, restarts, or drops the connection is retried with backoff and the
 * consumer re-registered, instead of the worker silently never (re)starting.
 *
 * @returns {Promise<boolean>} whether the first registration attempt succeeded;
 *   never rejects (a failure is retried in the background)
 */
const processEmailQueue = async () => {
  const registered = await rabbitmq.startConsumer(EMAIL_QUEUE, processJob, {
    prefetch: RABBITMQ_PREFETCH_COUNT,
    setup: declareEmailQueues,
  });
  logger.info(
    registered
      ? "Email queue worker started (RabbitMQ)"
      : "Email queue worker not registered yet; retrying in the background",
  );
  return registered;
};

/**
 * Get queue stats
 * @returns {Promise<Object>}
 */
const getQueueStats = async () => {
  try {
    const ch = await rabbitmq.getChannel();

    const emailQueue = await ch.checkQueue(EMAIL_QUEUE);
    const dlq = await ch.checkQueue(EMAIL_DLQ);

    return {
      emailQueueMessages: emailQueue.messageCount,
      dlqMessages: dlq.messageCount,
      status: "connected",
      processedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error("Failed to get queue stats", { error: error.message });
    return { emailQueueMessages: 0, dlqMessages: 0, status: "error" };
  }
};

/**
 * Clear email queue
 * @returns {Promise<boolean>}
 */
const clearQueue = async () => {
  try {
    const ch = await rabbitmq.getChannel();
    await ch.purgeQueue(EMAIL_QUEUE);
    logger.info("Email queue cleared");
    return true;
  } catch (error) {
    logger.error("Failed to clear queue", { error: error.message });
    return false;
  }
};

// ==========================================
// EXPORTED FUNCTIONS
// ==========================================

/**
 * Queue activation email (async)
 * @param {Object} params
 * @returns {Promise<boolean>}
 */
const queueActivationEmail = async ({
  email,
  firstName,
  lastName,
  activationLink,
}) => {
  return addEmailJob({
    type: "activation",
    data: { email, firstName, lastName, activationLink },
    maxRetries: 3,
  });
};

/**
 * Queue OTP email (async)
 * @param {Object} params
 * @returns {Promise<boolean>}
 */
const queueOtpEmail = async ({ email, firstName, lastName, otp }) => {
  return addEmailJob({
    type: "otp",
    data: { email, firstName, lastName, otp },
    maxRetries: 3,
  });
};

/**
 * Queue a generic notification email (async)
 * @param {Object} params
 * @returns {Promise<boolean>}
 */
const queueNotificationEmail = async ({
  email,
  firstName,
  title,
  message,
  actionUrl,
}) => {
  return addEmailJob({
    type: "notification",
    data: { email, firstName, title, message, actionUrl },
    maxRetries: 3,
  });
};

/**
 * Close the process's AMQP connection. Kept for callers that imported it from
 * here; there is ONE connection and ONE close, in rabbitmq.service (W-18).
 */
const closeRabbitMQ = () => rabbitmq.closeRabbitMQ();

module.exports = {
  processEmailQueue,
  queueActivationEmail,
  queueOtpEmail,
  queueNotificationEmail,
  getQueueStats,
  clearQueue,
  closeRabbitMQ,
  // For tests and the retry-queue documentation.
  processJob,
  retryQueueOf,
  retryDelayMs,
  EMAIL_QUEUE,
  EMAIL_DLQ,
};
