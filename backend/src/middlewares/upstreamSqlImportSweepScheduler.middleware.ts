/**
 * P24-06 — the SQL-dump import's hourly sweep (services/upstreamSqlImport.service.ts
 * #sweepUpstreamSqlImports): a run whose worker died is failed `INTERRUPTED`; a failed
 * run's file is deleted when its retention (UPSTREAM_IMPORT_FAILED_RETENTION_DAYS) ends;
 * a file in the dump directory that no run points at is deleted. The dump is personal
 * data: it must not outlive its purpose (UU PDP minimisation, docs/UPSTREAM/06-DPIA.md § 6).
 *
 * UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER sets the cron expression; `disabled` / `off` turns
 * it off. Monitored and alerted like every scheduled job (P7-02), the quarantine sweep's
 * pattern.
 */
import cron from "node-cron";
import { scheduleSetting } from "../utils/schedulerSwitch.util";
import { logger } from "./activityLog.middleware";
import { sweepUpstreamSqlImports, type SweepSummary } from "../services/upstreamSqlImport.service";
import jobMonitor from "../services/jobMonitor.service";

const { markDisabled, refuseSchedule, registerJob, runMonitored } = jobMonitor;

const JOB = "upstream-sql-import-sweep";
export const DEFAULT_SCHEDULE = "41 * * * *"; // hourly, off the quarantine sweep's minute

/** One sweep: logs only when it did something. */
export const runSweep = async (): Promise<SweepSummary> => {
  const summary = await sweepUpstreamSqlImports();
  if (summary.interrupted + summary.purged + summary.orphans > 0) {
    logger.info(
      `Upstream SQL import sweep: ${String(summary.interrupted)} interrupted run(s) failed, ` +
        `${String(summary.purged)} expired file(s) and ${String(summary.orphans)} orphan file(s) deleted`,
    );
  }
  return summary;
};

export const initUpstreamSqlImportSweep = (): void => {
  const schedule = scheduleSetting("UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER", DEFAULT_SCHEDULE);
  if (schedule === "disabled" || schedule === "off") {
    logger.info("Upstream SQL import sweep disabled via UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER");
    markDisabled(JOB, "disabled via UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER");
    return;
  }
  if (!cron.validate(schedule)) {
    logger.error(`Invalid UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER cron expression "${schedule}"; the sweep is not started`);
    void refuseSchedule(JOB, "UPSTREAM_SQL_IMPORT_SWEEP_SCHEDULER", schedule);
    return;
  }
  logger.info(`Upstream SQL import sweep scheduled with: ${schedule}`);
  registerJob(JOB, cron.schedule(schedule, () => runMonitored(JOB, runSweep)), schedule);
};
