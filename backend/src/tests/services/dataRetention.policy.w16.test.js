/**
 * W-16 (ADR-079) — one malformed retention setting no longer silences a tenant.
 *
 * `getRetentionPolicy` used `parseInt(value, 10)`: `""`, `"forever"` and null
 * became NaN, which the purge skipped every night with no trace, and `"30abc"`
 * silently became 30. A stored value that is not a whole number of days now
 * falls back to the platform default, the purge reports it at `error`, the
 * sweep counts it, and the scheduler records the run as FAILED (P7-02 alerts).
 * `setRetentionPolicy` refuses a non-integer with 400 for every caller.
 *
 * The same on PostgreSQL 18: retention.w16.live.test.js.
 */
const { Op } = require("sequelize");

jest.mock("../../config", () => ({ db: { transaction: jest.fn(async (cb) => cb("TX")) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../services/gdpr.service", () => ({
  purgeExpiredExports: jest.fn().mockResolvedValue({ deleted: 0, errors: 0 }),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../models", () => ({
  IotReading: { destroy: jest.fn() },
  Notification: { destroy: jest.fn() },
  Session: { destroy: jest.fn() },
  Tenant: { findAll: jest.fn() },
  TenantSettings: { findOne: jest.fn(), findAll: jest.fn(), upsert: jest.fn() },
}));

const models = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");
const retention = require("../../services/dataRetention.service");
const { failureOf } = require("../../middlewares/retentionScheduler.middleware");

const stored = (entity, value) => ({ key: `retention_policy_${entity}`, value });
const cutoffDays = (destroy) =>
  Math.round((Date.now() - destroy.mock.calls[0][0].where.createdAt[Op.lt].getTime()) / 86400000);

describe("W-16 — a malformed retention setting", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    models.TenantSettings.findOne.mockResolvedValue(null); // no legal hold
    models.Notification.destroy.mockResolvedValue(0);
    models.Session.destroy.mockResolvedValue(0);
  });

  it.each([[""], ["forever"], ["30abc"], [null], ["-5"], ["1.5"]])(
    "%p is not applied: the entity keeps its platform default, and it is reported",
    async (value) => {
      models.TenantSettings.findAll.mockResolvedValue([stored("notifications", value)]);

      const policies = await retention.getRetentionPolicy("t1");

      expect(policies.notifications).toBe(90);
    },
  );

  it("a whole number with surrounding spaces is applied", async () => {
    models.TenantSettings.findAll.mockResolvedValue([stored("notifications", " 45 ")]);
    expect((await retention.getRetentionPolicy("t1")).notifications).toBe(45);
  });

  it("the tenant purges on the default, and the anomaly is logged at error and returned", async () => {
    models.TenantSettings.findAll.mockResolvedValue([stored("notifications", "forever")]);

    const result = await retention.purgeExpiredRecords("t1");

    expect(cutoffDays(models.Notification.destroy)).toBe(90);
    expect(result.anomalies).toEqual([
      { entity: "notifications", source: "tenant_settings", value: "forever", appliedDays: 90 },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/tenant t1: notifications = "forever" \(tenant_settings\).*platform default of 90 days applies/),
    );
  });

  it("a stored key for a non-purgeable entity is still ignored, not reported", async () => {
    models.TenantSettings.findAll.mockResolvedValue([stored("audit_logs", "forever")]);
    const result = await retention.purgeExpiredRecords("t1");
    expect(result.anomalies).toEqual([]);
  });

  it("the sweep counts anomalies, and the scheduler calls such a run a failure", async () => {
    models.Tenant.findAll.mockResolvedValue([{ id: "t1" }, { id: "t2" }]);
    models.TenantSettings.findAll.mockImplementation(async ({ where }) =>
      where.tenantId === "t1" ? [stored("notifications", "forever"), stored("sessions", "")] : [],
    );

    const summary = await retention.runRetentionSweep();

    expect(summary).toMatchObject({ tenants: 2, errors: 0, anomalies: 2 });
    expect(failureOf(summary)).toBe(
      "2 retention setting(s) are not a whole number of days " +
        "(the platform default was applied; the error log names each tenant and key)",
    );
  });

  it("failureOf: a clean run is not a failure; errors and export failures are named", () => {
    expect(failureOf({ errors: 0, anomalies: 0, exportErrors: 0 })).toBeNull();
    expect(failureOf({ errors: 1, anomalies: 0, exportErrors: 2 })).toBe(
      "1 tenant(s) failed during the purge; 2 expired GDPR export(s) could not be deleted",
    );
  });

  describe("a malformed platform default (environment)", () => {
    const saved = process.env.NOTIFICATION_RETENTION_DAYS;
    afterAll(() => {
      if (saved === undefined) {delete process.env.NOTIFICATION_RETENTION_DAYS;} else {process.env.NOTIFICATION_RETENTION_DAYS = saved;}
    });

    it("has nothing to fall back to: the entity is not purged, and that is reported, not silent", async () => {
      process.env.NOTIFICATION_RETENTION_DAYS = "ninety";
      let isolated;
      let isolatedModels;
      jest.isolateModules(() => {
        isolated = require("../../services/dataRetention.service");
        isolatedModels = require("../../models");
      });
      isolatedModels.TenantSettings.findOne.mockResolvedValue(null);
      isolatedModels.TenantSettings.findAll.mockResolvedValue([]);
      isolatedModels.Session.destroy.mockResolvedValue(0);

      const result = await isolated.purgeExpiredRecords("t1");

      expect(isolatedModels.Notification.destroy).not.toHaveBeenCalled();
      expect(isolatedModels.Session.destroy).toHaveBeenCalled(); // the other entities still purge
      expect(result.anomalies).toEqual([
        { entity: "notifications", source: "environment", value: NaN, appliedDays: null },
      ]);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("NOT purged until it is fixed"));
    });
  });
});

describe("W-16 — setRetentionPolicy refuses a value that is not a whole number of days", () => {
  it.each([["abc"], [1.5], [NaN], ["30"]])("%p is a 400 and nothing is written", async (days) => {
    await expect(retention.setRetentionPolicy("t1", "notifications", days, { userId: "u1" })).rejects.toMatchObject({
      status: 400,
      message: "Retention days must be a whole number of days",
    });
    expect(models.TenantSettings.upsert).not.toHaveBeenCalled();
  });
});
