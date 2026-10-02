// P9-19 (ADR-087): converted from tenantLifecycleScheduler.middleware.js,
// behaviour unchanged. Every binding the JavaScript destructured at load is
// captured at load; `node-cron` stays the module object, read at call time.
import cron from "node-cron";
import { scheduleSetting as loadedScheduleSetting } from "../utils/schedulerSwitch.util"; // W-02: one switch for every singleton scheduler
import { logger as loadedLogger } from "./activityLog.middleware";
import { processExpiredGracePeriods as loadedProcessExpiredGracePeriods } from "../services/tenantLifecycle.service";
import {
  runMonitored as loadedRunMonitored,
  registerJob as loadedRegisterJob,
  markDisabled as loadedMarkDisabled,
  refuseSchedule as loadedRefuseSchedule,
} from "../services/jobMonitor.service";

const scheduleSetting = loadedScheduleSetting;
const logger = loadedLogger;
const processExpiredGracePeriods = loadedProcessExpiredGracePeriods;
const runMonitored = loadedRunMonitored;
const registerJob = loadedRegisterJob;
const markDisabled = loadedMarkDisabled;
const refuseSchedule = loadedRefuseSchedule;

/** One pass: what each tenant got, and how many failed. */
interface LifecycleOutcome {
  results: Awaited<ReturnType<typeof processExpiredGracePeriods>>;
  failed: number;
}

const JOB = "tenant-lifecycle";
const DEFAULT_SCHEDULE = "30 2 * * *"; // daily at 2:30 AM

/**
 * Initialize the tenant-lifecycle cron job (W-01).
 *
 * Runs according to TENANT_LIFECYCLE_SCHEDULER from .env (default: daily at
 * 2:30 AM), offboarding every suspended tenant whose grace period has passed.
 * Set TENANT_LIFECYCLE_SCHEDULER=disabled to turn it off.
 *
 * This replaces a 24-hour `setInterval` in index.js, which was configurable by
 * nothing and fired only if one process lived a full day — so a deploy more
 * than daily meant it never fired at all.
 */
const initTenantLifecycleScheduler = (): void => {
  const schedule = scheduleSetting("TENANT_LIFECYCLE_SCHEDULER", DEFAULT_SCHEDULE);

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Tenant lifecycle scheduler disabled via TENANT_LIFECYCLE_SCHEDULER");
    markDisabled(JOB, "disabled via TENANT_LIFECYCLE_SCHEDULER");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid TENANT_LIFECYCLE_SCHEDULER cron expression "${schedule}"; tenant lifecycle scheduler not started`,
    );
    void refuseSchedule(JOB, "TENANT_LIFECYCLE_SCHEDULER", schedule);
    return;
  }

  logger.info(
    schedule !== DEFAULT_SCHEDULE
      ? `Tenant lifecycle scheduler scheduled with: ${schedule}`
      : "Tenant lifecycle scheduler scheduled at 2:30 AM daily",
  );
  const task = cron.schedule(schedule, () =>
    runMonitored(JOB, runLifecycle, {
      isFailure: (outcome) =>
        (outcome as LifecycleOutcome).failed > 0 ? `${String((outcome as LifecycleOutcome).failed)} tenant(s) failed to offboard` : null,
    }),
  );
  registerJob(JOB, task, schedule);
};

/** One scheduled pass: logs its counts, rethrows so the run is a failure. */
const runLifecycle = async (): Promise<LifecycleOutcome> => {
  logger.info("Running tenant lifecycle processor...");
  try {
    const results = await processExpiredGracePeriods();
    const failed = results.filter((r) => r.action === "failed").length;
    logger.info(
      `Tenant lifecycle processor complete: offboarded=${String(results.length - failed)}, failed=${String(failed)}`,
    );
    return { results, failed };
  } catch (error) {
    logger.error(`Error during scheduled tenant lifecycle run: ${(error as Error).message}`);
    throw error;
  }
};

export = { initTenantLifecycleScheduler };
