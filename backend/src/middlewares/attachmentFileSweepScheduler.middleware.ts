// P9-19 (ADR-087): converted from attachmentFileSweepScheduler.middleware.js,
// behaviour unchanged. Every binding the JavaScript destructured at load is
// captured at load; `node-cron` stays the module object, read at call time.
import cron from "node-cron";
import { scheduleSetting as loadedScheduleSetting } from "../utils/schedulerSwitch.util"; // W-02: one switch for every singleton scheduler
import { logger as loadedLogger } from "./activityLog.middleware";
import { sweepDeletedAttachmentFiles as loadedSweepDeletedAttachmentFiles } from "../services/attachmentFileSweep.service";
import {
  runMonitored as loadedRunMonitored,
  registerJob as loadedRegisterJob,
  markDisabled as loadedMarkDisabled,
  refuseSchedule as loadedRefuseSchedule,
} from "../services/jobMonitor.service";

const scheduleSetting = loadedScheduleSetting;
const logger = loadedLogger;
const sweepDeletedAttachmentFiles = loadedSweepDeletedAttachmentFiles;
const runMonitored = loadedRunMonitored;
const registerJob = loadedRegisterJob;
const markDisabled = loadedMarkDisabled;
const refuseSchedule = loadedRefuseSchedule;

/** What a sweep reports (`attachmentFileSweep.service#sweepDeletedAttachmentFiles`). */
type SweepSummary = Awaited<ReturnType<typeof sweepDeletedAttachmentFiles>>;

const JOB = "attachment-file-sweep";
const DEFAULT_SCHEDULE = "13 4 * * *"; // daily, 04:13 — after the backups and the other purges

/**
 * D-22 (ADR-083) — the daily sweep of files whose attachment row has been
 * soft-deleted longer than the retention window
 * (services/attachmentFileSweep.service.ts). ATTACHMENT_FILE_SWEEP_SCHEDULER
 * sets the cron expression; `disabled` / `off` turns it off, and so does
 * SCHEDULERS_ENABLED=false (ADR-060) — it is a singleton job. Monitored and
 * alerted like every scheduled job (P7-02).
 */
const initAttachmentFileSweep = (): void => {
  const schedule = scheduleSetting("ATTACHMENT_FILE_SWEEP_SCHEDULER", DEFAULT_SCHEDULE);

  if (schedule === "disabled" || schedule === "off") {
    logger.info("Attachment file sweep disabled via ATTACHMENT_FILE_SWEEP_SCHEDULER");
    markDisabled(JOB, "disabled via ATTACHMENT_FILE_SWEEP_SCHEDULER");
    return;
  }

  if (!cron.validate(schedule)) {
    logger.error(
      `Invalid ATTACHMENT_FILE_SWEEP_SCHEDULER cron expression "${schedule}"; attachment file sweep not started`,
    );
    void refuseSchedule(JOB, "ATTACHMENT_FILE_SWEEP_SCHEDULER", schedule);
    return;
  }

  logger.info(`Attachment file sweep scheduled with: ${schedule}`);
  const task = cron.schedule(schedule, () => runMonitored(JOB, runSweep));
  registerJob(JOB, task, schedule);
};

/** One sweep; says what it removed, warns on failures and on hitting its bound. */
const runSweep = async (): Promise<SweepSummary> => {
  const summary = await sweepDeletedAttachmentFiles();
  if (summary.failed > 0) {
    logger.warn(
      `Attachment file sweep could not remove ${String(summary.failed)} file(s); they are retried by the next run`,
    );
  }
  if (summary.stoppedEarly) {
    logger.warn(
      `Attachment file sweep examined ${String(summary.examined)} row(s) and stopped at its per-run bound; the next run continues`,
    );
  } else if (summary.examined > 0) {
    logger.info(
      `Attachment file sweep removed ${String(summary.removed)} file(s) of attachments deleted more than ${String(summary.retentionDays)} days ago (${String(summary.absent)} already absent)`,
    );
  }
  return summary;
};

export = { initAttachmentFileSweep, DEFAULT_SCHEDULE };
