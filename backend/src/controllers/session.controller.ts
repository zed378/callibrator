// session.controller.ts
//
// P9-20 (ADR-087; converted under the four isolation gates): from
// session.controller.js with no behaviour change. `export =` keeps the exact
// object `require()` returned (the same keys, in the same order). Every
// load-time destructure is kept as a capture at load; `auditService` is the
// module object. The `.js` also destructured `badRequest` and `error` and never
// used them; those unused names are gone. Request data is read through typed
// views of the request; the emitted expressions (`req.body` destructured
// without a fallback, `req.user.id`) and the TypeErrors a missing body or user
// throws are the `.js` ones.
import { Op as LoadedOp } from "sequelize";
import type { Request, Response } from "express";
import type { Transaction as DbTransaction, WhereOptions } from "sequelize";

import { AppError as LoadedAppError } from "../utils/appError.util";
import { asyncHandlerWithMapping as loadedAsyncHandlerWithMapping } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import models from "../models";
import { isSuperAdmin as loadedIsSuperAdmin } from "../utils/role.util";
import auditService from "../services/audit.service";
import {
  auditPrincipal as loadedAuditPrincipal,
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
} from "../utils/auditPrincipal.util";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import type { AuditAction } from "../constants/auditActions";
import type { ModelInstance } from "../types/models";

const AppError = LoadedAppError;
const asyncHandlerWithMapping = loadedAsyncHandlerWithMapping;
const success = loadedSuccess;
const { Sessions, Users, Roles, Tenants, sequelize } = models;
const Op = LoadedOp;
const isSuperAdmin = loadedIsSuperAdmin;
const auditPrincipal = loadedAuditPrincipal;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;

type SessionRow = ModelInstance<"Session">;

/** A filter built key by key (attribute names and Op symbols), as Sequelize takes it. */
const whereOf = (where: Record<string | symbol, unknown>): WhereOptions => where;

/** The request as `auth` leaves it. */
type SessionRequest = Request & {
  user: { id: string; tenantId?: string | null; role?: { name?: string | null } | null; isApiKey?: boolean };
};

/** The list and stats query, as the query string carries it. */
interface SessionQuery {
  page?: string | number;
  limit?: string | number;
  search?: string;
  status?: string;
  userId?: string;
}

/**
 * A-324 — ending a session is audited, in the same transaction as the change.
 * The row names the actor (auditPrincipal: a user, or an API key as
 * system:api-key), the TARGET user and how many sessions ended — never the
 * token, its hash or any other session secret. It is written in the tenant
 * the session belongs to (the platform tenant for a tenantless user).
 *
 * @param {import("express").Request} req
 * @param {object} entry - { tenantId, action, resourceId, changes }
 * @param {object} transaction
 * @returns {Promise<void>}
 */
