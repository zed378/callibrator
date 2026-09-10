const crypto = require("crypto");
const { Op } = require("sequelize");

const { Sessions } = require("../models");

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
