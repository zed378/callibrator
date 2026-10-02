// P9-19 (ADR-087): converted from retentionScheduler.middleware.js, behaviour
// unchanged. Every binding the JavaScript destructured at load is captured at
// load; `node-cron` stays the module object, read at call time; `failureOf`
// stays a hoisted function declaration.
import cron from "node-cron";
import { scheduleSetting as loadedScheduleSetting } from "../utils/schedulerSwitch.util"; // W-02: one switch for every singleton scheduler
import { logger as loadedLogger } from "./activityLog.middleware";
import { runRetentionSweep as loadedRunRetentionSweep } from "../services/dataRetention.service";
// P10-05 (Q-42): the platform's access requests — expired after 90 days
// pending, deleted 12 months after their decision — in the same nightly run.
import { runAccessRequestRetention as loadedRunAccessRequestRetention } from "../services/accessRequest.service";
import {
  runMonitored as loadedRunMonitored,
  registerJob as loadedRegisterJob,
  markDisabled as loadedMarkDisabled,
  refuseSchedule as loadedRefuseSchedule,
} from "../services/jobMonitor.service";

const scheduleSetting = loadedScheduleSetting;
const logger = loadedLogger;
const runRetentionSweep = loadedRunRetentionSweep;
const runAccessRequestRetention = loadedRunAccessRequestRetention;
const runMonitored = loadedRunMonitored;
const registerJob = loadedRegisterJob;
const markDisabled = loadedMarkDisabled;
const refuseSchedule = loadedRefuseSchedule;

/** The sweep's counts, with what the access-request step adds to them. */
type RetentionSummary = Awaited<ReturnType<typeof runRetentionSweep>> & {
  accessRequestsExpired?: number;
  accessRequestsPurged?: number;
  accessRequestError?: string;
};

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
const initRetentionScheduler = (): void => {
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
    void refuseSchedule(JOB, "RETENTION_SCHEDULER", schedule);
    return;
  }

  logger.info(
    schedule !== DEFAULT_SCHEDULE
      ? `Retention scheduler scheduled with: ${schedule}`
      : "Retention scheduler scheduled at 2:00 AM daily",
  );
  const task = cron.schedule(schedule, () =>
    runMonitored(JOB, runSweep, {
      isFailure: failureOf as (result: unknown) => string | null,
      // ADR-082: a sweep that ran out of its budget alerts as a warning (W-17).
      isIncomplete: (summary) =>
        (summary as RetentionSummary).incomplete > 0
          ? `${String((summary as RetentionSummary).incomplete)} tenant(s) still hold data past its window after this run's budget`
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
 * @param summary - `{ errors, anomalies?, exportErrors?, accessRequestError? }`
 * @returns the reasons, or null
 */
function failureOf(summary: Partial<RetentionSummary>): string | null {
  const reasons: string[] = [];
  if ((summary.errors as number) > 0) {
    reasons.push(`${String(summary.errors)} tenant(s) failed during the purge`);
  }
  if ((summary.anomalies as number) > 0) {
    reasons.push(
      `${String(summary.anomalies)} retention setting(s) are not a whole number of days ` +
        "(the platform default was applied; the error log names each tenant and key)",
    );
  }
  if ((summary.exportErrors as number) > 0) {
    reasons.push(`${String(summary.exportErrors)} expired GDPR export(s) could not be deleted`);
  }
  if (summary.accessRequestError) {
    reasons.push(`the access-request retention step failed: ${summary.accessRequestError}`);
  }
  return reasons.length ? reasons.join("; ") : null;
}

/** One scheduled sweep: logs its summary, rethrows so the run is a failure. */
const runSweep = async (): Promise<RetentionSummary> => {
  logger.info("Running data retention sweep...");
  try {
    const summary: RetentionSummary = await runRetentionSweep();
    // P10-05 (Q-42): its own step, after the tenants. A failure here is a
    // failed run (personal data kept past its period), not a lost sweep.
    try {
      const accessRequests = await runAccessRequestRetention();
      summary.accessRequestsExpired = accessRequests.expired;
      summary.accessRequestsPurged = accessRequests.purged;
    } catch (error) {
      logger.error(`Access-request retention failed: ${(error as Error).message}`);
      summary.accessRequestError = (error as Error).message;
    }
    logger.info(
      `Retention sweep complete: tenants=${String(summary.tenants)}, ` +
        `purged=${String(summary.purged)}, skipped=${String(summary.skipped)}, ` +
        `errors=${String(summary.errors)}, incomplete=${String(summary.incomplete)}, ` +
        `anomalies=${String(summary.anomalies)}, exportsDeleted=${String(summary.exportsDeleted)}`,
    );
    return summary;
  } catch (error) {
    logger.error(`Error during scheduled retention sweep: ${(error as Error).message}`);
    throw error;
  }
};

export = { initRetentionScheduler, failureOf };