const auditSessionEnd = async (
  req: Request,
  { tenantId, action, resourceId, changes }: { tenantId: string | null | undefined; action: AuditAction; resourceId: string; changes: Record<string, unknown> },
  transaction: DbTransaction,
): Promise<void> => {
  const principal = auditPrincipal(req);
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

/** A session as the response shows it (both the list and the single read). */
const sessionView = (session: SessionRow): Record<string, unknown> => ({
  id: session.id,
  userId: session.user_id,
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: empty values read as the placeholder */
  username: session.user?.username || "Unknown",
  email: session.user?.email || "Unknown",
  firstName: session.user?.firstName || "",
  lastName: session.user?.lastName || "",
  ipAddress: session.ip_address || "N/A",
  userAgent: session.user_agent || "N/A",
  // Fall back to the user-agent, as browser/os already do. detectDevice was
  // written for exactly this but was never called, so a session with no
  // stored device reported "Unknown" even when the UA said otherwise.
  device: session.device || detectDevice(session.user_agent),
  browser: detectBrowser(session.user_agent),
  os: detectOS(session.user_agent),
  // A-334: no `location` — the Session model has no such column, and the
  // field only ever read "N/A". The session page never showed it.
  role: session.user?.role?.nameToShow || "User",
  tenantId: session.tenant_id,
  tenantName: session.tenant?.name || null,
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  isRevoked: session.is_revoked,
  isActive: session.is_active,
  expiredAt: session.expired_at,
  revokedAt: session.revoked_at,
  revokedReason: session.revoked_reason,
  lastActivityAt: session.last_activity_at,
  // A-334: the timestamp ATTRIBUTE is `createdAt` (`underscored: true` renames
  // only the column); `created_at` was always undefined.
  createdAt: session.createdAt,
  status: getSessionStatus(session),
});

// ==========================================
// GET ALL SESSIONS (Admin/Super Admin)
// ==========================================
const getAllSessions = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const { page = 1, limit = 20, search, status, userId } = req.query as SessionQuery;
  const where: Record<string | symbol, unknown> = {};

  // Filter by user ID if provided
  if (userId) {
    where["user_id"] = userId;
  }

  // Search by IP, device, or username
  if (search) {
    where[Op.or] = [
      { ip_address: { [Op.iLike]: `%${search}%` } },
      { device: { [Op.iLike]: `%${search}%` } },
      { user_agent: { [Op.iLike]: `%${search}%` } },
    ];
  }

  // Filter by status
  if (status === "active") {
    where["is_revoked"] = false;
    where["expired_at"] = { [Op.gte]: new Date() };
  } else if (status === "expired") {
    where["expired_at"] = { [Op.lt]: new Date() };
  } else if (status === "revoked") {
    where["is_revoked"] = true;
  }

  // parseInt applies ToString to its argument, so String(x) reads exactly as parseInt(x) did.
  const offset = (parseInt(String(page)) - 1) * parseInt(String(limit));

  const { count, rows } = await Sessions.findAndCountAll({
    where: whereOf(where),
    include: [
      // A-90: LEFT JOINs. User and Role have a defaultScope `where`, so
      // without `required: false` a session of a deleted user, or of a user
      // outside the tenant (the super admin acting inside it), vanished; the
      // mapping below already reads a missing user as "Unknown".
      {
        model: Users,
        as: "user",
        attributes: ["id", "username", "email", "firstName", "lastName"],
        required: false,
        include: [
          {
            model: Roles,
            as: "role",
            attributes: ["id", "name", "nameToShow"],
            required: false,
          },
        ],
      },
      {
        model: Tenants,
        as: "tenant",
        attributes: ["id", "name"],
        required: false,
      },
    ],
    limit: parseInt(String(limit)),
    offset: parseInt(String(offset)),
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    raw: true,
    nest: true,
  });

  const sessions = rows.map((session) => sessionView(session));

  // The envelope (A-111): rows in `data`, pagination in a TOP-LEVEL `meta`.
  // This used to send `data: { sessions, meta }`.
  success(
    res,
    sessions,
    {
      total: count,
      page: parseInt(String(page)),
      limit: parseInt(String(limit)),
      totalPages: Math.ceil(count / parseInt(String(limit))),
    },
    "Sessions retrieved successfully",
    200,
  );
}, {});

// ==========================================
// GET SESSION BY ID
// ==========================================
const getSessionById = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };

  const session = await Sessions.findByPk(id, {
    include: [
      // A-90: LEFT JOINs. User and Role have a defaultScope `where`, so
      // without `required: false` a session of a deleted user, or of a user
      // outside the tenant (the super admin acting inside it), vanished; the
      // mapping below already reads a missing user as "Unknown".
      {
        model: Users,
        as: "user",
        attributes: ["id", "username", "email", "firstName", "lastName"],
        required: false,
        include: [
          {
            model: Roles,
            as: "role",
            attributes: ["id", "name", "nameToShow"],
            required: false,
          },
        ],
      },
      {
        model: Tenants,
        as: "tenant",
        attributes: ["id", "name"],
        required: false,
      },
    ],
  });

  if (!session) {
    throw new AppError(404, "Session not found");
  }

  const sessionData = sessionView(session);

  success(res, sessionData, null, "Session retrieved successfully", 200);
}, {});

