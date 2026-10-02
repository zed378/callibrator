// P9-19 (ADR-087): converted from webhookDeliveryScheduler.middleware.js,
// behaviour unchanged. Every binding the JavaScript destructured at load is
// captured at load; `node-cron` stays the module object, read at call time.
// The schedule is read through config/env at call time, as `process.env` was.
import cron from "node-cron";
import { envOr } from "../config/env";
import { logger as loadedLogger } from "./activityLog.middleware";
import webhookService from "../services/webhook.service";
import jobMonitor from "../services/jobMonitor.service";

const logger = loadedLogger;
const { dispatchDue } = webhookService;
const { runMonitored, registerJob, markDisabled, refuseSchedule } = jobMonitor;

/** What one dispatcher pass reports (`webhook.service#dispatchDue`). */
type DispatchSummary = Awaited<ReturnType<typeof dispatchDue>>;

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
 * @returns the pass's summary; null when skipped or when the pass itself
 *   failed (logged)
 */
const runDispatch = async (): Promise<DispatchSummary | null> => {
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
            `Webhook dispatch: claimed=${String(summary.claimed)}, errors=${String(summary.errors)}`,
          );
        }
        return summary;
      } catch (error) {
        logger.error(`Webhook dispatch failed: ${String((error as { message?: unknown }).message)}`);
        throw error;
      }
    });
    return run.outcome === "success" ? (run.result as DispatchSummary) : null;
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
const initWebhookDeliveryScheduler = (): void => {
  const schedule = envOr("WEBHOOK_DISPATCH_SCHEDULER", DEFAULT_SCHEDULE);

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
    void refuseSchedule(JOB, "WEBHOOK_DISPATCH_SCHEDULER", schedule);
    return;
  }

  logger.info(`Webhook dispatcher scheduled with: ${schedule}`);
  void runDispatch();
  registerJob(JOB, cron.schedule(schedule, runDispatch), schedule);
};

export = { initWebhookDeliveryScheduler, runDispatch };
