const cron = require("node-cron");
const { logger } = require("./activityLog.middleware");
const { runRetentionSweep } = require("../services/dataRetention.service");

const DEFAULT_SCHEDULE = "0 2 * * *"; // daily at 2:00 AM

/**
 * Initialize the data-retention purge cron job.
 *
 * Runs according to RETENTION_SCHEDULER from .env (default: daily at 2:00 AM),
 * sweeping every tenant and deleting records past their retention window (legal
 * holds are respected inside purgeExpiredRecords). Set RETENTION_SCHEDULER=
 * disabled to turn it off. This closes the "purge is implemented but nothing
 * schedules it" gap — previously retention only ran on a manual admin call.
 */
const initRetentionScheduler = () => {
  const schedule = process.env.RETENTION_SCHEDULER || DEFAULT_SCHEDULE;

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Retention scheduler disabled via RETENTION_SCHEDULER");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid RETENTION_SCHEDULER cron expression "${schedule}"; retention scheduler not started`,
    );
    return;
  }

  logger.info(
    schedule !== DEFAULT_SCHEDULE
      ? `Retention scheduler scheduled with: ${schedule}`
      : "Retention scheduler scheduled at 2:00 AM daily",
  );

  cron.schedule(schedule, async () => {
    logger.info("Running data retention sweep...");
    try {
      const summary = await runRetentionSweep();
      logger.info(
        `Retention sweep complete: tenants=${summary.tenants}, ` +
          `purged=${summary.purged}, skipped=${summary.skipped}, ` +
          `errors=${summary.errors}`,
      );
    } catch (error) {
      logger.error(`Error during scheduled retention sweep: ${error.message}`);
    }
  });
};

module.exports = { initRetentionScheduler };
