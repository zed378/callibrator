/**
 * P21-03b (spec P19-02 § 9.1) — the nightly purge of `Idempotency-Key` rows past `expires_at`
 * (30 days), across every tenant (services/idempotency.service#purgeExpiredIdempotencyKeys).
 * IDEMPOTENCY_KEY_PURGE_SCHEDULER sets the cron expression; `disabled` / `off` turns it off, and so
 * does SCHEDULERS_ENABLED=false (ADR-060, a singleton job). Monitored like every scheduled job
 * (P7-02). No audit row per key — they are plumbing; the run logs its count.
 */
import cron from "node-cron";
import { scheduleSetting } from "../utils/schedulerSwitch.util";
import { logger } from "./activityLog.middleware";
import { purgeExpiredIdempotencyKeys } from "../services/idempotency.service";
import { markDisabled, refuseSchedule, registerJob, runMonitored } from "../services/jobMonitor.service";

const JOB = "idempotency-key-purge";
const SETTING = "IDEMPOTENCY_KEY_PURGE_SCHEDULER";
/** Daily, 03:53 — off the hour, after the other purges. */
export const DEFAULT_SCHEDULE = "53 3 * * *";

/** One purge; logs what it removed, and warns when it stopped at its bound. */
export const runPurge = async (): Promise<Awaited<ReturnType<typeof purgeExpiredIdempotencyKeys>>> => {
  const summary = await purgeExpiredIdempotencyKeys();
  if (summary.stoppedEarly) {
    logger.warn(`Idempotency key purge removed ${String(summary.deleted)} row(s) and stopped at its per-run bound; the next run continues`);
  } else if (summary.deleted > 0) {
    logger.info(`Idempotency key purge removed ${String(summary.deleted)} expired key(s)`);
  }
  return summary;
};

/** Start the job (index.ts, on the scheduler pod). */
export const initIdempotencyKeyPurge = (): void => {
  const schedule = scheduleSetting(SETTING, DEFAULT_SCHEDULE);
  if (schedule === "disabled" || schedule === "off") {
    logger.info(`Idempotency key purge disabled via ${SETTING}`);
    markDisabled(JOB, `disabled via ${SETTING}`);
    return;
  }
  if (!cron.validate(schedule)) {
    logger.error(`Invalid ${SETTING} cron expression "${schedule}"; idempotency key purge not started`);
    void refuseSchedule(JOB, SETTING, schedule);
    return;
  }
  logger.info(`Idempotency key purge scheduled with: ${schedule}`);
  const task = cron.schedule(schedule, () => runMonitored(JOB, runPurge));
  registerJob(JOB, task, schedule);
};
