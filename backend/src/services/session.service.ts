/**
 * Refresh-token sessions: create, validate, rotate, revoke; the liveness check
 * every authenticated request makes (A-48); the per-request session context.
 *
 * P9-12 (ADR-087 Amendment 13): converted from session.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order), and the functions that called their siblings
 * through `exports.` call them through that object, so a spy on the module still
 * intercepts them.
 */
import { createHash } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { Op, type InferAttributes, type InferCreationAttributes, type Transaction, type UpdateOptions, type WhereOptions } from "sequelize";

import models from "../models";
import redis from "./redis.service";
import { runAsSystem, SYSTEM_TASKS } from "../utils/jobContext.util";
import { env } from "../config/env";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { Sessions } = models;

type SessionRow = ModelInstance<"Session">;

const hashToken = (token: string): string => {
  return createHash("sha256").update(token).digest("hex");
};

// ==========================================
// CREATE SESSION
// ==========================================

/** What createSession records. */
interface CreateSessionInput {
  tenantId?: TenantId | null;
  userId: UserId;
  refreshToken: string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  device?: string | null | undefined;
  expiredAt?: Date | null | undefined;
  impersonatorId?: UserId | null;
  authMethod?: string | null;
}

const createSession = async ({
  tenantId = null,
  userId,
  refreshToken,
  ipAddress,
  userAgent,
  device,
  expiredAt,
  impersonatorId = null,
  authMethod = null,
}: CreateSessionInput): Promise<SessionRow> => {
  // Provide default expiredAt if not provided (7 days from now)
  const sessionExpiredAt =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
    expiredAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // As built: ip_address / user_agent / device may be undefined (a caller that omits them).
  const values = {
    tenant_id: tenantId,
    user_id: userId,
    // A-146: an impersonation session records its operator, so a refresh can
    // re-issue the `impersonatorId` claim. Absent (NULL) on every other one.
    ...(impersonatorId ? { impersonator_id: impersonatorId } : {}),
    // A-160: "saml" / "oidc" for an SSO session (migration 0052).
    ...(authMethod ? { auth_method: authMethod } : {}),

    token_hash: hashToken(refreshToken),

    ip_address: ipAddress,
    user_agent: userAgent,
    device,

    expired_at: sessionExpiredAt,
    last_activity_at: new Date(),
  };
  return await Sessions.create(values as InferCreationAttributes<SessionRow>);
};

// ==========================================
// VALIDATE SESSION
// ==========================================

const validateSession = async (refreshToken: string): Promise<SessionRow | null> => {
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

const revokeSession = async (refreshToken: string, reason = "LOGOUT"): Promise<[affectedCount: number]> => {
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

/**
 * Revoke every live session of one user.
 *
 * A-161: `skipTenantScope`, with the user id as the only predicate. Without
 * it the global tenant hooks AND-ed the CALLER's tenant onto the WHERE, so
 * the revocation silently missed sessions:
 *  - a principal with no tenant that is not a super admin resolves to "deny"
 *    (NO_TENANT_UUID) — its logout-all and password change revoked NOTHING;
 *  - a session row whose `tenant_id` is not the caller's current tenant — a
 *    NULL written before sessions carried a tenant, or a user since moved to
 *    another tenant — survived the caller's own "sign out everywhere" and
 *    password change.
 * The id is always server-derived (the authenticated caller, the owner of a
 * refresh token just validated, or an e-mail-code reset's own account), so
 * dropping the tenant predicate never widens the update beyond that one
 * user: `user_id` stays in the WHERE.
 *
 * @param userId - whose sessions (a missing id is refused)
 * @param reason - sessions.revoked_reason
 * @returns Sequelize's update result
 */
const revokeAllSessions = async (
  userId: UserId | null | undefined,
  reason = "LOGOUT_ALL",
): Promise<[affectedCount: number]> => {
  if (userId === undefined || userId === null || userId === "") {
    // Now that the tenant predicate is gone, `user_id` is the ONLY thing
    // narrowing this UPDATE. Refuse a missing id outright rather than rely on
    // what the driver makes of it (Sequelize 6 turns null into IS NULL and
    // throws on undefined) — a caller that lost its user id is a bug to see.
    throw new Error("revokeAllSessions: a user id is required");
  }
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
      skipTenantScope: true,
    },
  );
};

// ==========================================
// REVOKE EVERY SESSION BUT ONE (A-141)
// ==========================================

/**
 * Revoke every live session of `userId` except `keepSessionId` — the one the
 * caller is using. Replacing or disabling an authenticator must sign out
 * whoever else holds a session: if the change is a response to a stolen
 * phone or a stolen session, the thief's session is exactly the one to end.
 *
 * `skipTenantScope`: the user id is server-derived (the authenticated caller,
 * or a user an administrator's tenant-scoped lookup already returned); a
 * tenant-less principal's scope would otherwise match NO_TENANT_UUID and
 * revoke nothing.
 *
 * @param userId - whose sessions
 * @param keepSessionId - null revokes every session
 * @param reason - sessions.revoked_reason
 * @param options - `{ transaction }`
 * @returns how many sessions were revoked
 */
