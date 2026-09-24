const cron = require("node-cron");
const { logger } = require("./activityLog.middleware");
const {
  processExpiredGracePeriods,
} = require("../services/tenantLifecycle.service");
const {
  runMonitored,
  registerJob,
  markDisabled,
  refuseSchedule,
} = require("../services/jobMonitor.service");

const JOB = "tenant-lifecycle";

const DEFAULT_SCHEDULE = "30 2 * * *"; // daily at 2:30 AM

/**
 * Initialize the tenant-lifecycle cron job (W-01).
 *
 * Runs according to TENANT_LIFECYCLE_SCHEDULER from .env (default: daily at
 * 2:30 AM), offboarding every suspended tenant whose grace period has passed.
 * Set TENANT_LIFECYCLE_SCHEDULER=disabled to turn it off.
 *
 * This replaces a 24-hour `setInterval` in index.js, which was configurable by
 * nothing and fired only if one process lived a full day — so a deploy more
 * than daily meant it never fired at all.
 */
const initTenantLifecycleScheduler = () => {
  const schedule = process.env.TENANT_LIFECYCLE_SCHEDULER || DEFAULT_SCHEDULE;

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Tenant lifecycle scheduler disabled via TENANT_LIFECYCLE_SCHEDULER");
    markDisabled(JOB, "disabled via TENANT_LIFECYCLE_SCHEDULER");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid TENANT_LIFECYCLE_SCHEDULER cron expression "${schedule}"; tenant lifecycle scheduler not started`,
    );
    refuseSchedule(JOB, "TENANT_LIFECYCLE_SCHEDULER", schedule);
    return;
  }

  logger.info(
    schedule !== DEFAULT_SCHEDULE
      ? `Tenant lifecycle scheduler scheduled with: ${schedule}`
      : "Tenant lifecycle scheduler scheduled at 2:30 AM daily",
  );

  const task = cron.schedule(schedule, () =>
    runMonitored(JOB, runLifecycle, {
      isFailure: (outcome) =>
        outcome.failed > 0 ? `${outcome.failed} tenant(s) failed to offboard` : null,
    }),
  );
  registerJob(JOB, task, schedule);
};

/** One scheduled pass: logs its counts, rethrows so the run is a failure. */
const runLifecycle = async () => {
  logger.info("Running tenant lifecycle processor...");
  try {
    const results = await processExpiredGracePeriods();
    const failed = results.filter((r) => r.action === "failed").length;
    logger.info(
      `Tenant lifecycle processor complete: offboarded=${results.length - failed}, failed=${failed}`,
    );
    return { results, failed };
  } catch (error) {
    logger.error(`Error during scheduled tenant lifecycle run: ${error.message}`);
    throw error;
  }
};

module.exports = { initTenantLifecycleScheduler };
