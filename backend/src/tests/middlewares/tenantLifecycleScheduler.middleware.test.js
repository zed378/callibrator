/**
 * W-01 — the tenant-lifecycle processor runs on node-cron beside the other
 * scheduled jobs, configured by TENANT_LIFECYCLE_SCHEDULER, instead of a 24h
 * setInterval that nothing could configure and that fired only if one process
 * lived a full day.
 */
jest.mock("node-cron", () => ({
  schedule: jest.fn(),
  validate: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock("../../services/tenantLifecycle.service", () => ({
  processExpiredGracePeriods: jest.fn(),
}));

const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { logger } = require("../../middlewares/activityLog.middleware");
const { processExpiredGracePeriods } = require("../../services/tenantLifecycle.service");
const {
  initTenantLifecycleScheduler,
} = require("../../middlewares/tenantLifecycleScheduler.middleware");

const ENV = "TENANT_LIFECYCLE_SCHEDULER";

describe("tenantLifecycleScheduler middleware", () => {
  const original = process.env[ENV];

  afterEach(() => {
    // `process.env.X = undefined` stores the STRING "undefined"; delete instead.
    if (original === undefined) {
      delete process.env[ENV];
    } else {
      process.env[ENV] = original;
    }
  });

  it.each(["disabled", "off"])("does not schedule when set to %s", (value) => {
    process.env[ENV] = value;
    initTenantLifecycleScheduler();

    expect(logger.info).toHaveBeenCalledWith(
      "Tenant lifecycle scheduler disabled via TENANT_LIFECYCLE_SCHEDULER",
    );
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it("refuses an invalid cron expression, loudly", () => {
    cron.validate.mockReturnValue(false);
    process.env[ENV] = "not-a-cron";
    initTenantLifecycleScheduler();

    expect(cron.validate).toHaveBeenCalledWith("not-a-cron");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid TENANT_LIFECYCLE_SCHEDULER cron expression"),
    );
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it("schedules a custom expression", () => {
    cron.validate.mockReturnValue(true);
    process.env[ENV] = "0 4 * * *";
    initTenantLifecycleScheduler();

    expect(logger.info).toHaveBeenCalledWith("Tenant lifecycle scheduler scheduled with: 0 4 * * *");
    expect(cron.schedule).toHaveBeenCalledWith("0 4 * * *", expect.any(Function));
  });

  it("defaults to 02:30 daily when unset or empty", () => {
    cron.validate.mockReturnValue(true);
    delete process.env[ENV];
    initTenantLifecycleScheduler();
    process.env[ENV] = "";
    initTenantLifecycleScheduler();

    expect(cron.schedule.mock.calls.map(([expr]) => expr)).toEqual(["30 2 * * *", "30 2 * * *"]);
    expect(logger.info).toHaveBeenCalledWith("Tenant lifecycle scheduler scheduled at 2:30 AM daily");
  });

  it("the default expression is valid to the REAL node-cron", () => {
    expect(jest.requireActual("node-cron").validate("30 2 * * *")).toBe(true);
  });

  it("runs the processor and logs offboarded/failed counts when it fires", async () => {
    cron.validate.mockReturnValue(true);
    delete process.env[ENV];
    processExpiredGracePeriods.mockResolvedValue([
      { tenantId: "a", action: "offboarded" },
      { tenantId: "b", action: "failed", error: "x" },
      { tenantId: "c", action: "offboarded" },
    ]);

    initTenantLifecycleScheduler();
    const [, callback] = cron.schedule.mock.calls[0];
    await callback();

    expect(processExpiredGracePeriods).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "Tenant lifecycle processor complete: offboarded=2, failed=1",
    );
  });

  it("logs, and does not throw, when the processor throws", async () => {
    cron.validate.mockReturnValue(true);
    delete process.env[ENV];
    processExpiredGracePeriods.mockRejectedValue(new Error("db down"));

    initTenantLifecycleScheduler();
    const [, callback] = cron.schedule.mock.calls[0];
    await expect(callback()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      "Error during scheduled tenant lifecycle run: db down",
    );
  });

  it("index.js starts it beside the other cron jobs, and no longer uses a setInterval", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../../index.js"), "utf8");

    expect(source).toMatch(/initRetentionScheduler\(\);\s*(\/\/.*\s*)*initTenantLifecycleScheduler\(\);/);
    expect(source).not.toMatch(/processExpiredGracePeriods/);
    expect(source).not.toMatch(/24 \* 60 \* 60 \* 1000/);
  });
});