const revokeOtherSessions = async (
  userId: UserId,
  keepSessionId: string | null,
  reason: string,
  { transaction }: { transaction?: Transaction | undefined } = {},
): Promise<number> => {
  const where: { user_id: UserId; is_revoked: boolean; id?: { [Op.ne]: string } } = {
    user_id: userId,
    is_revoked: false,
  };
  if (keepSessionId) {
    where.id = { [Op.ne]: keepSessionId };
  }
  // `transaction` stays undefined when absent (null would switch off the CLS
  // transaction), so the options are typed through a variable, as before.
  const options: { where: WhereOptions; transaction: Transaction | undefined; skipTenantScope: boolean } = {
    where,
    transaction,
    skipTenantScope: true,
  };
  const [affected] = await Sessions.update(
    {
      is_revoked: true,
      revoked_at: new Date(),
      revoked_reason: reason,
      is_active: false,
    },
    options as UpdateOptions<InferAttributes<SessionRow>>,
  );
  return affected;
};

// ==========================================
// ROTATE REFRESH TOKEN
// ==========================================

/** What rotateRefreshToken takes. */
interface RotateRefreshTokenInput {
  oldRefreshToken: string;
  newRefreshToken: string;
  expiredAt?: Date | null | undefined;
}

const rotateRefreshToken = async ({
  oldRefreshToken,
  newRefreshToken,
  expiredAt,
}: RotateRefreshTokenInput): Promise<SessionRow | null> => {
  const session = await service.validateSession(oldRefreshToken);

  if (!session) {
    return null;
  }

  await service.revokeSession(oldRefreshToken, "TOKEN_ROTATION");

  return await service.createSession({
    tenantId: session.tenant_id,
    userId: session.user_id,

    refreshToken: newRefreshToken,

    ipAddress: session.ip_address,
    userAgent: session.user_agent,
    device: session.device,
    // A-160: a rotation keeps how the session signed in.
    authMethod: session.auth_method,

    expiredAt,
  });
};

// ==========================================
// CLEANUP EXPIRED SESSIONS
// ==========================================

/** Expired sessions deleted per statement (W-17). */
const CLEANUP_BATCH_SIZE = Number(env("SESSION_CLEANUP_BATCH_SIZE")) || 1000;
/** Once a run has spent this long, it stops after its current batch (W-17). */
const CLEANUP_BUDGET_MS = Number(env("SESSION_CLEANUP_BUDGET_MS")) || 60 * 1000;

/** cleanupExpiredSessions' options. */
interface CleanupOptions {
  now?: Date;
  batchSize?: number;
  budgetMs?: number;
}

/**
 * Delete expired sessions, in bounded batches.
 *
 * W-12: an explicit platform context (SYSTEM_TASKS.SESSION_CLEANUP). Expiry
 * does not depend on the tenant, and a platform operator's session has no
 * tenant at all, so the job spans tenants and says so.
 *
 * W-17: one `DELETE ... WHERE id IN (SELECT id ... LIMIT n)` per batch instead
 * of one unbounded DELETE, and the run stops once `budgetMs` has passed. What
 * is left is deleted by the next run; an expired session is refused at use
 * (isSessionLive) whether or not its row is gone.
 *
 * Not audited (ADR-051 Q-13): session sweeps are named there as out of scope.
 *
 * @param opts - `{ now, batchSize, budgetMs }`
 * @returns how many were deleted
 */
const cleanupExpiredSessions = async ({
  now = new Date(),
  batchSize = CLEANUP_BATCH_SIZE,
  budgetMs = CLEANUP_BUDGET_MS,
}: CleanupOptions = {}): Promise<number> =>
  runAsSystem(SYSTEM_TASKS.SESSION_CLEANUP, async () => {
    const deadline = Date.now() + budgetMs;
    let total = 0;
    for (;;) {
      const deleted = await Sessions.destroy({
        where: { expired_at: { [Op.lt]: now } },
        limit: batchSize,
      });
      total += deleted;
      if (deleted < batchSize || Date.now() >= deadline) {
        return total;
      }
    }
  });

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

const livenessKey = (sessionId: string): string => `session:live:${sessionId}`;

/** A liveness answer, as read from the row and as cached in Redis. */
type LivenessEntry = { revoked: true } | { revoked?: never; userId: UserId; expiresAt: number };

/**
 * Read the session row that decides liveness — by primary key, snake_case
 * columns, bypassing tenant scoping (the id comes from a server-signed token,
 * and the check runs before any tenant context exists).
 *
 * @param sessionId - the session's id
 * @returns the owner and expiry, or `{ revoked: true }`
 */
