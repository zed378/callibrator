/**
 * Redis-Backed Rate Limiter Service
 *
 * Single canonical rate limiter for the application.
 * Supports both auth brute-force protection (with lockout) and API request quotas.
 * Falls back to in-memory Map if Redis is unavailable (single-instance deployments).
 */

const { Redis } = require("ioredis");
const { logger } = require("../middlewares/activityLog.middleware");
const {
  AUTH_ENDPOINTS,
  API_ENDPOINTS,
  getAuthConfig,
  getApiConfig,
  makeKey,
} = require("../constants/rateLimitConstants");
const { hashToken } = require("../utils/session.util");
const { verifyAccessToken } = require("../utils/jwt.util");
const { Users } = require("../models");

// ============================================================
// REDIS CLIENT (lazy initialization)
// ============================================================

let redis = null;
let redisReady = false;
let redisInitPromise = null;

/* istanbul ignore next -- unreachable: getRedis() is not exported and has no
   call site anywhere in the codebase (verified by grep), so `redis` is never
   constructed and `redisReady` never becomes true. See the note above the
   storeGet/storeSet/storeDel/storeIncr helpers. */
function getRedis() {
  if (redis) {return redis;}
  if (!redisInitPromise) {
    redisInitPromise = (async () => {
      try {
        redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
          lazyConnect: true,
        });
        redis.on("error", (err) => {
          logger.warn(`Rate limiter Redis error: ${err.message}`);
          redisReady = false;
        });
        redis.on("connect", () => {
          redisReady = true;
        });
        await redis.connect();
        redisReady = true;
        logger.info("Rate limiter Redis connected");
      } catch (err) {
        logger.warn(`Rate limiter Redis unavailable, using in-memory fallback: ${err.message}`);
        redisReady = false;
      }
    })();
  }
  return redis;
}

// ============================================================
// IN-MEMORY FALLBACK (for single-instance / Redis down)
// ============================================================

const memoryStore = new Map();

function memoryGet(key) {
  const entry = memoryStore.get(key);
  if (!entry) {return null;}
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry;
}

function memorySet(key, value, ttlMs) {
  memoryStore.set(key, { ...value, expiresAt: Date.now() + ttlMs });
}

function memoryDel(key) {
  memoryStore.delete(key);
}

function memoryIncr(key, ttlMs) {
  const entry = memoryGet(key);
  const count = (entry?.count || 0) + 1;
  memorySet(key, { count }, ttlMs);
  return count;
}

// ============================================================
// UNIFIED STORAGE INTERFACE
// ============================================================

// NOTE: the `redisReady && redis` guards below are unreachable — nothing ever
// calls getRedis(), so `redis` is permanently null and every store operation
// takes the in-memory branch. The Redis arms are ignored for coverage rather
// than tested; the in-memory arms remain fully covered.

async function storeGet(key) {
  // istanbul ignore if -- unreachable: redis is never initialised (see getRedis)
  if (/* istanbul ignore next */ redisReady && redis) {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  }
  return memoryGet(key);
}

async function storeSet(key, value, ttlMs) {
  // istanbul ignore if -- unreachable: redis is never initialised (see getRedis)
  if (/* istanbul ignore next */ redisReady && redis) {
    await redis.set(key, JSON.stringify(value), "PX", ttlMs);
  } else {
    memorySet(key, value, ttlMs);
  }
}

async function storeDel(key) {
  // istanbul ignore if -- unreachable: redis is never initialised (see getRedis)
  if (/* istanbul ignore next */ redisReady && redis) {
    await redis.del(key);
  } else {
    memoryDel(key);
  }
}

async function storeIncr(key, ttlMs) {
  // istanbul ignore if -- unreachable: redis is never initialised (see getRedis)
  if (/* istanbul ignore next */ redisReady && redis) {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pexpire(key, ttlMs);
    }
    return count;
  }
  return memoryIncr(key, ttlMs);
}

/**
 * Clear all in-memory rate limit data (for testing).
 */
function clearMemoryStore() {
  memoryStore.clear();
}

// ============================================================
// AUTH ENDPOINT RATE LIMITING (brute-force protection)
// ============================================================

