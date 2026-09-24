// src/services/rabbitmq.service.js
//
// The process's ONE RabbitMQ connection (W-18), its publishing channel, and
// supervised consumers (W-06).
//
// Every producer and consumer goes through this module: the email queue, the
// batch-job worker and every publisher. The email queue used to keep a second,
// private connection of its own — two AMQP connections per process, and
// shutdown closed only one of them (W-18).

const amqplib = require("amqplib");
const redis = require("./redis.service");
const { logger } = require("../middlewares/activityLog.middleware");

let connection = null;
let channel = null;
// W-18 — the in-flight connect / channel open. Two concurrent first callers
// share it instead of both dialling and orphaning one of the two results.
let connecting = null;
let channelOpening = null;

const CONNECT_TIMEOUT =
  parseInt(process.env.RABBITMQ_CONNECT_TIMEOUT, 10) || 10000;
/** Consumer re-registration backoff: 1 s, 2 s, 4 s … capped here (W-06). */
const RECONNECT_BASE_MS =
  parseInt(process.env.RABBITMQ_RECONNECT_BASE_MS, 10) || 1000;
const RECONNECT_MAX_MS =
  parseInt(process.env.RABBITMQ_RECONNECT_MAX_MS, 10) || 30000;
/** How long shutdown waits for in-flight message handlers (W-07). */
const DRAIN_TIMEOUT_MS =
  parseInt(process.env.RABBITMQ_DRAIN_TIMEOUT_MS, 10) || 10000;

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
 * always false and the cache NEVER hit (A-36). Same failure shape as the
 * ioredis `.connected` bug (A-24): a mock proves the client, not the driver.
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

const openConnection = async () => {
  const connectPromise = amqplib.connect(rabbitUrl());
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`RabbitMQ connection timed out after ${CONNECT_TIMEOUT}ms`),
        ),
      CONNECT_TIMEOUT,
    );
    timer.unref();
  });

  let conn;
  try {
    conn = await Promise.race([connectPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }

  conn.on("error", (err) => {
    logger.error("RabbitMQ connection error", { error: err.message });
    forgetConnection(conn);
  });
  conn.on("close", () => {
    logger.warn("RabbitMQ connection closed");
    forgetConnection(conn);
  });

  connection = conn;
  return conn;
};

const getConnection = async () => {
  if (connection) {
    return connection;
  }
  if (!connecting) {
    connecting = openConnection().finally(() => {
      connecting = null;
    });
  }
  return connecting;
};

const openChannel = async () => {
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
  return ch;
};

/** The shared PUBLISHING channel. Consumers get channels of their own. */
const getChannel = async () => {
  if (channel) {
    return channel;
  }
  if (!channelOpening) {
    channelOpening = openChannel().finally(() => {
      channelOpening = null;
    });
  }
  return channelOpening;
};

/**
 * Declare a durable work queue, optionally with a dead-letter queue that failed
 * messages are routed to.
 *
 * @param {string} queue
 * @param {string} [dlq]
 * @param {object} [ch] - the channel to declare on (a consumer's own); the
 *   shared publishing channel when omitted
 */
const assertQueue = async (queue, dlq, ch) => {
  const target = ch || (await getChannel());
  if (dlq) {
    await target.assertQueue(dlq, { durable: true });
    await target.assertQueue(queue, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": "",
        "x-dead-letter-routing-key": dlq,
      },
    });
  } else {
    await target.assertQueue(queue, { durable: true });
  }
  return target;
};

/**
 * Publish a JSON message to a queue (persistent).
 * @param {string} queue
 * @param {*} message
 * @param {object} [properties] - extra AMQP properties (messageId, expiration)
 */
const publish = async (queue, message, properties = {}) => {
  const ch = await getChannel();
  return ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
    persistent: true,
    ...properties,
  });
};

// ------------------------------------------------------------------
// MESSAGE DEDUPLICATION (A-26)
// ------------------------------------------------------------------
//
// RabbitMQ delivery is AT LEAST ONCE. A message whose ack never reached the
// broker — channel closed, worker killed, connection dropped — is delivered
// again, and until A-26 every consumer simply did the work a second time: the
// same activation or OTP email went out twice.
//
// The claim is a Redis `SET NX EX` on a caller-supplied identity. Used by the
// email consumer. The batch-job worker no longer uses it (W-07): its claim is
// the atomic PENDING -> PROCESSING transition of the batch_jobs row, which
// holds with or without Redis and does not outlive a dead worker.
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
//    Proportionate for an email; recorded, and not used for batch jobs.
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

