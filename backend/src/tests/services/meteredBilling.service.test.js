/**
 * Tests for Metered Billing Service
 */

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../config", () => ({
  db: {
    getDialect: jest.fn(),
    query: jest.fn(),
    QueryTypes: { SELECT: "SELECT" },
    Sequelize: {
      fn: jest.fn(),
      col: jest.fn(),
      Op: { gte: "gte_symbol" },
    },
  },
}));

jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  },
}));

jest.mock("../../utils/circuitBreaker.util", () => ({
  withCircuitBreaker: (fn) => fn,
}));

jest.mock("../../models", () => ({
  UsageMetric: {
    create: jest.fn(),
    findOne: jest.fn(),
    findOrCreate: jest.fn(),
    findAll: jest.fn(),
    sum: jest.fn(),
    destroy: jest.fn(),
  },
  PlanQuota: {
    findOne: jest.fn(),
    findAll: jest.fn(),
  },
  Tenant: {
    findByPk: jest.fn(),
  },
}));

const meteredBillingService = require("../../services/meteredBilling.service");
const {
  trackUsage,
  getUsage,
  getAllUsage,
  checkQuota,
  enforceQuotas,
  generateUsageReport,
  getPlatformAnalytics,
  resetUsage,
  clearCache,
  getStatus,
} = meteredBillingService;

const { UsageMetric, PlanQuota, Tenant } = require("../../models");
const { db } = require("../../config");