const readLivenessFromDb = async (sessionId: string): Promise<LivenessEntry> => {
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
 * @param sessionId - the token's `sid` claim
 * @param userId - the token's `id` claim
 * @returns whether the session is live and belongs to that user
 */
const isSessionLive = async (sessionId: string, userId: unknown): Promise<boolean> => {
  const key = livenessKey(sessionId);
  const cached = await redis.get(key);
  let entry: LivenessEntry;

  if (!cached || typeof cached !== "object") {
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
  } else {
    // An object under this key is one this function cached (the branch above).
    entry = cached as LivenessEntry;
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
 * @param sessionIds - the sessions whose entries go
 * @returns when every delete has been attempted
 */
const invalidateLiveness = async (sessionIds: readonly string[]): Promise<void> => {
  await Promise.all(sessionIds.map((id) => redis.del(livenessKey(id))));
};

/** The options a Sequelize hook receives, as far as these hooks read them. */
interface HookOptions {
  where?: unknown;
  transaction?: { afterCommit?: unknown } | null;
}

/**
 * Run `fn` after the surrounding transaction commits, or now if there is none.
 * Clearing the entry before commit would let a concurrent request re-cache the
 * row as it was before the uncommitted revocation.
 */
const afterCommit = (
  options: HookOptions | null | undefined,
  fn: () => Promise<void>,
): Promise<void> | undefined => {
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: `options && options.transaction`
  const transaction = options && options.transaction;
  if (transaction && typeof transaction.afterCommit === "function") {
    (transaction as Transaction).afterCommit(() => fn());
    return undefined;
  }
  return fn();
};

// Session ids a bulk update is about to touch, captured before the UPDATE runs:
// afterwards a `where: { user_id, is_revoked: false }` no longer matches them.
const pendingBulkIds = new WeakMap<object, string[]>();

/** What registerLivenessInvalidation needs from the model it is given. */
interface LivenessHookTarget {
  addHook(hookType: string, name: string, fn: (...args: never[]) => unknown): unknown;
  unscoped(): {
    findAll(options: {
      where: unknown;
      attributes: string[];
      transaction: unknown;
      skipTenantScope: boolean;
      raw: boolean;
    }): Promise<{ id: string }[]>;
  };
}

/** The model check the JavaScript made: a value with an `addHook` function. */
const isHookTarget = (model: unknown): model is LivenessHookTarget =>
  Boolean(model) && typeof (model as { addHook?: unknown }).addHook === "function";

/**
 * Register the hooks that keep the liveness cache honest. Idempotent (named
 * hooks replace themselves).
 *
 * @param model - the Session model
 * @returns whether the hooks were registered
 */
const registerLivenessInvalidation = (model: unknown): boolean => {
  if (!isHookTarget(model)) {
    return false;
  }

  const onInstance = (instance: { id: string }, options: HookOptions): Promise<void> | undefined =>
    afterCommit(options, () => invalidateLiveness([instance.id]));

  model.addHook("afterUpdate", "sessionLivenessUpdate", onInstance);
  model.addHook("afterDestroy", "sessionLivenessDestroy", onInstance);

  model.addHook("beforeBulkUpdate", "sessionLivenessCapture", async (options: HookOptions) => {
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

  model.addHook("afterBulkUpdate", "sessionLivenessBulk", (options: HookOptions) => {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||`
    const ids = pendingBulkIds.get(options) || [];
    pendingBulkIds.delete(options);
    return afterCommit(options, () => invalidateLiveness(ids));
  });

  return true;
};

registerLivenessInvalidation(Sessions);

// ==========================================
// REVOKE SESSION BY ID
// ==========================================

/**
 * Revoke one session by its id — the `sid` an access token carries.
 *
 * @param sessionId - the session's id
 * @param reason - sessions.revoked_reason
 * @returns Sequelize's update result
 */
const revokeSessionById = async (sessionId: string, reason = "LOGOUT"): Promise<[affectedCount: number]> => {
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

const sessionContext = new AsyncLocalStorage<{ sessionId: string | null }>();

/**
 * @param sessionId - the request's session id, or null
 * @param fn - runs with it as the current session
 * @returns what `fn` returns
 */
const runWithSession = <T>(sessionId: string | null, fn: () => T): T =>
  sessionContext.run({ sessionId }, fn);

/**
 * @returns the current request's session id, or null
 */
const getCurrentSessionId = (): string | null => {
  const store = sessionContext.getStore();
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing, @typescript-eslint/prefer-optional-chain -- as built: `(store && store.sessionId) || null`
  return (store && store.sessionId) || null;
};

const service = {
  hashToken,
  createSession,
  validateSession,
  revokeSession,
  revokeAllSessions,
  revokeOtherSessions,
  rotateRefreshToken,
  cleanupExpiredSessions,
  SESSION_LIVENESS_TTL_SECONDS,
  livenessKey,
  isSessionLive,
  invalidateLiveness,
  registerLivenessInvalidation,
  revokeSessionById,
  runWithSession,
  getCurrentSessionId,
};

export = service;