// ------------------------------------------------------------------
// SUPERVISED CONSUMERS (W-06)
// ------------------------------------------------------------------
//
// A consumer is not a call. When the connection drops, the cached handles are
// forgotten (so the next PUBLISH reconnects) — but a subscription simply
// ceases to exist, and until W-06 nothing re-established it: a broker restart
// ended both workers for the life of the process, and messages published
// afterwards sat in the queue with nobody listening. A broker that was not up
// yet at boot meant the worker was never started at all.
//
// `startConsumer` registers a consumer on a channel of its OWN and supervises
// it: when that channel closes (the connection dropped, the broker restarted,
// or the channel was closed for a protocol error) or registration fails (the
// broker is down), it re-registers with capped exponential backoff, logging
// once per attempt. Registration is idempotent — one consumer per queue per
// process, however often the broker flaps.
//
// The handler receives `(msg, ch)`: `ch` is the channel the message arrived
// on, and the ONLY channel that may ack it. An ack of a delivery tag on any
// other channel is a protocol error that closes that channel (W-31) — the
// batch worker used to ack through the shared publishing channel.
//
// A handler that throws cannot reach `uncaughtException` / `unhandledRejection`
// (which call shutdown()): the rejection is caught and logged here.

const consumers = new Map();
const inFlight = new Set();
let stopping = false;

const backoffMs = (attempt) =>
  Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);

const closeQuietly = async (ch) => {
  try {
    await ch.close();
  } catch {
    // Already closed: nothing to release.
  }
};

const isCurrent = (entry) => !stopping && consumers.get(entry.queue) === entry;

const scheduleRegister = (entry, reason) => {
  if (!isCurrent(entry) || entry.timer) {
    return;
  }
  entry.attempt += 1;
  const delay = backoffMs(entry.attempt);
  logger.warn(
    `RabbitMQ consumer for "${entry.queue}" is not registered (${reason}); retry ${entry.attempt} in ${delay}ms`,
  );
  entry.timer = setTimeout(() => {
    entry.timer = null;
    register(entry);
  }, delay);
  entry.timer.unref();
};

const dispatch = (entry, ch, msg) => {
  if (msg === null) {
    // The broker cancelled the consumer (e.g. the queue was deleted).
    if (entry.channel === ch) {
      entry.channel = null;
      entry.tag = null;
      closeQuietly(ch);
      scheduleRegister(entry, "consumer cancelled by the broker");
    }
    return undefined;
  }
  const work = (async () => {
    try {
      await entry.handler(msg, ch);
    } catch (err) {
      logger.error(`RabbitMQ consumer for "${entry.queue}" failed on a message`, {
        error: err && err.message ? err.message : String(err),
      });
    }
  })();
  inFlight.add(work);
  work.then(() => inFlight.delete(work));
  return work;
};

// Never runs twice at once for one entry: it is started by startConsumer, and
// re-run only from the one retry timer scheduleRegister keeps per entry, which
// is set only after a registration ended (its catch) or a registered channel
// closed. A shutdown that begins while it awaits is caught by the isCurrent
// check after consume().
async function register(entry) {
  let ch = null;
  let closed = false;
  try {
    const conn = await getConnection();
    ch = await conn.createChannel();
    ch.on("error", (err) => {
      logger.error(`RabbitMQ consumer channel error ("${entry.queue}")`, { error: err.message });
    });
    ch.on("close", () => {
      closed = true;
      if (entry.channel === ch) {
        entry.channel = null;
        entry.tag = null;
        scheduleRegister(entry, "its channel closed");
      }
    });
    if (entry.setup) {
      await entry.setup(ch);
    }
    if (entry.prefetch) {
      await ch.prefetch(entry.prefetch);
    }
    const { consumerTag } = await ch.consume(entry.queue, (msg) => dispatch(entry, ch, msg));
    if (closed || !isCurrent(entry)) {
      throw new Error("the channel closed during registration");
    }
    entry.channel = ch;
    entry.tag = consumerTag;
    logger.info(
      entry.attempt > 0
        ? `RabbitMQ consumer for "${entry.queue}" re-registered after ${entry.attempt} attempt(s)`
        : `RabbitMQ consumer for "${entry.queue}" registered`,
    );
    entry.attempt = 0;
    return true;
  } catch (err) {
    if (ch && !closed) {
      await closeQuietly(ch);
    }
    scheduleRegister(entry, err.message);
    return false;
  }
}

