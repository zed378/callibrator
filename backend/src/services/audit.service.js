const { Op } = require("sequelize");
const { AuditLog, User, sequelize } = require("../models");
const { sql } = require("../utils/sql.util");
const { resolveScope, NO_TENANT_UUID } = require("../utils/tenantScope.util");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");
const { AUDIT_ACTIONS } = require("../constants/auditActions");
const { logger } = require("../middlewares/activityLog.middleware");
const { currentImpersonatorId } = require("../utils/auditActor.util");
const { ACTOR_TYPES, SYSTEM_ACTORS, SYSTEM_ACTOR_NAMES } = require("../constants/systemActors");
const { PLATFORM_TENANT_ID } = require("../constants/platformTenant");
const { redactAuditChanges } = require("../utils/auditRedaction.util");

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformLog = (log) => {
  if (!log) {return null;}
  return log.toJSON ? log.toJSON() : { ...log };
};

const transformLogs = (rows) => (rows || []).map(transformLog);

/**
 * A-124 — the actor columns of an audit row, or a throw.
 *
 * Exactly one of a user or a registered system actor. A user row carries no
 * `actorName` (the user is `userId`); a system row carries no `userId`. The
 * database enforces the same shape (migration 0033's CHECK) — this refuses it
 * first, with a message that names the call site's mistake.
 *
 * @param {string|null} userId
 * @param {string|null} systemActor
 * @returns {{userId: (string|null), actorType: string, actorName: (string|null)}}
 * @throws {Error} neither, both, or an unregistered system actor
 */
const resolveActor = (userId, systemActor) => {
  if (userId && systemActor) {
    throw new Error(
      `An audit entry names one actor: both user "${userId}" and system actor "${systemActor}" were given`,
    );
  }
  if (userId) {
    return { userId, actorType: ACTOR_TYPES.USER, actorName: null };
  }
  if (!systemActor) {
    throw new Error(
      "An audit entry must name its actor: a userId, or a systemActor from constants/systemActors.js",
    );
  }
  if (!SYSTEM_ACTOR_NAMES.includes(systemActor)) {
    throw new Error(
      `Unknown system actor "${systemActor}" — audit_logs accepts only ${SYSTEM_ACTOR_NAMES.join(", ")}`,
    );
  }
  return { userId: null, actorType: ACTOR_TYPES.SYSTEM, actorName: systemActor };
};

// ------------------------------------------------------------------
// LOG ACTION (Internal Use Only)
// ------------------------------------------------------------------
/**
 * Emits an immutable audit log record. The single write path for `audit_logs`.
 *
 * A-41 / A-42 — two call shapes, and they fail differently on purpose
 * (MEMORY/specs/A-41-audit-inside-transaction.md § Decision):
 *
 *  - `logAction(entry, { transaction })` — the compliance-critical set. The row
 *    is written in the caller's transaction, so a rollback takes it with it;
 *    and a failed write is RE-THROWN, so the mutation cannot commit
 *    unattributed (21 CFR 11.10(e)). Swallowing it here would be worse than
 *    useless: PostgreSQL has already aborted the transaction, and a COMMIT of
 *    an aborted transaction silently rolls back — the caller would report
 *    success for a change that never happened.
 *  - `logAction(entry)` — no transaction (the after-response middleware). The
 *    mutation has already committed; throwing cannot undo it. The failure is
 *    logged and `null` returned.
 *
 * Either way a failure goes to winston at `error` — the file sink production
 * collects — never only to `console`, with enough context to find the action.
 *
 * A-124 (ADR-051 Q-13) — the entry names EXACTLY ONE actor: a user
 * (`userId`) or a system job (`systemActor`, one of constants/systemActors.js
 * SYSTEM_ACTORS). Neither, both, or an unregistered job name is refused the
 * same way an invalid action is — re-thrown inside a transaction (so the
 * mutation rolls back rather than commit unattributed), logged and `null`
 * outside one. `actor_type` / `actor_name` are derived here and nowhere else.
 *
 * @param {object} entry
 * @param {string} entry.tenantId
 * @param {string|null} [entry.userId] - the acting user
 * @param {string|null} [entry.systemActor] - A-124: the acting job, from
 *   SYSTEM_ACTORS; only when there is no user
 * @param {string|null} [entry.impersonatorId] - F-8: the super admin acting
 *   through an impersonation token. When the caller passes none, the current
 *   request's impersonator (utils/auditActor.util.js) is recorded, so a service
 *   that builds its entry from chosen actor fields is still attributed.
 * @param {string} entry.action - one of AUDIT_ACTIONS
 * @param {string} entry.resourceType
 * @param {string|null} [entry.resourceId]
 * @param {object|null} [entry.changes] - never secrets: this table is permanent
 * @param {string|null} [entry.ipAddress]
 * @param {string|null} [entry.userAgent]
 * @param {object} [options]
 * @param {object} [options.transaction] - the mutation's transaction
 * @returns {Promise<object|null>} the row, or null after a logged failure outside a transaction
 * @throws the insert's error, when called with a transaction
 */
