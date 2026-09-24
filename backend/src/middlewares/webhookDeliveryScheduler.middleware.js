const cron = require("node-cron");
const { logger } = require("./activityLog.middleware");
const { dispatchDue } = require("../services/webhook.service");

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
    const summary = await dispatchDue();
    if (summary.claimed > 0) {
      logger.info(
        `Webhook dispatch: claimed=${summary.claimed}, errors=${summary.errors}`,
      );
    }
    return summary;
  } catch (error) {
    logger.error(`Webhook dispatch failed: ${error.message}`);
    return null;
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
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid WEBHOOK_DISPATCH_SCHEDULER cron expression "${schedule}"; webhook dispatcher not started`,
    );
    return;
  }

  logger.info(`Webhook dispatcher scheduled with: ${schedule}`);
  runDispatch();
  cron.schedule(schedule, runDispatch);
};

module.exports = { initWebhookDeliveryScheduler, runDispatch };
