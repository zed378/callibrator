const cron = require("node-cron");
const { logger } = require("./activityLog.middleware");
const { dispatchDue } = require("../services/webhook.service");
const {
  runMonitored,
  registerJob,
  markDisabled,
  refuseSchedule,
} = require("../services/jobMonitor.service");

const JOB = "webhook-dispatch";

// Every 15 seconds (node-cron's optional seconds field). Each tick claims at
// most WEBHOOK_DISPATCH_BATCH due deliveries; the first attempt of a new event
// does not wait for a tick (webhook.service#emitEvent attempts it at once).
const DEFAULT_SCHEDULE = "*/15 * * * * *";

let running = false;

/**
 * One dispatcher pass. A pass still running when the next tick fires is not
 * overlapped — the next tick is skipped. Across replicas no guard is needed:
 * the claim is `FOR UPDATE SKIP LOCKED` plus a lease (webhook.service#claim).
 *
 * @returns {Promise<{claimed: number, errors: number}|null>} null when skipped
 *   or when the pass itself failed (logged)
 */
const runDispatch = async () => {
  if (running) {
    return null;
  }
  running = true;
  try {
    // A pass that throws is a failed run (recorded, alerted once per streak);
    // deliveries a receiver refused are the dispatcher WORKING, not failing.
    const run = await runMonitored(JOB, async () => {
      try {
        const summary = await dispatchDue();
        if (summary.claimed > 0) {
          logger.info(
            `Webhook dispatch: claimed=${summary.claimed}, errors=${summary.errors}`,
          );
        }
        return summary;
      } catch (error) {
        logger.error(`Webhook dispatch failed: ${error.message}`);
        throw error;
      }
    });
    return run.outcome === "success" ? run.result : null;
  } finally {
    running = false;
  }
};

/**
 * Start the durable webhook dispatcher (A-10, ADR-054).
 *
 * It runs ONE pass immediately — that is what makes a restart resume the
 * retries the previous process had scheduled — and then on
 * WEBHOOK_DISPATCH_SCHEDULER (default every 15 s). `disabled` / `off` turns it
 * off: first attempts still happen at emit time, but no retry is ever made.
 */
const initWebhookDeliveryScheduler = () => {
  const schedule = process.env.WEBHOOK_DISPATCH_SCHEDULER || DEFAULT_SCHEDULE;

  if (schedule === "disabled" || schedule === "off") {
    logger.warn(
      "Webhook dispatcher disabled via WEBHOOK_DISPATCH_SCHEDULER: failed deliveries will not be retried",
    );
    markDisabled(JOB, "disabled via WEBHOOK_DISPATCH_SCHEDULER");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid WEBHOOK_DISPATCH_SCHEDULER cron expression "${schedule}"; webhook dispatcher not started`,
    );
    refuseSchedule(JOB, "WEBHOOK_DISPATCH_SCHEDULER", schedule);
    return;
  }

  logger.info(`Webhook dispatcher scheduled with: ${schedule}`);
  runDispatch();
  registerJob(JOB, cron.schedule(schedule, runDispatch), schedule);
};

module.exports = { initWebhookDeliveryScheduler, runDispatch };
