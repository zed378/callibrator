// P9-19 (ADR-087): converted from webhookDeliveryPurgeScheduler.middleware.js,
// behaviour unchanged. Every binding the JavaScript destructured at load is
// captured at load; `node-cron` stays the module object, read at call time.
import cron from "node-cron";
import { scheduleSetting as loadedScheduleSetting } from "../utils/schedulerSwitch.util"; // W-02: one switch for every singleton scheduler
import { logger as loadedLogger } from "./activityLog.middleware";
import { purgeFinishedDeliveries as loadedPurgeFinishedDeliveries } from "../services/webhookDeliveryPurge.service";
import {
  runMonitored as loadedRunMonitored,
  registerJob as loadedRegisterJob,
  markDisabled as loadedMarkDisabled,
  refuseSchedule as loadedRefuseSchedule,
} from "../services/jobMonitor.service";

const scheduleSetting = loadedScheduleSetting;
const logger = loadedLogger;
const purgeFinishedDeliveries = loadedPurgeFinishedDeliveries;
const runMonitored = loadedRunMonitored;
const registerJob = loadedRegisterJob;
const markDisabled = loadedMarkDisabled;
const refuseSchedule = loadedRefuseSchedule;

/** What a purge reports (`webhookDeliveryPurge.service#purgeFinishedDeliveries`). */
type PurgeSummary = Awaited<ReturnType<typeof purgeFinishedDeliveries>>;

const JOB = "webhook-delivery-purge";
const DEFAULT_SCHEDULE = "43 3 * * *"; // daily, 03:43 — off the hour, after the backups

/**
 * ADR-070 — the daily purge of finished webhook deliveries older than the
 * retention window (services/webhookDeliveryPurge.service.ts).
 * WEBHOOK_DELIVERY_PURGE_SCHEDULER sets the cron expression; `disabled` /
 * `off` turns it off, and so does SCHEDULERS_ENABLED=false (ADR-060) — unlike
 * the dispatcher, this is a singleton job. Monitored and alerted like every
 * scheduled job (P7-02).
 */
const initWebhookDeliveryPurge = (): void => {
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
    void refuseSchedule(JOB, "WEBHOOK_DELIVERY_PURGE_SCHEDULER", schedule);
    return;
  }

  logger.info(`Webhook delivery purge scheduled with: ${schedule}`);
  const task = cron.schedule(schedule, () => runMonitored(JOB, runPurge));
  registerJob(JOB, task, schedule);
};

/** One purge; says so when it removed rows, and warns when it hit its bound. */
const runPurge = async (): Promise<PurgeSummary> => {
  const summary = await purgeFinishedDeliveries();
  if (summary.stoppedEarly) {
    logger.warn(
      `Webhook delivery purge removed ${String(summary.deleted)} row(s) and stopped at its per-run bound; the next run continues`,
    );
  } else if (summary.deleted > 0) {
    logger.info(
      `Webhook delivery purge removed ${String(summary.deleted)} finished delivery row(s) older than ${String(summary.retentionDays)} days`,
    );
  }
  return summary;
};

export = { initWebhookDeliveryPurge, DEFAULT_SCHEDULE };