// ==========================================
// REVOKE SESSION (Admin can revoke any, user can revoke own)
// ==========================================
const revokeSession = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const r = req as SessionRequest;
  const { id } = r.params as { id: string };
  const { reason = "MANUAL_REVOKE" } = r.body as { reason?: string };
  const currentUserId = r.user.id;
  // N-01: the seeded name is "SUPERADMIN"; one predicate recognises both spellings.
  const isAdmin = isSuperAdmin(r.user);

  const session = await Sessions.findByPk(id, {
    // A-90: LEFT JOIN — the session of a deleted user must still be
    // revocable, not a 404. The user row is not read below.
    include: [
      {
        model: Users,
        as: "user",
        required: false,
      },
    ],
  });

  if (!session) {
    throw new AppError(404, "Session not found");
  }

  // Users can only revoke their own sessions, admins can revoke any
  if (!isAdmin && session.user_id !== currentUserId) {
    throw new AppError(403, "You can only revoke your own sessions");
  }

  if (session.is_revoked) {
    throw new AppError(400, "Session is already revoked");
  }

  // A-324: the revocation and its audit row commit together or not at all.
  await sequelize.transaction(async (transaction) => {
    await session.update(
      {
        is_revoked: true,
        revoked_at: new Date(),
        revoked_reason: reason,
        is_active: false,
      },
      { transaction },
    );
    await auditSessionEnd(
      req,
      {
        tenantId: session.tenant_id,
        action: "UPDATE",
        resourceId: session.id,
        changes: { event: "SESSION_REVOKED", targetUserId: session.user_id, sessionCount: 1, reason },
      },
      transaction,
    );
  });

  // Invalidate the token hash in cache if using Redis
  // Note: The actual JWT token is still valid until it expires, but the session
  // record marks it as revoked, which will be checked during verification

  success(res, null, null, "Session revoked successfully", 200);
}, {});

// ==========================================
// REVOKE ALL SESSIONS FOR A USER (Admin only)
// ==========================================
const revokeAllUserSessions = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const r = req as SessionRequest;
  const { userId } = r.params as { userId: string };
  const { reason = "ADMIN_REVOKE_ALL" } = r.body as { reason?: string };
  // As built: read, never used (the admin check below is the gate); the read throws without a user.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- as built: `const currentUserId = req.user.id` was never used
  r.user.id;
  // N-01: the seeded name is "SUPERADMIN"; one predicate recognises both spellings.
  const isAdmin = isSuperAdmin(r.user);

  // Only admins can revoke all sessions for a user
  if (!isAdmin) {
    throw new AppError(403, "Only admins can revoke all sessions for a user");
  }

  // A-324: the audit row is written in the target user's tenant. Unscoped:
  // a soft-deleted user's sessions must still be revocable and attributable.
  const target = await Users.unscoped().findByPk(userId, { attributes: ["id", "tenantId"] });

  const result = await sequelize.transaction(async (transaction) => {
    const updated = await Sessions.update(
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
        transaction,
      },
    );
    await auditSessionEnd(
      req,
      {
        tenantId: target ? target.tenantId : null,
        action: "UPDATE",
        resourceId: userId,
        changes: { event: "SESSIONS_REVOKED_ALL", targetUserId: userId, sessionCount: updated[0], reason },
      },
      transaction,
    );
    return updated;
  });

  success(
    res,
    { revokedCount: result[0] },
    null,
    `${String(result[0])} session(s) revoked successfully`,
    200,
  );
}, {});

