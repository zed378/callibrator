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
 */

const { Op } = require("sequelize");
const { Sessions } = require("../models");
const { db } = require("../config");
const auditService = require("./audit.service");
const { PLATFORM_TENANT_ID } = require("../constants/platformTenant");

/** A user has a handful of sessions; the read is bounded all the same (ADR-083). */
const OWN_SESSIONS_LIMIT = 100;

const LIST_ATTRIBUTES = [
  "id",
  "ip_address",
  "user_agent",
  "device",
  "auth_method",
  "impersonator_id",
  "created_at",
  "last_activity_at",
  "expired_at",
];

/** The live predicate: the one session.service#isSessionLive applies. */
const liveWhere = (userId, now = new Date()) => ({
  user_id: userId,
  is_revoked: false,
  is_active: true,
  expired_at: { [Op.gt]: now },
});

/**
 * @param {object} row - a Sessions row
 * @param {string|null} currentSessionId
 */
const toView = (row, currentSessionId) => ({
  id: row.id,
  current: row.id === currentSessionId,
  ipAddress: row.ip_address || null,
  userAgent: row.user_agent || null,
  device: row.device || null,
  signInMethod: row.auth_method || "password",
  // A platform operator's support session in this account (A-146). Shown so
  // the holder knows it exists; the operator's identity is not disclosed.
  impersonated: Boolean(row.impersonator_id),
  createdAt: row.created_at,
  lastActivityAt: row.last_activity_at || null,
  expiresAt: row.expired_at,
});

/**
 * GET /sessions/mine — the caller's live sessions, newest first.
 *
 * @param {string} userId - req.user.id
 * @param {string|null} currentSessionId - req.sessionId
 */
exports.listOwnSessions = async (userId, currentSessionId) => {
  const rows = await Sessions.findAll({
    where: liveWhere(userId),
    attributes: LIST_ATTRIBUTES,
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
 * @param {{id: string, tenantId?: string|null}} user - req.user
 * @param {string} sessionId
 * @param {string|null} currentSessionId - req.sessionId
 * @param {{ipAddress?: string|null, userAgent?: string|null}} [actor]
 */
exports.revokeOwnSession = async (user, sessionId, currentSessionId, actor = {}) => {
  const session = await Sessions.findOne({
    where: { id: sessionId, ...liveWhere(user.id) },
    skipTenantScope: true,
  });
  if (!session) {
    return { success: false, status: 404, message: "Session not found", data: null };
  }

  const current = session.id === currentSessionId;
  await db.transaction(async (transaction) => {
    await session.update(
      { is_revoked: true, is_active: false, revoked_at: new Date(), revoked_reason: "USER_REVOKED" },
      { transaction },
    );
    await auditService.logAction(
      {
        tenantId: user.tenantId || session.tenant_id || PLATFORM_TENANT_ID,
        userId: user.id,
        action: "UPDATE",
        resourceType: "Session",
        resourceId: session.id,
        changes: { operation: "REVOKE_OWN_SESSION", current, reason: "USER_REVOKED" },
        ipAddress: actor.ipAddress || null,
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

exports.OWN_SESSIONS_LIMIT = OWN_SESSIONS_LIMIT;
