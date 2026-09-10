/**
 * Session Security Middleware
 *
 * Provides additional session security hardening:
 * - Session fixation protection
 * - Concurrent session limiting
 * - Suspicious activity detection
 * - IP/User-Agent binding validation
 * - Session timeout enforcement
 */

const { AppError } = require("../utils/appError.util");
const { logger } = require("./activityLog.middleware");
const { db } = require("../config");

// ==========================================
// CONFIGURATION
// ==========================================

const MAX_CONCURRENT_SESSIONS =
  parseInt(process.env.MAX_CONCURRENT_SESSIONS) || 5;
const SESSION_INACTIVITY_TIMEOUT_MS =
  parseInt(process.env.SESSION_INACTIVITY_TIMEOUT) || 30 * 60 * 1000; // 30 min default
const SESSION_ABSOLUTE_TIMEOUT_MS =
  parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT) || 12 * 60 * 60 * 1000; // 12 hours default
const SUSPICIOUS_IP_CHANGE_DETECTED =
  process.env.SUSPICIOUS_IP_CHANGE_DETECTED !== "false";

// ==========================================
// SESSION FIXATION PROTECTION
// ==========================================

/**
 * Regenerate session ID on authentication
 * Prevents session fixation attacks by ensuring a new session is created
 * after login/MFA/SO
 *
 * Usage: Add this middleware before auth handlers
 */
exports.sessionFixationProtection = (req, res, next) => {
  // On authentication events, invalidate old session
  const isAuthEvent =
    req.path === "/login" ||
    req.path === "/mfa/verify" ||
    req.path === "/sso/callback" ||
    req.path === "/sso/oidc/callback";

  if (isAuthEvent && req.sessionId) {
    // Mark old session as revoked in database
    if (db.getDialect() === "postgres") {
      db.query(`UPDATE "Sessions" SET "isRevoked" = true WHERE id = $1`, {
        replacements: [req.sessionId],
      });
    }
    logger.info("Session fixation protection: old session revoked", {
      sessionId: req.sessionId,
      ip: req.ip,
    });
  }

  next();
};

// ==========================================
// CONCURRENT SESSION LIMITING
// ==========================================

/**
 * Check and enforce concurrent session limits
 * @param {number} maxSessions - Maximum concurrent sessions per user
 */
exports.enforceSessionLimit = async (maxSessions = MAX_CONCURRENT_SESSIONS) => {
  return async (req, res, next) => {
    if (!req.user || !req.user.id) {
      return next();
    }

    try {
      let sessionCount;
      if (db.getDialect() === "postgres") {
        const result = await db.query(
          `SELECT COUNT(*) as count FROM "Sessions" 
           WHERE "userId" = $1 AND "isRevoked" = false AND "expiresAt" > NOW()`,
          { replacements: [req.user.id], type: db.QueryTypes.SELECT },
        );
        sessionCount = parseInt(result[0].count);
      } else {
        const { Sessions } = require("../models");
        sessionCount = await Sessions.count({
          where: {
            userId: req.user.id,
            isRevoked: false,
            expiresAt: { [db.Sequelize.Op.gt]: new Date() },
          },
        });
      }

      if (sessionCount >= maxSessions) {
        // Revoke oldest session
        if (db.getDialect() === "postgres") {
          await db.query(
            `UPDATE "Sessions" SET "isRevoked" = true, "revokedAt" = NOW()
             WHERE id = (
               SELECT id FROM "Sessions" 
               WHERE "userId" = $1 AND "isRevoked" = false 
               ORDER BY "createdAt" ASC LIMIT 1
             )`,
            { replacements: [req.user.id] },
          );
        }
        logger.info("Session limit enforced: oldest session revoked", {
          userId: req.user.id,
          sessionCount,
          maxSessions,
        });
      }

      next();
    } catch (err) {
      logger.error("Session limit check failed", { error: err.message });
      // Don't block on session limit check failure
      next();
    }
  };
};

// ==========================================
// IP/USER-AGENT BINDING
// ==========================================

/**
 * Validate that the request IP matches the session's original IP
 * Detects potential session hijacking
 */