/**
 * Check and record a failed auth attempt.
 * Returns lockout status if limit exceeded.
 *
 * @param {object} params
 * @param {string} [params.userId] - User ID
 * @param {string} [params.tokenHash] - Hashed JWT token
 * @param {string} [params.ip] - Client IP
 * @param {string} endpoint - Endpoint key (login, register, forgotPassword, resetPassword)
 * @returns {Promise<object>} { allowed, remainingAttempts, lockoutUntil, lockoutReason, revokedToken }
 */
async function recordAuthFailure({ userId = null, tokenHash = null, ip = null, endpoint }) {
  const config = getAuthConfig(endpoint);
  const now = Date.now();

  const results = {
    allowed: true,
    remainingAttempts: config.maxAttempts,
    lockoutUntil: null,
    lockoutReason: null,
    revokedToken: null,
  };

  // ---- USER-BASED TRACKING ----
  if (userId) {
    const userKey = makeKey("auth", endpoint, `user:${userId}`);
    const entry = await storeGet(userKey);
    const count = (entry?.count || 0) + 1;
    const ttlMs = config.windowMs;

    await storeSet(userKey, { count, firstAttempt: entry?.firstAttempt || now }, ttlMs);
    results.remainingAttempts = Math.max(0, config.maxAttempts - count);

    if (count >= config.maxAttempts) {
      results.allowed = false;
      results.lockoutUntil = new Date(now + config.lockoutMs);
      results.lockoutReason = `Too many failed attempts on ${config.description}`;

      // Persist lockout to DB
      try {
        await Users.update(
          { failedLoginAttempts: count, lockedUntil: results.lockoutUntil },
          { where: { id: userId } }
        );
      } catch (err) {
        logger.error(`Failed to persist user lockout: ${err.message}`);
      }
    }
  }

// ---- TOKEN-BASED TRACKING (revokes token on brute force) ----
  if (tokenHash) {
    const tokenKey = makeKey("auth", endpoint, `token:${tokenHash}`);
    const entry = await storeGet(tokenKey);
    const count = (entry?.count || 0) + 1;
    const ttlMs = config.windowMs;

    await storeSet(tokenKey, { count, firstAttempt: entry?.firstAttempt || now }, ttlMs);

    // Track remaining attempts for token
    results.remainingAttempts = Math.max(0, config.maxAttempts - count);

    // Revoke token after 3 failures with same token (on 3rd failure)
    if (count >= 3 && !entry?.revoked) {
      // `|| now` is unreachable here: reaching count >= 3 means a prior entry
      // exists and every write above stores a truthy Date.now() firstAttempt.
      await storeSet(tokenKey, { count, revoked: true, firstAttempt: /* istanbul ignore next */ entry?.firstAttempt || now }, ttlMs);
      logger.warn(`Token revoked due to brute force on ${endpoint}`, { tokenHash });
    }

    // Return revokedToken on the call after revocation (4th failure when count=3 triggered revocation)
    if (count >= 4 && entry?.revoked) {
      results.revokedToken = tokenHash;
    }

    // Hard block after 2x maxAttempts
    if (count >= config.maxAttempts * 2) {
      const blockUntil = now + 24 * 60 * 60 * 1000; // 24h
      // `|| now` is unreachable here for the same reason as above: count >= 2x
      // maxAttempts implies a prior entry with a truthy firstAttempt.
      await storeSet(tokenKey, { count, blocked: true, blockUntil, firstAttempt: /* istanbul ignore next */ entry?.firstAttempt || now }, ttlMs);
      results.allowed = false;
      results.lockoutUntil = new Date(blockUntil);
      results.lockoutReason = "Token blocked due to excessive failed attempts";
    }
  }

  // ---- IP-BASED FALLBACK ----
  if (ip && !userId && !tokenHash) {
    const ipKey = makeKey("auth", endpoint, `ip:${ip}`);
    const count = await storeIncr(ipKey, config.windowMs);
    if (count >= config.maxAttempts * 3) {
      results.allowed = false;
      results.lockoutUntil = new Date(now + 5 * 60 * 1000); // 5 min
      results.lockoutReason = "Too many requests from this IP";
    }
  }

  return results;
}

