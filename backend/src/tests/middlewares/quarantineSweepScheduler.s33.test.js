/**
 * S-33 — the quarantine sweep is scheduled hourly, monitored (P7-02), can be
 * disabled, and refuses an invalid expression with an alert.
 */
jest.mock("../../services/jobMonitor.service", () =>
  require("../fixtures/jobMonitorMock").create(),
);
jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ id: "task" })),
  validate: jest.requireActual("node-cron").validate,
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/quarantineSweep.service", () => ({ sweepQuarantine: jest.fn() }));

const cron = require("node-cron");
const { logger } = require("../../middlewares/activityLog.middleware");
const { sweepQuarantine } = require("../../services/quarantineSweep.service");
const monitor = require("../../services/jobMonitor.service");
const { initQuarantineSweep, DEFAULT_SCHEDULE } = require("../../middlewares/quarantineSweepScheduler.middleware");

describe("S-33 quarantine sweep scheduler", () => {
  beforeEach(() => {
    delete process.env.QUARANTINE_SWEEP_SCHEDULER;
  });

  it("schedules hourly by default and registers with the job monitor", () => {
    initQuarantineSweep();
    expect(cron.schedule).toHaveBeenCalledWith(DEFAULT_SCHEDULE, expect.any(Function));
    expect(DEFAULT_SCHEDULE).toBe("17 * * * *");
    expect(monitor.registerJob).toHaveBeenCalledWith("quarantine-sweep", { id: "task" }, "17 * * * *");
  });

  it("a sweep that removed files warns; one that removed none is quiet", async () => {
    initQuarantineSweep();
    const tick = cron.schedule.mock.calls[0][1];
    sweepQuarantine.mockResolvedValueOnce({ scanned: 3, removed: 2, errors: 0 });
    expect((await tick()).outcome).toBe("success");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("removed 2 abandoned upload(s)"));
    logger.warn.mockClear();
    sweepQuarantine.mockResolvedValueOnce({ scanned: 0, removed: 0, errors: 0 });
    await tick();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("a sweep that could not remove a file is a FAILED run", async () => {
    initQuarantineSweep();
    sweepQuarantine.mockResolvedValueOnce({ scanned: 1, removed: 0, errors: 1 });
    const run = await cron.schedule.mock.calls[0][1]();
    expect(run).toEqual(expect.objectContaining({ outcome: "failure", error: "1 quarantined file(s) could not be removed" }));
  });

  it.each(["disabled", "off"])("%s turns it off and reports it disabled", (value) => {
    process.env.QUARANTINE_SWEEP_SCHEDULER = value;
    initQuarantineSweep();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(monitor.markDisabled).toHaveBeenCalledWith("quarantine-sweep", "disabled via QUARANTINE_SWEEP_SCHEDULER");
  });

  it("an invalid expression is refused and alerted", () => {
    process.env.QUARANTINE_SWEEP_SCHEDULER = "hourly";
    initQuarantineSweep();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Invalid QUARANTINE_SWEEP_SCHEDULER"));
    expect(monitor.refuseSchedule).toHaveBeenCalledWith("quarantine-sweep", "QUARANTINE_SWEEP_SCHEDULER", "hourly");
  });

  it("a custom expression is used", () => {
    process.env.QUARANTINE_SWEEP_SCHEDULER = "*/10 * * * *";
    initQuarantineSweep();
    expect(cron.schedule).toHaveBeenCalledWith("*/10 * * * *", expect.any(Function));
  });
});