exports.validateSessionBinding = async (req, res, next) => {
  if (!req?.session || !req?.sessionId) {
    return next();
  }

  try {
    let sessionData;
    if (db.getDialect() === "postgres") {
      const result = await db.query(
        `SELECT "ipAddress", "userAgent", "lastActivity" FROM "Sessions" WHERE id = $1`,
        { replacements: [req.sessionId], type: db.QueryTypes.SELECT },
      );
      sessionData = result[0];
    } else {
      const { Sessions } = require("../models");
      sessionData = await Sessions.findByPk(req.sessionId);
    }

    if (!sessionData) {
      return next();
    }

    // Check IP change (only if configured)
    if (SUSPICIOUS_IP_CHANGE_DETECTED) {
      const currentIp = req.ip || req.connection.remoteAddress;
      const sessionIp = sessionData.ipAddress;

      if (sessionIp && currentIp !== sessionIp) {
        logger.warn("Suspicious IP change detected", {
          sessionId: req.sessionId,
          sessionIp,
          currentIp,
          userAgent: req.headers["user-agent"],
        });

        // Don't block - just log and optionally require re-authentication
        // In strict mode, uncomment the following:
        // return next(new AppError(401, "Suspicious activity detected. Please re-authenticate."));
      }
    }

    // Update last activity
    if (db.getDialect() === "postgres") {
      db.query(`UPDATE "Sessions" SET "lastActivity" = NOW() WHERE id = $1`, {
        replacements: [req.sessionId],
      });
    }

    next();
  } catch (err) {
    logger.error("Session binding validation failed", { error: err.message });
    next();
  }
};

// ==========================================
// SESSION TIMEOUT ENFORCEMENT
// ==========================================

/**
 * Check session inactivity and absolute timeouts
 * @param {number} inactivityTimeout - Inactivity timeout in milliseconds
 * @param {number} absoluteTimeout - Absolute session timeout in milliseconds
 */
exports.enforceSessionTimeout = (
  inactivityTimeout = SESSION_INACTIVITY_TIMEOUT_MS,
  absoluteTimeout = SESSION_ABSOLUTE_TIMEOUT_MS,
) => {
  return async (req, res, next) => {
    if (!req?.session || !req?.sessionId) {
      return next();
    }

    try {
      let sessionData;
      if (db.getDialect() === "postgres") {
        const result = await db.query(
          `SELECT "lastActivity", "createdAt" FROM "Sessions" WHERE id = $1`,
          { replacements: [req.sessionId], type: db.QueryTypes.SELECT },
        );
        sessionData = result[0];
      } else {
        const { Sessions } = require("../models");
        sessionData = await Sessions.findByPk(req.sessionId);
      }

      if (!sessionData) {
        return next();
      }

      const now = new Date();
      const lastActivity = new Date(
        sessionData.lastActivity || sessionData.createdAt,
      );
      const createdAt = new Date(sessionData.createdAt);

      // Check inactivity timeout
      if (now - lastActivity > inactivityTimeout) {
        logger.info("Session expired due to inactivity", {
          sessionId: req.sessionId,
          lastActivity,
          inactivityTimeout: inactivityTimeout / 1000 / 60,
        });
        return next(
          new AppError(
            401,
            "Session expired due to inactivity. Please log in again.",
          ),
        );
      }

      // Check absolute timeout
      if (now - createdAt > absoluteTimeout) {
        logger.info("Session expired due to absolute timeout", {
          sessionId: req.sessionId,
          createdAt,
          absoluteTimeout: absoluteTimeout / 1000 / 60 / 60,
        });
        return next(new AppError(401, "Session expired. Please log in again."));
      }

      next();
    } catch (err) {
      logger.error("Session timeout check failed", { error: err.message });
      next();
    }
  };
};

// ==========================================
// SECURITY HEADERS
// ==========================================

/**
 * Add security headers to responses
 * Based on OWASP recommendations
 */
exports.securityHeaders = (req, res, next) => {
  // Prevent caching of authenticated responses
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  // XSS Protection
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  // Content Security Policy (restrictive for auth endpoints)
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none';",
  );

  // Strict Transport Security
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload",
    );
  }

  next();
};

// ==========================================
// COMBO MIDDLEWARE
// ==========================================

/**
 * Apply all session security middleware as a chain
 * Usage: router.use(sessionSecurity.fullSessionSecurity())
 */
exports.fullSessionSecurity = () => {
  return [
    exports.securityHeaders,
    exports.validateSessionBinding,
    exports.enforceSessionTimeout(),
    exports.enforceSessionLimit(),
  ];
};
