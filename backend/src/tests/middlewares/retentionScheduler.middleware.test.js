/**
 * Tests for retentionScheduler middleware
 */

jest.mock("node-cron", () => ({
  schedule: jest.fn(),
  validate: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock("../../services/dataRetention.service", () => ({
  runRetentionSweep: jest.fn(),
}));

const cron = require("node-cron");
const { logger } = require("../../middlewares/activityLog.middleware");
const { runRetentionSweep } = require("../../services/dataRetention.service");
const {
  initRetentionScheduler,
} = require("../../middlewares/retentionScheduler.middleware");

describe("retentionScheduler middleware", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    cron.schedule.mockClear();
    cron.validate.mockClear();
  });

  afterEach(() => {
    process.env.RETENTION_SCHEDULER = originalEnv.RETENTION_SCHEDULER;
  });

  it("logs info and returns when RETENTION_SCHEDULER is 'disabled'", () => {
    process.env.RETENTION_SCHEDULER = "disabled";
    initRetentionScheduler();

    expect(logger.info).toHaveBeenCalledWith(
      "Retention scheduler disabled via RETENTION_SCHEDULER",
    );
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it("logs info and returns when RETENTION_SCHEDULER is 'off'", () => {
    process.env.RETENTION_SCHEDULER = "off";
    initRetentionScheduler();

    expect(logger.info).toHaveBeenCalledWith(
      "Retention scheduler disabled via RETENTION_SCHEDULER",
    );
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it("logs error and returns when the cron expression is invalid", () => {
    cron.validate.mockReturnValue(false);
    process.env.RETENTION_SCHEDULER = "not-a-cron";
    initRetentionScheduler();

    expect(cron.validate).toHaveBeenCalledWith("not-a-cron");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid RETENTION_SCHEDULER cron expression"),
    );
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it("logs info with a custom schedule when the expression is valid", () => {
    cron.validate.mockReturnValue(true);
    process.env.RETENTION_SCHEDULER = "0 4 * * *";
    initRetentionScheduler();

    expect(cron.validate).toHaveBeenCalledWith("0 4 * * *");
    expect(logger.info).toHaveBeenCalledWith(
      "Retention scheduler scheduled with: 0 4 * * *",
    );
  });

  it("logs info with the default schedule when no env var is set", () => {
    delete process.env.RETENTION_SCHEDULER;
    cron.validate.mockReturnValue(true);
    initRetentionScheduler();

    expect(cron.validate).toHaveBeenCalledWith("0 2 * * *");
    expect(logger.info).toHaveBeenCalledWith(
      "Retention scheduler scheduled at 2:00 AM daily",
    );
  });

  it("uses the default schedule when the env var is an empty string", () => {
    cron.validate.mockReturnValue(true);
    process.env.RETENTION_SCHEDULER = "";
    initRetentionScheduler();

    expect(cron.validate).toHaveBeenCalledWith("0 2 * * *");
  });

  it("registers a cron job with the provided schedule", () => {
    cron.validate.mockReturnValue(true);
    process.env.RETENTION_SCHEDULER = "0 5 * * *";
    initRetentionScheduler();

    expect(cron.schedule).toHaveBeenCalledTimes(1);
    const [expr, callback] = cron.schedule.mock.calls[0];
    expect(expr).toBe("0 5 * * *");
    expect(typeof callback).toBe("function");
  });

  it("runs the sweep and logs a summary when the cron fires successfully", async () => {
    cron.validate.mockReturnValue(true);
    process.env.RETENTION_SCHEDULER = "0 2 * * *";
    runRetentionSweep.mockResolvedValue({
      tenants: 3,
      purged: 12,
      skipped: 1,
      errors: 0,
    });

    initRetentionScheduler();
    const [, callback] = cron.schedule.mock.calls[0];
    await callback();

    expect(logger.info).toHaveBeenCalledWith("Running data retention sweep...");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("tenants=3"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("purged=12"),
    );
  });

  it("logs an error when the sweep throws", async () => {
    cron.validate.mockReturnValue(true);
    process.env.RETENTION_SCHEDULER = "0 2 * * *";
    runRetentionSweep.mockRejectedValue(new Error("sweep failed"));

    initRetentionScheduler();
    const [, callback] = cron.schedule.mock.calls[0];
    await callback();

    expect(logger.error).toHaveBeenCalledWith(
      "Error during scheduled retention sweep: sweep failed",
    );
  });
});
