const cron = require("node-cron");
const { scheduleSetting } = require("../utils/schedulerSwitch.util"); // W-02: one switch for every singleton scheduler
const { logger } = require("./activityLog.middleware");
const { runRetentionSweep } = require("../services/dataRetention.service");
const {
  runMonitored,
  registerJob,
  markDisabled,
  refuseSchedule,
} = require("../services/jobMonitor.service");

const JOB = "retention-sweep";

const DEFAULT_SCHEDULE = "0 2 * * *"; // daily at 2:00 AM

/**
 * Initialize the data-retention purge cron job.
 *
 * Runs according to RETENTION_SCHEDULER from .env (default: daily at 2:00 AM),
 * sweeping every tenant and deleting records past their retention window (legal
 * holds are respected inside purgeExpiredRecords). Set RETENTION_SCHEDULER=
 * disabled to turn it off. This closes the "purge is implemented but nothing
 * schedules it" gap — previously retention only ran on a manual admin call.
 *
 * Every run is recorded and a failure alerts (P7-02, jobMonitor.service). The
 * purge failed every night with `column "tenantId" does not exist` until
 * somebody looked; a sweep that throws, or finishes with per-tenant errors,
 * is now a failed run that wakes somebody.
 */
const initRetentionScheduler = () => {
  const schedule = scheduleSetting("RETENTION_SCHEDULER", DEFAULT_SCHEDULE);

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Retention scheduler disabled via RETENTION_SCHEDULER");
    markDisabled(JOB, "disabled via RETENTION_SCHEDULER");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid RETENTION_SCHEDULER cron expression "${schedule}"; retention scheduler not started`,
    );
    refuseSchedule(JOB, "RETENTION_SCHEDULER", schedule);
    return;
  }

  logger.info(
    schedule !== DEFAULT_SCHEDULE
      ? `Retention scheduler scheduled with: ${schedule}`
      : "Retention scheduler scheduled at 2:00 AM daily",
  );

  const task = cron.schedule(schedule, () =>
    runMonitored(JOB, runSweep, {
      isFailure: (summary) =>
        summary.errors > 0
          ? `${summary.errors} tenant(s) failed during the purge`
          : null,
    }),
  );
  registerJob(JOB, task, schedule);
};

/** One scheduled sweep: logs its summary, rethrows so the run is a failure. */
const runSweep = async () => {
  logger.info("Running data retention sweep...");
  try {
    const summary = await runRetentionSweep();
    logger.info(
      `Retention sweep complete: tenants=${summary.tenants}, ` +
        `purged=${summary.purged}, skipped=${summary.skipped}, ` +
        `errors=${summary.errors}`,
    );
    return summary;
  } catch (error) {
    logger.error(`Error during scheduled retention sweep: ${error.message}`);
    throw error;
  }
};

module.exports = { initRetentionScheduler };
