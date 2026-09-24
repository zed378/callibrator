/**
 * Redis-Backed Rate Limiter Service
 *
 * Single canonical rate limiter for the application.
 * Supports both auth brute-force protection (with lockout) and API request quotas.
 *
 * Storage is the SHARED ioredis client from `redis.service` whenever it is
 * ready; the in-process Map is a fallback for a Redis outage only. Read the
 * fallback-policy note below before changing either arm.
 */

const { logger } = require("../middlewares/activityLog.middleware");
const { getRedisConnection } = require("./redis.service");
const {
  AUTH_ENDPOINTS,
  API_ENDPOINTS,
  getAuthConfig,
  getApiConfig,
  makeKey,
} = require("../constants/rateLimitConstants");
const { hashToken } = require("../utils/session.util");
const { verifyAccessToken, verifyPurposeToken } = require("../utils/jwt.util");
const { Users } = require("../models");

// ============================================================
// REDIS CLIENT — the shared one, never a second one
// ============================================================

/**
 * The shared ioredis client when it can serve commands, otherwise null.
 *
 * A-30: this service used to build its own client inside a `getRedis()` that
 * was neither exported nor called, so `redisReady` was never true and every
 * counter lived in the in-process Map — lockouts reset on every deploy and
 * each replica enforced its own copy of the limit. It now follows the one
 * client `index.js` connects at startup through `initRedis()`.
 *
 * Readiness is `client.status === "ready"`. ioredis has NO `connected`
 * property — that was node-redis v3, and guarding on it is exactly what made
 * every redis.service helper a silent no-op until 2026-09-21. Do not
 * reintroduce it.
 *
 * Commands are never issued from a non-ready client: the shared client is
 * created with `lazyConnect`, so a command would dial out from whichever
 * process happened to touch the limiter first.
 *
 * @returns {import("ioredis").Redis | null}
 */
function readyRedis() {
  try {
    const client = getRedisConnection();
    return client && client.status === "ready" ? client : null;
  } catch (err) {
    logger.warn(`Rate limiter could not reach the shared Redis client: ${err.message}`);
    return null;
  }
}

/**
 * The caller's address for a per-IP key: `req.ip`, else the socket's. Never a
 * request header (see THE IP IDENTIFIER below).
 *
 * @param {{ip?: string, socket?: {remoteAddress?: string}}} req
 * @returns {string|undefined}
 */
function clientAddress(req) {
  return req.ip || req.socket?.remoteAddress;
}

// ============================================================
// KEY DESIGN, AND WHAT HAPPENS WHEN REDIS IS DOWN
// ============================================================

// KEYS — `makeKey()` yields `ratelimit:<type>:<endpoint>:<identifier>`, where
// the identifier is a user id, a token hash or a client IP. There is no
// process, host or replica component, which is the point: every replica
// increments the same key. The window is the key's TTL, written atomically by
// the same script that increments the counter, and — exactly as the in-memory
// fallback has always done — each increment refreshes it, so the window is
// sliding: a counter only clears after a full quiet window. `firstAttempt` is
// preserved across increments, so the lockout end a caller reports stays
// anchored to the first failure rather than to the latest one.
//
// THE IP IDENTIFIER is `req.ip`, and only `req.ip` (A-16). Express derives it
// from X-Forwarded-For under a one-hop `trust proxy` (TRUST_PROXY_HOPS), and
// every proxy adjacent to the backend sends exactly one entry, the client
// address resolved at the edge (deploy/compose/nginx/*.conf, frontend
// src/lib/clientIp.ts). A raw X-Forwarded-For is never read here: it is the
// one header a client can write, so falling back to it would let a caller
// choose its own bucket. When req.ip is absent the socket address is used.
//
// Per-IP FAILURE counting is still switched off unless AUTH_RATE_LIMIT_BY_IP
// is "true" (noteAuthFailure). Turn it on for a deployment only after its
// stored session IPs have been seen to be real client addresses — until then
// req.ip may be one proxy address shared by every browser, and a per-IP lock
// would lock everyone. The per-user and per-token keys do not depend on it.
//
// OUTAGE POLICY — fail over to memory, never fail open. If Redis is not ready,
// or a command throws mid-flight, the counter is kept in this process's Map
// instead. A request is therefore never silently un-rate-limited because Redis
// blinked: it is still counted, just no longer counted globally.
//
// What that costs during an outage: counters are per process again, so with N
// replicas the effective limit is N x the configured one, and counts taken
// while Redis was down are not merged back when it returns. We take that over
// the alternatives. Failing CLOSED on a read — treating "Redis said nothing"
// as "locked" — turns a cache hiccup into a total authentication outage for
// every tenant. Failing OPEN — skipping the limit — hands an attacker the
// whole point of the control, since brute force then only requires waiting for
// a Redis blip. Degraded-but-counting is the only one of the three that is
// wrong in a bounded way.
//
// The single remaining fail-open is `endpointRateLimiter`'s outer catch, which
// calls next(). Every store operation now handles its own Redis failure, so
// that catch only sees programming errors — and it logs them.

