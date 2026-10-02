// src/services/redis.service.ts
//
// P9-18 (ADR-087): converted from redis.service.js, behaviour unchanged (its
// interim `.d.ts` is deleted with it). `logger` is captured at load; the
// environment is read through config/env at the same moments as before
// (credentialOptions and the first getRedisConnection); internal calls use the
// local functions, never the exports, as the JavaScript did. `export =` keeps
// the object `require()` returned.
import Redis from "ioredis";
import type { Redis as RedisClient } from "ioredis";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { env } from "../config/env";

const logger = loadedLogger;

// ==========================================
// REDIS CONNECTION
// ==========================================

let redis: RedisClient | null = null;

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
 * @param times - 1-based attempt number since the last `ready`
 * @returns delay in milliseconds, capped at RETRY_DELAY_CAP_MS
 */
const retryStrategy = (times: number): number => Math.min(times * 200, RETRY_DELAY_CAP_MS);

/**
 * Clients closeRedis() shut down on purpose. Per client, and never cleared:
 * ioredis emits `close`/`end` on a later tick than `quit()` resolves, so a
 * flag reset after `await quit()` would already be false when they fire.
 */
const closedOnPurpose = new WeakSet<RedisClient>();

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
 * @param client - the shared client
 */
const watchLifecycle = (client: RedisClient): void => {
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
      message: `ioredis stopped reconnecting; forcing a reconnect in ${String(RETRY_DELAY_CAP_MS)}ms`,
    });
    const timer = setTimeout(() => {
      if (client.status === "end" && !closedOnPurpose.has(client)) {
        client.connect().catch(() => {
          // The failed attempt goes through closeHandler → retryStrategy,
          // which keeps retrying; the `error` listener has already logged it.
        });
      }
    }, RETRY_DELAY_CAP_MS);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a fake timer may lack unref
    timer.unref?.();
  });
};

/**
 * Redis credentials (S-09), backward compatible.
 *
 * Redis here is not a cache: it holds the brute-force lockout counters and the
 * WebAuthn/OIDC state, so an unauthenticated Redis lets anything on its
 * network flush a lockout. The compose stack now starts Redis with
 * `--requirepass` whenever REDIS_PASSWORD is set, and the backend
 * authenticates with:
 *
 *   REDIS_PASSWORD   the `requirepass` / ACL password
 *   REDIS_USERNAME   an ACL user (Redis 6+); omit for the `default` user
 *
 * Both unset: no AUTH, exactly as before. Credentials embedded in REDIS_URL
 * (`redis://user:pass@host:6379`) also work and TAKE PRECEDENCE — ioredis
 * applies the URL's credentials over the options — so use one or the other.
 * Every client duplicated from this one (the Socket.IO adapter's pub/sub
 * pair) inherits them.
 *
 * @returns `{ password?, username? }`
 */
const credentialOptions = (): { password?: string; username?: string } => {
  const options: { password?: string; username?: string } = {};
  if (env("REDIS_PASSWORD")) {
    options.password = env("REDIS_PASSWORD") as string;
  }
  if (env("REDIS_USERNAME")) {
    options.username = env("REDIS_USERNAME") as string;
  }
  return options;
};

