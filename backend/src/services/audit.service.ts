// P9-18 (ADR-087): converted from audit.service.js, behaviour unchanged (its
// interim `.d.ts` is deleted with it). The export is the same object, its keys
// in the JavaScript's order (`exports.x = …` five times). recordAccountLock
// still calls `auditService.logAction` through that object at call time, as the
// JavaScript called `exports.logAction`, so a spy on it still sees the call.
// Every import is captured at load as the JavaScript's destructuring
// `require` was; `../config` is still required lazily inside recordAccountLock.
import { Op as loadedOp } from "sequelize";
import type { CreationAttributes, Transaction, WhereOptions } from "sequelize";
import type * as ConfigModule from "../config";
import models from "../models";
import { sql as loadedSql } from "../utils/sql.util";
import type { SqlRunner } from "../utils/sql.util";
import { resolveScope as loadedResolveScope, NO_TENANT_UUID as loadedNoTenantUuid } from "../utils/tenantScope.util";
// The JavaScript required AppError and never used it; the load is kept.
import "../utils/appError.util";
import { DEFAULT_LIMIT as loadedDefaultLimit, MAX_LIMIT as loadedMaxLimit } from "../constants";
import { AUDIT_ACTIONS as loadedAuditActions } from "../constants/auditActions";
import type { AuditAction } from "../constants/auditActions";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { currentImpersonatorId as loadedCurrentImpersonatorId } from "../utils/auditActor.util";
import {
  ACTOR_TYPES as loadedActorTypes,
  SYSTEM_ACTORS as loadedSystemActors,
  SYSTEM_ACTOR_NAMES as loadedSystemActorNames,
} from "../constants/systemActors";
import type { ActorType, SystemActor } from "../constants/systemActors";
import { PLATFORM_TENANT_ID as loadedPlatformTenantId } from "../constants/platformTenant";
import { redactAuditChanges as loadedRedactAuditChanges } from "../utils/auditRedaction.util";

const Op = loadedOp;
const { AuditLog, User, sequelize } = models;
const sql = loadedSql;
const resolveScope = loadedResolveScope;
const NO_TENANT_UUID = loadedNoTenantUuid;
const DEFAULT_LIMIT = loadedDefaultLimit;
const MAX_LIMIT = loadedMaxLimit;
const AUDIT_ACTIONS = loadedAuditActions;
const logger = loadedLogger;
const currentImpersonatorId = loadedCurrentImpersonatorId;
const ACTOR_TYPES = loadedActorTypes;
const SYSTEM_ACTORS = loadedSystemActors;
const SYSTEM_ACTOR_NAMES = loadedSystemActorNames;
const PLATFORM_TENANT_ID = loadedPlatformTenantId;
const redactAuditChanges = loadedRedactAuditChanges;

/** One audit row, as logAction takes it. EXACTLY ONE actor: `userId` or `systemActor` (A-124). */
interface AuditEntry {
  tenantId: string | null | undefined;
  userId?: string | null | undefined;
  systemActor?: string | null | undefined;
  impersonatorId?: string | null | undefined;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null | undefined;
  /** Never secrets: this table is permanent (D-27 redacts them). */
  changes?: Record<string, unknown> | null | undefined;
  ipAddress?: string | null | undefined;
  /**
   * Stored as given. `auditActor(req)` passes the raw `user-agent` header, which Node types
   * `string | string[]` (P9-20: widened so the controllers that pass it type-check; type-only).
   */
  userAgent?: string | readonly string[] | null | undefined;
}

/** recordAccountLock's parameters (A-126, A-185). */
interface AccountLock {
  persistLock: (transaction: Transaction | null) => Promise<unknown>;
  user: { id: string; tenantId?: string | null };
  lockedUntil: Date;
  failedAttempts: number;
  endpoint: string;
  ipAddress: string | null;
  userAgent: string | null;
  scope?: string | undefined;
}

/** fetchAuditLogs' query, as the controller passes it. */
interface AuditQuery {
  tenantId?: unknown;
  page?: unknown;
  limit?: unknown;
  userId?: unknown;
  actorType?: unknown;
  action?: unknown;
  resourceType?: unknown;
  resourceId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}

const errorField = (error: unknown, field: "message" | "stack" | "status"): unknown => (error as Record<string, unknown>)[field];

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformLog = (log: unknown): unknown => {
  if (!log) {return null;}
  const row = log as { toJSON?: () => unknown };
  return row.toJSON ? row.toJSON() : { ...log };
};

// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `rows || []`
const transformLogs = (rows: readonly unknown[] | null | undefined): unknown[] => (rows || []).map(transformLog);

/**
 * A-124 — the actor columns of an audit row, or a throw.
 *
 * Exactly one of a user or a registered system actor. A user row carries no
 * `actorName` (the user is `userId`); a system row carries no `userId`. The
 * database enforces the same shape (migration 0033's CHECK) — this refuses it
 * first, with a message that names the call site's mistake.
 *
 * @param userId - the acting user
 * @param systemActor - the acting job
 * @returns the actor columns
 * @throws {Error} neither, both, or an unregistered system actor
 */
