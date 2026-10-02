// P9-19 (ADR-087): converted from sessionCleanup.middleware.js, behaviour
// unchanged. Every binding the JavaScript destructured at load is captured at
// load; `node-cron` stays the module object, read at call time.
import cron from "node-cron";
import { scheduleSetting as loadedScheduleSetting } from "../utils/schedulerSwitch.util"; // W-02: one switch for every singleton scheduler
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import {
  cleanupExpiredSessions as loadedCleanupExpiredSessions,
  revokeAllSessions as loadedRevokeAllSessions,
} from "../services/session.service";
import {
  runMonitored as loadedRunMonitored,
  registerJob as loadedRegisterJob,
  markDisabled as loadedMarkDisabled,
  refuseSchedule as loadedRefuseSchedule,
} from "../services/jobMonitor.service";
import type { UserId } from "../types/ids";

const scheduleSetting = loadedScheduleSetting;
const logger = loadedLogger;
const cleanupExpiredSessions = loadedCleanupExpiredSessions;
const revokeAllSessions = loadedRevokeAllSessions;
const runMonitored = loadedRunMonitored;
const registerJob = loadedRegisterJob;
const markDisabled = loadedMarkDisabled;
const refuseSchedule = loadedRefuseSchedule;

const JOB = "session-cleanup";

/**
 * Clean up expired sessions and revoke invalid sessions
 * Deletes sessions where expiredAt is in the past
 * Returns count of deleted sessions
 */
const cleanupExpiredSessionsJob = async (): Promise<number> => {
  try {
    const deletedCount = await cleanupExpiredSessions();
    logger.info(
      `Session cleanup completed: ${String(deletedCount)} expired sessions deleted`,
    );
    return deletedCount;
  } catch (error) {
    logger.error(`Error during session cleanup: ${(error as Error).message}`);
    throw error;
  }
};

/**
 * Revoke all sessions for a user (e.g., on password change)
 *
 * @param userId - User ID whose sessions should be revoked
 * @param reason - Reason for revocation
 */
const revokeUserSessions = async (userId: UserId, reason = "ACCOUNT_SECURITY"): Promise<number> => {
  try {
    const [updatedCount] = await revokeAllSessions(userId, reason);
    logger.info(
      `Revoked ${String(updatedCount)} sessions for user ${userId}: ${reason}`,
    );
    return updatedCount;
  } catch (error) {
    logger.error(`Error revoking sessions for user ${userId}:`, (error as Error).message);
    throw error;
  }
};

/** What initSessionCleanup returns, whatever the schedule. */
interface SessionCleanupHelpers {
  cleanupExpiredSessions: typeof cleanupExpiredSessionsJob;
  revokeUserSessions: typeof revokeUserSessions;
}

/**
 * Initialize the session cleanup cron job
 * Runs according to SESSION_CLEANUP_SCHEDULER from .env
 * Default: Daily at 2:00 AM (0 2 * * *)
 *
 * Every run is recorded and a failure alerts (P7-02, jobMonitor.service). An
 * invalid expression used to reach cron.schedule and throw at boot; it is now
 * refused, logged and alerted like the other schedulers.
 */
const initSessionCleanup = (): SessionCleanupHelpers => {
  const schedule = scheduleSetting("SESSION_CLEANUP_SCHEDULER", "0 2 * * *");
  const helpers: SessionCleanupHelpers = {
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
    void refuseSchedule(JOB, "SESSION_CLEANUP_SCHEDULER", schedule);
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
        logger.error(`Error during scheduled session cleanup: ${(error as Error).message}`);
        throw error;
      }
    }),
  );
  registerJob(JOB, task, schedule);

  return helpers;
};

export = {
  initSessionCleanup,
  cleanupExpiredSessionsJob,
  revokeUserSessions,
};
