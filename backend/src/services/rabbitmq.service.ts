// src/services/rabbitmq.service.ts
//
// The process's ONE RabbitMQ connection (W-18), its publishing channel, and
// supervised consumers (W-06).
//
// Every producer and consumer goes through this module: the email queue, the
// batch-job worker and every publisher. The email queue used to keep a second,
// private connection of its own — two AMQP connections per process, and
// shutdown closed only one of them (W-18).

//
// P9-18 (ADR-087, Stage C): converted from rabbitmq.service.js with no
// behaviour change. `export =` keeps the object `require()` returned (the same
// keys, in the same order). `connect` is a named import of amqplib (which
// ships its own types), read at call time as before; `redis` is read at call
// time through its object. The tuning constants are still read once at load
// and `rabbitUrl()` at each connect, now through config/env.

import { connect as amqpConnect } from "amqplib";
import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import redis from "./redis.service";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { env } from "../config/env";

const logger = loadedLogger;

/** A consumer's message handler: acks or nacks on `ch`, the channel the message arrived on. */
type MessageHandler = (msg: ConsumeMessage, ch: Channel) => Promise<void> | void;

/** One supervised consumer (W-06). */
interface ConsumerEntry {
  queue: string;
  handler: MessageHandler;
  prefetch: number | undefined;
  setup: ((ch: Channel) => Promise<void>) | undefined;
  channel: Channel | null;
  tag: string | null;
  timer: NodeJS.Timeout | null;
  attempt: number;
  firstAttempt?: Promise<boolean>;
}

/** The message of a caught error, read as the `.js` read `err.message`. */
const messageOf = (err: unknown): string => (err as Error).message;

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
// W-18 — the in-flight connect / channel open. Two concurrent first callers
// share it instead of both dialling and orphaning one of the two results.
let connecting: Promise<ChannelModel> | null = null;
let channelOpening: Promise<Channel> | null = null;

// As built: an unset, empty or non-numeric value falls back to the default.
const CONNECT_TIMEOUT =
  parseInt(env("RABBITMQ_CONNECT_TIMEOUT") as string, 10) || 10000;
/** Consumer re-registration backoff: 1 s, 2 s, 4 s … capped here (W-06). */
const RECONNECT_BASE_MS =
  parseInt(env("RABBITMQ_RECONNECT_BASE_MS") as string, 10) || 1000;
const RECONNECT_MAX_MS =
  parseInt(env("RABBITMQ_RECONNECT_MAX_MS") as string, 10) || 30000;
/** How long shutdown waits for in-flight message handlers (W-07). */
const DRAIN_TIMEOUT_MS =
  parseInt(env("RABBITMQ_DRAIN_TIMEOUT_MS") as string, 10) || 10000;

