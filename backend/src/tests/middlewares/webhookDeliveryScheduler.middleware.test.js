/**
 * A-10 — the durable webhook dispatcher: a pass at boot (what makes a restart
 * resume scheduled retries), then node-cron on WEBHOOK_DISPATCH_SCHEDULER.
 */
jest.mock("../../services/jobMonitor.service", () =>
  require("../fixtures/jobMonitorMock").create(),
);
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
  validate: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock("../../services/webhook.service", () => ({
  dispatchDue: jest.fn(),
}));

const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { logger } = require("../../middlewares/activityLog.middleware");
const { dispatchDue } = require("../../services/webhook.service");
const {
  initWebhookDeliveryScheduler,
  runDispatch,
} = require("../../middlewares/webhookDeliveryScheduler.middleware");

const ENV = "WEBHOOK_DISPATCH_SCHEDULER";

describe("webhookDeliveryScheduler middleware", () => {
  const original = process.env[ENV];

  beforeEach(() => {
    delete process.env[ENV];
    cron.validate.mockReturnValue(true);
    dispatchDue.mockResolvedValue({ claimed: 0, errors: 0 });
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV];
    } else {
      process.env[ENV] = original;
    }
  });

  it("runs a pass immediately at boot, then every 15 seconds by default", async () => {
    initWebhookDeliveryScheduler();
    expect(dispatchDue).toHaveBeenCalledTimes(1); // the boot pass: resume after a restart
    expect(cron.schedule).toHaveBeenCalledWith("*/15 * * * * *", runDispatch);
    await new Promise((r) => setImmediate(r));
  });

  it("uses WEBHOOK_DISPATCH_SCHEDULER when set", () => {
    process.env[ENV] = "*/5 * * * * *";
    initWebhookDeliveryScheduler();
    expect(cron.schedule).toHaveBeenCalledWith("*/5 * * * * *", runDispatch);
  });

  it.each(["disabled", "off"])("does not start when set to %s, and warns that retries stop", (value) => {
    process.env[ENV] = value;
    initWebhookDeliveryScheduler();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(dispatchDue).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("will not be retried"));
  });

  it("refuses an invalid cron expression", () => {
    process.env[ENV] = "nonsense";
    cron.validate.mockReturnValue(false);
    initWebhookDeliveryScheduler();
    expect(cron.schedule).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Invalid WEBHOOK_DISPATCH_SCHEDULER"));
  });

  it("logs a pass that claimed work, and stays quiet on an idle one", async () => {
    dispatchDue.mockResolvedValueOnce({ claimed: 3, errors: 1 });
    expect(await runDispatch()).toEqual({ claimed: 3, errors: 1 });
    expect(logger.info).toHaveBeenCalledWith("Webhook dispatch: claimed=3, errors=1");
    logger.info.mockClear();
    expect(await runDispatch()).toEqual({ claimed: 0, errors: 0 });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("never overlaps itself: a tick during a running pass is skipped", async () => {
    let release;
    dispatchDue.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = runDispatch();
    expect(await runDispatch()).toBeNull();
    release({ claimed: 0, errors: 0 });
    await first;
    expect(dispatchDue).toHaveBeenCalledTimes(1);
  });

  it("logs a failed pass and recovers for the next one", async () => {
    dispatchDue.mockRejectedValueOnce(new Error("db down"));
    expect(await runDispatch()).toBeNull();
    expect(logger.error).toHaveBeenCalledWith("Webhook dispatch failed: db down");
    expect(await runDispatch()).toEqual({ claimed: 0, errors: 0 });
  });

  it("is started at boot by index.js", () => {
    const index = fs.readFileSync(path.join(__dirname, "../../../index.js"), "utf8");
    expect(index).toMatch(/initWebhookDeliveryScheduler\(\);/);
  });
});
