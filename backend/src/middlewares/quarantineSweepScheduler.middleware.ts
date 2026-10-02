// P9-19 (ADR-087): converted from quarantineSweepScheduler.middleware.js, behaviour
// unchanged. Every binding the JavaScript destructured at load is captured at
// load (`const x = loadedX`), so a module whose export is replaced later is not
// read again; `node-cron` stays the module object, read at call time as before.
import cron from "node-cron";
import { scheduleSetting as loadedScheduleSetting } from "../utils/schedulerSwitch.util"; // W-02: one switch for every singleton scheduler
import { logger as loadedLogger } from "./activityLog.middleware";
import { sweepQuarantine as loadedSweepQuarantine } from "../services/quarantineSweep.service";
import {
  runMonitored as loadedRunMonitored,
  registerJob as loadedRegisterJob,
  markDisabled as loadedMarkDisabled,
  refuseSchedule as loadedRefuseSchedule,
} from "../services/jobMonitor.service";

const scheduleSetting = loadedScheduleSetting;
const logger = loadedLogger;
const sweepQuarantine = loadedSweepQuarantine;
const runMonitored = loadedRunMonitored;
const registerJob = loadedRegisterJob;
const markDisabled = loadedMarkDisabled;
const refuseSchedule = loadedRefuseSchedule;

/** What a sweep reports (`quarantineSweep.service#sweepQuarantine`). */
type SweepSummary = Awaited<ReturnType<typeof sweepQuarantine>>;

const JOB = "quarantine-sweep";
const DEFAULT_SCHEDULE = "17 * * * *"; // hourly, off the top of the hour

/**
 * S-33 — hourly removal of files a crash left in `uploads/.quarantine`
 * (services/quarantineSweep.service.ts). QUARANTINE_SWEEP_SCHEDULER sets the
 * cron expression; `disabled` / `off` turns it off. Monitored and alerted
 * like every scheduled job (P7-02).
 */
const initQuarantineSweep = (): void => {
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
    void refuseSchedule(JOB, "QUARANTINE_SWEEP_SCHEDULER", schedule);
    return;
  }

  logger.info(`Quarantine sweep scheduled with: ${schedule}`);
  const task = cron.schedule(schedule, () =>
    runMonitored(JOB, runSweep, {
      isFailure: (summary) =>
        (summary as SweepSummary).errors > 0 ? `${String((summary as SweepSummary).errors)} quarantined file(s) could not be removed` : null,
      // ADR-082: a run that stopped at its entry limit alerts as a warning (W-17).
      isIncomplete: (summary) =>
        (summary as SweepSummary).truncated
          ? `stopped at the entry limit (QUARANTINE_SWEEP_MAX_ENTRIES) with entries left; ${String((summary as SweepSummary).removed)} removed this run`
          : null,
    }),
  );
  registerJob(JOB, task, schedule);
};

/** One sweep: logs only when it removed something. */
const runSweep = async (): Promise<SweepSummary> => {
  const summary = await sweepQuarantine();
  if (summary.removed > 0) {
    logger.warn(
      `Quarantine sweep removed ${String(summary.removed)} abandoned upload(s) (a crash mid-scan leaves them)`,
    );
  }
  return summary;
};

export = { initQuarantineSweep, DEFAULT_SCHEDULE };
