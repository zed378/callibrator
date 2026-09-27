/**
 * D-22 (ADR-083) — the deleted-attachment file sweep runs daily, under the one
 * scheduler switch (ADR-060: SCHEDULERS_ENABLED=false turns it off with the
 * others), monitored (P7-02), and refuses an invalid expression with an alert.
 */
jest.mock("../../services/jobMonitor.service", () => require("../fixtures/jobMonitorMock").create());
jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ id: "task" })),
  validate: jest.requireActual("node-cron").validate,
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/attachmentFileSweep.service", () => ({ sweepDeletedAttachmentFiles: jest.fn() }));

const cron = require("node-cron");
const { logger } = require("../../middlewares/activityLog.middleware");
const { sweepDeletedAttachmentFiles } = require("../../services/attachmentFileSweep.service");
const monitor = require("../../services/jobMonitor.service");
const {
  initAttachmentFileSweep,
  DEFAULT_SCHEDULE,
} = require("../../middlewares/attachmentFileSweepScheduler.middleware");

const summary = (over = {}) => ({
  tenants: 2,
  examined: 0,
  removed: 0,
  absent: 0,
  outsideUploads: 0,
  failed: 0,
  retentionDays: 90,
  cutoff: "2026-06-29T00:00:00.000Z",
  stoppedEarly: false,
  ...over,
});

describe("D-22 attachment file sweep scheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ATTACHMENT_FILE_SWEEP_SCHEDULER;
    delete process.env.SCHEDULERS_ENABLED;
  });

  it("schedules daily by default and registers with the job monitor", () => {
    initAttachmentFileSweep();
    expect(DEFAULT_SCHEDULE).toBe("13 4 * * *");
    expect(cron.schedule).toHaveBeenCalledWith(DEFAULT_SCHEDULE, expect.any(Function));
    expect(monitor.registerJob).toHaveBeenCalledWith("attachment-file-sweep", { id: "task" }, "13 4 * * *");
  });

  it("is switched off with every other singleton by SCHEDULERS_ENABLED=false", () => {
    process.env.SCHEDULERS_ENABLED = "false";
    process.env.ATTACHMENT_FILE_SWEEP_SCHEDULER = "*/5 * * * *";
    initAttachmentFileSweep();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(monitor.markDisabled).toHaveBeenCalledWith(
      "attachment-file-sweep",
      "disabled via ATTACHMENT_FILE_SWEEP_SCHEDULER",
    );
  });

  it("a run that examined rows says what it removed; one that examined none is quiet", async () => {
    initAttachmentFileSweep();
    const tick = cron.schedule.mock.calls[0][1];
    sweepDeletedAttachmentFiles.mockResolvedValueOnce(summary({ examined: 5, removed: 3, absent: 2 }));
    expect((await tick()).outcome).toBe("success");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("removed 3 file(s) of attachments deleted more than 90 days ago (2 already absent)"),
    );
    logger.info.mockClear();
    sweepDeletedAttachmentFiles.mockResolvedValueOnce(summary());
    await tick();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("a run with files it could not remove warns that the next run retries them", async () => {
    initAttachmentFileSweep();
    sweepDeletedAttachmentFiles.mockResolvedValueOnce(summary({ examined: 4, removed: 3, failed: 1 }));
    await cron.schedule.mock.calls[0][1]();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("could not remove 1 file(s)"));
  });

  it("a run that hit its bound warns that the next run continues", async () => {
    initAttachmentFileSweep();
    sweepDeletedAttachmentFiles.mockResolvedValueOnce(summary({ examined: 5000, removed: 5000, stoppedEarly: true }));
    await cron.schedule.mock.calls[0][1]();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("stopped at its per-run bound"));
  });

  it("a failed run is reported to the monitor as a failure", async () => {
    initAttachmentFileSweep();
    sweepDeletedAttachmentFiles.mockRejectedValueOnce(new Error("db down"));
    const run = await cron.schedule.mock.calls[0][1]();
    expect(run).toEqual(expect.objectContaining({ outcome: "failure" }));
  });

  it.each(["disabled", "off"])("%s turns it off and reports it disabled", (value) => {
    process.env.ATTACHMENT_FILE_SWEEP_SCHEDULER = value;
    initAttachmentFileSweep();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(monitor.markDisabled).toHaveBeenCalledWith(
      "attachment-file-sweep",
      "disabled via ATTACHMENT_FILE_SWEEP_SCHEDULER",
    );
  });

  it("an invalid expression is refused and alerted", () => {
    process.env.ATTACHMENT_FILE_SWEEP_SCHEDULER = "daily";
    initAttachmentFileSweep();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Invalid ATTACHMENT_FILE_SWEEP_SCHEDULER"));
    expect(monitor.refuseSchedule).toHaveBeenCalledWith(
      "attachment-file-sweep",
      "ATTACHMENT_FILE_SWEEP_SCHEDULER",
      "daily",
    );
  });
});
