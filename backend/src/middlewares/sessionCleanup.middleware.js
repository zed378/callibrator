const cron = require("node-cron");
const { logger } = require("../middlewares/activityLog.middleware");
const {
  cleanupExpiredSessions,
  revokeAllSessions,
} = require("../services/session.service");


/**
 * Clean up expired sessions and revoke invalid sessions
 * Deletes sessions where expiredAt is in the past
 * Returns count of deleted sessions
 */
const cleanupExpiredSessionsJob = async () => {
  try {
    const deletedCount = await cleanupExpiredSessions();
    logger.info(
      `Session cleanup completed: ${deletedCount} expired sessions deleted`,
    );
    return deletedCount;
  } catch (error) {
    logger.error(`Error during session cleanup: ${error.message}`);
    throw error;
  }
};

/**
 * Revoke all sessions for a user (e.g., on password change)
 * @param {string} userId - User ID whose sessions should be revoked
 * @param {string} reason - Reason for revocation
 */
const revokeUserSessions = async (userId, reason = "ACCOUNT_SECURITY") => {
  try {
    const [updatedCount] = await revokeAllSessions(userId, reason);
    logger.info(
      `Revoked ${updatedCount} sessions for user ${userId}: ${reason}`,
    );
    return updatedCount;
  } catch (error) {
    logger.error(`Error revoking sessions for user ${userId}:`, error.message);
    throw error;
  }
};

/**
 * Initialize the session cleanup cron job
 * Runs according to SESSION_CLEANUP_SCHEDULER from .env
 * Default: Daily at 2:00 AM (0 2 * * *)
 */
const initSessionCleanup = () => {
  const schedule = process.env.SESSION_CLEANUP_SCHEDULER || "0 2 * * *";

  const message =
    schedule !== "0 2 * * *"
      ? `Session cleanup scheduled with: ${schedule}`
      : "Session cleanup scheduled at 2:00 AM daily";

  logger.info(message);

  cron.schedule(schedule, async () => {
    logger.info("Running session cleanup...");

    try {
      await cleanupExpiredSessionsJob();
      logger.info("Session cleanup completed successfully");
    } catch (error) {
      logger.error(`Error during scheduled session cleanup: ${error.message}`);
    }
  });

  return {
    cleanupExpiredSessions: cleanupExpiredSessionsJob,
    revokeUserSessions,
  };
};

module.exports = {
  initSessionCleanup,
  cleanupExpiredSessionsJob,
  revokeUserSessions,
};