exports.logAction = async (
  {
    tenantId,
    userId = null,
    systemActor = null,
    impersonatorId = null,
    action,
    resourceType,
    resourceId = null,
    changes = null,
    ipAddress = null,
    userAgent = null,
  },
  { transaction } = {},
) => {
  const impersonator = impersonatorId || currentImpersonatorId();
  try {
    if (!AUDIT_ACTIONS.includes(action)) {
      throw new Error(
        `Invalid audit action "${action}" — audit_logs.action accepts only ${AUDIT_ACTIONS.join(", ")}`,
      );
    }
    const actor = resolveActor(userId, systemActor);
    // D-27 (ADR-070): a secret never reaches this permanent table — its value
    // is replaced, and the call site that tried is named so it gets fixed.
    const { value: safeChanges, redacted } = redactAuditChanges(changes);
    if (redacted.length > 0) {
      logger.warn("Audit changes carried secret-bearing fields; their values were redacted", {
        tenantId,
        action,
        resourceType,
        resourceId,
        fields: redacted,
      });
    }
    const newLog = await AuditLog.create(
      {
        tenantId,
        userId: actor.userId,
        actorType: actor.actorType,
        actorName: actor.actorName,
        // Only when there is one: the column defaults to NULL, and the
        // ordinary row keeps the exact shape it always had.
        ...(impersonator ? { impersonatorId: impersonator } : {}),
        action,
        resourceType,
        resourceId,
        changes: safeChanges,
        ipAddress,
        userAgent,
      },
      { transaction },
    );
    return transformLog(newLog);
  } catch (error) {
    logger.error("Audit log write failed", {
      tenantId,
      userId,
      systemActor,
      impersonatorId: impersonator,
      action,
      resourceType,
      resourceId,
      inTransaction: Boolean(transaction),
      error: error.message,
      stack: error.stack,
    });
    if (transaction) {
      throw error;
    }
    return null;
  }
};

// ------------------------------------------------------------------
// FETCH AUDIT LOGS
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// ACCOUNT LOCKED (A-126, ADR-051 Q-15)
// ------------------------------------------------------------------
/**
 * Persist a brute-force sign-in lock together with its `ACCOUNT_LOCKED` row.
 *
 * The two call sites that engage a lock — auth.service#loginUser (the fifth
 * wrong password) and rateLimiter.redis.service#recordAuthFailure (the
 * per-user budget of an endpoint that persists the sign-in lock, e.g. the MFA
 * step) — hand the lock write to `persistLock`, and it runs in ONE transaction
 * with the row, so a lock and its record commit together.
 *
 * FAIL SECURE. The lock is a security control and must not depend on the
 * audit table: if the transaction fails (the audit insert, most likely), the
 * failure is logged at `error` and the lock is persisted ON ITS OWN, with no
 * transaction — the pre-A-126 behaviour. The reverse — rolling the lock back
 * because the row could not be written — would switch brute-force protection
 * off for as long as audit writes fail.
 *
 * WHO AND WHERE. The actor is `system:auth-lockout`: the lock is the system's
 * act, not the account holder's, and the attempts may not be theirs. The
 * locked account is the RESOURCE. The row goes in the account's OWN tenant (a
 * tenant-less account — a super admin with no home — in PLATFORM, Q-14), where
 * that tenant's administrators read it and the person guessing does not.
 *
 * NOT AN ENUMERATION ORACLE. Both call sites reach this only for an account
 * that exists (loginUser found the row; the limiter's user id comes from a
 * verified token, never a typed name). An unknown account is never locked and
 * never gets a row, and nothing here changes the HTTP answer.
 *
 * @param {object} params
 * @param {(transaction: (object|null)) => Promise<unknown>} params.persistLock -
 *   writes `users.locked_until` (and the counter), in `transaction` when one is
 *   given; with `null` it must write outside any transaction
 * @param {{id: string, tenantId?: (string|null)}} params.user - the locked account
 * @param {Date} params.lockedUntil
 * @param {number} params.failedAttempts
 * @param {string} params.endpoint - where the attempts were made
 * @param {string|null} params.ipAddress - the address of the attempt that tripped the lock (null when unknown)
 * @param {string|null} params.userAgent - null when unknown
 * @param {string} [params.scope] - A-185: what a password sign-in pause
 *   covers; absent for a lock of the account itself
 * @returns {Promise<boolean>} true when the row was written, false when the
 *   lock was persisted without it
 * @throws whatever the fallback lock write throws
 */
