const cron = require("node-cron");
const { scheduleSetting } = require("../utils/schedulerSwitch.util"); // W-02: one switch for every singleton scheduler
const { logger } = require("./activityLog.middleware");
const { sweepQuarantine } = require("../services/quarantineSweep.service");
const {
  runMonitored,
  registerJob,
  markDisabled,
  refuseSchedule,
} = require("../services/jobMonitor.service");

const JOB = "quarantine-sweep";
const DEFAULT_SCHEDULE = "17 * * * *"; // hourly, off the top of the hour

/**
 * S-33 — hourly removal of files a crash left in `uploads/.quarantine`
 * (services/quarantineSweep.service.js). QUARANTINE_SWEEP_SCHEDULER sets the
 * cron expression; `disabled` / `off` turns it off. Monitored and alerted
 * like every scheduled job (P7-02).
 */
const initQuarantineSweep = () => {
  const schedule = scheduleSetting("QUARANTINE_SWEEP_SCHEDULER", DEFAULT_SCHEDULE);

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Quarantine sweep disabled via QUARANTINE_SWEEP_SCHEDULER");
    markDisabled(JOB, "disabled via QUARANTINE_SWEEP_SCHEDULER");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid QUARANTINE_SWEEP_SCHEDULER cron expression "${schedule}"; quarantine sweep not started`,
    );
    refuseSchedule(JOB, "QUARANTINE_SWEEP_SCHEDULER", schedule);
    return;
  }

  logger.info(`Quarantine sweep scheduled with: ${schedule}`);
  const task = cron.schedule(schedule, () =>
    runMonitored(JOB, runSweep, {
      isFailure: (summary) =>
        summary.errors > 0 ? `${summary.errors} quarantined file(s) could not be removed` : null,
    }),
  );
  registerJob(JOB, task, schedule);
};

/** One sweep: logs only when it removed something. */
const runSweep = async () => {
  const summary = await sweepQuarantine();
  if (summary.removed > 0) {
    logger.warn(
      `Quarantine sweep removed ${summary.removed} abandoned upload(s) (a crash mid-scan leaves them)`,
    );
  }
  return summary;
};

module.exports = { initQuarantineSweep, DEFAULT_SCHEDULE };
