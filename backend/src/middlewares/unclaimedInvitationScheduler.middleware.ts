/**
 * P24-09b (ADR-139 § 5) — the nightly deactivation of imported accounts whose first invitation is 30
 * days old and still unclaimed (services/unclaimedInvitation). UNCLAIMED_INVITATION_SCHEDULER sets the
 * cron expression; `disabled` / `off` turns it off, and so does SCHEDULERS_ENABLED=false (ADR-060) —
 * a singleton job. Monitored and alerted like every scheduled job (P7-02). Named exports only.
 */
import cron from "node-cron";
import { scheduleSetting } from "../utils/schedulerSwitch.util";
import { logger } from "./activityLog.middleware";
import { deactivateUnclaimedAccounts, type UnclaimedSummary } from "../services/unclaimedInvitation.service";
import { markDisabled, refuseSchedule, registerJob, runMonitored } from "../services/jobMonitor.service";

export const UNCLAIMED_INVITATION_JOB = "unclaimed-invitation";
export const UNCLAIMED_INVITATION_DEFAULT_SCHEDULE = "47 3 * * *"; // daily, 03:47

/** One run; says what it did. */
export const runUnclaimedInvitation = async (): Promise<UnclaimedSummary> => {
  const summary = await deactivateUnclaimedAccounts();
  if (summary.errors > 0) {
    logger.warn(`Unclaimed invitation deactivation failed for ${String(summary.errors)} account(s); the next run retries them`);
  }
  if (summary.deactivated > 0) {
    logger.info(`Unclaimed invitation deactivation: ${String(summary.deactivated)} of ${String(summary.examined)} awaiting account(s) deactivated`);
  }
  return summary;
};

/** Schedule the job (or record why it is not scheduled). */
export const initUnclaimedInvitation = (): void => {
  const schedule = scheduleSetting("UNCLAIMED_INVITATION_SCHEDULER", UNCLAIMED_INVITATION_DEFAULT_SCHEDULE);
  if (schedule === "disabled" || schedule === "off") {
    logger.info("Unclaimed invitation deactivation disabled via UNCLAIMED_INVITATION_SCHEDULER");
    markDisabled(UNCLAIMED_INVITATION_JOB, "disabled via UNCLAIMED_INVITATION_SCHEDULER");
    return;
  }
  if (!cron.validate(schedule)) {
    logger.error(`Invalid UNCLAIMED_INVITATION_SCHEDULER cron expression "${schedule}"; unclaimed invitation deactivation not started`);
    void refuseSchedule(UNCLAIMED_INVITATION_JOB, "UNCLAIMED_INVITATION_SCHEDULER", schedule);
    return;
  }
  logger.info(`Unclaimed invitation deactivation scheduled with: ${schedule}`);
  const task = cron.schedule(schedule, () => runMonitored(UNCLAIMED_INVITATION_JOB, runUnclaimedInvitation));
  registerJob(UNCLAIMED_INVITATION_JOB, task, schedule);
};