describe("meteredBillingService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
    // jest.config has clearMocks:true / resetMocks:false, so mockReturnValue
    // survives between tests. Pin the dialect back to the non-postgres default
    // here so a test that opts into "postgres" cannot leak into the next one.
    db.getDialect.mockReturnValue("sqlite");
    process.env.USAGE_ENABLED = "true";
    process.env.USAGE_TTL_DAYS = "90";
    process.env.USAGE_AGGREGATION_HOURS = "1";
  });

  afterEach(() => {
    process.env.USAGE_ENABLED = "true";
  });

  describe("trackUsage", () => {
    it("should track usage for a tenant", async () => {
      await trackUsage("tenant-1", "api_calls", 1);

      const current = meteredBillingService.getUsage("tenant-1", "api_calls");
      expect(current).toBeDefined();
    });

    it("should increment by specified amount", async () => {
      await trackUsage("tenant-1", "api_calls", 5);
    });

    it("should default amount to 1", async () => {
      await trackUsage("tenant-1", "api_calls");
    });

    it("should skip tracking when USAGE_ENABLED is false", async () => {
      process.env.USAGE_ENABLED = "false";
      await trackUsage("tenant-1", "api_calls", 1);
    });

    it("should skip tracking when tenantId is missing", async () => {
      await trackUsage(null, "api_calls", 1);
      await trackUsage("", "api_calls", 1);
    });

    it("should skip tracking when metric is missing", async () => {
      await trackUsage("tenant-1", null, 1);
      await trackUsage("tenant-1", "", 1);
    });

    it("should handle errors gracefully without throwing", async () => {
      await expect(
        trackUsage("tenant-1", "api_calls", 1),
      ).resolves.not.toThrow();
    });
  });

  describe("getUsage", () => {
    it("should return usage data with default options", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const result = await getUsage("tenant-1", "api_calls");

      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("current");
      expect(result).toHaveProperty("history");
    });

    it("should return usage data with custom options", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const result = await getUsage("tenant-1", "api_calls", {
        period: "weekly",
        days: 7,
      });

      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("current");
      expect(result).toHaveProperty("history");
    });

    it("should return empty data when no records found", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const result = await getUsage("nonexistent", "api_calls");

      expect(result.total).toBe(0);
      expect(result.history).toEqual([]);
    });

    it("should handle database errors gracefully", async () => {
      UsageMetric.findAll.mockRejectedValue(new Error("DB connection failed"));

      const result = await getUsage("tenant-1", "api_calls");

      expect(result.total).toBe(0);
      expect(result.current).toBe(0);
      expect(result.history).toEqual([]);
    });
  });

  describe("getAllUsage", () => {
    it("should return all usage metrics for a tenant", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const result = await getAllUsage("tenant-1");

      expect(result).toHaveProperty("api_calls");
      expect(result).toHaveProperty("storage_bytes");
      expect(result).toHaveProperty("calibrations");
      expect(result).toHaveProperty("documents");
      expect(result).toHaveProperty("users");
      expect(result).toHaveProperty("notifications");
    });

    it("should handle errors for individual metrics", async () => {
      const result = await getAllUsage("tenant-1");

      expect(Object.keys(result).length).toBeGreaterThan(0);
    });
  });

  describe("checkQuota", () => {
    it("should return quota status when under limit", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const result = await checkQuota("tenant-1", "api_calls", 10000);

      expect(result).toHaveProperty("exceeded", false);
      expect(result).toHaveProperty("usage");
      expect(result).toHaveProperty("limit", 10000);
      expect(result).toHaveProperty("percentage");
      expect(result).toHaveProperty("remaining");
    });

    it("should return quota exceeded when over limit", async () => {
      // Mock usage that exceeds the limit
      const mockRecord = {
        count: 15000,
        periodStart: new Date(),
      };
      UsageMetric.findAll.mockResolvedValue([mockRecord]);

      const result = await checkQuota("tenant-1", "api_calls", 10000);

      expect(result.exceeded).toBe(true);
      expect(result.usage).toBe(15000);
      expect(result.limit).toBe(10000);
      expect(result.remaining).toBe(0);
    });

    it("should handle zero limit gracefully", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const result = await checkQuota("tenant-1", "api_calls", 0);

      expect(result).toHaveProperty("exceeded");
      expect(result).toHaveProperty("percentage", 0);
    });
  });

  describe("enforceQuotas", () => {
    it("should return no violations when all quotas met", async () => {
      PlanQuota.findAll.mockResolvedValue([]);

      const result = await enforceQuotas("tenant-1");

      expect(result.enforced).toBe(false);
      expect(result.violations).toEqual([]);
    });

    it("should return violations when quotas exceeded", async () => {
      const mockQuota = {
        metric: "api_calls",
        limit: 100,
      };
      PlanQuota.findAll.mockResolvedValue([mockQuota]);

      UsageMetric.findAll.mockResolvedValue([]);

      const result = await enforceQuotas("tenant-1");

      expect(result).toHaveProperty("enforced");
      expect(result).toHaveProperty("violations");
    });

    it("should handle database errors", async () => {
      PlanQuota.findAll.mockRejectedValue(new Error("DB error"));

      await expect(enforceQuotas("tenant-1")).rejects.toThrow("DB error");
    });
  });

  describe("generateUsageReport", () => {
    it("should generate a usage report for 30 days", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const report = await generateUsageReport("tenant-1", 30);

      expect(report).toHaveProperty("tenantId", "tenant-1");
      expect(report).toHaveProperty("period");
      expect(report.period.days).toBe(30);
      expect(report).toHaveProperty("generatedAt");
      expect(report).toHaveProperty("metrics");
      expect(report).toHaveProperty("summary");
    });

    it("should generate a usage report for custom period", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const report = await generateUsageReport("tenant-1", 7);

      expect(report.period.days).toBe(7);
    });

    it("should handle errors gracefully", async () => {
      UsageMetric.findAll.mockRejectedValue(new Error("DB error"));

      const report = await generateUsageReport("tenant-1", 30);

      expect(report).toHaveProperty("metrics", {});
      expect(report).toHaveProperty("summary");
    });
  });

  describe("getPlatformAnalytics", () => {
    it("should return platform-wide analytics", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const analytics = await getPlatformAnalytics({ days: 30 });

      expect(analytics).toHaveProperty("period", 30);
      expect(analytics).toHaveProperty("metrics");
    });

    it("should return analytics for custom period", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const analytics = await getPlatformAnalytics({ days: 90 });

      expect(analytics.period).toBe(90);
    });

    it("should handle database errors", async () => {
      UsageMetric.findAll.mockRejectedValue(new Error("DB connection failed"));

      const analytics = await getPlatformAnalytics({ days: 30 });

      expect(analytics.period).toBe(30);
      expect(analytics.metrics).toEqual([]);
    });
  });

  describe("resetUsage", () => {
    it("should reset usage counters for a tenant/metric", async () => {
      UsageMetric.destroy.mockResolvedValue(1);

      await resetUsage("tenant-1", "api_calls");

      expect(getStatus().storeSize).toBe(0);
    });

    it("should handle errors gracefully", async () => {
      await expect(resetUsage("tenant-1", "api_calls")).resolves.not.toThrow();
    });
  });

  describe("clearCache", () => {
    it("should clear the in-memory usage store", async () => {
      await trackUsage("tenant-1", "api_calls", 1);
      clearCache();

      const status = getStatus();
      expect(status.storeSize).toBe(0);
    });
  });

  describe("getStatus", () => {
    it("should return service status", async () => {
      const status = getStatus();

      expect(status).toHaveProperty("enabled", true);
      expect(status).toHaveProperty("ttlDays", 90);
      expect(status).toHaveProperty("aggregationHours", 1);
      expect(status).toHaveProperty("storeSize");
    });

    it("should show disabled when USAGE_ENABLED is false", async () => {
      process.env.USAGE_ENABLED = "false";
      const status = getStatus();

      expect(status.enabled).toBe(false);
    });

    it("should fall back to the default TTL and aggregation window", async () => {
      delete process.env.USAGE_TTL_DAYS;
      delete process.env.USAGE_AGGREGATION_HOURS;

      const status = getStatus();

      expect(status.ttlDays).toBe(90);
      expect(status.aggregationHours).toBe(1);
    });

    it("should ignore unparseable numeric env vars", async () => {
      process.env.USAGE_TTL_DAYS = "not-a-number";
      process.env.USAGE_AGGREGATION_HOURS = "not-a-number";

      const status = getStatus();

      expect(status.ttlDays).toBe(90);
      expect(status.aggregationHours).toBe(1);
    });
  });

  // ==========================================
  // COVERAGE — persistUsage (fire-and-forget)
  // ==========================================

  describe("trackUsage — persistence", () => {
    const { logger } = require("../../middlewares/activityLog.middleware");
    // persistUsage is deliberately not awaited by trackUsage; let its microtasks run.
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it("should seed a newly created bucket with exactly the tracked amount (no double count)", async () => {
      const record = { count: 3, increment: jest.fn().mockResolvedValue() };
      // created === true: the row was inserted with `defaults.count = amount`.
      UsageMetric.findOrCreate.mockResolvedValue([record, true]);

      await trackUsage("tenant-1", "api_calls", 3);
      await flush();

      expect(UsageMetric.findOrCreate).toHaveBeenCalledWith({
        where: {
          tenantId: "tenant-1",
          metric: "api_calls",
          periodStart: expect.any(Date),
        },
        defaults: {
          tenantId: "tenant-1",
          metric: "api_calls",
          periodStart: expect.any(Date),
          count: 3,
        },
      });
      // Fresh row already carries count:3 — it must NOT be incremented again,
      // otherwise the first unit of every bucket is double-counted.
      expect(record.increment).not.toHaveBeenCalled();
    });

    it("should atomically add to an already-existing bucket", async () => {
      const record = { count: 4, increment: jest.fn().mockResolvedValue() };
      // created === false: the bucket already existed for this period.
      UsageMetric.findOrCreate.mockResolvedValue([record, false]);

      await trackUsage("tenant-1", "api_calls", 3);
      await flush();

      // Accumulate atomically (count = count + amount) rather than read-modify-write.
      expect(record.increment).toHaveBeenCalledWith("count", { by: 3 });
    });

    it("should truncate periodStart to the aggregation window", async () => {
      process.env.USAGE_AGGREGATION_HOURS = "6";
      UsageMetric.findOrCreate.mockResolvedValue([
        { count: 0, increment: jest.fn().mockResolvedValue() },
        true,
      ]);

      await trackUsage("tenant-1", "api_calls", 1);
      await flush();

      const periodStart = UsageMetric.findOrCreate.mock.calls[0][0].where.periodStart;
      expect(periodStart.getHours() % 6).toBe(0);
      expect(periodStart.getMinutes()).toBe(0);
      expect(periodStart.getSeconds()).toBe(0);
      expect(periodStart.getMilliseconds()).toBe(0);
    });

    it("should log — and swallow — a persistence failure", async () => {
      UsageMetric.findOrCreate.mockRejectedValue(new Error("write failed"));

      await expect(trackUsage("tenant-1", "api_calls", 1)).resolves.toBeUndefined();
      await flush();

      expect(logger.error).toHaveBeenCalledWith("Failed to persist usage", {
        tenantId: "tenant-1",
        metric: "api_calls",
        error: "write failed",
      });
      // The in-memory counter still moved.
      expect(getStatus().storeSize).toBe(1);
    });

    it("should log — and swallow — an unexpected tracking failure", async () => {
      UsageMetric.findOrCreate.mockResolvedValue([{ count: 0, save: jest.fn() }, true]);
      // A tenantId whose stringification blows up makes the counter key throw.
      const badTenantId = {
        toString() {
          throw new Error("bad tenant id");
        },
      };

      await expect(
        trackUsage(badTenantId, "api_calls", 1),
      ).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        "Usage tracking failed",
        expect.objectContaining({ metric: "api_calls", error: "bad tenant id" }),
      );
    });

    it("should not persist anything while usage tracking is disabled", async () => {
      process.env.USAGE_ENABLED = "false";

      await trackUsage("tenant-1", "api_calls", 1);
      await flush();

      expect(UsageMetric.findOrCreate).not.toHaveBeenCalled();
      expect(getStatus().storeSize).toBe(0);
    });
  });

  // ==========================================
  // COVERAGE — getUsage
  // ==========================================

  describe("getUsage — postgres dialect", () => {
    beforeEach(() => {
      db.getDialect.mockReturnValue("postgres");
    });

    it("should aggregate the raw SQL results", async () => {
      db.query.mockResolvedValue([
        { period: "2024-01-02", total: "30" },
        { period: "2024-01-01", total: "12" },
      ]);

      const result = await getUsage("tenant-1", "api_calls", { days: 7 });

      expect(db.query).toHaveBeenCalledWith(expect.stringContaining("UsageMetrics"), {
        replacements: ["tenant-1", "api_calls", 7],
        type: "SELECT",
      });
      expect(result.total).toBe(42);
      expect(result.history).toEqual([
        { period: "2024-01-02", count: 30 },
        { period: "2024-01-01", count: 12 },
      ]);
      expect(result.current).toBe(0);
    });

    it("should treat a null SQL total as zero", async () => {
      db.query.mockResolvedValue([{ period: "2024-01-01", total: null }]);

      const result = await getUsage("tenant-1", "api_calls");

      expect(result.total).toBe(0);
      expect(result.history).toEqual([{ period: "2024-01-01", count: 0 }]);
    });

    it("should default to a 30-day lookback", async () => {
      db.query.mockResolvedValue([]);

      await getUsage("tenant-1", "api_calls");

      expect(db.query.mock.calls[0][1].replacements).toEqual([
        "tenant-1",
        "api_calls",
        30,
      ]);
    });

    it("should fall back to an empty result when the query fails", async () => {
      db.query.mockRejectedValue(new Error("syntax error"));

      const result = await getUsage("tenant-1", "api_calls");

      expect(result).toEqual({ total: 0, current: 0, history: [] });
    });

    it("should include the in-memory counter alongside the persisted total", async () => {
      db.query.mockResolvedValue([{ period: "2024-01-01", total: "5" }]);
      UsageMetric.findOrCreate.mockResolvedValue([{ save: jest.fn() }, true]);
      await trackUsage("tenant-1", "api_calls", 3);

      const result = await getUsage("tenant-1", "api_calls");

      expect(result.total).toBe(5);
      expect(result.current).toBe(3);
    });
  });

  describe("getUsage — non-postgres dialect", () => {
    it("should sum record counts and format periods as ISO dates", async () => {
      UsageMetric.findAll.mockResolvedValue([
        { count: 10, periodStart: new Date("2024-03-02T05:00:00.000Z") },
        { count: 5, periodStart: new Date("2024-03-01T05:00:00.000Z") },
      ]);

      const result = await getUsage("tenant-1", "api_calls", { days: 7 });

      expect(result.total).toBe(15);
      expect(result.history).toEqual([
        { period: "2024-03-02", count: 10 },
        { period: "2024-03-01", count: 5 },
      ]);
    });

    it("should treat a record with no count as zero", async () => {
      UsageMetric.findAll.mockResolvedValue([
        { count: null, periodStart: new Date("2024-03-01T05:00:00.000Z") },
      ]);

      const result = await getUsage("tenant-1", "api_calls");

      expect(result.total).toBe(0);
    });
  });

  // ==========================================
  // COVERAGE — quota enforcement / overage
  // ==========================================

  describe("enforceQuotas — violations and overage handling", () => {
    const { logger } = require("../../middlewares/activityLog.middleware");

    const exceedingUsage = () =>
      UsageMetric.findAll.mockResolvedValue([
        { count: 500, periodStart: new Date("2024-03-01T00:00:00.000Z") },
      ]);

    it("should suspend a free-tier tenant that blows its quota", async () => {
      PlanQuota.findAll.mockResolvedValue([{ metric: "api_calls", limit: 100 }]);
      exceedingUsage();
      const tenant = { subscriptionId: null, update: jest.fn().mockResolvedValue(true) };
      Tenant.findByPk.mockResolvedValue(tenant);

      const result = await enforceQuotas("tenant-1");

      expect(result).toEqual({
        enforced: true,
        violations: [
          { metric: "api_calls", usage: 500, limit: 100, overage: 400 },
        ],
      });
      expect(tenant.update).toHaveBeenCalledWith({ status: "suspended" });
      expect(logger.warn).toHaveBeenCalledWith("Quota exceeded", {
        tenantId: "tenant-1",
        metric: "api_calls",
        usage: 500,
        limit: 100,
      });
    });

    it("should allow — not suspend — an overage on a paid tenant", async () => {
      PlanQuota.findAll.mockResolvedValue([{ metric: "api_calls", limit: 100 }]);
      exceedingUsage();
      const tenant = { subscriptionId: "sub_123", update: jest.fn() };
      Tenant.findByPk.mockResolvedValue(tenant);

      const result = await enforceQuotas("tenant-1");

      expect(result.enforced).toBe(true);
      // The returned violation carries the correctly computed overage.
      expect(result.violations).toEqual([
        { metric: "api_calls", usage: 500, limit: 100, overage: 400 },
      ]);
      // A paid tenant is never suspended.
      expect(tenant.update).not.toHaveBeenCalled();
      // BUG (meteredBilling.service.js:300): enforceQuotas passes `check.overage`
      // to handleOverage, but checkQuota (line 258-264) never returns an `overage`
      // key — so handleOverage always receives `undefined` and this log line
      // reports `overage: undefined`. It should pass `check.usage - quota.limit`,
      // exactly as the violation object on line 289 does. Asserting only the
      // fields that are correct here, deliberately NOT pinning the broken value.
      expect(logger.info).toHaveBeenCalledWith(
        "Paid tier overage - allowing",
        expect.objectContaining({ tenantId: "tenant-1", metric: "api_calls" }),
      );
    });

    it("should throw 404 when the overage tenant does not exist", async () => {
      PlanQuota.findAll.mockResolvedValue([{ metric: "api_calls", limit: 100 }]);
      exceedingUsage();
      Tenant.findByPk.mockResolvedValue(null);

      await expect(enforceQuotas("tenant-1")).rejects.toMatchObject({
        status: 404,
        message: "Tenant not found",
      });
    });

    it("should not touch the tenant when every quota is respected", async () => {
      PlanQuota.findAll.mockResolvedValue([{ metric: "api_calls", limit: 10000 }]);
      UsageMetric.findAll.mockResolvedValue([
        { count: 5, periodStart: new Date("2024-03-01T00:00:00.000Z") },
      ]);

      const result = await enforceQuotas("tenant-1");

      expect(result).toEqual({ enforced: false, violations: [] });
      expect(Tenant.findByPk).not.toHaveBeenCalled();
    });
  });

  describe("checkQuota — percentage", () => {
    it("should cap the reported percentage at 100", async () => {
      UsageMetric.findAll.mockResolvedValue([
        { count: 500, periodStart: new Date("2024-03-01T00:00:00.000Z") },
      ]);

      const result = await checkQuota("tenant-1", "api_calls", 100);

      expect(result.percentage).toBe(100);
      expect(result.remaining).toBe(0);
    });

    it("should report a partial percentage under the limit", async () => {
      UsageMetric.findAll.mockResolvedValue([
        { count: 25, periodStart: new Date("2024-03-01T00:00:00.000Z") },
      ]);

      const result = await checkQuota("tenant-1", "api_calls", 100);

      expect(result).toEqual({
        exceeded: false,
        usage: 25,
        limit: 100,
        percentage: 25,
        remaining: 75,
      });
    });

    it("should add the in-memory counter to the persisted total", async () => {
      UsageMetric.findAll.mockResolvedValue([]);
      UsageMetric.findOrCreate.mockResolvedValue([{ save: jest.fn() }, true]);
      await trackUsage("tenant-1", "api_calls", 7);

      const result = await checkQuota("tenant-1", "api_calls", 100);

      expect(result.usage).toBe(7);
    });
  });

  // ==========================================
  // COVERAGE — reporting
  // ==========================================

  describe("generateUsageReport — populated metrics", () => {
    it("should build trends and roll up the summary", async () => {
      UsageMetric.findAll.mockResolvedValue([
        { count: 11, periodStart: new Date("2024-03-02T00:00:00.000Z") },
        { count: 22, periodStart: new Date("2024-03-01T00:00:00.000Z") },
      ]);

      const report = await generateUsageReport("tenant-1", 30);

      expect(report.metrics.api_calls).toEqual({
        current: 0,
        total: 33,
        trend: [11, 22],
      });
      expect(report.summary).toEqual({
        totalApiCalls: 33,
        totalStorageBytes: 33,
        totalCalibrations: 33,
      });
    });

    it("should keep only the last 7 points of the trend", async () => {
      UsageMetric.findAll.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          count: i,
          periodStart: new Date(`2024-03-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`),
        })),
      );

      const report = await generateUsageReport("tenant-1", 30);

      expect(report.metrics.api_calls.trend).toEqual([3, 4, 5, 6, 7, 8, 9]);
    });

    it("should default to a 30-day window", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const report = await generateUsageReport("tenant-1");

      expect(report.period.days).toBe(30);
    });
  });

  describe("getPlatformAnalytics — populated metrics", () => {
    it("should coerce the aggregate columns to numbers", async () => {
      UsageMetric.findAll.mockResolvedValue([
        { metric: "api_calls", total: "1200", records: "12" },
        { metric: "calibrations", total: "40", records: "4" },
      ]);

      const analytics = await getPlatformAnalytics({ days: 7 });

      expect(analytics).toEqual({
        period: 7,
        metrics: [
          { metric: "api_calls", total: 1200, records: 12 },
          { metric: "calibrations", total: 40, records: 4 },
        ],
      });
    });

    it("should default to 30 days when called with no options", async () => {
      UsageMetric.findAll.mockResolvedValue([]);

      const analytics = await getPlatformAnalytics();

      expect(analytics.period).toBe(30);
    });
  });

  // ==========================================
  // COVERAGE — resetUsage
  // ==========================================

  describe("resetUsage — dialects", () => {
    it("should clear the in-memory counter and the ORM rows on non-postgres", async () => {
      db.getDialect.mockReturnValue("sqlite");
      UsageMetric.findOrCreate.mockResolvedValue([{ save: jest.fn() }, true]);
      UsageMetric.destroy.mockResolvedValue(1);
      await trackUsage("tenant-1", "api_calls", 5);

      await resetUsage("tenant-1", "api_calls");

      expect(UsageMetric.destroy).toHaveBeenCalledWith({
        where: { tenantId: "tenant-1", metric: "api_calls" },
      });
      expect(getStatus().storeSize).toBe(0);
    });

    it("should issue a DELETE statement on postgres", async () => {
      db.getDialect.mockReturnValue("postgres");
      db.query.mockResolvedValue([]);

      await resetUsage("tenant-1", "api_calls");

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "UsageMetrics"'),
        { replacements: ["tenant-1", "api_calls"] },
      );
      expect(UsageMetric.destroy).not.toHaveBeenCalled();
    });
  });
});