/**
 * Register a supervised consumer on a queue. Idempotent per queue.
 *
 * @param {string} queue
 * @param {(msg: object, ch: object) => Promise<void>} handler - acks/nacks on `ch`
 * @param {object} [options]
 * @param {number} [options.prefetch]
 * @param {(ch: object) => Promise<void>} [options.setup] - queue declarations,
 *   re-run on every (re-)registration so a restarted broker gets them back
 * @returns {Promise<boolean>} whether the FIRST attempt registered; a false is
 *   retried in the background, never thrown
 */
const startConsumer = (queue, handler, { prefetch, setup } = {}) => {
  if (consumers.has(queue)) {
    return consumers.get(queue).firstAttempt;
  }
  const entry = { queue, handler, prefetch, setup, channel: null, tag: null, timer: null, attempt: 0 };
  consumers.set(queue, entry);
  entry.firstAttempt = register(entry);
  return entry.firstAttempt;
};

/**
 * Settle a message on the channel it arrived on. Never throws: when that
 * channel has closed, the broker has already requeued the message and will
 * redeliver it — there is nothing left to settle.
 *
 * @param {object} ch
 * @param {object} msg
 * @param {"ack"|"nack"} how
 * @returns {boolean} whether the settlement was sent
 */
const settle = (ch, msg, how) => {
  try {
    if (how === "ack") {
      ch.ack(msg);
    } else {
      ch.nack(msg, false, false);
    }
    return true;
  } catch (err) {
    logger.warn(`RabbitMQ ${how} not sent (${err.message}); the broker redelivers the message`);
    return false;
  }
};

/** Acknowledge a message on the channel it arrived on. */
const ack = (ch, msg) => settle(ch, msg, "ack");
/** Reject a message without requeue (dead-letters it) on the channel it arrived on. */
const nack = (ch, msg) => settle(ch, msg, "nack");

/**
 * Stop consuming and wait for the handlers already running (W-07).
 *
 * Shutdown must STOP CONSUMING before it closes anything and wait for in-flight
 * work; otherwise a message being handled is cut off mid-way. A handler still
 * running after `timeoutMs` is abandoned: its message is unacked, so the broker
 * redelivers it to the next process.
 *
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{drained: boolean, pending: number}>}
 */
const stopConsumers = async ({ timeoutMs = DRAIN_TIMEOUT_MS } = {}) => {
  stopping = true;
  for (const entry of consumers.values()) {
    clearTimeout(entry.timer);
    entry.timer = null;
    if (entry.channel && entry.tag) {
      try {
        await entry.channel.cancel(entry.tag);
      } catch {
        // The channel is gone: nothing is being delivered to it any more.
      }
    }
  }
  const pending = [...inFlight];
  if (pending.length === 0) {
    return { drained: true, pending: 0 };
  }
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
  });
  const drained = await Promise.race([Promise.all(pending).then(() => true), timedOut]);
  clearTimeout(timer);
  if (!drained) {
    logger.warn(
      `${inFlight.size} RabbitMQ message handler(s) still running after ${timeoutMs}ms; ` +
        "closing anyway — the broker redelivers their messages",
    );
  }
  return { drained, pending: drained ? 0 : inFlight.size };
};

/**
 * Close every AMQP resource this process opened: stop the consumers (draining
 * in-flight handlers), close their channels, then the publishing channel and
 * the one connection. The ONLY close; index.js calls it once at shutdown.
 */
const closeRabbitMQ = async () => {
  try {
    await stopConsumers();
    for (const entry of consumers.values()) {
      if (entry.channel) {
        await closeQuietly(entry.channel);
      }
    }
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
    consumers.clear();
    channel = null;
    connection = null;
    stopping = false;
  }
};

/** The queues with a supervised consumer, and whether each is registered now. */
const consumerStatus = () =>
  [...consumers.values()].map((entry) => ({
    queue: entry.queue,
    registered: Boolean(entry.channel),
    attempt: entry.attempt,
  }));

module.exports = {
  getConnection,
  getChannel,
  assertQueue,
  publish,
  claimMessage,
  DEDUP_TTL_SECONDS,
  startConsumer,
  ack,
  nack,
  stopConsumers,
  consumerStatus,
  closeRabbitMQ,
};
