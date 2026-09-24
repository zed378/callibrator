const cron = require("node-cron");
const { logger } = require("./activityLog.middleware");
const { runScheduledBackup } = require("../services/scheduledBackup.service");
const {
  runMonitored,
  registerJob,
  markDisabled,
  refuseSchedule,
} = require("../services/jobMonitor.service");

const JOB = "scheduled-backup";

const DEFAULT_SCHEDULE = "0 0 * * *"; // daily at 00:00

/**
 * Start the BACKUP_SCHEDULER job (S-03): a tenant backup of every tenant that
 * is not offboarded, then pruning of expired ones (S-14). What it backs up and
 * why is in services/scheduledBackup.service.js.
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
 * @returns {boolean} true when the job was scheduled
 */
const cronBackup = () => {
  const schedule = process.env.BACKUP_SCHEDULER || DEFAULT_SCHEDULE;

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Scheduled tenant backup disabled via BACKUP_SCHEDULER");
    markDisabled(JOB, "disabled via BACKUP_SCHEDULER");
    return false;
  }

  if (!cron.validate(schedule)) {
    const message = `Invalid BACKUP_SCHEDULER cron expression "${schedule}"; scheduled tenant backup NOT started`;
    logger.error(message);
    process.stderr.write(`[scheduled-backup] ${message}\n`);
    refuseSchedule(JOB, "BACKUP_SCHEDULER", schedule);
    return false;
  }

  logger.info(`Scheduled tenant backup scheduled with: ${schedule}`);

  const task = cron.schedule(schedule, () =>
    runMonitored(JOB, runBackup, { isFailure: failureOf }),
  );
  registerJob(JOB, task, schedule);
  return true;
};

/** One scheduled run; runScheduledBackup records its own outcome file. */
const runBackup = async () => {
  logger.info("Running scheduled tenant backup");
  // runScheduledBackup records and surfaces its own outcome, and never
  // rejects; the catch is for a defect in that promise, not a backup error.
  try {
    return await runScheduledBackup();
  } catch (err) {
    logger.error(`Scheduled tenant backup crashed: ${err.message}`);
    process.stderr.write(`[scheduled-backup] crashed: ${err.message}\n`);
    throw err;
  }
};

/**
 * Why a completed run counts as failed, or null.
 * @param {{ok: boolean, error: string|null, failed: object[], prune: object|null}} outcome
 */
const failureOf = (outcome) => {
  if (outcome.ok) {
    return null;
  }
  if (outcome.error) {
    return outcome.error;
  }
  const prune = outcome.prune || { errors: [], refused: [] };
  return (
    `${outcome.failed.length} tenant backup(s) failed, ` +
    `${prune.errors.length} prune error(s), ${prune.refused.length} prune refusal(s)`
  );
};

module.exports = { cronBackup, DEFAULT_SCHEDULE, failureOf };
