// P9-19 (ADR-087): converted from backup.middleware.js, behaviour unchanged.
// Every binding the JavaScript destructured at load is captured at load;
// `node-cron` stays the module object, read at call time.
import cron from "node-cron";
import { scheduleSetting as loadedScheduleSetting } from "../utils/schedulerSwitch.util"; // W-02: one switch for every singleton scheduler
import { logger as loadedLogger } from "./activityLog.middleware";
import { runScheduledBackup as loadedRunScheduledBackup } from "../services/scheduledBackup.service";
import {
  runMonitored as loadedRunMonitored,
  registerJob as loadedRegisterJob,
  markDisabled as loadedMarkDisabled,
  refuseSchedule as loadedRefuseSchedule,
} from "../services/jobMonitor.service";

const scheduleSetting = loadedScheduleSetting;
const logger = loadedLogger;
const runScheduledBackup = loadedRunScheduledBackup;
const runMonitored = loadedRunMonitored;
const registerJob = loadedRegisterJob;
const markDisabled = loadedMarkDisabled;
const refuseSchedule = loadedRefuseSchedule;

const JOB = "scheduled-backup";
const DEFAULT_SCHEDULE = "0 0 * * *"; // daily at 00:00

/** A completed run's outcome, as `failureOf` reads it. */
interface BackupOutcome {
  ok: boolean;
  error: string | null;
  failed: unknown[];
  prune: { errors: unknown[]; refused: unknown[] } | null;
}

/**
 * Start the BACKUP_SCHEDULER job (S-03): a tenant backup of every tenant that
 * is not offboarded, then pruning of expired ones (S-14). What it backs up and
 * why is in services/scheduledBackup.service.ts.
 *
 * BACKUP_SCHEDULER is a cron expression (default daily at 00:00);
 * `disabled` / `off` turns the job off. An invalid expression is refused
 * loudly — on stderr as well as the log — rather than silently scheduling a
 * default: a backup the operator believes is scheduled and is not is the
 * failure this job used to be.
 *
 * It replaced a job that zipped `data/` and `log/` from inside the pkg
 * snapshot and wrote nothing (S-03).
 *
 * P7-02 / S-33: the run goes through jobMonitor.service, which records it,
 * alerts on a failed run (`ok: false`), and — because this is a singleton
 * job — claims the scheduled minute in Redis first, so two replicas do not
 * both back up every tenant.
 *
 * @returns true when the job was scheduled
 */
const cronBackup = (): boolean => {
  const schedule = scheduleSetting("BACKUP_SCHEDULER", DEFAULT_SCHEDULE);

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Scheduled tenant backup disabled via BACKUP_SCHEDULER");
    markDisabled(JOB, "disabled via BACKUP_SCHEDULER");
    return false;
  }

  if (!cron.validate(schedule)) {
    const message = `Invalid BACKUP_SCHEDULER cron expression "${schedule}"; scheduled tenant backup NOT started`;
    logger.error(message);
    process.stderr.write(`[scheduled-backup] ${message}\n`);
    void refuseSchedule(JOB, "BACKUP_SCHEDULER", schedule);
    return false;
  }

  logger.info(`Scheduled tenant backup scheduled with: ${schedule}`);
  const task = cron.schedule(schedule, () =>
    runMonitored(JOB, runBackup, { isFailure: failureOf as (result: unknown) => string | null }),
  );
  registerJob(JOB, task, schedule);
  return true;
};

/** One scheduled run; runScheduledBackup records its own outcome file. */
const runBackup = async (): Promise<unknown> => {
  logger.info("Running scheduled tenant backup");
  // runScheduledBackup records and surfaces its own outcome, and never
  // rejects; the catch is for a defect in that promise, not a backup error.
  try {
    return await runScheduledBackup();
  } catch (err) {
    logger.error(`Scheduled tenant backup crashed: ${(err as Error).message}`);
    process.stderr.write(`[scheduled-backup] crashed: ${(err as Error).message}\n`);
    throw err;
  }
};

/**
 * Why a completed run counts as failed, or null.
 *
 * @param outcome - `{ ok, error, failed, prune }`
 * @returns the reason, or null for a run that succeeded
 */
const failureOf = (outcome: BackupOutcome): string | null => {
  if (outcome.ok) {
    return null;
  }
  if (outcome.error) {
    return outcome.error;
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `outcome.prune || {...}`
  const prune = outcome.prune || { errors: [], refused: [] };
  return (
    `${String(outcome.failed.length)} tenant backup(s) failed, ` +
    `${String(prune.errors.length)} prune error(s), ${String(prune.refused.length)} prune refusal(s)`
  );
};

export = { cronBackup, DEFAULT_SCHEDULE, failureOf };
