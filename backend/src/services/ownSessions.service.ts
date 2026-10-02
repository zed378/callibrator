/**
 * Q-08 (ADR-084) — a signed-in user sees their own live sessions and can end
 * any one of them.
 *
 * This is the control ADR-084 chose INSTEAD of a concurrent-session cap and
 * of IP / user-agent binding. A cap silently ends one login when another
 * starts (and on shared hospital workstations and phones it ends the wrong
 * one); binding ends a session when a mobile network or hospital Wi-Fi
 * rotates an address. What both were meant to catch — a session the user does
 * not recognise — is caught here by the only party who can recognise it: the
 * list shows where and how each session signed in (address and browser as
 * RECORDED at sign-in or refresh, never compared), and one tap ends it.
 *
 * Every read and write names the caller's own user id, which comes from the
 * verified session (req.user.id), never from the request. `skipTenantScope`
 * because a tenant-less principal's scope would otherwise match nothing, as in
 * session.service#revokeAllSessions (A-161); the user id is the predicate.
 * Another user's session — in this tenant or any other — is 404, exactly like
 * one that does not exist.
 *
 * P9-18 (ADR-087, Stage C leaves): converted from ownSessions.service.js with
 * no behaviour change. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order). `Sessions`, `db` and the platform id are
 * captured once at load, as the `.js` destructured them; `auditService` is the
 * module object, read at call time.
 */

import { Op, type Transaction, type WhereOptions } from "sequelize";
import models from "../models";
import { db as loadedDb } from "../config";
import auditService from "./audit.service";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import type { UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { Sessions } = models;
const db = loadedDb;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;

/** A listed session row. */
type SessionRow = ModelInstance<"Session">;

/** One session, as the caller sees it. */
interface SessionView {
  id: string;
  current: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  device: string | null;
  signInMethod: string;
  impersonated: boolean;
  createdAt: Date;
  lastActivityAt: Date | null;
  expiresAt: Date;
}

/** The service's answer (the controller sends it through success()). */
interface OwnSessionsResult<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

/** Who ended the session, for the audit row. */
interface RevokeActor {
  ipAddress?: string | null;
  /** P9-20: widened to what auditActor(req) returns (type-only; the value is only ever written to the audit row). */
  userAgent?: string | readonly string[] | null;
}

/** The principal ending one of its own sessions. */
interface RevokingUser {
  id: UserId;
  tenantId?: string | null;
}

/** A user has a handful of sessions; the read is bounded all the same (ADR-083). */
const OWN_SESSIONS_LIMIT = 100;

const LIST_ATTRIBUTES = [
  "id",
  "ip_address",
  "user_agent",
  "device",
  "auth_method",
  "impersonator_id",
  // A-339: the ATTRIBUTE, `createdAt` (column created_at). Selected as
  // "created_at" the row carried it only in dataValues: an instance has no
  // accessor for a non-attribute, so `row.created_at` was undefined and the
  // list never answered a creation time.
  "createdAt",
  "last_activity_at",
  "expired_at",
];

/** The live predicate: the one session.service#isSessionLive applies. */
const liveWhere = (userId: UserId, now = new Date()): {
  user_id: UserId;
  is_revoked: false;
  is_active: true;
  expired_at: { [Op.gt]: Date };
} => ({
  user_id: userId,
  is_revoked: false,
  is_active: true,
  expired_at: { [Op.gt]: now },
});

/**
 * @param row - a Sessions row
 * @param currentSessionId - the session making the request
 */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty value also reads as null / "password" */
const toView = (row: SessionRow, currentSessionId: string | null | undefined): SessionView => ({
  id: row.id,
  current: row.id === currentSessionId,
  ipAddress: row.ip_address || null,
  userAgent: row.user_agent || null,
  device: row.device || null,
  signInMethod: row.auth_method || "password",
  // A platform operator's support session in this account (A-146). Shown so
  // the holder knows it exists; the operator's identity is not disclosed.
  impersonated: Boolean(row.impersonator_id),
  createdAt: row.createdAt,
  lastActivityAt: row.last_activity_at || null,
  expiresAt: row.expired_at,
});
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

/**
 * GET /sessions/mine — the caller's live sessions, newest first.
 *
 * @param userId - req.user.id
 * @param currentSessionId - req.sessionId
 */
const listOwnSessions = async (
  userId: UserId,
  currentSessionId: string | null | undefined,
): Promise<OwnSessionsResult<SessionView[]>> => {
  const rows: SessionRow[] = await Sessions.findAll({
    where: liveWhere(userId),
    // As built: listed by column name (see SessionRow).
    attributes: LIST_ATTRIBUTES as (keyof ModelInstance<"Session">)[],
    order: [["created_at", "DESC"]],
    limit: OWN_SESSIONS_LIMIT,
    skipTenantScope: true,
  });
  return {
    success: true,
    status: 200,
    message: "Your active sessions",
    data: rows.map((row) => toView(row, currentSessionId)),
  };
};

/**
 * POST /sessions/mine/:id/revoke — end one of the caller's own sessions.
 *
 * The revocation and its audit row are one transaction. The Session model's
 * hooks drop the liveness cache after commit (session.service), so that
 * session's access token is refused on its next request and its sockets at
 * the next re-check (ADR-085).
 *
 * @param user - req.user
 * @param sessionId - the session to end
 * @param currentSessionId - req.sessionId
 * @param actor - where the request came from, for the audit row
 */
const revokeOwnSession = async (
  user: RevokingUser,
  sessionId: string,
  currentSessionId: string | null | undefined,
  actor: RevokeActor = {},
): Promise<OwnSessionsResult<{ id: string; current: boolean } | null>> => {
  const where: WhereOptions = { id: sessionId, ...liveWhere(user.id) };
  const session = await Sessions.findOne({
    where,
    skipTenantScope: true,
  });
  if (!session) {
    return { success: false, status: 404, message: "Session not found", data: null };
  }

  const current = session.id === currentSessionId;
  await db.transaction(async (transaction: Transaction) => {
    await session.update(
      { is_revoked: true, is_active: false, revoked_at: new Date(), revoked_reason: "USER_REVOKED" },
      { transaction },
    );
    await auditService.logAction(
      {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `||` down to the platform tenant
        tenantId: user.tenantId || session.tenant_id || PLATFORM_TENANT_ID,
        userId: user.id,
        action: "UPDATE",
        resourceType: "Session",
        resourceId: session.id,
        changes: { operation: "REVOKE_OWN_SESSION", current, reason: "USER_REVOKED" },
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
        ipAddress: actor.ipAddress || null,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );
  });

  return {
    success: true,
    status: 200,
    message: current ? "This session has been signed out" : "The session has been signed out",
    data: { id: session.id, current },
  };
};

export = { listOwnSessions, revokeOwnSession, OWN_SESSIONS_LIMIT };
