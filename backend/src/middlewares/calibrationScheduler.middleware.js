const cron = require("node-cron");
const { logger } = require("./activityLog.middleware");
const {
  runCalibrationScan,
} = require("../services/calibrationScheduler.service");

const DEFAULT_SCHEDULE = "0 1 * * *"; // daily at 1:00 AM

/**
 * Initialize the calibration scheduler cron job.
 * Runs according to CALIBRATION_SCHEDULER from .env (default: daily at 1:00 AM).
 * Set CALIBRATION_SCHEDULER=disabled to turn it off.
 */
const initCalibrationScheduler = () => {
  const schedule = process.env.CALIBRATION_SCHEDULER || DEFAULT_SCHEDULE;

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Calibration scheduler disabled via CALIBRATION_SCHEDULER");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid CALIBRATION_SCHEDULER cron expression "${schedule}"; calibration scheduler not started`,
    );
    return;
  }

  logger.info(
    schedule !== DEFAULT_SCHEDULE
      ? `Calibration scheduler scheduled with: ${schedule}`
      : "Calibration scheduler scheduled at 1:00 AM daily",
  );

  cron.schedule(schedule, async () => {
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
    } catch (error) {
      logger.error(`Error during scheduled calibration scan: ${error.message}`);
    }
  });
};

module.exports = { initCalibrationScheduler };