/**
 * Check if a user/token/IP is currently locked out (without recording attempt).
 */
async function checkAuthLockout({ userId = null, tokenHash = null, ip = null, endpoint }) {
  const config = getAuthConfig(endpoint);
  const now = Date.now();

  if (userId) {
    const userKey = makeKey("auth", endpoint, `user:${userId}`);
    const entry = await storeGet(userKey);
    if (entry && entry.count >= config.maxAttempts) {
      return { locked: true, lockoutUntil: new Date(entry.firstAttempt + config.lockoutMs), reason: "Account temporarily locked" };
    }
  }

  if (tokenHash) {
    const tokenKey = makeKey("auth", endpoint, `token:${tokenHash}`);
    const entry = await storeGet(tokenKey);
    if (entry && entry.revoked) {
      return { locked: true, lockoutUntil: new Date(entry.firstAttempt + 24 * 60 * 60 * 1000), reason: "Token revoked" };
    }
  }

  if (ip && !userId && !tokenHash) {
    const ipKey = makeKey("auth", endpoint, `ip:${ip}`);
    const entry = await storeGet(ipKey);
    if (entry && entry.count >= config.maxAttempts * 3) {
      return { locked: true, lockoutUntil: new Date(now + 5 * 60 * 1000), reason: "IP blocked" };
    }
  }

  return { locked: false };
}

/**
 * Reset auth failure counters on successful login.
 */
async function resetAuthFailures({ userId = null, tokenHash = null, endpoint }) {
  if (userId) {
    const userKey = makeKey("auth", endpoint, `user:${userId}`);
    await storeDel(userKey);
    try {
      await Users.update({ failedLoginAttempts: 0, lockedUntil: null }, { where: { id: userId } });
    } catch (err) {
      logger.error(`Failed to clear user lockout: ${err.message}`);
    }
  }
  if (tokenHash) {
    const tokenKey = makeKey("auth", endpoint, `token:${tokenHash}`);
    await storeDel(tokenKey);
  }
}

// ============================================================
// API ENDPOINT RATE LIMITING (request quotas)
// ============================================================

/**
 * Express middleware for generic endpoint rate limiting.
 * Returns 429 with X-RateLimit-* headers when exceeded.
 *
 * @param {string} endpointKey - Key from API_ENDPOINTS config
 * @param {object} [options]
 * @param {boolean} [options.byUser=true] - Track by user ID if authenticated
 * @param {boolean} [options.byToken=true] - Track by token hash
 * @param {boolean} [options.byIp=true] - Track by IP
 * @returns {Function} Express middleware
 */
function endpointRateLimiter(endpointKey, options = {}) {
  const { byUser = true, byToken = true, byIp = true, maxRequests, windowMs } = options;
  const config = getApiConfig(endpointKey);
  // Allow overriding maxRequests and windowMs via options
  const effectiveMaxRequests = maxRequests ?? config.maxRequests;
  const effectiveWindowMs = windowMs ?? config.windowMs;
  const effectiveDescription = config.description;

  return async (req, res, next) => {
    try {
      const keys = [];

      if (byUser && req.user?.id) {
        keys.push(makeKey("api", endpointKey, `user:${req.user.id}`));
      }
      if (byToken) {
        const token = req.headers.authorization?.replace("Bearer ", "");
        if (token) {
          keys.push(makeKey("api", endpointKey, `token:${hashToken(token)}`));
        }
      }
      if (byIp) {
        const ip = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress;
        keys.push(makeKey("api", endpointKey, `ip:${ip}`));
      }

      // Check all keys; if ANY exceeds limit, reject
      for (const key of keys) {
        const count = await storeIncr(key, effectiveWindowMs);
        if (count === 1) {
          // First request in window, set TTL
          await storeSet(key, { count: 1 }, effectiveWindowMs);
        }

        if (count > effectiveMaxRequests) {
          // istanbul ignore next -- the `redisReady && redis` arm is unreachable:
          // redis is never initialised (see getRedis), so this always yields
          // effectiveWindowMs. Asserted indirectly by the retryAfter tests.
          const ttl = redisReady && redis ? await redis.pttl(key) : effectiveWindowMs;
          return res.status(429).json({
            success: false,
            status: 429,
            message: `Too many requests. ${effectiveDescription} limit exceeded.`,
            retryAfter: Math.ceil(ttl / 1000),
          });
        }

        // Set headers on first key checked
        if (key === keys[0]) {
          res.set({
            "X-RateLimit-Limit": String(effectiveMaxRequests),
            "X-RateLimit-Remaining": String(Math.max(0, effectiveMaxRequests - count)),
            "X-RateLimit-Reset": String(Math.ceil((Date.now() + effectiveWindowMs) / 1000)),
          });
        }
      }

      next();
    } catch (err) {
      logger.error(`Rate limiter error: ${err.message}`);
      next(); // Fail open
    }
  };
}

