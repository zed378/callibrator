// src/services/redis.service.js
const Redis = require("ioredis");
const { logger } = require("../middlewares/activityLog.middleware");

// ==========================================
// REDIS CONNECTION
// ==========================================

let redis = null;

/**
 * Longest wait between two reconnect attempts, in milliseconds.
 *
 * ioredis's own default strategy caps at 2000 ms; this matches it.
 */
const RETRY_DELAY_CAP_MS = 2000;

/**
 * How long to wait between reconnect attempts.
 *
 * It must ALWAYS return a number. ioredis 5 (`built/redis/event_handler.js`,
 * `closeHandler`) calls `retryStrategy(++retryAttempts)` on every lost
 * connection and, when the result is not a number, calls `setStatus("end")`
 * and flushes every queued command with "Connection is closed" — and never
 * dials again unless something calls `connect()` by hand. The README says the
 * same: "the connection will be lost forever if the user doesn't call
 * `redis.connect()` manually".
 *
 * This used to return `null` after the third attempt: a reconnect budget of
 * about 1.2 s. Any Redis restart outlived it, the client ended, and because
 * `initRedis()` runs once at boot every helper below reported "not ready"
 * for the rest of the process's life (W-05) — registration 429, passkeys 503,
 * the rate limiter back on per-process memory, queue dedup off. The attempt
 * counter resets to 0 on `ready` (`readyHandler`), so the backoff starts
 * short again after each recovery.
 *
 * @param {number} times - 1-based attempt number since the last `ready`
 * @returns {number} delay in milliseconds, capped at RETRY_DELAY_CAP_MS
 */
const retryStrategy = (times) => Math.min(times * 200, RETRY_DELAY_CAP_MS);

/**
 * Clients closeRedis() shut down on purpose. Per client, and never cleared:
 * ioredis emits `close`/`end` on a later tick than `quit()` resolves, so a
 * flag reset after `await quit()` would already be false when they fire.
 */
const closedOnPurpose = new WeakSet();

/**
 * Log the connection's state transitions and keep the client from ever
 * staying ended.
 *
 * - ready → close: one `warn` naming the consequence (every helper fails
 *   over until the connection returns). ioredis also emits `error` on each
 *   failed attempt, which the `error` listener logs.
 * - close → ready: one `warn` that it recovered.
 * - end without closeRedis(): with a numeric retryStrategy ioredis only gets
 *   here when the connector itself errors (`Redis#_connect`); schedule a
 *   `connect()`, whose failure re-enters the normal retry loop.
 *
 * @param {import("ioredis").Redis} client
 */
const watchLifecycle = (client) => {
  let lost = false;

  client.on("ready", () => {
    if (lost) {
      lost = false;
      logger.warn("Redis reconnected; caching, locks and shared rate limiting resumed");
    }
  });

  client.on("close", () => {
    if (!lost && !closedOnPurpose.has(client)) {
      lost = true;
      logger.warn(
        "Redis connection lost; caching, locks, WebAuthn/OIDC state and shared rate limiting are degraded until it reconnects",
      );
    }
  });

  client.on("end", () => {
    if (closedOnPurpose.has(client)) {return;}
    logger.error({
      status: "Redis Connection Ended",
      message: `ioredis stopped reconnecting; forcing a reconnect in ${RETRY_DELAY_CAP_MS}ms`,
    });
    const timer = setTimeout(() => {
      if (client.status === "end" && !closedOnPurpose.has(client)) {
        client.connect().catch(() => {
          // The failed attempt goes through closeHandler → retryStrategy,
          // which keeps retrying; the `error` listener has already logged it.
        });
      }
    }, RETRY_DELAY_CAP_MS);
    timer.unref?.();
  });
};

const getRedisConnection = () => {
  if (redis) {
    return redis;
  }

  const redisUrl =
    process.env.REDIS_URL ||
    `redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || 6379}`;

  redis = new Redis(redisUrl, {
    // Commands queued while disconnected are rejected after every 4th failed
    // attempt rather than waiting forever. The helpers below never queue —
    // they check readiness first — but the rate limiter and queue dedup call
    // the client directly and already treat a rejection as "Redis down".
    maxRetriesPerRequest: 3,
    retryStrategy,
    lazyConnect: true,
  });

  redis.on("error", (err) => {
    logger.error({
      status: "Redis Connection Error",
      message: err.message,
    });
  });

  watchLifecycle(redis);

  return redis;
};

/**
 * Whether the shared client can serve commands right now.
 *
 * ioredis exposes readiness as `client.status === "ready"`. It has NO
 * `connected` property — that was node-redis v3. Every helper below used to
 * guard on that missing property, which is always `undefined` on ioredis, so
 * each one returned early: nothing was ever cached, no lock was ever acquired,
 * and no WebAuthn challenge or OIDC authorization request was ever stored. On
 * production that surfaced as registration answering 429 "Registration in
 * progress" to everyone, passkeys answering 503, and the OIDC provider's
 * authorization flow failing — all while Redis was up and healthy.
 *
 * @param {import("ioredis").Redis | null} client
 * @returns {boolean}
 */
const isReady = (client) => Boolean(client) && client.status === "ready";

// ==========================================
// INITIALIZE REDIS
// ==========================================