const resolveActor = (
  userId: string | null | undefined,
  systemActor: string | null | undefined,
): { userId: string | null; actorType: ActorType; actorName: string | null } => {
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
  if (!SYSTEM_ACTOR_NAMES.includes(systemActor as SystemActor)) {
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
 * `impersonatorId` (F-8): the super admin acting through an impersonation
 * token. When the caller passes none, the current request's impersonator
 * (utils/auditActor.util) is recorded, so a service that builds its entry from
 * chosen actor fields is still attributed.
 *
 * @param entry - the row (`changes` never secrets: this table is permanent)
 * @param options - `transaction`: the mutation's transaction
 * @returns the row, or null after a logged failure outside a transaction
 * @throws the insert's error, when called with a transaction
 */
const logAction = async (
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
  }: AuditEntry,
  { transaction }: { transaction?: Transaction | null | undefined } = {},
): Promise<unknown> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty id falls through too
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
      } as unknown as CreationAttributes<InstanceType<typeof AuditLog>>,
      { transaction: transaction as Transaction },
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
      error: errorField(error, "message"),
      stack: errorField(error, "stack"),
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
 * `persistLock` writes `users.locked_until` (and the counter), in the given
 * transaction when there is one; with `null` it must write outside any.
 * `scope` (A-185): what a password sign-in pause covers; absent for a lock of
 * the account itself.
 *
 * @param params - the lock
 * @returns true when the row was written, false when the lock was persisted without it
 * @throws whatever the fallback lock write throws
 */
const recordAccountLock = async ({
  persistLock,
  user,
  lockedUntil,
  failedAttempts,
  endpoint,
  ipAddress,
  userAgent,
  scope,
}: AccountLock): Promise<boolean> => {
  // Required here, not at the top: this module is loaded by many test files
  // that mock the models and nothing else, and only this function needs `db`.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required per call (see above)
  const { db } = require("../config") as typeof ConfigModule;
  try {
    await db.transaction(async (transaction) => {
      await persistLock(transaction);
      await auditService.logAction(
        {
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty tenant id is PLATFORM too
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
      error: errorField(error, "message"),
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
 * @param tenantId - the tenant the controller chose
 * @returns the tenant to bind
 */
const countTenantId = (tenantId: unknown): unknown => {
  const scope = resolveScope({});
  if (scope.mode === "filter") {return scope.tenantId;}
  if (scope.mode === "deny") {return NO_TENANT_UUID;}
  return tenantId;
};

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
 *
 * @param query - the controller's query
 * @returns the service's own response object
 */
const fetchAuditLogs = async ({
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
}: AuditQuery): Promise<unknown> => {
  try {
    const whereClause: Record<string | symbol, unknown> & { createdAt?: Record<symbol, Date> } = { tenantId };

    if (userId) {whereClause["userId"] = userId;}
    // A-124: "every action not taken by a person" is `actorType=system`.
    if (actorType) {whereClause["actorType"] = actorType;}
    if (action) {whereClause["action"] = action;}
    if (resourceType) {whereClause["resourceType"] = resourceType;}
    if (resourceId) {whereClause["resourceId"] = resourceId;}

    // P8-04: no date and no single resource → the default window.
    const windowDefaulted = !startDate && !endDate && !resourceId;
    let from: Date | null = null;
    if (startDate) {
      from = new Date(startDate as string);
    } else if (windowDefaulted) {
      from = new Date(Date.now() - AUDIT_DEFAULT_WINDOW_DAYS * DAY_MS);
    }
    const to = endDate ? new Date(endDate as string) : null;
    if (from || to) {
      whereClause.createdAt = {};
      if (from) {whereClause.createdAt[Op.gte] = from;}
      if (to) {whereClause.createdAt[Op.lte] = to;}
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    const [rows, [counted]] = await Promise.all([
      AuditLog.findAll({
        where: whereClause as WhereOptions,
        limit: safeLimit,
        offset,
        order: [["createdAt", "DESC"], ["id", "DESC"]],
        // required:false — userId is nullable (SET NULL on user delete) and User
        // carries a scope that would otherwise INNER JOIN and hide those logs.
        include: [
          { model: User, as: "user", attributes: ["id", "username", "firstName", "lastName", "email"], required: false },
          // F-8: the super admin who acted through an impersonation token. Most
          // rows have none; required:false for the same reason as `user`.
          { model: User, as: "impersonator", attributes: ["id", "username", "firstName", "lastName", "email"], required: false },
        ],
      }),
      // The models barrel types `sequelize` as the Sequelize class; sql() takes its `query`.
      sql<{ n: number }>(sequelize as unknown as SqlRunner, AUDIT_COUNT_SQL, [
        countTenantId(tenantId),
        /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty filter binds NULL */
        userId || null,
        actorType || null,
        action || null,
        resourceType || null,
        resourceId || null,
        /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
        from,
        to,
        AUDIT_COUNT_CAP + 1,
      ] as Parameters<typeof sql>[2]),
    ]);
    const n = (counted as { n: number }).n;
    const totalIsCapped = n > AUDIT_COUNT_CAP;
    const count = totalIsCapped ? AUDIT_COUNT_CAP : n;

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
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- as built: the controller reads `status` and `message` off a plain object
    throw {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status is 500
      status: errorField(error, "status") || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message is the default
      message: errorField(error, "message") || "Failed to fetch audit logs",
    };
  }
};

// The exported object, its keys in the JavaScript's order (`exports.x = …`).
const auditService = {
  logAction,
  recordAccountLock,
  AUDIT_DEFAULT_WINDOW_DAYS,
  AUDIT_COUNT_CAP,
  fetchAuditLogs,
};

export = auditService;
