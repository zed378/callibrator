const cron = require("node-cron");
const { logger } = require("../middlewares/activityLog.middleware");
const {
  cleanupExpiredSessions,
  revokeAllSessions,
} = require("../services/session.service");
const {
  runMonitored,
  registerJob,
  markDisabled,
  refuseSchedule,
} = require("../services/jobMonitor.service");

const JOB = "session-cleanup";

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
 *
 * Every run is recorded and a failure alerts (P7-02, jobMonitor.service). An
 * invalid expression used to reach cron.schedule and throw at boot; it is now
 * refused, logged and alerted like the other schedulers.
 */
const initSessionCleanup = () => {
  const schedule = process.env.SESSION_CLEANUP_SCHEDULER || "0 2 * * *";
  const helpers = {
    cleanupExpiredSessions: cleanupExpiredSessionsJob,
    revokeUserSessions,
  };

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Session cleanup disabled via SESSION_CLEANUP_SCHEDULER");
    markDisabled(JOB, "disabled via SESSION_CLEANUP_SCHEDULER");
    return helpers;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid SESSION_CLEANUP_SCHEDULER cron expression "${schedule}"; session cleanup not started`,
    );
    refuseSchedule(JOB, "SESSION_CLEANUP_SCHEDULER", schedule);
    return helpers;
  }

  const message =
    schedule !== "0 2 * * *"
      ? `Session cleanup scheduled with: ${schedule}`
      : "Session cleanup scheduled at 2:00 AM daily";

  logger.info(message);

  const task = cron.schedule(schedule, () =>
    runMonitored(JOB, async () => {
      logger.info("Running session cleanup...");
      try {
        const deleted = await cleanupExpiredSessionsJob();
        logger.info("Session cleanup completed successfully");
        return deleted;
      } catch (error) {
        logger.error(`Error during scheduled session cleanup: ${error.message}`);
        throw error;
      }
    }),
  );
  registerJob(JOB, task, schedule);

  return helpers;
};

module.exports = {
  initSessionCleanup,
  cleanupExpiredSessionsJob,
  revokeUserSessions,
};
