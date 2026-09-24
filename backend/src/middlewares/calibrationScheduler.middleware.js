const cron = require("node-cron");
const { scheduleSetting } = require("../utils/schedulerSwitch.util"); // W-02: one switch for every singleton scheduler
const { logger } = require("./activityLog.middleware");
const {
  runCalibrationScan,
} = require("../services/calibrationScheduler.service");
const {
  runMonitored,
  registerJob,
  markDisabled,
  refuseSchedule,
} = require("../services/jobMonitor.service");

const JOB = "calibration-scan";

const DEFAULT_SCHEDULE = "0 1 * * *"; // daily at 1:00 AM

/**
 * Initialize the calibration scheduler cron job.
 * Runs according to CALIBRATION_SCHEDULER from .env (default: daily at 1:00 AM).
 * Set CALIBRATION_SCHEDULER=disabled to turn it off.
 *
 * Every run is recorded and a failure alerts (P7-02, jobMonitor.service): a
 * scan that throws, or one that finishes with per-device errors, is a failed
 * run — "overdue devices got no work order" must not read as success.
 */
const initCalibrationScheduler = () => {
  const schedule = scheduleSetting("CALIBRATION_SCHEDULER", DEFAULT_SCHEDULE);

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Calibration scheduler disabled via CALIBRATION_SCHEDULER");
    markDisabled(JOB, "disabled via CALIBRATION_SCHEDULER");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid CALIBRATION_SCHEDULER cron expression "${schedule}"; calibration scheduler not started`,
    );
    refuseSchedule(JOB, "CALIBRATION_SCHEDULER", schedule);
    return;
  }

  logger.info(
    schedule !== DEFAULT_SCHEDULE
      ? `Calibration scheduler scheduled with: ${schedule}`
      : "Calibration scheduler scheduled at 1:00 AM daily",
  );

  const task = cron.schedule(schedule, () =>
    runMonitored(JOB, runScan, {
      isFailure: (summary) =>
        summary.errors > 0
          ? `${summary.errors} device(s) failed during the scan`
          : null,
    }),
  );
  registerJob(JOB, task, schedule);
};

/** One scheduled scan: logs its summary, rethrows so the run is a failure. */
const runScan = async () => {
  logger.info("Running calibration scheduler scan...");
  try {
    const summary = await runCalibrationScan();
    logger.info(
      `Calibration scan complete: scanned=${summary.scanned}, ` +
        `workOrdersCreated=${summary.workOrdersCreated}, ` +
        `notificationsCreated=${summary.notificationsCreated}, ` +
        `skipped=${summary.skipped}, overdue=${summary.overdue}, ` +
        `errors=${summary.errors}`,
    );
    return summary;
  } catch (error) {
    logger.error(`Error during scheduled calibration scan: ${error.message}`);
    throw error;
  }
};

module.exports = { initCalibrationScheduler };
