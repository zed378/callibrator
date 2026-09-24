const cron = require("node-cron");
const { logger } = require("./activityLog.middleware");
const { runScheduledBackup } = require("../services/scheduledBackup.service");

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
 * @returns {boolean} true when the job was scheduled
 */
const cronBackup = () => {
  const schedule = process.env.BACKUP_SCHEDULER || DEFAULT_SCHEDULE;

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Scheduled tenant backup disabled via BACKUP_SCHEDULER");
    return false;
  }

  if (!cron.validate(schedule)) {
    const message = `Invalid BACKUP_SCHEDULER cron expression "${schedule}"; scheduled tenant backup NOT started`;
    logger.error(message);
    process.stderr.write(`[scheduled-backup] ${message}\n`);
    return false;
  }

  logger.info(`Scheduled tenant backup scheduled with: ${schedule}`);

  cron.schedule(schedule, async () => {
    logger.info("Running scheduled tenant backup");
    // runScheduledBackup records and surfaces its own outcome, and never
    // rejects; the catch is for a defect in that promise, not a backup error.
    await runScheduledBackup().catch((err) => {
      logger.error(`Scheduled tenant backup crashed: ${err.message}`);
      process.stderr.write(`[scheduled-backup] crashed: ${err.message}\n`);
    });
  });
  return true;
};

module.exports = { cronBackup, DEFAULT_SCHEDULE };