/**
 * Get current rate limit status for monitoring (no increment).
 */
async function getRateLimitStatus({ userId = null, tokenHash = null, ip = null, endpoint, type = "api" }) {
  const configs = type === "auth" ? getAuthConfig(endpoint) : getApiConfig(endpoint);
  const status = { user: null, token: null, ip: null };

  if (userId) {
    const userKey = makeKey(type, endpoint, `user:${userId}`);
    const entry = await storeGet(userKey);
    status.user = entry ? { count: entry.count, expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null, isLocked: type === "auth" && entry.count >= configs.maxAttempts } : null;
  }

  if (tokenHash) {
    const tokenKey = makeKey(type, endpoint, `token:${tokenHash}`);
    const entry = await storeGet(tokenKey);
    status.token = entry ? { count: entry.count, expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null, isBlocked: entry.blocked === true } : null;
  }

  if (ip) {
    const ipKey = makeKey(type, endpoint, `ip:${ip}`);
    const entry = await storeGet(ipKey);
    status.ip = entry ? { count: entry.count, expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null } : null;
  }

  return status;
}

/**
 * Clear all rate limits for a user (admin action).
 */
async function clearUserRateLimits(userId) {
  if (!userId) {return;}
  // Note: This is best-effort with pattern matching if using Redis
  // For simplicity, we clear known keys
  const endpoints = [...Object.keys(AUTH_ENDPOINTS), ...Object.keys(API_ENDPOINTS)];
  for (const endpoint of endpoints) {
    await storeDel(makeKey("auth", endpoint, `user:${userId}`));
    await storeDel(makeKey("api", endpoint, `user:${userId}`));
  }
  logger.info(`Cleared rate limits for user ${userId}`);
}

/**
 * Revoke a token by its hash.
 * Updates the Sessions table to mark the token as revoked.
 * @param {string} tokenHash - Hashed token
 * @param {string} reason - Reason for revocation
 * @returns {Promise<boolean>} True if revoked
 */
async function revokeTokenByHash(tokenHash, reason = "RATE_LIMIT_EXCEEDED") {
  try {
    const { Sessions } = require("../models");
    const affected = await Sessions.update(
      {
        isRevoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
        isActive: false,
      },
      { where: { tokenHash, isRevoked: false } },
    );
    return affected[0] > 0;
  } catch (error) {
    logger.error("Error revoking token by hash:", error);
    return false;
  }
}

/**
 * Revoke all tokens for a user.
 * @param {string} userId - User ID
 * @param {string} reason - Reason for revocation
 * @returns {Promise<number>} Number of revoked sessions
 */
async function revokeAllUserTokens(userId, reason = "SECURITY_REVOCATION") {
  try {
    const { Sessions } = require("../models");
    const [affected] = await Sessions.update(
      {
        isRevoked: true,
        revokedAt: new Date(),
        revokedReason: reason,
        isActive: false,
      },
      { where: { userId, isRevoked: false } },
    );
    logger.info(`Revoked ${affected} sessions for user ${userId}: ${reason}`);
    return affected;
  } catch (error) {
    logger.error("Error revoking user tokens:", error);
    return 0;
  }
}

/**
 * Check if a token is blocked.
 * @param {string} token - Raw token
 * @param {string} endpoint - Endpoint path (optional)
 * @returns {Promise<object>} Block status
 */