// ==========================================
// DELETE SESSION (Remove revoked/expired sessions)
// ==========================================
const deleteSession = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const r = req as SessionRequest;
  const { id } = r.params as { id: string };
  const currentUserId = r.user.id;
  // N-01: the seeded name is "SUPERADMIN"; one predicate recognises both spellings.
  const isAdmin = isSuperAdmin(r.user);

  const session = await Sessions.findByPk(id);

  if (!session) {
    throw new AppError(404, "Session not found");
  }

  // Users can only delete their own sessions, admins can delete any
  if (!isAdmin && session.user_id !== currentUserId) {
    throw new AppError(403, "You can only manage your own sessions");
  }

  // Only allow deleting revoked or expired sessions
  if (!session.is_revoked && session.expired_at > new Date()) {
    throw new AppError(400, "Can only delete revoked or expired sessions");
  }

  // A-324: the deletion and its audit row commit together or not at all.
  await sequelize.transaction(async (transaction) => {
    await session.destroy({ transaction });
    await auditSessionEnd(
      req,
      {
        tenantId: session.tenant_id,
        action: "DELETE",
        resourceId: session.id,
        changes: { event: "SESSION_DELETED", targetUserId: session.user_id, sessionCount: 1 },
      },
      transaction,
    );
  });

  success(res, null, null, "Session deleted successfully", 200);
}, {});

// ==========================================
// GET SESSION STATISTICS
// ==========================================
const getSessionStats = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const { userId } = req.query as SessionQuery;
  const where: Record<string, unknown> = {};

  if (userId) {
    where["user_id"] = userId;
  }

  const [total, activeResult, expiredResult, revokedResult] = await Promise.all(
    [
      Sessions.count({ where: whereOf(where) }),
      Sessions.count({
        where: whereOf({
          ...where,
          is_revoked: false,
          expired_at: { [Op.gte]: new Date() },
        }),
      }),
      Sessions.count({
        where: whereOf({
          ...where,
          expired_at: { [Op.lt]: new Date() },
        }),
      }),
      Sessions.count({
        where: whereOf({
          ...where,
          is_revoked: true,
        }),
      }),
    ],
  );

  success(
    res,
    {
      total,
      active: activeResult,
      expired: expiredResult,
      revoked: revokedResult,
    },
    null,
    "Session statistics retrieved successfully",
    200,
  );
}, {});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty user agent reads as "" */
function detectDevice(userAgent: string | null | undefined): string {
  const ua = (userAgent || "").toLowerCase();
  if (ua.includes("mobile")) {
    return "Mobile";
  }
  if (ua.includes("tablet")) {
    return "Tablet";
  }
  if (ua.includes("ipad")) {
    return "iPad";
  }
  return "Desktop";
}

function detectBrowser(userAgent: string | null | undefined): string {
  const ua = (userAgent || "").toLowerCase();
  if (ua.includes("edg/")) {
    return "Microsoft Edge";
  }
  if (ua.includes("chrome")) {
    return "Google Chrome";
  }
  if (ua.includes("firefox")) {
    return "Firefox";
  }
  if (ua.includes("safari")) {
    return "Safari";
  }
  if (ua.includes("msie") || ua.includes("trident")) {
    return "Internet Explorer";
  }
  return "Unknown";
}

function detectOS(userAgent: string | null | undefined): string {
  const ua = (userAgent || "").toLowerCase();
  if (ua.includes("windows")) {
    return "Windows";
  }
  if (ua.includes("mac os")) {
    return "macOS";
  }
  if (ua.includes("linux")) {
    return "Linux";
  }
  if (ua.includes("android")) {
    return "Android";
  }
  if (ua.includes("ios")) {
    return "iOS";
  }
  return "Unknown";
}
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

function getSessionStatus(session: SessionRow): "revoked" | "expired" | "active" {
  if (session.is_revoked) {
    return "revoked";
  }
  if (new Date(session.expired_at) < new Date()) {
    return "expired";
  }
  return "active";
}

const controller = {
  getAllSessions,
  getSessionById,
  revokeSession,
  revokeAllUserSessions,
  deleteSession,
  getSessionStats,
};

export = controller;
