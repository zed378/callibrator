/**
 * P21-09e (P19-04 spec § 4.6, UD-18 (b)) — the nightly deactivation of the bound accounts of client
 * facilities that ended at least their tenant's period ago (services/boundAccountDeactivation).
 * BOUND_ACCOUNT_DEACTIVATION_SCHEDULER sets the cron expression; `disabled` / `off` turns it off,
 * and so does SCHEDULERS_ENABLED=false (ADR-060) — a singleton job. Monitored and alerted like every
 * scheduled job (P7-02). Named exports only.
 */
import cron from "node-cron";
import { scheduleSetting } from "../utils/schedulerSwitch.util";
import { logger } from "./activityLog.middleware";
import { deactivateEndedFacilityAccounts, type DeactivationSummary } from "../services/boundAccountDeactivation.service";
import { markDisabled, refuseSchedule, registerJob, runMonitored } from "../services/jobMonitor.service";

export const BOUND_ACCOUNT_DEACTIVATION_JOB = "bound-account-deactivation";
export const BOUND_ACCOUNT_DEACTIVATION_DEFAULT_SCHEDULE = "37 3 * * *"; // daily, 03:37

/** One run; says what it did. */
export const runBoundAccountDeactivation = async (): Promise<DeactivationSummary> => {
  const summary = await deactivateEndedFacilityAccounts();
  if (summary.errors > 0) {
    logger.warn(`Bound account deactivation failed for ${String(summary.errors)} facility(ies); the next run retries them`);
  }
  if (summary.deactivated > 0) {
    logger.info(`Bound account deactivation: ${String(summary.deactivated)} account(s) of ${String(summary.due)} ended facility(ies) deactivated`);
  }
  return summary;
};

/** Schedule the job (or record why it is not scheduled). */
export const initBoundAccountDeactivation = (): void => {
  const schedule = scheduleSetting("BOUND_ACCOUNT_DEACTIVATION_SCHEDULER", BOUND_ACCOUNT_DEACTIVATION_DEFAULT_SCHEDULE);
  if (schedule === "disabled" || schedule === "off") {
    logger.info("Bound account deactivation disabled via BOUND_ACCOUNT_DEACTIVATION_SCHEDULER");
    markDisabled(BOUND_ACCOUNT_DEACTIVATION_JOB, "disabled via BOUND_ACCOUNT_DEACTIVATION_SCHEDULER");
    return;
  }
  if (!cron.validate(schedule)) {
    logger.error(`Invalid BOUND_ACCOUNT_DEACTIVATION_SCHEDULER cron expression "${schedule}"; bound account deactivation not started`);
    void refuseSchedule(BOUND_ACCOUNT_DEACTIVATION_JOB, "BOUND_ACCOUNT_DEACTIVATION_SCHEDULER", schedule);
    return;
  }
  logger.info(`Bound account deactivation scheduled with: ${schedule}`);
  const task = cron.schedule(schedule, () => runMonitored(BOUND_ACCOUNT_DEACTIVATION_JOB, runBoundAccountDeactivation));
  registerJob(BOUND_ACCOUNT_DEACTIVATION_JOB, task, schedule);
};