exports.recordAccountLock = async ({
  persistLock,
  user,
  lockedUntil,
  failedAttempts,
  endpoint,
  ipAddress,
  userAgent,
  scope,
}) => {
  // Required here, not at the top: this module is loaded by many test files
  // that mock the models and nothing else, and only this function needs `db`.
  const { db } = require("../config");
  try {
    await db.transaction(async (transaction) => {
      await persistLock(transaction);
      await exports.logAction(
        {
          tenantId: user.tenantId || PLATFORM_TENANT_ID,
          systemActor: SYSTEM_ACTORS.AUTH_LOCKOUT,
          action: "ACCOUNT_LOCKED",
          resourceType: "User",
          resourceId: user.id,
          changes: {
            endpoint,
            failedAttempts,
            lockedUntil: lockedUntil.toISOString(),
            // A-185: a password sign-in pause is not an account lock — it
            // names what was paused ("identifier+address" or "identifier").
            ...(scope ? { scope } : {}),
          },
          ipAddress,
          userAgent,
        },
        { transaction },
      );
    });
    return true;
  } catch (error) {
    logger.error("ACCOUNT_LOCKED was not recorded; persisting the lock without its audit row", {
      userId: user.id,
      endpoint,
      error: error.message,
    });
    await persistLock(null);
    return false;
  }
};

/**
 * P8-04 (ADR-096): a list request with no date filter reads this many days back.
 * The trail is never purged (ADR-051 Q-12), so "everything" grows without bound.
 */
const AUDIT_DEFAULT_WINDOW_DAYS = 90;
/** P8-04 (ADR-096): the list counts at most this many rows; past it, `meta.totalIsCapped`. */
const AUDIT_COUNT_CAP = 10000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * P8-04 (ADR-096) — the list's count, bounded. `findAndCountAll` counted every
 * row the tenant ever wrote on every page request: a parallel sequential scan
 * of 500,000 rows, 39 of 72 active queries under the P8-07 load. This counts
 * at most `$9` rows through the (tenant_id, created_at) index.
 *
 * Raw SQL, so the tenant predicate is bound explicitly (`tenant_id = $1`); every
 * filter is a bound value or NULL, so the statement text never varies.
 */
const AUDIT_COUNT_SQL = `SELECT count(*)::int AS n FROM (
  SELECT 1 FROM audit_logs
   WHERE tenant_id = $1
     AND ($2::uuid IS NULL OR user_id = $2::uuid)
     AND ($3::enum_audit_logs_actor_type IS NULL OR actor_type = $3::enum_audit_logs_actor_type)
     AND ($4::enum_audit_logs_action IS NULL OR action = $4::enum_audit_logs_action)
     AND ($5::varchar IS NULL OR resource_type = $5::varchar)
     AND ($6::varchar IS NULL OR resource_id = $6::varchar)
     AND ($7::timestamptz IS NULL OR created_at >= $7::timestamptz)
     AND ($8::timestamptz IS NULL OR created_at <= $8::timestamptz)
   LIMIT $9) capped`;

/**
 * The tenant the raw count binds: the one the global hook FORCES on the rows
 * query (tenantScope.util#applyTenantWhere) — the context's tenant for a tenant
 * principal, NO_TENANT_UUID for a context with none — and the caller's
 * `tenantId` only where the hook would not filter (super admin, system task, no
 * context). Raw SQL bypasses the hooks, so the count must not trust a
 * `tenantId` the rows query would have overridden.
 *
 * @param {string|null} tenantId - the tenant the controller chose
 * @returns {string|null}
 */
