/**
 * Tests for the metered-billing service methods added to make the module
 * functional (the tenant-facing billing API consumed by the controller).
 */
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../config", () => ({
  db: {
    getDialect: () => "sqlite",
    QueryTypes: { SELECT: "SELECT" },
    Sequelize: { Op: { gte: "gte", lte: "lte", ne: "ne" }, fn: jest.fn(), col: jest.fn() },
    query: jest.fn(),
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
  withCircuitBreaker: (name, fn) => fn,
}));
jest.mock("../../models", () => ({
  UsageMetric: { findAll: jest.fn().mockResolvedValue([]), findOrCreate: jest.fn() },
  UsageAlert: { findAll: jest.fn(), create: jest.fn(), findOne: jest.fn() },
  Invoice: { findAndCountAll: jest.fn() },
  Tenant: { findByPk: jest.fn() },
}));

const svc = require("../../services/meteredBilling.service");
const { UsageAlert, Invoice, Tenant } = require("../../models");

describe("meteredBilling.service new methods", () => {
  beforeEach(() => jest.clearAllMocks());

  it("getTenantUsage returns a metrics snapshot", async () => {
    const res = await svc.getTenantUsage("t-1");
    expect(res.tenantId).toBe("t-1");
    expect(res.metrics).toHaveProperty("api_calls");
  });

  it("getBillingHistory paginates invoices", async () => {
    Invoice.findAndCountAll.mockResolvedValueOnce({ count: 2, rows: [{ id: "i1" }] });
    const res = await svc.getBillingHistory("t-1", 1, 20);
    expect(res.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
    expect(res.rows).toHaveLength(1);
  });

  describe("estimateCost", () => {
    it("computes cost from the rate card × quantity", async () => {
      const res = await svc.estimateCost("t-1", { api_calls: 1000 }, 2);
      // 0.0001 * 1000 * 2 = 0.2
      expect(res.total).toBe(0.2);
      expect(res.lineItems[0]).toMatchObject({ metric: "api_calls", quantity: 2000 });
    });
    it("400s when metrics is not an object", async () => {
      await expect(svc.estimateCost("t-1", null, 1)).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("getPlanDetails", () => {
    it("returns plan limits + overage pricing", async () => {
      Tenant.findByPk.mockResolvedValueOnce({
        plan: "professional",
        limitSeats: 25,
        limitStorageMb: 10240,
        billingCycle: "monthly",
      });
      const res = await svc.getPlanDetails("t-1");
      expect(res.plan).toBe("professional");
      expect(res.limits.api_calls).toBe(100000);
      expect(res.overagePricing).toHaveProperty("calibrations");
    });
    it("404s when the tenant is missing", async () => {
      Tenant.findByPk.mockResolvedValueOnce(null);
      await expect(svc.getPlanDetails("t-1")).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("usage alerts", () => {
    it("lists alerts", async () => {
      UsageAlert.findAll.mockResolvedValueOnce([{ id: "a1" }]);
      expect(await svc.getUsageAlerts("t-1")).toEqual([{ id: "a1" }]);
    });
    it("creates an alert", async () => {
      UsageAlert.create.mockResolvedValueOnce({ id: "a1" });
      await svc.createUsageAlert("t-1", { metricName: "api_calls", threshold: 5000 });
      expect(UsageAlert.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "t-1",
          metricName: "api_calls",
          threshold: 5000,
          comparison: "gte",
          notificationChannels: ["email"],
        }),
      );
    });
    it("400s creating an alert without metricName/threshold", async () => {
      await expect(svc.createUsageAlert("t-1", { threshold: 1 })).rejects.toMatchObject({ status: 400 });
    });
    it("deletes an owned alert", async () => {
      const destroy = jest.fn().mockResolvedValue(true);
      UsageAlert.findOne.mockResolvedValueOnce({ id: "a1", destroy });
      const res = await svc.deleteUsageAlert("t-1", "a1");
      expect(destroy).toHaveBeenCalled();
      expect(res).toEqual({ success: true, id: "a1" });
    });
    it("404s deleting a missing alert", async () => {
      UsageAlert.findOne.mockResolvedValueOnce(null);
      await expect(svc.deleteUsageAlert("t-1", "missing")).rejects.toMatchObject({ status: 404 });
    });
  });

  it("getAnalytics maps the period to days without clobbering the label", async () => {
    const res = await svc.getAnalytics("t-1", "7d");
    expect(res.period).toBe("7d");
    expect(res.days).toBe(7);
    expect(res.metrics).toBeDefined();
  });

  // ==========================================
  // COVERAGE — getBillingHistory
  // ==========================================

  describe("getBillingHistory — filters and pagination", () => {
    it("filters on both startDate and endDate", async () => {
      Invoice.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await svc.getBillingHistory("t-1", 1, 20, "2024-01-01", "2024-02-01");

      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: "t-1",
            createdAt: {
              gte: new Date("2024-01-01"),
              lte: new Date("2024-02-01"),
            },
          },
        }),
      );
    });

    it("filters on startDate alone", async () => {
      Invoice.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await svc.getBillingHistory("t-1", 1, 20, "2024-01-01");

      expect(Invoice.findAndCountAll.mock.calls[0][0].where.createdAt).toEqual({
        gte: new Date("2024-01-01"),
      });
    });

    it("filters on endDate alone", async () => {
      Invoice.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await svc.getBillingHistory("t-1", 1, 20, undefined, "2024-02-01");

      expect(Invoice.findAndCountAll.mock.calls[0][0].where.createdAt).toEqual({
        lte: new Date("2024-02-01"),
      });
    });

    it("omits the createdAt filter when no dates are given", async () => {
      Invoice.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await svc.getBillingHistory("t-1");

      expect(Invoice.findAndCountAll.mock.calls[0][0].where).toEqual({
        tenantId: "t-1",
      });
    });

    it("defaults to page 1 / limit 20", async () => {
      Invoice.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      const res = await svc.getBillingHistory("t-1");

      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, offset: 0 }),
      );
      expect(res.meta).toEqual({ total: 0, page: 1, limit: 20, totalPages: 0 });
    });

    it("clamps the limit to 100 and floors the page at 1", async () => {
      Invoice.findAndCountAll.mockResolvedValue({ count: 250, rows: [] });

      const res = await svc.getBillingHistory("t-1", -5, 500);

      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100, offset: 0 }),
      );
      expect(res.meta).toEqual({ total: 250, page: 1, limit: 100, totalPages: 3 });
    });

    it("falls back to the defaults for unparseable page/limit", async () => {
      Invoice.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await svc.getBillingHistory("t-1", "abc", "xyz");

      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 20, offset: 0 }),
      );
    });

    it("computes the offset from the page", async () => {
      Invoice.findAndCountAll.mockResolvedValue({ count: 100, rows: [] });

      await svc.getBillingHistory("t-1", 3, 10);

      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
    });
  });

  // ==========================================
  // COVERAGE — estimateCost
  // ==========================================

  describe("estimateCost — branches", () => {
    it("defaults the multiplier to 1 when quantity is absent", async () => {
      const res = await svc.estimateCost("t-1", { calibrations: 10 });

      expect(res.quantity).toBe(1);
      expect(res.lineItems[0]).toEqual({
        metric: "calibrations",
        rate: 0.5,
        quantity: 10,
        cost: 5,
      });
      expect(res.total).toBe(5);
    });

    it("rates an unknown metric at zero", async () => {
      const res = await svc.estimateCost("t-1", { unknown_metric: 1000 }, 1);

      expect(res.lineItems[0]).toEqual({
        metric: "unknown_metric",
        rate: 0,
        quantity: 1000,
        cost: 0,
      });
      expect(res.total).toBe(0);
    });

    it("treats non-numeric units as zero", async () => {
      const res = await svc.estimateCost("t-1", { api_calls: "lots" }, 2);

      expect(res.lineItems[0].quantity).toBe(0);
      expect(res.total).toBe(0);
    });

    it("sums multiple line items and reports USD", async () => {
      const res = await svc.estimateCost(
        "t-1",
        { api_calls: 10000, users: 10 },
        1,
      );

      // 0.0001*10000 = 1, 2.0*10 = 20
      expect(res.currency).toBe("USD");
      expect(res.lineItems).toHaveLength(2);
      expect(res.total).toBe(21);
    });

    it("returns an empty estimate for an empty metrics object", async () => {
      const res = await svc.estimateCost("t-1", {}, 1);

      expect(res).toEqual({ currency: "USD", quantity: 1, lineItems: [], total: 0 });
    });

    it("400s when metrics is a non-object", async () => {
      await expect(svc.estimateCost("t-1", "api_calls", 1)).rejects.toMatchObject({
        status: 400,
        message: "metrics object is required",
      });
    });
  });

  // ==========================================
  // COVERAGE — getPlanDetails
  // ==========================================

  describe("getPlanDetails — plan fallbacks", () => {
    it("falls back to the free plan when the tenant has no plan", async () => {
      Tenant.findByPk.mockResolvedValue({
        plan: null,
        limitSeats: 5,
        limitStorageMb: 1024,
        billingCycle: "monthly",
      });

      const res = await svc.getPlanDetails("t-1");

      expect(res.plan).toBe("free");
      expect(res.limits).toEqual({
        api_calls: 10000,
        storage_bytes: 1073741824,
        calibrations: 50,
        users: 5,
        seats: 5,
        storageMb: 1024,
      });
    });

    it("falls back to the free limits for an unrecognised plan name", async () => {
      Tenant.findByPk.mockResolvedValue({
        plan: "platinum",
        limitSeats: 1,
        limitStorageMb: 1,
        billingCycle: "annual",
      });

      const res = await svc.getPlanDetails("t-1");

      expect(res.plan).toBe("platinum");
      expect(res.limits.api_calls).toBe(10000);
    });

    it("returns null (unlimited) limits for the enterprise plan", async () => {
      Tenant.findByPk.mockResolvedValue({
        plan: "enterprise",
        limitSeats: null,
        limitStorageMb: null,
        billingCycle: "annual",
      });

      const res = await svc.getPlanDetails("t-1");

      expect(res.limits.api_calls).toBeNull();
      expect(res.limits.calibrations).toBeNull();
    });
  });

  // ==========================================
  // COVERAGE — createUsageAlert
  // ==========================================

  describe("createUsageAlert — branches", () => {
    it("honours explicit comparison, channels, isEnabled and description", async () => {
      UsageAlert.create.mockResolvedValue({ id: "a1" });

      await svc.createUsageAlert("t-1", {
        metricName: "storage_bytes",
        threshold: 100,
        comparison: "lte",
        notificationChannels: ["sms", "webhook"],
        isEnabled: false,
        description: "Storage watch",
      });

      expect(UsageAlert.create).toHaveBeenCalledWith({
        tenantId: "t-1",
        metricName: "storage_bytes",
        threshold: 100,
        comparison: "lte",
        notificationChannels: ["sms", "webhook"],
        isEnabled: false,
        description: "Storage watch",
      });
    });

    it("accepts a zero threshold", async () => {
      UsageAlert.create.mockResolvedValue({ id: "a1" });

      await svc.createUsageAlert("t-1", { metricName: "api_calls", threshold: 0 });

      expect(UsageAlert.create).toHaveBeenCalledWith(
        expect.objectContaining({ threshold: 0, isEnabled: true, description: "" }),
      );
    });

    it("400s when threshold is null", async () => {
      await expect(
        svc.createUsageAlert("t-1", { metricName: "api_calls", threshold: null }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it("400s when alertData is omitted entirely", async () => {
      await expect(svc.createUsageAlert("t-1")).rejects.toMatchObject({
        status: 400,
        message: "metricName and threshold are required",
      });
    });
  });

  describe("getUsageAlerts", () => {
    it("scopes the query to the tenant, newest first", async () => {
      UsageAlert.findAll.mockResolvedValue([]);

      await svc.getUsageAlerts("t-1");

      expect(UsageAlert.findAll).toHaveBeenCalledWith({
        where: { tenantId: "t-1" },
        order: [["createdAt", "DESC"]],
      });
    });
  });

  describe("deleteUsageAlert", () => {
    it("scopes the lookup to both the alert id and the tenant", async () => {
      UsageAlert.findOne.mockResolvedValue({ id: "a1", destroy: jest.fn() });

      await svc.deleteUsageAlert("t-1", "a1");

      expect(UsageAlert.findOne).toHaveBeenCalledWith({
        where: { id: "a1", tenantId: "t-1" },
      });
    });
  });

  describe("getAnalytics — period mapping", () => {
    it("defaults to 30 days when no period is given", async () => {
      const res = await svc.getAnalytics("t-1");

      expect(res.period).toBe("30d");
      expect(res.days).toBe(30);
    });

    it("falls back to 30 days for an unrecognised period", async () => {
      const res = await svc.getAnalytics("t-1", "forever");

      expect(res.period).toBe("forever");
      expect(res.days).toBe(30);
    });

    it("maps 90d and 1y", async () => {
      expect((await svc.getAnalytics("t-1", "90d")).days).toBe(90);
      expect((await svc.getAnalytics("t-1", "1y")).days).toBe(365);
    });
  });

  describe("getTenantUsage", () => {
    it("stamps generatedAt as an ISO timestamp", async () => {
      const res = await svc.getTenantUsage("t-1");

      expect(new Date(res.generatedAt).toISOString()).toBe(res.generatedAt);
    });
  });
});