// ============================================================
// IN-MEMORY FALLBACK (Redis outage only)
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

// ============================================================
// UNIFIED STORAGE INTERFACE
// ============================================================

/**
 * Atomic counter increment, as ONE round trip.
 *
 * Read-then-write across two commands loses increments whenever two replicas
 * (or two requests on one replica) interleave, which is precisely the case the
 * limiter exists for. INCR + a separate PEXPIRE is atomic per command but not
 * as a pair: a process that dies between them leaves a counter with no TTL,
 * i.e. a lockout that never expires. The script does both under Redis's single
 * execution thread.
 *
 * It writes the same shape the memory store writes — `{ count, firstAttempt,
 * expiresAt }` — so callers that read `entry.expiresAt` (isTokenBlocked,
 * isUserLockedOut, getRateLimitStatus) behave identically on either backend.
 * KEYS[1] = key, ARGV[1] = ttl in ms, ARGV[2] = now in ms.
 * Returns the PREVIOUS raw value ("" when the key was absent) so the caller
 * can see flags such as `revoked` exactly as the read-then-write did.
 */
const INCR_ENTRY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local ttl = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local count = 1
local firstAttempt = now
if raw then
  local ok, previous = pcall(cjson.decode, raw)
  if ok and type(previous) == 'table' then
    count = (previous.count or 0) + 1
    firstAttempt = previous.firstAttempt or now
  else
    -- Something that is not one of our entries is sitting on this key. Treat
    -- it as absent and take it over: raising here would make this key fail
    -- every request back to the per-process Map, silently and forever.
    raw = false
  end
end
redis.call('SET', KEYS[1],
  cjson.encode({ count = count, firstAttempt = firstAttempt, expiresAt = now + ttl }),
  'PX', ttl)
