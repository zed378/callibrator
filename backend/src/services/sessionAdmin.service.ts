/**
 * ARC-01 (the 2026-11 audit) — the session management reads and writes, moved
 * out of `session.controller`. Transactions open in the service, never a
 * controller; the controller parses the request, calls these, and maps the
 * envelope.
 *
 * Every query keeps the shape the controller ran (A-90 LEFT JOINs, BUG-01
 * `distinct`, the BUG-02 live predicate), and every ending of a session writes
 * its audit row inside the same transaction (A-324). The audit row names the
 * actor through the caller's `AuditPrincipal`, never a token or its hash.
 *
 * BUG-02, finished here: the stats' `revoked` count and the delete check read
 * the same "not live" definition as the list's `revoked` filter — a session
 * deactivated without being revoked is ended, everywhere.
 */
import { Op, type Transaction, type WhereOptions } from "sequelize";

import models from "../models";
import auditService from "./audit.service";
import { AppError } from "../utils/appError.util";
import { auditEntryActor, actorChanges, type AuditPrincipal } from "../utils/auditPrincipal.util";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { liveSessionWhere, sessionStatus } from "../utils/sessionState.util";
import type { AuditAction } from "../constants/auditActions";
import type { ModelInstance } from "../types/models";

const { Sessions, Users, Roles, Tenants, sequelize } = models;

type SessionRow = ModelInstance<"Session">;

/** A filter built key by key (attribute names and Op symbols), as Sequelize takes it. */
const whereOf = (where: Record<string | symbol, unknown>): WhereOptions => where;

/** Who asks: their user id, and whether they may act on any user's session. */
interface SessionActor {
  readonly userId: string;
  readonly isAdmin: boolean;
}

/** The list query, as the controller parsed it. */
interface SessionListQuery {
  readonly page: number;
  readonly limit: number;
  readonly search?: string | undefined;
  readonly status?: string | undefined;
  readonly userId?: string | undefined;
}

/** The "ended" predicate: revoked, or deactivated without being revoked (BUG-02). */
const endedWhere = (): Record<symbol, unknown> => ({ [Op.or]: [{ is_revoked: true }, { is_active: false }] });

/** A-90: LEFT JOINs. User and Role have a defaultScope `where`. */
const viewInclude = () => [
  {
    model: Users,
    as: "user",
    attributes: ["id", "username", "email", "firstName", "lastName"],
    required: false,
    include: [{ model: Roles, as: "role", attributes: ["id", "name", "nameToShow"], required: false }],
  },
  { model: Tenants, as: "tenant", attributes: ["id", "name"], required: false },
];

/** A-324: ending a session is audited, in the same transaction as the change. */
const auditSessionEnd = async (
  principal: AuditPrincipal,
  { tenantId, action, resourceId, changes }: { tenantId: string | null | undefined; action: AuditAction; resourceId: string; changes: Record<string, unknown> },
  transaction: Transaction,
): Promise<void> => {
  await auditService.logAction(
    {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty tenant reads as the platform's
      tenantId: tenantId || PLATFORM_TENANT_ID,
      ...auditEntryActor(principal),
      action,
      resourceType: "session",
      resourceId,
      changes: { ...changes, ...actorChanges(principal) },
    },
    { transaction },
  );
};

/**
 * @param query - the parsed list query
 * @returns one page of sessions and the number of sessions in the filter
 */
const listSessions = async (query: SessionListQuery): Promise<{ rows: SessionRow[]; count: number }> => {
  const where: Record<string | symbol, unknown> = {};
  if (query.userId) {
    where["user_id"] = query.userId;
  }
  if (query.search) {
    where[Op.or] = [
      { ip_address: { [Op.iLike]: `%${query.search}%` } },
      { device: { [Op.iLike]: `%${query.search}%` } },
      { user_agent: { [Op.iLike]: `%${query.search}%` } },
    ];
  }
  if (query.status === "active") {
    Object.assign(where, liveSessionWhere(new Date()));
  } else if (query.status === "expired") {
    where["expired_at"] = { [Op.lt]: new Date() };
  } else if (query.status === "revoked") {
    Object.assign(where, endedWhere());
  }
  const { count, rows } = await Sessions.findAndCountAll({
    where: whereOf(where),
    // BUG-01: count sessions, not JOINED rows.
    distinct: true,
    include: viewInclude(),
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    raw: true,
    nest: true,
  });
  return { rows, count };
};

/**
 * @param id - the session id
 * @returns the session with its user, role and tenant
 * @throws AppError 404 when there is none
 */
