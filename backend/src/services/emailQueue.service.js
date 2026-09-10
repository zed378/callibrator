// src/services/emailQueue.service.js
const amqplib = require("amqplib");
const {
  sendOtpEmail,
  sendActivationEmail,
  sendNotificationEmail,
} = require("./email.service");
const { logger } = require("../middlewares/activityLog.middleware");

// ==========================================
// RABBITMQ CONNECTION
// ==========================================

let connection = null;
let channel = null;

const getRabbitMQConnection = async () => {
  if (connection && connection.isOpen) {
    return connection;
  }

  const rabbitUrl =
    process.env.RABBITMQ_URL ||
    `amqp://${process.env.RABBITMQ_HOST || "localhost"}:${process.env.RABBITMQ_PORT || 5672}`;

  const connectPromise = amqplib.connect(rabbitUrl);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(`RabbitMQ connection timed out after ${RABBITMQ_CONNECT_TIMEOUT}ms`)),
      RABBITMQ_CONNECT_TIMEOUT,
    );
  });

  connection = await Promise.race([connectPromise, timeoutPromise]).catch((err) => {
    logger.error("RabbitMQ connection failed", { error: err.message });
    throw err;
  });

  connection.on("error", (err) => {
    logger.error("RabbitMQ connection error", { error: err.message });
  });

  connection.on("close", () => {
    logger.warn("RabbitMQ connection closed");
    connection = null;
    channel = null;
  });

  return connection;
};

const createChannel = async () => {
  if (channel && channel.isOpen) {
    return channel;
  }

  const conn = await getRabbitMQConnection();
  channel = await conn.createChannel();

  return channel;
};

// ==========================================
// QUEUE INITIALIZATION
// ==========================================

const EMAIL_QUEUE = "email_queue";
const EMAIL_DLQ = "email_dlq";

// Connection and consumer timeouts (in milliseconds)
const RABBITMQ_CONNECT_TIMEOUT = parseInt(process.env.RABBITMQ_CONNECT_TIMEOUT) || 10000;
const RABBITMQ_CONSUMER_TIMEOUT = parseInt(process.env.RABBITMQ_CONSUMER_TIMEOUT) || 30000;
const RABBITMQ_PREFETCH_COUNT = parseInt(process.env.RABBITMQ_PREFETCH_COUNT) || 10;

const initEmailQueue = async () => {
  try {
    const ch = await createChannel();

    // Declare dead letter queue first
    await ch.assertQueue(EMAIL_DLQ, { durable: true });

    // Declare email queue with dead letter exchange
    await ch.assertQueue(EMAIL_QUEUE, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": EMAIL_DLQ,
      },
    });

    logger.info("Email queue initialized");
    return true;
  } catch (error) {
    logger.error("Failed to initialize email queue", { error: error.message });
    return false;
  }
};

// ==========================================
// EMAIL JOB QUEUE
// ==========================================

/**
 * Add email job to RabbitMQ queue
 * @param {Object} job - Email job data
 * @returns {Promise<boolean>}
 */
const addEmailJob = async (job) => {
  try {
    const ch = await createChannel();

    const jobData = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: job.type,
      data: job.data,
      createdAt: new Date().toISOString(),
      retries: 0,
      // unreachable fallback: every caller of addEmailJob (queueActivationEmail
      // / queueOtpEmail / queueNotificationEmail) passes a hard-coded
      // maxRetries: 3, so the `|| 3` alternative never evaluates.
      maxRetries: /* istanbul ignore next */ job.maxRetries || 3,
    };

    ch.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify(jobData)), {
      persistent: true,
    });

    logger.info("Email job added to queue", {
      jobId: jobData.id,
      type: job.type,
      to: job.data.email,
    });

    return true;
  } catch (error) {
    logger.error("Failed to add email job to queue", {
      error: error.message,
      job,
    });
    // Fallback: send synchronously
    logger.warn("RabbitMQ unavailable, sending email synchronously");
    await sendEmailDirectly(job);
    return true;
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
      to: job.data.email,
    });

    return true;
  } catch (error) {
    logger.error("Failed to send email", {
      error: error.message,
      type: job.type,
      to: job.data.email,
    });
    return false;
  }
};

/**
 * Process email queue jobs
 * Runs in background worker
 * @returns {Promise<void>}
 */
const processEmailQueue = async () => {
  try {
    const initialized = await initEmailQueue();
    if (!initialized) {
      throw new Error("Initialization failed");
    }
  } catch (error) {
    logger.warn(
      "Failed to initialize RabbitMQ, email queue worker not started",
      {
        error: error.message,
      },
    );
    return;
  }

  logger.info("Email queue worker started (RabbitMQ)");

  const ch = await createChannel();

  // Ack mode - manual acknowledgment with configurable prefetch
  ch.prefetch(RABBITMQ_PREFETCH_COUNT);

  // Consumer timeout to prevent hung workers
  const consumerTimeout = setTimeout(() => {
    logger.warn("Email queue consumer timeout reached");
  }, RABBITMQ_CONSUMER_TIMEOUT);
  consumerTimeout.unref(); // Don't prevent process exit

  const processJob = async (msg) => {
    if (!msg) {return;}

    let job;
    try {
      job = JSON.parse(msg.content.toString());
    } catch {
      logger.error("Invalid email job data");
      ch.nack(msg, false, false); // Drop invalid message
      return;
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

      if (success) {
        ch.ack(msg);
        logger.info("Email sent successfully", {
          type: job.type,
          to: job.data.email,
        });
      } else {
        throw new Error("Email sending returned false");
      }
    } catch (error) {
      logger.error("Error processing email job", {
        error: error.message,
        jobId: job.id,
        retries: job.retries,
      });

      // Check if we should retry
      if (job.retries < (job.maxRetries || 3)) {
        job.retries += 1;
        const delay = Math.pow(2, job.retries) * 1000; // Exponential backoff

        logger.info(
          `Retrying email job ${job.retries}/${job.maxRetries} after ${delay}ms`,
          { jobId: job.id },
        );

        // Re-send with delay
        setTimeout(() => {
          ch.sendToQueue(EMAIL_QUEUE, Buffer.from(JSON.stringify(job)), {
            persistent: true,
          });
        }, delay);
      }

      // Nack without requeue (will go to DLQ after max retries)
      ch.nack(msg, false, false);
    }
  };

  // Start consuming
  ch.consume(EMAIL_QUEUE, processJob);

  logger.info("Email queue consumer started");
};

/**
 * Get queue stats
 * @returns {Promise<Object>}
 */
const getQueueStats = async () => {
  try {
    const ch = await createChannel();

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
    const ch = await createChannel();
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
 * Close RabbitMQ connection
 * @returns {Promise<void>}
 */
const closeRabbitMQ = async () => {
  try {
    if (channel) {
      await channel.close();
    }
    if (connection) {
      await connection.close();
    }
    logger.info("RabbitMQ connection closed");
  } catch (error) {
    logger.error("Error closing RabbitMQ connection", { error: error.message });
  }
};

module.exports = {
  processEmailQueue,
  queueActivationEmail,
  queueOtpEmail,
  queueNotificationEmail,
  getQueueStats,
  clearQueue,
  closeRabbitMQ,
};