const rabbitUrl = (): string =>
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value also falls back
  env("RABBITMQ_URL") ||
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value also falls back
  `amqp://${env("RABBITMQ_HOST") || "localhost"}:${
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions -- as built: an empty value also falls back; the default port is a number
    env("RABBITMQ_PORT") || 5672
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
const forgetConnection = (conn: ChannelModel): void => {
  if (connection === conn) {
    connection = null;
    channel = null;
  }
};

const forgetChannel = (ch: Channel): void => {
  if (channel === ch) {
    channel = null;
  }
};

const openConnection = async (): Promise<ChannelModel> => {
  const connectPromise = amqpConnect(rabbitUrl());
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: the arrow returns reject()'s undefined
        reject(
          // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a number interpolated as its decimal string
          new Error(`RabbitMQ connection timed out after ${CONNECT_TIMEOUT}ms`),
        ),
      CONNECT_TIMEOUT,
    );
    timer.unref();
  });

  let conn: ChannelModel;
  try {
    conn = await Promise.race([connectPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }

  conn.on("error", (err: Error) => {
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

const getConnection = async (): Promise<ChannelModel> => {
  if (connection) {
    return connection;
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: the shared in-flight promise
  if (!connecting) {
    connecting = openConnection().finally(() => {
      connecting = null;
    });
  }
  return connecting;
};

const openChannel = async (): Promise<Channel> => {
  const conn = await getConnection();
  const ch = await conn.createChannel();

  ch.on("error", (err: Error) => {
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
const getChannel = async (): Promise<Channel> => {
  if (channel) {
    return channel;
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: the shared in-flight promise
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
 * @param queue
 * @param dlq
 * @param ch - the channel to declare on (a consumer's own); the
 *   shared publishing channel when omitted
 */
const assertQueue = async (queue: string, dlq?: string | null, ch?: Channel | null): Promise<Channel> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: any falsy channel means the shared one
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
 * @param queue
 * @param message
 * @param properties - extra AMQP properties (messageId, expiration)
 */
const publish = async (queue: string, message: unknown, properties: Record<string, unknown> = {}): Promise<boolean> => {
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
  parseInt(env("QUEUE_DEDUP_TTL_SECONDS") as string, 10) || 86400;

/** What a claim answers (see claimMessage). */
interface MessageClaim {
  claimed: boolean;
  deduplicated: boolean;
  release: () => Promise<boolean>;
}

const dedupKey = (identity: string): string => `dedup:msg:${identity}`;

/** Returned when there is no claim to give back. */
// eslint-disable-next-line @typescript-eslint/require-await -- as built: async, so it answers a promise like release()
const noRelease = async (): Promise<boolean> => false;

/**
 * Claim a message identity before acting on it.
 *
 * @param identity stable across a redelivery — see each consumer.
 * @param ttlSeconds
 * @returns `claimed: false` means this identity was already processed: ACK the
 *   message and do nothing. `claimed: true` means proceed, and call
 *   `release()` if the side effect failed so a retry is not mistaken for a
 *   duplicate. `deduplicated: false` with `claimed: true` says the claim was
 *   not actually enforced (no store available).
 */
const claimMessage = async (identity: string, ttlSeconds: number = DEDUP_TTL_SECONDS): Promise<MessageClaim> => {
  const key = dedupKey(identity);
  try {
    const client = redis.getRedisConnection();
    // ioredis readiness is `status === "ready"`; it has no `.connected`.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-optional-chain -- as built: the client is checked although the declaration says it is always returned
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
      error: messageOf(error),
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

const consumers = new Map<string, ConsumerEntry>();
const inFlight = new Set<Promise<void>>();
let stopping = false;

const backoffMs = (attempt: number): number =>
  Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);

const closeQuietly = async (ch: Channel): Promise<void> => {
  try {
    await ch.close();
  } catch {
    // Already closed: nothing to release.
  }
};

const isCurrent = (entry: ConsumerEntry): boolean => !stopping && consumers.get(entry.queue) === entry;

const scheduleRegister = (entry: ConsumerEntry, reason: string): void => {
  if (!isCurrent(entry) || entry.timer) {
    return;
  }
  entry.attempt += 1;
  const delay = backoffMs(entry.attempt);
  logger.warn(
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a number interpolated as its decimal string
    `RabbitMQ consumer for "${entry.queue}" is not registered (${reason}); retry ${entry.attempt} in ${delay}ms`,
  );
  const timer = setTimeout(() => {
    entry.timer = null;
    // Not awaited, as built: register() never rejects (it catches and reschedules).
    void register(entry);
  }, delay);
  entry.timer = timer;
  timer.unref();
};

const dispatch = (entry: ConsumerEntry, ch: Channel, msg: ConsumeMessage | null): Promise<void> | undefined => {
  if (msg === null) {
    // The broker cancelled the consumer (e.g. the queue was deleted).
    if (entry.channel === ch) {
      entry.channel = null;
      entry.tag = null;
      // Not awaited, as built: closeQuietly never rejects.
      void closeQuietly(ch);
      scheduleRegister(entry, "consumer cancelled by the broker");
    }
    return undefined;
  }
  const work = (async () => {
    try {
      await entry.handler(msg, ch);
    } catch (err) {
      const thrown = err as { message?: unknown } | null | undefined;
      logger.error(`RabbitMQ consumer for "${entry.queue}" failed on a message`, {
        // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: a falsy message, or a non-Error, is stringified whole
        error: thrown && thrown.message ? thrown.message : String(err),
      });
    }
  })();
  inFlight.add(work);
  // Not awaited, as built: `work` never rejects (its handler errors are caught above).
  void work.then(() => inFlight.delete(work));
  return work;
};

// Never runs twice at once for one entry: it is started by startConsumer, and
// re-run only from the one retry timer scheduleRegister keeps per entry, which
// is set only after a registration ended (its catch) or a registered channel
// closed. A shutdown that begins while it awaits is caught by the isCurrent
// check after consume().
async function register(entry: ConsumerEntry): Promise<boolean> {
  let ch: Channel | null = null;
  let closed = false;
  try {
    const conn = await getConnection();
    const opened = await conn.createChannel();
    ch = opened;
    opened.on("error", (err: Error) => {
      logger.error(`RabbitMQ consumer channel error ("${entry.queue}")`, { error: err.message });
    });
    opened.on("close", () => {
      closed = true;
      if (entry.channel === opened) {
        entry.channel = null;
        entry.tag = null;
        scheduleRegister(entry, "its channel closed");
      }
    });
    if (entry.setup) {
      await entry.setup(opened);
    }
    if (entry.prefetch) {
      await opened.prefetch(entry.prefetch);
    }
    // eslint-disable-next-line @typescript-eslint/no-misused-promises -- as built: dispatch returns the handler's promise, which amqplib ignores
    const { consumerTag } = await opened.consume(entry.queue, (msg) => dispatch(entry, opened, msg));
    // `closed` is set by the "close" listener while the awaits above run.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- set asynchronously by the listener
    if (closed || !isCurrent(entry)) {
      throw new Error("the channel closed during registration");
    }
    entry.channel = opened;
    entry.tag = consumerTag;
    logger.info(
      entry.attempt > 0
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a number interpolated as its decimal string
        ? `RabbitMQ consumer for "${entry.queue}" re-registered after ${entry.attempt} attempt(s)`
        : `RabbitMQ consumer for "${entry.queue}" registered`,
    );
    entry.attempt = 0;
    return true;
  } catch (err) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- `closed` is set asynchronously by the listener
    if (ch && !closed) {
      await closeQuietly(ch);
    }
    scheduleRegister(entry, messageOf(err));
    return false;
  }
}

/**
 * Register a supervised consumer on a queue. Idempotent per queue.
 *
 * @param queue
 * @param handler - acks/nacks on `ch`
 * @param options.prefetch
 * @param options.setup - queue declarations,
 *   re-run on every (re-)registration so a restarted broker gets them back
 * @returns whether the FIRST attempt registered; a false is
 *   retried in the background, never thrown
 */
const startConsumer = (
  queue: string,
  handler: MessageHandler,
  { prefetch, setup }: { prefetch?: number; setup?: (ch: Channel) => Promise<void> } = {},
): Promise<boolean> => {
  if (consumers.has(queue)) {
    // Set by the first call for this queue, below.
    return (consumers.get(queue) as ConsumerEntry).firstAttempt as Promise<boolean>;
  }
  const entry: ConsumerEntry = { queue, handler, prefetch, setup, channel: null, tag: null, timer: null, attempt: 0 };
  consumers.set(queue, entry);
  entry.firstAttempt = register(entry);
  return entry.firstAttempt;
};

/**
 * Settle a message on the channel it arrived on. Never throws: when that
 * channel has closed, the broker has already requeued the message and will
 * redeliver it — there is nothing left to settle.
 *
 * @param ch
 * @param msg
 * @param how
 * @returns whether the settlement was sent
 */
const settle = (ch: Channel, msg: ConsumeMessage, how: "ack" | "nack"): boolean => {
  try {
    if (how === "ack") {
      ch.ack(msg);
    } else {
      ch.nack(msg, false, false);
    }
    return true;
  } catch (err) {
    logger.warn(`RabbitMQ ${how} not sent (${messageOf(err)}); the broker redelivers the message`);
    return false;
  }
};

/** Acknowledge a message on the channel it arrived on. */
const ack = (ch: Channel, msg: ConsumeMessage): boolean => settle(ch, msg, "ack");
/** Reject a message without requeue (dead-letters it) on the channel it arrived on. */
const nack = (ch: Channel, msg: ConsumeMessage): boolean => settle(ch, msg, "nack");

/**
 * Stop consuming and wait for the handlers already running (W-07).
 *
 * Shutdown must STOP CONSUMING before it closes anything and wait for in-flight
 * work; otherwise a message being handled is cut off mid-way. A handler still
 * running after `timeoutMs` is abandoned: its message is unacked, so the broker
 * redelivers it to the next process.
 *
 * @param options.timeoutMs
 */
const stopConsumers = async (
  { timeoutMs = DRAIN_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<{ drained: boolean; pending: number }> => {
  stopping = true;
  for (const entry of consumers.values()) {
    // As built: clearTimeout(null) is a no-op.
    clearTimeout(entry.timer as NodeJS.Timeout);
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
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- as built: the arrow returns resolve()'s undefined
    timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
  });
  const drained = await Promise.race([Promise.all(pending).then(() => true), timedOut]);
  clearTimeout(timer);
  if (!drained) {
    logger.warn(
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: a number interpolated as its decimal string
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
const closeRabbitMQ = async (): Promise<void> => {
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
    logger.error("Error closing RabbitMQ connection", { error: messageOf(error) });
  } finally {
    consumers.clear();
    channel = null;
    connection = null;
    stopping = false;
  }
};

/** The queues with a supervised consumer, and whether each is registered now. */
const consumerStatus = (): { queue: string; registered: boolean; attempt: number }[] =>
  [...consumers.values()].map((entry) => ({
    queue: entry.queue,
    registered: Boolean(entry.channel),
    attempt: entry.attempt,
  }));

export = {
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
