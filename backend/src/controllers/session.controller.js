// session.controller.js
const { AppError } = require("../utils/appError.util");
const { asyncHandlerWithMapping } = require("../utils/controllerWrapper.util");
const { success, badRequest, error } = require("../utils/response.util");
const { Sessions, Users, Roles, Tenants } = require("../models");
const { Op } = require("sequelize");

// ==========================================
// GET ALL SESSIONS (Admin/Super Admin)
// ==========================================
exports.getAllSessions = asyncHandlerWithMapping(async (req, res) => {
  const { page = 1, limit = 20, search, status, userId } = req.query;
  const where = {};

  // Filter by user ID if provided
  if (userId) {
    where.user_id = userId;
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
    where.is_revoked = false;
    where.expired_at = { [Op.gte]: new Date() };
  } else if (status === "expired") {
    where.expired_at = { [Op.lt]: new Date() };
  } else if (status === "revoked") {
    where.is_revoked = true;
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { count, rows } = await Sessions.findAndCountAll({
    where,
    include: [
      {
        model: Users,
        as: "user",
        attributes: ["id", "username", "email", "firstName", "lastName"],
        include: [
          {
            model: Roles,
            as: "role",
            attributes: ["id", "name", "nameToShow"],
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
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [["createdAt", "DESC"]],
    raw: true,
    nest: true,
  });

  const sessions = rows.map((session) => ({
    id: session.id,
    userId: session.user_id,
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
    location: session.location || "N/A",
    role: session.user?.role?.nameToShow || "User",
    tenantId: session.tenant_id,
    tenantName: session.tenant?.name || null,
    isRevoked: session.is_revoked,
    isActive: session.is_active,
    expiredAt: session.expired_at,
    revokedAt: session.revoked_at,
    revokedReason: session.revoked_reason,
    lastActivityAt: session.last_activity_at,
    createdAt: session.created_at,
    status: getSessionStatus(session),
  }));

  success(
    res,
    {
      sessions,
      meta: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / parseInt(limit)),
      },
    },
    null,
    "Sessions retrieved successfully",
    200,
  );
}, {});

// ==========================================
// GET SESSION BY ID
// ==========================================
exports.getSessionById = asyncHandlerWithMapping(async (req, res) => {
  const { id } = req.params;

  const session = await Sessions.findByPk(id, {
    include: [
      {
        model: Users,
        as: "user",
        attributes: ["id", "username", "email", "firstName", "lastName"],
        include: [
          {
            model: Roles,
            as: "role",
            attributes: ["id", "name", "nameToShow"],
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

  const sessionData = {
    id: session.id,
    userId: session.user_id,
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
    location: session.location || "N/A",
    role: session.user?.role?.nameToShow || "User",
    tenantId: session.tenant_id,
    tenantName: session.tenant?.name || null,
    isRevoked: session.is_revoked,
    isActive: session.is_active,
    expiredAt: session.expired_at,
    revokedAt: session.revoked_at,
    revokedReason: session.revoked_reason,
    lastActivityAt: session.last_activity_at,
    createdAt: session.created_at,
    status: getSessionStatus(session),
  };

  success(res, sessionData, null, "Session retrieved successfully", 200);
}, {});

// ==========================================
// REVOKE SESSION (Admin can revoke any, user can revoke own)
// ==========================================
exports.revokeSession = asyncHandlerWithMapping(async (req, res) => {
  const { id } = req.params;
  const { reason = "MANUAL_REVOKE" } = req.body;
  const currentUserId = req.user.id;
  const isAdmin = req.user.role?.name === "SUPER_ADMIN";

  const session = await Sessions.findByPk(id, {
    include: [
      {
        model: Users,
        as: "user",
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

  await session.update({
    is_revoked: true,
    revoked_at: new Date(),
    revoked_reason: reason,
    is_active: false,
  });

  // Invalidate the token hash in cache if using Redis
  // Note: The actual JWT token is still valid until it expires, but the session
  // record marks it as revoked, which will be checked during verification

  success(res, null, null, "Session revoked successfully", 200);
}, {});

// ==========================================
// REVOKE ALL SESSIONS FOR A USER (Admin only)
// ==========================================
exports.revokeAllUserSessions = asyncHandlerWithMapping(async (req, res) => {
  const { userId } = req.params;
  const { reason = "ADMIN_REVOKE_ALL" } = req.body;
  const currentUserId = req.user.id;
  const isAdmin = req.user.role?.name === "SUPER_ADMIN";

  // Only admins can revoke all sessions for a user
  if (!isAdmin) {
    throw new AppError(403, "Only admins can revoke all sessions for a user");
  }

  const result = await Sessions.update(
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

  success(
    res,
    { revokedCount: result[0] },
    null,
    `${result[0]} session(s) revoked successfully`,
    200,
  );
}, {});

// ==========================================
// DELETE SESSION (Remove revoked/expired sessions)
// ==========================================
exports.deleteSession = asyncHandlerWithMapping(async (req, res) => {
  const { id } = req.params;
  const currentUserId = req.user.id;
  const isAdmin = req.user.role?.name === "SUPER_ADMIN";

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

  await session.destroy();

  success(res, null, null, "Session deleted successfully", 200);
}, {});

// ==========================================
// GET SESSION STATISTICS
// ==========================================
exports.getSessionStats = asyncHandlerWithMapping(async (req, res) => {
  const { userId } = req.query;
  const where = {};

  if (userId) {
    where.user_id = userId;
  }

  const [total, activeResult, expiredResult, revokedResult] = await Promise.all(
    [
      Sessions.count({ where }),
      Sessions.count({
        where: {
          ...where,
          is_revoked: false,
          expired_at: { [Op.gte]: new Date() },
        },
      }),
      Sessions.count({
        where: {
          ...where,
          expired_at: { [Op.lt]: new Date() },
        },
      }),
      Sessions.count({
        where: {
          ...where,
          is_revoked: true,
        },
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

function detectDevice(userAgent) {
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

function detectBrowser(userAgent) {
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

function detectOS(userAgent) {
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

function getSessionStatus(session) {
  if (session.is_revoked) {
    return "revoked";
  }
  if (new Date(session.expired_at) < new Date()) {
    return "expired";
  }
  return "active";
}
