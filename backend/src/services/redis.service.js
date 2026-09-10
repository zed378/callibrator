// src/services/redis.service.js
const Redis = require("ioredis");
const { logger } = require("../middlewares/activityLog.middleware");

// ==========================================
// REDIS CONNECTION
// ==========================================

let redis = null;

const getRedisConnection = () => {
  if (redis) {
    return redis;
  }

  const redisUrl =
    process.env.REDIS_URL ||
    `redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || 6379}`;

  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) {
        return null;
      }
      return Math.min(times * 200, 1000);
    },
    lazyConnect: true,
  });

  redis.on("error", (err) => {
    logger.error({
      status: "Redis Connection Error",
      message: err.message,
    });
  });

  return redis;
};

// ==========================================
// INITIALIZE REDIS
// ==========================================

const initRedis = async () => {
  try {
    const client = getRedisConnection();
    if (!client.connected) {
      await client.connect();
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
    if (!client || !client.connected) {return null;}

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
    if (!client || !client.connected) {return false;}

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
    if (!client || !client.connected) {return false;}

    await client.del(key);
    return true;
  } catch (error) {
    logger.error({ status: "Redis DEL Error", message: error.message });
    return false;
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
    if (!client || !client.connected) {return 0;}

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
    if (!client || !client.connected) {return null;}

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
    if (!client || !client.connected) {return false;}

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
  delPattern,
  acquireLock,
  releaseLock,
  cacheKeys,
  closeRedis,
};
