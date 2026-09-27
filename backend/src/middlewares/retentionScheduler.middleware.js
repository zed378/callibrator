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
      isFailure: failureOf,
      // ADR-082: a sweep that ran out of its budget alerts as a warning (W-17).
      isIncomplete: (summary) =>
        summary.incomplete > 0
          ? `${summary.incomplete} tenant(s) still hold data past its window after this run's budget`
          : null,
    }),
  );
  registerJob(JOB, task, schedule);
};

/**
 * Why a completed sweep counts as failed, or null. W-16 (ADR-079): a retention
 * value that could not be applied is a failure too; before, it made a tenant
 * silently never purge. W-15: so is an expired GDPR export the sweep could
 * not delete — personal data kept past its expiry.
 *
 * @param {{errors: number, anomalies?: number, exportErrors?: number}} summary
 * @returns {string|null}
 */
function failureOf(summary) {
  const reasons = [];
  if (summary.errors > 0) {
    reasons.push(`${summary.errors} tenant(s) failed during the purge`);
  }
  if (summary.anomalies > 0) {
    reasons.push(
      `${summary.anomalies} retention setting(s) are not a whole number of days ` +
        "(the platform default was applied; the error log names each tenant and key)",
    );
  }
  if (summary.exportErrors > 0) {
    reasons.push(`${summary.exportErrors} expired GDPR export(s) could not be deleted`);
  }
  return reasons.length ? reasons.join("; ") : null;
}

/** One scheduled sweep: logs its summary, rethrows so the run is a failure. */
const runSweep = async () => {
  logger.info("Running data retention sweep...");
  try {
    const summary = await runRetentionSweep();
    logger.info(
      `Retention sweep complete: tenants=${summary.tenants}, ` +
        `purged=${summary.purged}, skipped=${summary.skipped}, ` +
        `errors=${summary.errors}, incomplete=${summary.incomplete}, ` +
        `anomalies=${summary.anomalies}, exportsDeleted=${summary.exportsDeleted}`,
    );
    return summary;
  } catch (error) {
    logger.error(`Error during scheduled retention sweep: ${error.message}`);
    throw error;
  }
};

module.exports = { initRetentionScheduler, failureOf };
