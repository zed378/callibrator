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
import type { Request, Response } from "express";

import { AppError } from "../utils/appError.util";
import { asyncHandlerWithMapping as loadedAsyncHandlerWithMapping } from "../utils/controllerWrapper.util";
import { success as loadedSuccess } from "../utils/response.util";
import { isSuperAdmin as loadedIsSuperAdmin } from "../utils/role.util";
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import { sessionStatus } from "../utils/sessionState.util";
import sessionAdmin from "../services/sessionAdmin.service";
import type { ModelInstance } from "../types/models";

const asyncHandlerWithMapping = loadedAsyncHandlerWithMapping;
const success = loadedSuccess;
const isSuperAdmin = loadedIsSuperAdmin;
const auditPrincipal = loadedAuditPrincipal;

type SessionRow = ModelInstance<"Session">;

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

// ARC-01 (the 2026-11 audit): every query and transaction lives in
// services/sessionAdmin.service; a handler parses the request, calls it, and
// maps the envelope.

// ==========================================
// GET ALL SESSIONS (Admin/Super Admin)
// ==========================================
const getAllSessions = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const { page = 1, limit = 20, search, status, userId } = req.query as SessionQuery;
  // parseInt applies ToString to its argument, so String(x) reads exactly as parseInt(x) did.
  const pageNo = parseInt(String(page));
  const pageSize = parseInt(String(limit));

  const { count, rows } = await sessionAdmin.listSessions({ page: pageNo, limit: pageSize, search, status, userId });

  // The envelope (A-111): rows in `data`, pagination in a TOP-LEVEL `meta`.
  success(
    res,
    rows.map((session) => sessionView(session)),
    { total: count, page: pageNo, limit: pageSize, totalPages: Math.ceil(count / pageSize) },
    "Sessions retrieved successfully",
    200,
  );
}, {});

// ==========================================
// GET SESSION BY ID
// ==========================================
const getSessionById = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const session = await sessionAdmin.getSession(id);
  success(res, sessionView(session), null, "Session retrieved successfully", 200);
}, {});

// ==========================================
// REVOKE SESSION (Admin can revoke any, user can revoke own)
// ==========================================
const revokeSession = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const r = req as SessionRequest;
  const { id } = r.params as { id: string };
  const { reason = "MANUAL_REVOKE" } = r.body as { reason?: string };
  // N-01: the seeded name is "SUPERADMIN"; one predicate recognises both spellings.
  const actor = { userId: r.user.id, isAdmin: isSuperAdmin(r.user) };

  await sessionAdmin.revokeSession(id, actor, reason, auditPrincipal(req));

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
  if (!isSuperAdmin(r.user)) {
    throw new AppError(403, "Only admins can revoke all sessions for a user");
  }

  const revokedCount = await sessionAdmin.revokeAllForUser(userId, reason, auditPrincipal(req));

  success(res, { revokedCount }, null, `${String(revokedCount)} session(s) revoked successfully`, 200);
}, {});

// ==========================================
// DELETE SESSION (Remove revoked/expired sessions)
// ==========================================
const deleteSession = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const r = req as SessionRequest;
  const { id } = r.params as { id: string };
  // N-01: the seeded name is "SUPERADMIN"; one predicate recognises both spellings.
  const actor = { userId: r.user.id, isAdmin: isSuperAdmin(r.user) };

  await sessionAdmin.deleteSession(id, actor, auditPrincipal(req));

  success(res, null, null, "Session deleted successfully", 200);
}, {});

// ==========================================
// GET SESSION STATISTICS
// ==========================================
const getSessionStats = asyncHandlerWithMapping(async (req: Request, res: Response) => {
  const { userId } = req.query as SessionQuery;
  const stats = await sessionAdmin.sessionStats(userId);
  success(res, stats, null, "Session statistics retrieved successfully", 200);
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

/**
 * BUG-02: the ONE status a session has, read from the ONE definition of a
 * live session: not revoked, not deactivated, not expired.
 */
const getSessionStatus = (session: SessionRow): "revoked" | "expired" | "active" =>
  sessionStatus(session);

const controller = {
  getAllSessions,
  getSessionById,
  revokeSession,
  revokeAllUserSessions,
  deleteSession,
  getSessionStats,
};

export = controller;
