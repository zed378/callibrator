/**
 * ADR-070 — the webhook delivery purge runs daily, under the one scheduler
 * switch (ADR-060: SCHEDULERS_ENABLED=false turns it off with the others),
 * monitored (P7-02), and refuses an invalid expression with an alert.
 */
jest.mock("../../services/jobMonitor.service", () => require("../fixtures/jobMonitorMock").create());
jest.mock("node-cron", () => ({
  schedule: jest.fn(() => ({ id: "task" })),
  validate: jest.requireActual("node-cron").validate,
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../services/webhookDeliveryPurge.service", () => ({ purgeFinishedDeliveries: jest.fn() }));

const cron = require("node-cron");
const { logger } = require("../../middlewares/activityLog.middleware");
const { purgeFinishedDeliveries } = require("../../services/webhookDeliveryPurge.service");
const monitor = require("../../services/jobMonitor.service");
const {
  initWebhookDeliveryPurge,
  DEFAULT_SCHEDULE,
} = require("../../middlewares/webhookDeliveryPurgeScheduler.middleware");

const summary = (over = {}) => ({
  tenants: 2,
  deleted: 0,
  retentionDays: 30,
  cutoff: "2026-08-26T00:00:00.000Z",
  stoppedEarly: false,
  ...over,
});

describe("ADR-070 webhook delivery purge scheduler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.WEBHOOK_DELIVERY_PURGE_SCHEDULER;
    delete process.env.SCHEDULERS_ENABLED;
  });

  it("schedules daily by default and registers with the job monitor", () => {
    initWebhookDeliveryPurge();
    expect(DEFAULT_SCHEDULE).toBe("43 3 * * *");
    expect(cron.schedule).toHaveBeenCalledWith(DEFAULT_SCHEDULE, expect.any(Function));
    expect(monitor.registerJob).toHaveBeenCalledWith("webhook-delivery-purge", { id: "task" }, "43 3 * * *");
  });

  it("is switched off with every other singleton by SCHEDULERS_ENABLED=false", () => {
    process.env.SCHEDULERS_ENABLED = "false";
    process.env.WEBHOOK_DELIVERY_PURGE_SCHEDULER = "*/5 * * * *";
    initWebhookDeliveryPurge();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(monitor.markDisabled).toHaveBeenCalledWith(
      "webhook-delivery-purge",
      "disabled via WEBHOOK_DELIVERY_PURGE_SCHEDULER",
    );
  });

  it("a run that removed rows says how many; one that removed none is quiet", async () => {
    initWebhookDeliveryPurge();
    const tick = cron.schedule.mock.calls[0][1];
    purgeFinishedDeliveries.mockResolvedValueOnce(summary({ deleted: 12 }));
    expect((await tick()).outcome).toBe("success");
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("removed 12 finished delivery row(s) older than 30 days"));
    logger.info.mockClear();
    purgeFinishedDeliveries.mockResolvedValueOnce(summary());
    await tick();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("a run that hit its bound warns that the next run continues", async () => {
    initWebhookDeliveryPurge();
    purgeFinishedDeliveries.mockResolvedValueOnce(summary({ deleted: 50000, stoppedEarly: true }));
    await cron.schedule.mock.calls[0][1]();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("stopped at its per-run bound"));
  });

  it("a failed run is reported to the monitor as a failure", async () => {
    initWebhookDeliveryPurge();
    purgeFinishedDeliveries.mockRejectedValueOnce(new Error("db down"));
    const run = await cron.schedule.mock.calls[0][1]();
    expect(run).toEqual(expect.objectContaining({ outcome: "failure" }));
  });

  it.each(["disabled", "off"])("%s turns it off and reports it disabled", (value) => {
    process.env.WEBHOOK_DELIVERY_PURGE_SCHEDULER = value;
    initWebhookDeliveryPurge();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(monitor.markDisabled).toHaveBeenCalledWith(
      "webhook-delivery-purge",
      "disabled via WEBHOOK_DELIVERY_PURGE_SCHEDULER",
    );
  });

  it("an invalid expression is refused and alerted", () => {
    process.env.WEBHOOK_DELIVERY_PURGE_SCHEDULER = "daily";
    initWebhookDeliveryPurge();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Invalid WEBHOOK_DELIVERY_PURGE_SCHEDULER"));
    expect(monitor.refuseSchedule).toHaveBeenCalledWith(
      "webhook-delivery-purge",
      "WEBHOOK_DELIVERY_PURGE_SCHEDULER",
      "daily",
    );
  });
});
