const crypto = require("crypto");
const { AsyncLocalStorage } = require("async_hooks");
const { Op } = require("sequelize");

const { Sessions } = require("../models");
const redis = require("./redis.service");

const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

exports.hashToken = hashToken;

// ==========================================
// CREATE SESSION
// ==========================================

exports.createSession = async ({
  tenantId = null,
  userId,
  refreshToken,
  ipAddress,
  userAgent,
  device,
  expiredAt,
}) => {
  // Provide default expiredAt if not provided (7 days from now)
  const sessionExpiredAt =
    expiredAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  return await Sessions.create({
    tenant_id: tenantId,
    user_id: userId,

    token_hash: hashToken(refreshToken),

    ip_address: ipAddress,
    user_agent: userAgent,
    device,

    expired_at: sessionExpiredAt,
    last_activity_at: new Date(),
  });
};

// ==========================================
// VALIDATE SESSION
// ==========================================

exports.validateSession = async (refreshToken) => {
  const tokenHash = hashToken(refreshToken);

  const session = await Sessions.findOne({
    where: {
      token_hash: tokenHash,
      is_revoked: false,
      is_active: true,
    },
  });

  if (!session) {
    return null;
  }

  if (new Date(session.expired_at) <= new Date()) {
    await session.update({
      is_revoked: true,
      revoked_at: new Date(),
      revoked_reason: "SESSION_EXPIRED",
      is_active: false,
    });

    return null;
  }

  await session.update({
    last_activity_at: new Date(),
  });

  return session;
};

// ==========================================
// REVOKE SESSION
// ==========================================

exports.revokeSession = async (refreshToken, reason = "LOGOUT") => {
  const tokenHash = hashToken(refreshToken);

  return await Sessions.update(
    {
      is_revoked: true,
      revoked_at: new Date(),
      revoked_reason: reason,
      is_active: false,
    },
    {
      where: {
        token_hash: tokenHash,
      },
    },
  );
};

// ==========================================
// REVOKE ALL USER SESSIONS
// ==========================================

exports.revokeAllSessions = async (userId, reason = "LOGOUT_ALL") => {
  return await Sessions.update(
    {
      is_revoked: true,
      revoked_at: new Date(),
      revoked_reason: reason,
      is_active: false,
    },
    {
      where: {
        user_id: userId,
        is_revoked: false,
      },
    },
  );
};

// ==========================================
// ROTATE REFRESH TOKEN
// ==========================================

exports.rotateRefreshToken = async ({
  oldRefreshToken,
  newRefreshToken,
  expiredAt,
}) => {
  const session = await exports.validateSession(oldRefreshToken);

  if (!session) {
    return null;
  }

  await exports.revokeSession(oldRefreshToken, "TOKEN_ROTATION");

  return await exports.createSession({
    tenantId: session.tenant_id,
    userId: session.user_id,

    refreshToken: newRefreshToken,

    ipAddress: session.ip_address,
    userAgent: session.user_agent,
    device: session.device,

    expiredAt,
  });
};

// ==========================================
// CLEANUP EXPIRED SESSIONS
// ==========================================

exports.cleanupExpiredSessions = async () => {
  return await Sessions.destroy({
    where: {
      expired_at: {
        [Op.lt]: new Date(),
      },
    },
  });
};

// ==========================================
// SESSION LIVENESS (A-48)
// ==========================================
//
// An access token carries the id of the session it was issued with (`sid`).
// `auth.middleware.js` asks isSessionLive() on every request, so revoking a
// session — logout, an administrator's revoke, a password change, token
// rotation — stops its access token on the next request instead of when the
// token expires (JWT_ACCESS_EXPIRED, which is 1d on the running deployment).
//
// The answer is cached in Redis so a live session costs no database read per
// request. Invalidation is driven by the Session model's own hooks (registered
// below), so every revocation that goes through Sequelize clears the entry —
// including session.controller.js, which updates the model directly rather
// than calling this service.
//
// REDIS DOWN → the check falls through to the database. It does NOT fail open
// (the session is still checked, against the authoritative row) and it does
// NOT fail closed (a Redis outage must not become an outage for every signed-in
// user). The cost is one primary-key read per request while Redis is away.
//
// The TTL bounds what invalidation cannot reach: a revocation made while this
// process could not reach Redis (del() is a no-op then, and the entry is still
// there when the connection returns), a write that bypasses model hooks (raw
// SQL, `hooks: false` as in Session#softDelete), and the read/revoke race where
// a request populates the cache from a row read an instant before it was
// revoked. In each case the stale answer lives at most this long.

const SESSION_LIVENESS_TTL_SECONDS = 60;

exports.SESSION_LIVENESS_TTL_SECONDS = SESSION_LIVENESS_TTL_SECONDS;

const livenessKey = (sessionId) => `session:live:${sessionId}`;

exports.livenessKey = livenessKey;

/**
 * Read the session row that decides liveness — by primary key, snake_case
 * columns, bypassing tenant scoping (the id comes from a server-signed token,
 * and the check runs before any tenant context exists).
 *
 * @param {string} sessionId
 * @returns {Promise<{userId: string, expiresAt: number} | {revoked: true}>}
 */