const countTenantId = (tenantId) => {
  const scope = resolveScope({});
  if (scope.mode === "filter") {return scope.tenantId;}
  if (scope.mode === "deny") {return NO_TENANT_UUID;}
  return tenantId;
};

exports.AUDIT_DEFAULT_WINDOW_DAYS = AUDIT_DEFAULT_WINDOW_DAYS;
exports.AUDIT_COUNT_CAP = AUDIT_COUNT_CAP;

/**
 * One tenant's audit trail, newest first. Each row carries `actorType` and
 * `actorName` (A-124) beside `userId` / `user`.
 *
 * `tenantId` is chosen by the controller: the reader's home tenant, or — for a
 * super admin asking for `scope=platform` only — PLATFORM_TENANT_ID (A-125).
 * For anyone else the global tenant hooks force their own tenant regardless.
 *
 * P8-04 (ADR-096), an API change:
 *  - with no `startDate`, no `endDate` and no `resourceId`, the list reads the
 *    last AUDIT_DEFAULT_WINDOW_DAYS days, and `meta.window` says so
 *    (`{ from, to: null, defaulted: true }`). A caller that wants older rows
 *    passes a `startDate`. A single resource's history is not windowed.
 *  - `meta.total` counts at most AUDIT_COUNT_CAP rows; `meta.totalIsCapped` is
 *    true when more match (the total is then a lower bound).
 */
exports.fetchAuditLogs = async ({
  tenantId,
  page = 1,
  limit = DEFAULT_LIMIT,
  userId,
  actorType,
  action,
  resourceType,
  resourceId,
  startDate,
  endDate,
}) => {
  try {
    const whereClause = { tenantId };

    if (userId) {whereClause.userId = userId;}
    // A-124: "every action not taken by a person" is `actorType=system`.
    if (actorType) {whereClause.actorType = actorType;}
    if (action) {whereClause.action = action;}
    if (resourceType) {whereClause.resourceType = resourceType;}
    if (resourceId) {whereClause.resourceId = resourceId;}

    // P8-04: no date and no single resource → the default window.
    const windowDefaulted = !startDate && !endDate && !resourceId;
    let from = null;
    if (startDate) {
      from = new Date(startDate);
    } else if (windowDefaulted) {
      from = new Date(Date.now() - AUDIT_DEFAULT_WINDOW_DAYS * DAY_MS);
    }
    const to = endDate ? new Date(endDate) : null;
    if (from || to) {
      whereClause.createdAt = {};
      if (from) {whereClause.createdAt[Op.gte] = from;}
      if (to) {whereClause.createdAt[Op.lte] = to;}
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    const [rows, [counted]] = await Promise.all([
      AuditLog.findAll({
        where: whereClause,
        limit: safeLimit,
        offset,
        order: [["createdAt", "DESC"]],
        // required:false — userId is nullable (SET NULL on user delete) and User
        // carries a scope that would otherwise INNER JOIN and hide those logs.
        include: [
          { model: User, as: "user", attributes: ["id", "username", "firstName", "lastName", "email"], required: false },
          // F-8: the super admin who acted through an impersonation token. Most
          // rows have none; required:false for the same reason as `user`.
          { model: User, as: "impersonator", attributes: ["id", "username", "firstName", "lastName", "email"], required: false },
        ],
      }),
      sql(sequelize, AUDIT_COUNT_SQL, [
        countTenantId(tenantId),
        userId || null,
        actorType || null,
        action || null,
        resourceType || null,
        resourceId || null,
        from,
        to,
        AUDIT_COUNT_CAP + 1,
      ]),
    ]);
    const totalIsCapped = counted.n > AUDIT_COUNT_CAP;
    const count = totalIsCapped ? AUDIT_COUNT_CAP : counted.n;

    return {
      success: true,
      status: 200,
      message: "Fetch audit logs successful",
      data: {
        rows: transformLogs(rows),
        count,
        meta: {
          total: count,
          totalIsCapped,
          page: Number(page),
          limit: safeLimit,
          totalPages: Math.ceil(count / safeLimit),
          window: {
            from: from ? from.toISOString() : null,
            to: to ? to.toISOString() : null,
            defaulted: windowDefaulted,
          },
        },
      },
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to fetch audit logs",
    };
  }
};