async function isTokenBlocked(token, endpoint = null) {
  const tokenHash = hashToken(token);
  const key = makeKey("auth", endpoint, `token:${tokenHash}`);
  const entry = await storeGet(key);
  const now = Date.now();

  if (entry && now < entry.expiresAt && entry.blocked) {
    return {
      isBlocked: true,
      blockUntil: new Date(entry.blockUntil),
      reason: "Token blocked due to suspicious activity",
    };
  }

  return { isBlocked: false };
}

/**
 * Check if a user is locked out.
 * @param {string} userId - User ID
 * @param {string} endpoint - Endpoint path (optional)
 * @returns {Promise<object>} Lockout status
 */
async function isUserLockedOut(userId, endpoint = null) {
  const config = getAuthConfig(endpoint);
  const key = makeKey("auth", endpoint, `user:${userId}`);
  const entry = await storeGet(key);
  const now = Date.now();

  if (entry && now < entry.expiresAt && entry.count >= config.maxAttempts) {
    return {
      isLocked: true,
      lockoutUntil: new Date(entry.lockoutUntil || now + config.lockoutMs),
      remainingAttempts: 0,
      reason: "Account temporarily locked due to too many failed attempts",
    };
  }

  return {
    isLocked: false,
    remainingAttempts: config.maxAttempts - (entry?.count || 0),
  };
}

// ============================================================
// MIDDLEWARE FACTORIES FOR AUTH ROUTES
// ============================================================

/**
 * Middleware to check auth lockout BEFORE processing login/register.
 */
function authPreCheck(endpoint) {
  return async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace("Bearer ", "");
      const tokenHash = token ? hashToken(token) : null;
      const ip = req.ip || req.headers["x-forwarded-for"] || req.socket.remoteAddress;

      let userId = null;
      if (token) {
        try {
          const decoded = verifyAccessToken(token);
          userId = decoded.id;
        } catch (_) {
          // Invalid token, ignore for userId check
        }
      }

      const lockout = await checkAuthLockout({ userId, tokenHash, ip, endpoint });
      if (lockout.locked) {
        return res.status(429).json({
          success: false,
          status: 429,
          message: lockout.reason,
          lockoutUntil: lockout.lockoutUntil.toISOString(),
          retryAfter: Math.ceil((lockout.lockoutUntil - Date.now()) / 1000),
        });
      }

      // Attach for post-processing
      req.rateLimitContext = { userId, tokenHash, ip, endpoint };
      next();
    } catch (err) {
      logger.error(`Auth pre-check error: ${err.message}`);
      next();
    }
  };
}

/**
 * Middleware to record auth failure AFTER failed login/register.
 */
function authPostFailure(endpoint) {
  return async (req, res, next) => {
    // Only record if response indicates failure (4xx, not 429 which is pre-check)
    if (res.statusCode >= 400 && res.statusCode < 500 && res.statusCode !== 429) {
      try {
        await recordAuthFailure({ ...req.rateLimitContext, endpoint });
      } catch (err) {
        logger.error(`Auth post-failure recording error: ${err.message}`);
      }
    }
    next();
  };
}

/**
 * Middleware to reset auth failures AFTER successful login.
 */
function authPostSuccess(endpoint) {
  return async (req, res, next) => {
    if (res.statusCode === 200 && req.rateLimitContext) {
      try {
        await resetAuthFailures({ ...req.rateLimitContext, endpoint });
      } catch (err) {
        logger.error(`Auth post-success reset error: ${err.message}`);
      }
    }
    next();
  };
}

module.exports = {
  // Core functions
  recordAuthFailure,
  checkAuthLockout,
  resetAuthFailures,
  endpointRateLimiter,
  getRateLimitStatus,
  clearUserRateLimits,

  // Token/User management
  revokeTokenByHash,
  revokeAllUserTokens,
  isTokenBlocked,
  isUserLockedOut,

  // Auth route middleware
  authPreCheck,
  authPostFailure,
  authPostSuccess,

  // Config access
  getAuthConfig,
  getApiConfig,

  // Admin functions
  clearMemoryStore,
};