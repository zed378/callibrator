// src/services/rabbitmq.service.js
//
// Shared RabbitMQ connection/channel helper. The email queue historically kept
// its own private connection; this is the reusable version so other producers
// and workers (e.g. batch jobs) share one connection instead of opening their
// own. Connize lazily, guard with a connect timeout, and reset the cached
// handles when the connection drops so the next call reconnects.

const amqplib = require("amqplib");
const { logger } = require("../middlewares/activityLog.middleware");

let connection = null;
let channel = null;

const CONNECT_TIMEOUT =
  parseInt(process.env.RABBITMQ_CONNECT_TIMEOUT, 10) || 10000;

const rabbitUrl = () =>
  process.env.RABBITMQ_URL ||
  `amqp://${process.env.RABBITMQ_HOST || "localhost"}:${
    process.env.RABBITMQ_PORT || 5672
  }`;

const getConnection = async () => {
  if (connection && connection.isOpen) {
    return connection;
  }

  const connectPromise = amqplib.connect(rabbitUrl());
  const timeoutPromise = new Promise((_, reject) => {
    const t = setTimeout(
      () =>
        reject(
          new Error(`RabbitMQ connection timed out after ${CONNECT_TIMEOUT}ms`),
        ),
      CONNECT_TIMEOUT,
    );
    t.unref();
  });

  connection = await Promise.race([connectPromise, timeoutPromise]);

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

const getChannel = async () => {
  if (channel && channel.isOpen) {
    return channel;
  }
  const conn = await getConnection();
  channel = await conn.createChannel();
  return channel;
};

/**
 * Declare a durable work queue, optionally with a dead-letter queue that failed
 * messages are routed to.
 */
const assertQueue = async (queue, dlq) => {
  const ch = await getChannel();
  if (dlq) {
    await ch.assertQueue(dlq, { durable: true });
    await ch.assertQueue(queue, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": dlq,
      },
    });
  } else {
    await ch.assertQueue(queue, { durable: true });
  }
  return ch;
};

/** Publish a JSON message to a queue (persistent). */
const publish = async (queue, message) => {
  const ch = await getChannel();
  return ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
    persistent: true,
  });
};

/** Register a consumer on a queue. */
const consume = async (queue, handler, prefetch) => {
  const ch = await getChannel();
  if (prefetch) {
    ch.prefetch(prefetch);
  }
  await ch.consume(queue, handler);
  return ch;
};

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
  } finally {
    channel = null;
    connection = null;
  }
};

module.exports = {
  getConnection,
  getChannel,
  assertQueue,
  publish,
  consume,
  closeRabbitMQ,
};
