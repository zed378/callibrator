const cron = require("node-cron");
const { scheduleSetting } = require("../utils/schedulerSwitch.util"); // W-02: one switch for every singleton scheduler
const { logger } = require("./activityLog.middleware");
const { purgeFinishedDeliveries } = require("../services/webhookDeliveryPurge.service");
const {
  runMonitored,
  registerJob,
  markDisabled,
  refuseSchedule,
} = require("../services/jobMonitor.service");

const JOB = "webhook-delivery-purge";
const DEFAULT_SCHEDULE = "43 3 * * *"; // daily, 03:43 — off the hour, after the backups

/**
 * ADR-070 — the daily purge of finished webhook deliveries older than the
 * retention window (services/webhookDeliveryPurge.service.js).
 * WEBHOOK_DELIVERY_PURGE_SCHEDULER sets the cron expression; `disabled` /
 * `off` turns it off, and so does SCHEDULERS_ENABLED=false (ADR-060) — unlike
 * the dispatcher, this is a singleton job. Monitored and alerted like every
 * scheduled job (P7-02).
 */
const initWebhookDeliveryPurge = () => {
  const schedule = scheduleSetting("WEBHOOK_DELIVERY_PURGE_SCHEDULER", DEFAULT_SCHEDULE);

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Webhook delivery purge disabled via WEBHOOK_DELIVERY_PURGE_SCHEDULER");
    markDisabled(JOB, "disabled via WEBHOOK_DELIVERY_PURGE_SCHEDULER");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid WEBHOOK_DELIVERY_PURGE_SCHEDULER cron expression "${schedule}"; webhook delivery purge not started`,
    );
    refuseSchedule(JOB, "WEBHOOK_DELIVERY_PURGE_SCHEDULER", schedule);
    return;
  }

  logger.info(`Webhook delivery purge scheduled with: ${schedule}`);
  const task = cron.schedule(schedule, () => runMonitored(JOB, runPurge));
  registerJob(JOB, task, schedule);
};

/** One purge; says so when it removed rows, and warns when it hit its bound. */
const runPurge = async () => {
  const summary = await purgeFinishedDeliveries();
  if (summary.stoppedEarly) {
    logger.warn(
      `Webhook delivery purge removed ${summary.deleted} row(s) and stopped at its per-run bound; the next run continues`,
    );
  } else if (summary.deleted > 0) {
    logger.info(
      `Webhook delivery purge removed ${summary.deleted} finished delivery row(s) older than ${summary.retentionDays} days`,
    );
  }
  return summary;
};

module.exports = { initWebhookDeliveryPurge, DEFAULT_SCHEDULE };