const initRedis = async () => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {
      // lazyConnect: true leaves the client in "wait"; connect() from any other
      // state (connecting/reconnecting) throws "already connecting".
      if (client.status === "wait" || client.status === "end") {
        await client.connect();
      }
      // Wait for ready state
      await new Promise((resolve) => {
        if (client.status === "ready") {
          resolve();
        } else {
          client.once("ready", resolve);
        }
      });
      logger.info("Redis connected successfully");
    }
    return client;
  } catch (error) {
    logger.error({
      status: "Redis Initialization Failed",
      message: error.message,
    });
    // Return null to indicate Redis is unavailable
    return null;
  }
};

// ==========================================
// CACHE HELPERS
// ==========================================

/**
 * Get cached value
 * @param {string} key
 * @returns {Promise<any|null>}
 */
const get = async (key) => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {return null;}

    const value = await client.get(key);
    if (!value) {return null;}

    // Try to parse as JSON, fallback to string
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    logger.error({ status: "Redis GET Error", message: error.message });
    return null;
  }
};

/**
 * Set cache value with optional TTL
 * @param {string} key
 * @param {any} value
 * @param {number} [ttl=300] - TTL in seconds (default 5 min)
 */
const set = async (key, value, ttl = 300) => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {return false;}

    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    await client.setex(key, ttl, serialized);
    return true;
  } catch (error) {
    logger.error({ status: "Redis SET Error", message: error.message });
    return false;
  }
};

/**
 * Delete cache key
 * @param {string} key
 * @returns {Promise<boolean>}
 */
const del = async (key) => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {return false;}

    await client.del(key);
    return true;
  } catch (error) {
    logger.error({ status: "Redis DEL Error", message: error.message });
    return false;
  }
};

/**
 * Read a key and delete it in ONE command (Redis GETDEL, 6.2+), so a value can
 * be consumed exactly once even when two requests race for it across replicas.
 * A get() followed by a del() lets both readers see the value.
 *
 * Returns null on a miss AND when Redis is unavailable — callers that need a
 * fallback keep their own (see sso.controller.js's handoff store).
 *
 * @param {string} key
 * @returns {Promise<any|null>} the parsed value (JSON, else the raw string), or null
 */
const getDel = async (key) => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {return null;}

    const value = await client.getdel(key);
    if (!value) {return null;}

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    logger.error({ status: "Redis GETDEL Error", message: error.message });
    return null;
  }
};

/**
 * Delete keys matching pattern — processes ALL batches via SCAN cursor
 * @param {string} pattern
 * @returns {Promise<number>}
 */
const delPattern = async (pattern) => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {return 0;}

    let deleted = 0;
    let cursor = "0";

    do {
      const [nextCursor, keys] = await client.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await client.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0"); // "0" means iteration complete

    return deleted;
  } catch (error) {
    logger.error({
      status: "Redis DEL Pattern Error",
      message: error.message,
    });
    return 0;
  }
};

/**
 * Acquire distributed lock
 * @param {string} key
 * @param {number} [ttl=5000] - Lock TTL in milliseconds
 * @returns {Promise<string|null>} - Lock ID or null if failed
 */
const acquireLock = async (key, ttl = 5000) => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {return null;}

    const lockKey = `lock:${key}`;
    const lockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // SET NX EX = Set if Not eXists with EXpiry
    const result = await client.set(
      lockKey,
      lockId,
      "EX",
      Math.ceil(ttl / 1000),
      "NX",
    );

    if (result === "OK") {
      return lockId;
    }
    return null;
  } catch (error) {
    logger.error({ status: "Redis Lock Error", message: error.message });
    return null;
  }
};

/**
 * Release distributed lock
 * @param {string} key
 * @param {string} lockId
 * @returns {Promise<boolean>}
 */
const releaseLock = async (key, lockId) => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {return false;}

    const lockKey = `lock:${key}`;
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await client.eval(script, 1, lockKey, lockId);
    return result === 1;
  } catch (error) {
    logger.error({ status: "Redis Unlock Error", message: error.message });
    return false;
  }
};

// ==========================================
// CACHE KEY BUILDERS
// ==========================================

const cacheKeys = {
  user: (userId) => `user:${userId}`,
  userByEmail: (email) => `user:email:${email}`,
  userByUsername: (username) => `user:username:${username}`,
  tenant: (tenantId) => `tenant:${tenantId}`,
  tenantByCode: (code) => `tenant:code:${code}`,
  tenantSettings: (tenantId) => `tenant:settings:${tenantId}`,
  role: (roleId) => `role:${roleId}`,
  permissions: (roleId) => `permissions:role:${roleId}`,
  userPermissions: (userId) => `permissions:user:${userId}`,
  session: (sessionHash) => `session:${sessionHash}`,
  rateLimit: (identifier) => `ratelimit:${identifier}`,
  lock: (resource) => `lock:${resource}`,
};

// ==========================================
// CLOSE REDIS CONNECTION
// ==========================================

const closeRedis = async () => {
  try {
    if (redis) {
      closedOnPurpose.add(redis);
      await redis.quit();
      redis = null;
      logger.info("Redis connection closed");
    }
  } catch (error) {
    logger.error({ status: "Redis Close Error", message: error.message });
  }
};

module.exports = {
  initRedis,
  getRedisConnection,
  get,
  set,
  del,
  getDel,
  delPattern,
  acquireLock,
  releaseLock,
  cacheKeys,
  closeRedis,
  retryStrategy,
  RETRY_DELAY_CAP_MS,
};
