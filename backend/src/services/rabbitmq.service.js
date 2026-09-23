// src/services/rabbitmq.service.js
//
// Shared RabbitMQ connection/channel helper. The email queue historically kept
// its own private connection; this is the reusable version so other producers
// and workers (e.g. batch jobs) share one connection instead of opening their
// own. Connize lazily, guard with a connect timeout, and reset the cached
// handles when the connection drops so the next call reconnects.

const amqplib = require("amqplib");
const redis = require("./redis.service");
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

/**
 * Drop the cached connection if it is still the one that just died.
 *
 * Liveness is tracked through amqplib's own "close"/"error" events, NOT
 * through an `isOpen` property. amqplib (2.0.1 here) has no such property on
 * either the connection or the channel — `grep -rn isOpen node_modules/amqplib`
 * returns nothing — so the old guard `connection && connection.isOpen` was
 * always false and the cache NEVER hit: every getConnection()/getChannel()
 * opened a fresh AMQP connection or channel and nothing closed them. The suite
 * stayed green because the test mock invented `isOpen`. Same failure shape as
 * the ioredis `.connected` bug (A-24): a mock proves the client, not the
 * driver.
 *
 * The identity check matters because a late event from a connection we have
 * already replaced must not evict its replacement.
 */
const forgetConnection = (conn) => {
  if (connection === conn) {
    connection = null;
    channel = null;
  }
};

const forgetChannel = (ch) => {
  if (channel === ch) {
    channel = null;
  }
};

const getConnection = async () => {
  if (connection) {
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

  const conn = await Promise.race([connectPromise, timeoutPromise]);

  conn.on("error", (err) => {
    logger.error("RabbitMQ connection error", { error: err.message });
    forgetConnection(conn);
  });
  conn.on("close", () => {
    logger.warn("RabbitMQ connection closed");
    forgetConnection(conn);
  });

  connection = conn;
  return connection;
};

const getChannel = async () => {
  if (channel) {
    return channel;
  }
  const conn = await getConnection();
  const ch = await conn.createChannel();

  ch.on("error", (err) => {
    logger.error("RabbitMQ channel error", { error: err.message });
    forgetChannel(ch);
  });
  ch.on("close", () => {
    forgetChannel(ch);
  });

  channel = ch;
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

// ------------------------------------------------------------------
// MESSAGE DEDUPLICATION (A-26)
// ------------------------------------------------------------------
//
// RabbitMQ delivery is AT LEAST ONCE. A message whose ack never reached the
// broker — channel closed, worker killed, connection dropped — is delivered
// again, and until now every consumer simply did the work a second time: the
// same activation or OTP email went out twice.
//
// The claim is a Redis `SET NX EX` on a caller-supplied identity. Redis is
// already a hard dependency of the process that runs these consumers
// (`index.js` awaits `initRedis()` before starting the email worker and the
// batch worker), so this adds no new infrastructure.
//
// This does NOT use `redis.service#acquireLock`: that helper returns `null`
// both when the lock is held and when Redis is unreachable, and those two
// cases must behave in opposite ways here — see below.
//
// THIS IS NOT EXACTLY-ONCE, and must not be described as such:
//
//  - Redis unreachable => NO deduplication. The message is processed. A
//    duplicate email is recoverable; a silently dropped one is not.
//  - The claim is taken BEFORE the side effect. If the worker dies between
//    claiming and sending, the redelivery is skipped and that email is never
//    sent (until the claim's TTL expires, by which time the message is gone).
//  - If the send reaches the SMTP server and then throws, the claim is
//    released and the retry sends a second copy.
//
// What it removes is the common case: the broker redelivering a message whose
// work already completed.

/** How long a claim survives. One day: far longer than any redelivery. */
const DEDUP_TTL_SECONDS =
  parseInt(process.env.QUEUE_DEDUP_TTL_SECONDS, 10) || 86400;

const dedupKey = (identity) => `dedup:msg:${identity}`;

/** Returned when there is no claim to give back. */
const noRelease = async () => false;

/**
 * Claim a message identity before acting on it.
 *
 * @param {string} identity stable across a redelivery — see each consumer.
 * @param {number} [ttlSeconds]
 * @returns {Promise<{claimed: boolean, deduplicated: boolean,
 *                    release: () => Promise<boolean>}>}
 *   `claimed: false` means this identity was already processed: ACK the
 *   message and do nothing. `claimed: true` means proceed, and call
 *   `release()` if the side effect failed so a retry is not mistaken for a
 *   duplicate. `deduplicated: false` with `claimed: true` says the claim was
 *   not actually enforced (no store available).
 */
const claimMessage = async (identity, ttlSeconds = DEDUP_TTL_SECONDS) => {
  const key = dedupKey(identity);
  try {
    const client = redis.getRedisConnection();
    // ioredis readiness is `status === "ready"`; it has no `.connected`.
    if (!client || client.status !== "ready") {
      logger.warn("Dedup store unavailable; processing without deduplication", {
        key,
      });
      return { claimed: true, deduplicated: false, release: noRelease };
    }

    const result = await client.set(key, "1", "EX", ttlSeconds, "NX");
    if (result !== "OK") {
      return { claimed: false, deduplicated: true, release: noRelease };
    }

    return {
      claimed: true,
      deduplicated: true,
      release: () => redis.del(key),
    };
  } catch (error) {
    logger.error("Dedup claim failed; processing without deduplication", {
      key,
      error: error.message,
    });
    return { claimed: true, deduplicated: false, release: noRelease };
  }
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
  claimMessage,
  DEDUP_TTL_SECONDS,
  closeRabbitMQ,
};