const readLivenessFromDb = async (sessionId) => {
  const row = await Sessions.findOne({
    where: { id: sessionId, is_revoked: false, is_active: true },
    attributes: ["id", "user_id", "expired_at"],
    skipTenantScope: true,
  });
  if (!row) {
    return { revoked: true };
  }
  return {
    userId: row.user_id,
    expiresAt: new Date(row.expired_at).getTime(),
  };
};

/**
 * Whether the session an access token names is still usable by that user.
 *
 * @param {string} sessionId - the token's `sid` claim
 * @param {string} userId - the token's `id` claim
 * @returns {Promise<boolean>}
 */
exports.isSessionLive = async (sessionId, userId) => {
  const key = livenessKey(sessionId);
  let entry = await redis.get(key);

  if (!entry || typeof entry !== "object") {
    entry = await readLivenessFromDb(sessionId);
    const remaining = entry.revoked
      ? SESSION_LIVENESS_TTL_SECONDS
      : Math.ceil((entry.expiresAt - Date.now()) / 1000);
    if (remaining > 0) {
      await redis.set(
        key,
        entry,
        Math.min(SESSION_LIVENESS_TTL_SECONDS, remaining),
      );
    }
  }

  return (
    !entry.revoked &&
    String(entry.userId) === String(userId) &&
    entry.expiresAt > Date.now()
  );
};

/**
 * Drop the cached liveness of these sessions.
 *
 * @param {Array<string>} sessionIds
 * @returns {Promise<void>}
 */
const invalidateLiveness = async (sessionIds) => {
  await Promise.all(sessionIds.map((id) => redis.del(livenessKey(id))));
};

exports.invalidateLiveness = invalidateLiveness;

/**
 * Run `fn` after the surrounding transaction commits, or now if there is none.
 * Clearing the entry before commit would let a concurrent request re-cache the
 * row as it was before the uncommitted revocation.
 */
const afterCommit = (options, fn) => {
  const transaction = options && options.transaction;
  if (transaction && typeof transaction.afterCommit === "function") {
    transaction.afterCommit(() => fn());
    return undefined;
  }
  return fn();
};

// Session ids a bulk update is about to touch, captured before the UPDATE runs:
// afterwards a `where: { user_id, is_revoked: false }` no longer matches them.
const pendingBulkIds = new WeakMap();

/**
 * Register the hooks that keep the liveness cache honest. Idempotent (named
 * hooks replace themselves).
 *
 * @param {object} model - the Session model
 * @returns {boolean} whether the hooks were registered
 */
const registerLivenessInvalidation = (model) => {
  if (!model || typeof model.addHook !== "function") {
    return false;
  }

  const onInstance = (instance, options) =>
    afterCommit(options, () => invalidateLiveness([instance.id]));

  model.addHook("afterUpdate", "sessionLivenessUpdate", onInstance);
  model.addHook("afterDestroy", "sessionLivenessDestroy", onInstance);

  model.addHook("beforeBulkUpdate", "sessionLivenessCapture", async (options) => {
    const rows = await model.unscoped().findAll({
      where: options.where,
      attributes: ["id"],
      transaction: options.transaction,
      skipTenantScope: true,
      raw: true,
    });
    pendingBulkIds.set(
      options,
      rows.map((row) => row.id),
    );
  });

  model.addHook("afterBulkUpdate", "sessionLivenessBulk", (options) => {
    const ids = pendingBulkIds.get(options) || [];
    pendingBulkIds.delete(options);
    return afterCommit(options, () => invalidateLiveness(ids));
  });

  return true;
};

exports.registerLivenessInvalidation = registerLivenessInvalidation;

registerLivenessInvalidation(Sessions);

// ==========================================
// REVOKE SESSION BY ID
// ==========================================

/**
 * Revoke one session by its id — the `sid` an access token carries.
 *
 * @param {string} sessionId
 * @param {string} [reason="LOGOUT"]
 */
exports.revokeSessionById = async (sessionId, reason = "LOGOUT") => {
  return await Sessions.update(
    {
      is_revoked: true,
      revoked_at: new Date(),
      revoked_reason: reason,
      is_active: false,
    },
    {
      // The id is taken from a server-signed token, and a tenant-less
      // principal's scope would otherwise match NO_TENANT_UUID and revoke
      // nothing.
      where: { id: sessionId, is_revoked: false },
      skipTenantScope: true,
    },
  );
};

// ==========================================
// REQUEST SESSION CONTEXT
// ==========================================
//
// The session the current request authenticated with, for code that is not
// handed `req` (POST /auth/logout calls authService.logoutSession() with no
// arguments).

const sessionContext = new AsyncLocalStorage();

/**
 * @param {string|null} sessionId
 * @param {Function} fn
 */
exports.runWithSession = (sessionId, fn) =>
  sessionContext.run({ sessionId }, fn);

/**
 * @returns {string|null}
 */
exports.getCurrentSessionId = () => {
  const store = sessionContext.getStore();
  return (store && store.sessionId) || null;
};