return raw or ''
`;

async function storeGet(key) {
  const client = readyRedis();
  if (client) {
    try {
      const data = await client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      logger.warn(`Rate limiter Redis GET failed, reading the memory fallback: ${err.message}`);
    }
  }
  return memoryGet(key);
}

async function storeSet(key, value, ttlMs) {
  const entry = { ...value, expiresAt: Date.now() + ttlMs };
  const client = readyRedis();
  if (client) {
    try {
      await client.set(key, JSON.stringify(entry), "PX", ttlMs);
      return;
    } catch (err) {
      logger.warn(`Rate limiter Redis SET failed, counting in memory: ${err.message}`);
    }
  }
  memorySet(key, value, ttlMs);
}

async function storeDel(key) {
  const client = readyRedis();
  if (client) {
    try {
      await client.del(key);
    } catch (err) {
      logger.warn(`Rate limiter Redis DEL failed: ${err.message}`);
    }
  }
  // Always clear the local copy too: a counter may have been recorded here
  // while Redis was down, and a reset that leaves it behind keeps a user
  // locked out of their own account after a successful login.
  memoryDel(key);
}

/**
 * Increment the counter at `key` and return the entry as it was BEFORE the
 * increment, together with the new count.
 *
 * @param {string} key
 * @param {number} ttlMs
 * @param {number} now
 * @returns {Promise<{ previous: object|null, count: number }>}
 */
async function storeIncrEntry(key, ttlMs, now = Date.now()) {
  const client = readyRedis();
  if (client) {
    try {
      const raw = await client.eval(INCR_ENTRY_SCRIPT, 1, key, String(ttlMs), String(now));
      const previous = raw ? JSON.parse(raw) : null;
      return { previous, count: (previous?.count || 0) + 1 };
    } catch (err) {
      logger.warn(`Rate limiter Redis INCR failed, counting in memory: ${err.message}`);
    }
  }
  const previous = memoryGet(key);
  const count = (previous?.count || 0) + 1;
  memorySet(key, { count, firstAttempt: previous?.firstAttempt || now }, ttlMs);
  return { previous, count };
}

async function storeIncr(key, ttlMs) {
  const { count } = await storeIncrEntry(key, ttlMs);
  return count;
}

/**
 * Milliseconds left on a key's window, for the Retry-After hint.
 * Redis answers -1 (no TTL) or -2 (no key) rather than throwing; both mean we
 * have nothing better to offer than the configured window.
 */
async function storeTtl(key, fallbackMs) {
  const client = readyRedis();
  if (client) {
    try {
      const ttl = await client.pttl(key);
      return ttl > 0 ? ttl : fallbackMs;
    } catch (err) {
      logger.warn(`Rate limiter Redis PTTL failed: ${err.message}`);
    }
  }
  // The memory fallback refreshes the window on every increment, so the
  // configured window IS the time left on the counter we just wrote.
  return fallbackMs;
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
async function recordAuthFailure({ userId = null, tokenHash = null, ip = null, alsoByIp = false, endpoint }) {
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
    const ttlMs = config.windowMs;
    // One atomic round trip: two replicas failing the same account at the same
    // moment used to read the same count and each write count+1, losing a
    // failure and pushing the lockout out by one attempt per collision.
    const { count } = await storeIncrEntry(userKey, ttlMs, now);
    results.remainingAttempts = Math.max(0, config.maxAttempts - count);

    if (count >= config.maxAttempts) {
      results.allowed = false;
      results.lockoutUntil = new Date(now + config.lockoutMs);
      results.lockoutReason = `Too many failed attempts on ${config.description}`;
    }

    // Persist lockout to DB — the sign-in lock. Not for an endpoint whose
    // lock must stay its own (A-142, `persistUserLockout: false`).
    if (count >= config.maxAttempts && config.persistUserLockout !== false) {
      try {
        await Users.update(
          { failedLoginAttempts: count, lockedUntil: results.lockoutUntil },
          { where: { id: userId } },
        );
      } catch (err) {
        logger.error(`Failed to persist user lockout: ${err.message}`);
      }
    }
  }

  // ---- TOKEN-BASED TRACKING (revokes token on brute force) ----
  if (tokenHash) {
    const tokenKey = makeKey("auth", endpoint, `token:${tokenHash}`);
    const ttlMs = config.windowMs;

    const { previous: entry, count } = await storeIncrEntry(tokenKey, ttlMs, now);
    // Resolved once, here, where `entry` really can be absent — the later
    // writes reuse it instead of repeating a `|| now` fallback that can never
    // be taken (count >= 3 implies a prior entry) and so could never be tested.
    const firstAttempt = entry?.firstAttempt || now;

    // Track remaining attempts for token
    results.remainingAttempts = Math.max(0, config.maxAttempts - count);

    // Revoke token after 3 failures with same token (on 3rd failure)
    if (count >= 3 && !entry?.revoked) {
      await storeSet(tokenKey, { count, revoked: true, firstAttempt }, ttlMs);
      logger.warn(`Token revoked due to brute force on ${endpoint}`, { tokenHash });
    }

    // Return revokedToken on the call after revocation (4th failure when count=3 triggered revocation)
    if (count >= 4 && entry?.revoked) {
      results.revokedToken = tokenHash;
    }

    // Hard block after 2x maxAttempts
    if (count >= config.maxAttempts * 2) {
      const blockUntil = now + 24 * 60 * 60 * 1000; // 24h
      await storeSet(tokenKey, { count, blocked: true, blockUntil, firstAttempt }, ttlMs);
      results.allowed = false;
      results.lockoutUntil = new Date(blockUntil);
      results.lockoutReason = "Token blocked due to excessive failed attempts";
    }
  }

  // ---- IP-BASED ----
  // A fallback for a caller with no user or token — unless the endpoint asks
  // for the address to be counted as well (`alsoByIp`, A-81: /mfa/login always
  // has a token, and a fresh token costs an attacker only the password).
  if (ip && (alsoByIp || (!userId && !tokenHash))) {
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
async function checkAuthLockout({ userId = null, tokenHash = null, ip = null, alsoByIp = false, endpoint }) {
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

  if (ip && (alsoByIp || (!userId && !tokenHash))) {
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
  }
  // A success on an endpoint that never writes the sign-in lock must not
  // clear it either (A-142).
  if (userId && getAuthConfig(endpoint).persistUserLockout !== false) {
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
        const ip = clientAddress(req);
        keys.push(makeKey("api", endpointKey, `ip:${ip}`));
      }

      // Check all keys; if ANY exceeds limit, reject
      for (const key of keys) {
        // storeIncr writes the counter and its TTL in one atomic operation;
        // the "first request in window, set TTL" follow-up write this used to
        // do was the non-atomic half of the pair and is gone.
        const count = await storeIncr(key, effectiveWindowMs);

        if (count > effectiveMaxRequests) {
          const ttl = await storeTtl(key, effectiveWindowMs);
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
      const ip = clientAddress(req);

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
 * A-81 — the lockout check for POST /auth/mfa/login.
 *
 * The second factor was unthrottled: a 6-digit TOTP has 10^6 values, the MFA
 * token lives five minutes, and a fresh token costs only the password — so a
 * stolen password and an unlimited endpoint defeated the second factor.
 *
 * authPreCheck cannot serve here: it reads the principal from an
 * Authorization header, and the MFA token travels in the body. This reads it
 * from there and keys the attempt three ways:
 *   - the USER the token names — the one that matters, because minting a new
 *     token does not reset it. It locks at `mfaLogin.maxAttempts` failures,
 *     and recordAuthFailure then also writes users.locked_until, which
 *     loginMfa and loginUser both honour (A-83);
 *   - the TOKEN — revoked after three failures, as on every auth endpoint;
 *   - the ADDRESS, when AUTH_RATE_LIMIT_BY_IP is on (`alsoByIp`), so one
 *     source cannot spread its guesses across many accounts.
 * The handler records the outcome (auth.controller.js `withAuthOutcome`).
 *
 * @returns {import("express").RequestHandler}
 */
function mfaLoginPreCheck() {
  const endpoint = "mfaLogin";
  return async (req, res, next) => {
    try {
      const token = typeof req.body?.token === "string" ? req.body.token : null;
      const tokenHash = token ? hashToken(token) : null;
      const ip = clientAddress(req);

      let userId = null;
      if (token) {
        try {
          userId = verifyPurposeToken(token, "mfa").id || null;
        } catch (_) {
          // An invalid token names no user; it is still counted by its hash.
        }
      }

      const context = { userId, tokenHash, ip, alsoByIp: true, endpoint };
      const lockout = await checkAuthLockout(context);
      if (lockout.locked) {
        return res.status(429).json({
          success: false,
          status: 429,
          message: lockout.reason,
          lockoutUntil: lockout.lockoutUntil.toISOString(),
          retryAfter: Math.ceil((lockout.lockoutUntil - Date.now()) / 1000),
        });
      }

      req.rateLimitContext = context;
      next();
    } catch (err) {
      logger.error(`MFA login pre-check error: ${err.message}`);
      next();
    }
  };
}

/**
 * A-142 — the lockout check for the SIGNED-IN MFA endpoints: POST
 * /auth/mfa/setup, /auth/mfa/verify and /auth/mfa/disable.
 *
 * Each checks a code (and setup-as-rotation and disable a password) for
 * whoever holds the session, and none was throttled: a stolen session could
 * guess the current code for a rotation or a disable without limit. Mounted
 * AFTER `auth`, so the principal is the authenticated user (`req.user.id`) —
 * never a body field. Keys:
 *   - the USER — one `mfaManage` bucket across all three endpoints;
 *   - the ADDRESS, only when AUTH_RATE_LIMIT_BY_IP is "true" (see THE IP
 *     IDENTIFIER): until a deployment's req.ip is known to be the client, a
 *     per-IP lock could lock every user behind one proxy address.
 * There is no per-token key: the access token is the session, and the user
 * key already covers every session of that user.
 *
 * The handler records the outcome (auth.controller.js `withAuthOutcome`).
 *
 * @returns {import("express").RequestHandler}
 */
function mfaManagePreCheck() {
  const endpoint = "mfaManage";
  return async (req, res, next) => {
    try {
      const context = {
        userId: req.user?.id || null,
        tokenHash: null,
        ip: process.env.AUTH_RATE_LIMIT_BY_IP === "true" ? clientAddress(req) : null,
        alsoByIp: true,
        endpoint,
      };
      const lockout = await checkAuthLockout(context);
      if (lockout.locked) {
        return res.status(429).json({
          success: false,
          status: 429,
          message: "Too many failed MFA attempts. Try again later.",
          lockoutUntil: lockout.lockoutUntil.toISOString(),
          retryAfter: Math.ceil((lockout.lockoutUntil - Date.now()) / 1000),
        });
      }

      req.rateLimitContext = context;
      next();
    } catch (err) {
      logger.error(`MFA management pre-check error: ${err.message}`);
      next();
    }
  };
}

// A-67 — RECORDING THE OUTCOME
//
// This used to be two middlewares, `authPostFailure` mounted BEFORE the
// controller and `authPostSuccess` mounted AFTER it. The first ran while the
// status was still 200, so it never saw a failure; the second sat behind a
// controller that sends the response and never calls next(), so it never ran.
// Every auth lockout this service implements was therefore a no-op on login,
// register, send-OTP and reset-password.
//
// The outcome is now recorded by the handler itself (auth.controller.js
// `withAuthOutcome`, sso.controller.js ssoExchange), which is the only code
// that knows the outcome — and it records a failure BEFORE the error response
// is sent, so a client cannot learn the result of attempt N and send attempt
// N+1 ahead of the count.

/**
 * Count a failed attempt against whatever authPreCheck attached to the request.
 * Never throws: a limiter fault must not turn a 401 into a 500.
 *
 * @param {object} req - carries `rateLimitContext` from authPreCheck
 * @param {string} endpoint - AUTH_ENDPOINTS key
 * @returns {Promise<void>}
 */
async function noteAuthFailure(req, endpoint) {
  try {
    // A-67 / A-16: until a deployment's req.ip is known to be the client
    // (see THE IP IDENTIFIER above), it may be one proxy address shared by
    // every browser, and a per-IP count would let anyone lock login for
    // everyone. Count by IP only where AUTH_RATE_LIMIT_BY_IP says so.
    const context = { ...req.rateLimitContext };
    if (process.env.AUTH_RATE_LIMIT_BY_IP !== "true") {
      context.ip = null;
    }
    await recordAuthFailure({ ...context, endpoint });
  } catch (err) {
    logger.error(`Auth failure recording error on ${endpoint}: ${err.message}`);
  }
}

/**
 * Clear the per-user and per-token counters after a success. The per-IP
 * counter is deliberately NOT cleared (resetAuthFailures takes no ip): one
 * valid account must not buy an address a fresh budget of guesses against
 * every other account.
 *
 * @param {object} req - carries `rateLimitContext` from authPreCheck
 * @param {string} endpoint - AUTH_ENDPOINTS key
 * @returns {Promise<void>}
 */
async function noteAuthSuccess(req, endpoint) {
  if (!req.rateLimitContext) {
    return;
  }
  try {
    await resetAuthFailures({ ...req.rateLimitContext, endpoint });
  } catch (err) {
    logger.error(`Auth success reset error on ${endpoint}: ${err.message}`);
  }
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
  mfaLoginPreCheck,
  mfaManagePreCheck,
  noteAuthFailure,
  noteAuthSuccess,

  // Config access
  getAuthConfig,
  getApiConfig,

  // Admin functions
  clearMemoryStore,
};