const getRedisConnection = (): RedisClient => {
  if (redis) {
    return redis;
  }

  const redisUrl =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty variable falls back
    env("REDIS_URL") ||
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/restrict-template-expressions -- as built: an empty variable falls back; the port is interpolated as given
    `redis://${env("REDIS_HOST") || "localhost"}:${env("REDIS_PORT") || 6379}`;

  redis = new Redis(redisUrl, {
    ...credentialOptions(),
    // Commands queued while disconnected are rejected after every 4th failed
    // attempt rather than waiting forever. The helpers below never queue —
    // they check readiness first — but the rate limiter and queue dedup call
    // the client directly and already treat a rejection as "Redis down".
    maxRetriesPerRequest: 3,
    retryStrategy,
    lazyConnect: true,
    // ioredis 6 defaults to RESP3. The eval scripts, scan cursors and SET NX
    // replies below were written and tested against RESP2 shapes, so the v5
    // wire protocol is kept explicitly (2026-09-24 dependency upgrade).
    protocol: 2,
  });

  redis.on("error", (err: Error) => {
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
 * @param client - the shared client, or null
 * @returns whether it is ready
 */
const isReady = (client: RedisClient | null): boolean => Boolean(client) && (client as RedisClient).status === "ready";

// ==========================================
// INITIALIZE REDIS
// ==========================================

const initRedis = async (): Promise<RedisClient | null> => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {
      // lazyConnect: true leaves the client in "wait"; connect() from any other
      // state (connecting/reconnecting) throws "already connecting".
      if (client.status === "wait" || client.status === "end") {
        await client.connect();
      }
      // Wait for ready state
      await new Promise<void>((resolve) => {
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
      message: (error as Error).message,
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
 * @param key - the key
 * @returns the value (JSON-parsed, else the string), or null
 */
const get = async (key: string): Promise<unknown> => {
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
    logger.error({ status: "Redis GET Error", message: (error as Error).message });
    return null;
  }
};

/**
 * Set cache value with optional TTL
 * @param key - the key
 * @param value - the value (JSON unless a string)
 * @param ttl - TTL in seconds (default 5 min)
 * @returns whether it was stored
 */
const set = async (key: string, value: unknown, ttl = 300): Promise<boolean> => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {return false;}

    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    await client.setex(key, ttl, serialized);
    return true;
  } catch (error) {
    logger.error({ status: "Redis SET Error", message: (error as Error).message });
    return false;
  }
};

/**
 * Delete cache key
 * @param key - the key
 * @returns whether the command ran
 */
const del = async (key: string): Promise<boolean> => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {return false;}

    await client.del(key);
    return true;
  } catch (error) {
    logger.error({ status: "Redis DEL Error", message: (error as Error).message });
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
 * @param key - the key
 * @returns the parsed value (JSON, else the raw string), or null
 */
const getDel = async (key: string): Promise<unknown> => {
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
    logger.error({ status: "Redis GETDEL Error", message: (error as Error).message });
    return null;
  }
};

/**
 * Delete keys matching pattern — processes ALL batches via SCAN cursor
 * @param pattern - the MATCH pattern
 * @returns how many keys were deleted
 */
const delPattern = async (pattern: string): Promise<number> => {
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
      message: (error as Error).message,
    });
    return 0;
  }
};

/**
 * Acquire distributed lock
 * @param key - the resource
 * @param ttl - Lock TTL in milliseconds
 * @returns Lock ID or null if failed
 */
const acquireLock = async (key: string, ttl = 5000): Promise<string | null> => {
  try {
    const client = getRedisConnection();
    if (!isReady(client)) {return null;}

    const lockKey = `lock:${key}`;
    const lockId = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;

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
    logger.error({ status: "Redis Lock Error", message: (error as Error).message });
    return null;
  }
};

/**
 * Release distributed lock
 * @param key - the resource
 * @param lockId - the id acquireLock returned
 * @returns whether the lock was released
 */
const releaseLock = async (key: string, lockId: string): Promise<boolean> => {
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
    logger.error({ status: "Redis Unlock Error", message: (error as Error).message });
    return false;
  }
};

// ==========================================
// CACHE KEY BUILDERS
// ==========================================

/* eslint-disable @typescript-eslint/restrict-template-expressions -- as built: any id is interpolated as given */
const cacheKeys = {
  user: (userId: unknown): string => `user:${userId}`,
  userByEmail: (email: unknown): string => `user:email:${email}`,
  userByUsername: (username: unknown): string => `user:username:${username}`,
  tenant: (tenantId: unknown): string => `tenant:${tenantId}`,
  tenantByCode: (code: unknown): string => `tenant:code:${code}`,
  tenantSettings: (tenantId: unknown): string => `tenant:settings:${tenantId}`,
  role: (roleId: unknown): string => `role:${roleId}`,
  permissions: (roleId: unknown): string => `permissions:role:${roleId}`,
  userPermissions: (userId: unknown): string => `permissions:user:${userId}`,
  session: (sessionHash: unknown): string => `session:${sessionHash}`,
  rateLimit: (identifier: unknown): string => `ratelimit:${identifier}`,
  lock: (resource: unknown): string => `lock:${resource}`,
};
/* eslint-enable @typescript-eslint/restrict-template-expressions */

// ==========================================
// CLOSE REDIS CONNECTION
// ==========================================

const closeRedis = async (): Promise<void> => {
  try {
    if (redis) {
      closedOnPurpose.add(redis);
      await redis.quit();
      redis = null;
      logger.info("Redis connection closed");
    }
  } catch (error) {
    logger.error({ status: "Redis Close Error", message: (error as Error).message });
  }
};

export = {
  credentialOptions,
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