const getSession = async (id: string): Promise<SessionRow> => {
  const session = await Sessions.findByPk(id, { include: viewInclude() });
  if (!session) {
    throw new AppError(404, "Session not found");
  }
  return session;
};

/**
 * Revoke one session: the caller's own, or any for an admin.
 *
 * @throws AppError 404 (none), 403 (another user's, not an admin), 400 (already revoked)
 */
const revokeSession = async (
  id: string,
  actor: SessionActor,
  reason: string,
  principal: AuditPrincipal,
): Promise<void> => {
  // A-90: LEFT JOIN — the session of a deleted user must still be revocable.
  const session = await Sessions.findByPk(id, { include: [{ model: Users, as: "user", required: false }] });
  if (!session) {
    throw new AppError(404, "Session not found");
  }
  if (!actor.isAdmin && session.user_id !== actor.userId) {
    throw new AppError(403, "You can only revoke your own sessions");
  }
  if (session.is_revoked) {
    throw new AppError(400, "Session is already revoked");
  }
  await sequelize.transaction(async (transaction) => {
    await session.update(
      { is_revoked: true, revoked_at: new Date(), revoked_reason: reason, is_active: false },
      { transaction },
    );
    await auditSessionEnd(
      principal,
      {
        tenantId: session.tenant_id,
        action: "UPDATE",
        resourceId: session.id,
        changes: { event: "SESSION_REVOKED", targetUserId: session.user_id, sessionCount: 1, reason },
      },
      transaction,
    );
  });
};

/**
 * Revoke every live session of one user (the caller has been checked as an admin).
 *
 * @returns how many sessions were revoked
 */
const revokeAllForUser = async (userId: string, reason: string, principal: AuditPrincipal): Promise<number> => {
  // A-324: the audit row is written in the target user's tenant. Unscoped: a
  // soft-deleted user's sessions must still be revocable and attributable.
  const target = await Users.unscoped().findByPk(userId, { attributes: ["id", "tenantId"] });
  return sequelize.transaction(async (transaction) => {
    const [count] = await Sessions.update(
      { is_revoked: true, revoked_at: new Date(), revoked_reason: reason, is_active: false },
      { where: { user_id: userId, is_revoked: false }, transaction },
    );
    await auditSessionEnd(
      principal,
      {
        tenantId: target ? target.tenantId : null,
        action: "UPDATE",
        resourceId: userId,
        changes: { event: "SESSIONS_REVOKED_ALL", targetUserId: userId, sessionCount: count, reason },
      },
      transaction,
    );
    return count;
  });
};

/**
 * Delete one ended (revoked, deactivated or expired) session.
 *
 * @throws AppError 404 (none), 403 (another user's, not an admin), 400 (still live)
 */
const deleteSession = async (id: string, actor: SessionActor, principal: AuditPrincipal): Promise<void> => {
  const session = await Sessions.findByPk(id);
  if (!session) {
    throw new AppError(404, "Session not found");
  }
  if (!actor.isAdmin && session.user_id !== actor.userId) {
    throw new AppError(403, "You can only manage your own sessions");
  }
  // BUG-02: a live session cannot be deleted; an ended one — revoked,
  // deactivated or expired — can.
  if (sessionStatus(session) === "active") {
    throw new AppError(400, "Can only delete revoked or expired sessions");
  }
  await sequelize.transaction(async (transaction) => {
    await session.destroy({ transaction });
    await auditSessionEnd(
      principal,
      {
        tenantId: session.tenant_id,
        action: "DELETE",
        resourceId: session.id,
        changes: { event: "SESSION_DELETED", targetUserId: session.user_id, sessionCount: 1 },
      },
      transaction,
    );
  });
};

/**
 * @param userId - narrow the counts to one user, or all when absent
 * @returns the counts by status, each from the same definitions as the list's filters
 */
const sessionStats = async (
  userId?: string,
): Promise<{ total: number; active: number; expired: number; revoked: number }> => {
  const where: Record<string | symbol, unknown> = userId ? { user_id: userId } : {};
  const [total, active, expired, revoked] = await Promise.all([
    Sessions.count({ where: whereOf(where) }),
    Sessions.count({ where: whereOf({ ...where, ...liveSessionWhere(new Date()) }) }),
    Sessions.count({ where: whereOf({ ...where, expired_at: { [Op.lt]: new Date() } }) }),
    Sessions.count({ where: whereOf({ ...where, ...endedWhere() }) }),
  ]);
  return { total, active, expired, revoked };
};

const sessionAdminService = {
  listSessions,
  getSession,
  revokeSession,
  revokeAllForUser,
  deleteSession,
  sessionStats,
};

export = sessionAdminService;
