const crypto = require("crypto");

const { Sessions } = require("../models");

// ==========================================
// HASH TOKEN
// ==========================================

const hashToken = (token) => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

// ==========================================
// CREATE SESSION
// ==========================================

const createSession = async ({
  userId,
  token,
  ipAddress = null,
  userAgent = null,
  expiredAt,
}) => {
  const tokenHash = hashToken(token);

  return Sessions.create({
    user_id: userId,
    token_hash: tokenHash,
    ip_address: ipAddress,
    user_agent: userAgent,
    expired_at: expiredAt,
    is_revoked: false,
  });
};

// ==========================================
// FIND SESSION
// ==========================================

const findSession = async ({ token, userId, sessionId }) => {
  const tokenHash = hashToken(token);

  const where = {
    is_revoked: false,
  };

  // Prioritize session ID from x-session header
  if (sessionId) {
    where.id = sessionId;
  } else {
    // Fallback to token-based lookup
    where.token_hash = tokenHash;
    where.user_id = userId;
  }

  return Sessions.findOne({
    where,
  });
};

// ==========================================
// REVOKE SESSION
// ==========================================

const revokeSession = async ({ token, userId }) => {
  const tokenHash = hashToken(token);

  return Sessions.update(
    {
      is_revoked: true,
    },
    {
      where: {
        token_hash: tokenHash,
        user_id: userId,
      },
    },
  );
};

// ==========================================
// REVOKE ALL USER SESSIONS
// ==========================================

const revokeAllUserSessions = async (userId) => {
  return Sessions.update(
    {
      is_revoked: true,
    },
    {
      where: {
        user_id: userId,
      },
    },
  );
};

module.exports = {
  hashToken,
  createSession,
  findSession,
  revokeSession,
  revokeAllUserSessions,
};
