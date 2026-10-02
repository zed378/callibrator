// P9-19 (ADR-087): converted from calibrationScheduler.middleware.js, behaviour
// unchanged. Every binding the JavaScript destructured at load is captured at
// load; `node-cron` stays the module object, read at call time.
import cron from "node-cron";
import { scheduleSetting as loadedScheduleSetting } from "../utils/schedulerSwitch.util"; // W-02: one switch for every singleton scheduler
import { logger as loadedLogger } from "./activityLog.middleware";
import { runCalibrationScan as loadedRunCalibrationScan } from "../services/calibrationScheduler.service";
import {
  runMonitored as loadedRunMonitored,
  registerJob as loadedRegisterJob,
  markDisabled as loadedMarkDisabled,
  refuseSchedule as loadedRefuseSchedule,
} from "../services/jobMonitor.service";

const scheduleSetting = loadedScheduleSetting;
const logger = loadedLogger;
const runCalibrationScan = loadedRunCalibrationScan;
const runMonitored = loadedRunMonitored;
const registerJob = loadedRegisterJob;
const markDisabled = loadedMarkDisabled;
const refuseSchedule = loadedRefuseSchedule;

/** What a scan reports (`calibrationScheduler.service#runCalibrationScan`). */
type ScanSummary = Awaited<ReturnType<typeof runCalibrationScan>>;

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
const initCalibrationScheduler = (): void => {
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
    void refuseSchedule(JOB, "CALIBRATION_SCHEDULER", schedule);
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
        (summary as ScanSummary).errors > 0
          ? `${String((summary as ScanSummary).errors)} device(s) failed during the scan`
          : null,
    }),
  );
  registerJob(JOB, task, schedule);
};

/** One scheduled scan: logs its summary, rethrows so the run is a failure. */
const runScan = async (): Promise<ScanSummary> => {
  logger.info("Running calibration scheduler scan...");
  try {
    const summary = await runCalibrationScan();
    logger.info(
      `Calibration scan complete: scanned=${String(summary.scanned)}, ` +
        `workOrdersCreated=${String(summary.workOrdersCreated)}, ` +
        `notificationsCreated=${String(summary.notificationsCreated)}, ` +
        `skipped=${String(summary.skipped)}, overdue=${String(summary.overdue)}, ` +
        `errors=${String(summary.errors)}`,
    );
    return summary;
  } catch (error) {
    logger.error(`Error during scheduled calibration scan: ${(error as Error).message}`);
    throw error;
  }
};

export = { initCalibrationScheduler };
