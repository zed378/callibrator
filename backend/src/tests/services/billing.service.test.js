/**
 * Tests for billing.service.js
 *
 * Covers: getSubscription, updateSubscription, fetchInvoices
 */

jest.mock("../../config", () => ({
  db: {
    getDialect: jest.fn(),
    query: jest.fn(),
    QueryTypes: { SELECT: "SELECT" },
    Sequelize: {
      fn: jest.fn(),
      col: jest.fn(),
      Op: {
        eq: Symbol("eq"),
        ne: Symbol("ne"),
        gte: Symbol("gte"),
        gt: Symbol("gt"),
        lte: Symbol("lte"),
        lt: Symbol("lt"),
        not: Symbol("not"),
        in: Symbol("in"),
        notIn: Symbol("notIn"),
        like: Symbol("like"),
        notLike: Symbol("notLike"),
        iLike: Symbol("iLike"),
        notILike: Symbol("notILike"),
        startsWith: Symbol("startsWith"),
        endsWith: Symbol("endsWith"),
        between: Symbol("between"),
        notBetween: Symbol("notBetween"),
        overlap: Symbol("overlap"),
        contains: Symbol("contains"),
        contained: Symbol("contained"),
        and: Symbol("and"),
        or: Symbol("or"),
        any: Symbol("any"),
        all: Symbol("all"),
        values: Symbol("values"),
        regexp: Symbol("regexp"),
        notRegexp: Symbol("notRegexp"),
        literal: Symbol("literal"),
        col: Symbol("col"),
        fn: Symbol("fn"),
        where: Symbol("where"),
        join: Symbol("join"),
      },
    },
  },
}));

jest.mock("../../utils/appError.util", () => {
  class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.name = "AppError";
      this.status = status;
    }
  }
  return { AppError };
});

jest.mock("../../constants", () => ({
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
}));

jest.mock("../../models", () => ({
  Subscription: {
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  Invoice: {
    findAndCountAll: jest.fn(),
  },
}));

const billingService = require("../../services/billing.service");
const { Subscription, Invoice } = require("../../models");

describe("billing.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ================================================================
  describe("getSubscription", () => {
    it("should return existing subscription successfully", async () => {
      const mockSub = {
        id: "sub-1",
        tenantId: "t-1",
        planId: "pro",
        status: "Active",
        billingCycle: "Monthly",
        toJSON: () => ({
          id: "sub-1",
          tenantId: "t-1",
          planId: "pro",
          status: "Active",
          billingCycle: "Monthly",
        }),
      };
      Subscription.findOne.mockResolvedValueOnce(mockSub);

      const result = await billingService.getSubscription("t-1");

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.message).toBe("Subscription retrieved successfully");
      expect(result.data).toEqual({
        id: "sub-1",
        tenantId: "t-1",
        planId: "pro",
        status: "Active",
        billingCycle: "Monthly",
      });
      expect(Subscription.findOne).toHaveBeenCalledWith({ where: { tenantId: "t-1" } });
    });

    it("should auto-create a basic subscription when none exists", async () => {
      Subscription.findOne.mockResolvedValueOnce(null);
      const now = new Date();
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      Subscription.create.mockResolvedValueOnce({
        id: "sub-new",
        tenantId: "t-1",
        planId: "basic",
        status: "Active",
        billingCycle: "Monthly",
        currentPeriodStart: now,
        currentPeriodEnd: thirtyDaysFromNow,
        toJSON: () => ({
          id: "sub-new",
          tenantId: "t-1",
          planId: "basic",
          status: "Active",
          billingCycle: "Monthly",
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: thirtyDaysFromNow.toISOString(),
        }),
      });

      const result = await billingService.getSubscription("t-1");

      expect(result.success).toBe(true);
      expect(result.data.planId).toBe("basic");
      expect(result.data.status).toBe("Active");
      expect(Subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "t-1",
          planId: "basic",
          status: "Active",
          billingCycle: "Monthly",
        }),
      );
    });

    it("should throw on database error", async () => {
      Subscription.findOne.mockRejectedValueOnce(new Error("DB connection failed"));

      await expect(billingService.getSubscription("t-1")).rejects.toEqual({
        status: 500,
        message: "DB connection failed",
      });
    });
  });

  // ================================================================
  describe("updateSubscription", () => {
    it("should update the subscription plan successfully", async () => {
      const mockSub = {
        id: "sub-1",
        tenantId: "t-1",
        planId: "basic",
        billingCycle: "Monthly",
        status: "Active",
        update: jest.fn().mockResolvedValue({}),
        toJSON: () => ({
          id: "sub-1",
          tenantId: "t-1",
          planId: "pro",
          billingCycle: "Monthly",
          status: "Active",
        }),
      };
      Subscription.findOne.mockResolvedValueOnce(mockSub);

      const result = await billingService.updateSubscription("t-1", { planId: "pro" });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.message).toBe("Subscription updated successfully");
      expect(result.data.planId).toBe("pro");
      expect(mockSub.update).toHaveBeenCalledWith({ planId: "pro" });
    });

    it("should update billing cycle when provided", async () => {
      const mockSub = {
        id: "sub-1",
        tenantId: "t-1",
        planId: "basic",
        billingCycle: "Monthly",
        status: "Active",
        update: jest.fn().mockResolvedValue({}),
        toJSON: () => ({
          id: "sub-1",
          tenantId: "t-1",
          planId: "basic",
          billingCycle: "Yearly",
        }),
      };
      Subscription.findOne.mockResolvedValueOnce(mockSub);

      const result = await billingService.updateSubscription("t-1", { billingCycle: "Yearly" });

      expect(result.data.billingCycle).toBe("Yearly");
      expect(mockSub.update).toHaveBeenCalledWith({ billingCycle: "Yearly" });
    });

    it("should update status when provided", async () => {
      const mockSub = {
        id: "sub-1",
        tenantId: "t-1",
        planId: "basic",
        billingCycle: "Monthly",
        status: "Active",
        update: jest.fn().mockResolvedValue({}),
        toJSON: () => ({
          id: "sub-1",
          tenantId: "t-1",
          planId: "basic",
          status: "Inactive",
        }),
      };
      Subscription.findOne.mockResolvedValueOnce(mockSub);

      const result = await billingService.updateSubscription("t-1", { status: "Inactive" });

      expect(result.data.status).toBe("Inactive");
      expect(mockSub.update).toHaveBeenCalledWith({ status: "Inactive" });
    });

    it("should ignore unknown fields in update payload", async () => {
      const mockSub = {
        id: "sub-1",
        tenantId: "t-1",
        planId: "basic",
        billingCycle: "Monthly",
        status: "Active",
        update: jest.fn().mockResolvedValue({}),
        toJSON: () => ({
          id: "sub-1",
          tenantId: "t-1",
          planId: "pro",
          unknownField: "ignored",
        }),
      };
      Subscription.findOne.mockResolvedValueOnce(mockSub);

      await billingService.updateSubscription("t-1", { planId: "pro", unknownField: "ignored" });

      // Should only update allowed fields (planId, billingCycle, status)
      const updateCall = mockSub.update.mock.calls[0][0];
      expect(Object.keys(updateCall)).toEqual(["planId"]);
    });

    it("should throw 404 when subscription not found", async () => {
      Subscription.findOne.mockResolvedValueOnce(null);

      await expect(
        billingService.updateSubscription("t-1", { planId: "pro" }),
      ).rejects.toMatchObject({ status: 404, message: "Subscription not found for this tenant" });
    });

    it("should throw 500 on database error", async () => {
      Subscription.findOne.mockRejectedValueOnce(new Error("DB down"));

      await expect(
        billingService.updateSubscription("t-1", { planId: "pro" }),
      ).rejects.toMatchObject({ status: 500, message: "DB down" });
    });
  });

  // ================================================================
  describe("fetchInvoices", () => {
    it("should fetch invoices with pagination", async () => {
      const mockInvoice = {
        id: "inv-1",
        tenantId: "t-1",
        amount: 99.99,
        status: "paid",
        toJSON: () => ({
          id: "inv-1",
          tenantId: "t-1",
          amount: 99.99,
          status: "paid",
        }),
      };
      Invoice.findAndCountAll.mockResolvedValueOnce({
        count: 5,
        rows: [mockInvoice],
      });

      const result = await billingService.fetchInvoices({ tenantId: "t-1", page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.message).toBe("Fetch invoices successful");
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.count).toBe(5);
      expect(result.data.meta).toEqual({
        total: 5,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: "t-1" },
          limit: 10,
          offset: 0,
          order: [["createdAt", "DESC"]],
        }),
      );
    });

    it("should filter by status when provided", async () => {
      Invoice.findAndCountAll.mockResolvedValueOnce({
        count: 2,
        rows: [],
      });

      await billingService.fetchInvoices({ tenantId: "t-1", status: "unpaid" });

      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: "t-1", status: "unpaid" },
        }),
      );
    });

    it("should enforce MAX_LIMIT cap", async () => {
      Invoice.findAndCountAll.mockResolvedValueOnce({
        count: 0,
        rows: [],
      });

      await billingService.fetchInvoices({ tenantId: "t-1", limit: 9999 });

      // Should cap at MAX_LIMIT (100)
      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100, offset: 0 }),
      );
    });

    it("should use page 2 offset correctly", async () => {
      Invoice.findAndCountAll.mockResolvedValueOnce({
        count: 50,
        rows: [],
      });

      await billingService.fetchInvoices({ tenantId: "t-1", page: 3, limit: 10 });

      // page 3, limit 10 -> offset = (3-1)*10 = 20
      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10,
          offset: 20,
        }),
      );
    });

    it("should include subscription relation in query", async () => {
      Invoice.findAndCountAll.mockResolvedValueOnce({
        count: 1,
        rows: [],
      });

      await billingService.fetchInvoices({ tenantId: "t-1" });

      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          include: [
            {
              model: Subscription,
              as: "subscription",
              attributes: ["id", "planId"],
            },
          ],
        }),
      );
    });

    it("should return empty array for zero results", async () => {
      Invoice.findAndCountAll.mockResolvedValueOnce({
        count: 0,
        rows: [],
      });

      const result = await billingService.fetchInvoices({ tenantId: "t-1" });

      expect(result.data.rows).toEqual([]);
      expect(result.data.count).toBe(0);
      expect(result.data.meta.totalPages).toBe(0);
    });

    it("should throw on database error", async () => {
      Invoice.findAndCountAll.mockRejectedValueOnce(new Error("DB query failed"));

      await expect(
        billingService.fetchInvoices({ tenantId: "t-1" }),
      ).rejects.toMatchObject({
        status: 500,
        message: "DB query failed",
      });
    });

    it("should handle default limit when not provided", async () => {
      Invoice.findAndCountAll.mockResolvedValueOnce({
        count: 0,
        rows: [],
      });

      await billingService.fetchInvoices({ tenantId: "t-1" });

      // Default limit is 20
      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 20,
          offset: 0,
        }),
      );
    });

    it("should handle page 1 with default limit correctly", async () => {
      Invoice.findAndCountAll.mockResolvedValueOnce({
        count: 0,
        rows: [],
      });

      await billingService.fetchInvoices({ tenantId: "t-1", page: 1, limit: 20 });

      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 20,
          offset: 0,
        }),
      );
    });

    it("should include Subscription model in include array", async () => {
      Invoice.findAndCountAll.mockResolvedValueOnce({
        count: 0,
        rows: [],
      });

      await billingService.fetchInvoices({ tenantId: "t-1" });

      const includeArg = Invoice.findAndCountAll.mock.calls[0][0].include;
      expect(includeArg).toHaveLength(1);
      expect(includeArg[0].model).toBe(Subscription);
      expect(includeArg[0].as).toBe("subscription");
    });
  });

  // ================================================================
  // Coverage: transform helpers + error-default branches
  // ================================================================
  describe("transformRecord branches", () => {
    it("serializes a Sequelize instance via toJSON", async () => {
      Subscription.findOne.mockResolvedValueOnce({
        id: "sub-1",
        toJSON: () => ({ id: "sub-1", planId: "pro" }),
      });

      const result = await billingService.getSubscription("t-1");

      expect(result.data).toEqual({ id: "sub-1", planId: "pro" });
    });

    it("spreads a plain object that has no toJSON", async () => {
      Subscription.findOne.mockResolvedValueOnce({ id: "sub-1", planId: "basic" });

      const result = await billingService.getSubscription("t-1");

      expect(result.data).toEqual({ id: "sub-1", planId: "basic" });
    });

    it("returns null data when the auto-created subscription is null", async () => {
      Subscription.findOne.mockResolvedValueOnce(null);
      Subscription.create.mockResolvedValueOnce(null);

      const result = await billingService.getSubscription("t-1");

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  describe("getSubscription error defaults", () => {
    it("defaults to 500 and a generic message when the error has neither", async () => {
      Subscription.findOne.mockRejectedValueOnce({});

      await expect(billingService.getSubscription("t-1")).rejects.toEqual({
        status: 500,
        message: "Failed to retrieve subscription",
      });
    });

    it("preserves a status carried by the error", async () => {
      Subscription.findOne.mockRejectedValueOnce({ status: 503, message: "DB offline" });

      await expect(billingService.getSubscription("t-1")).rejects.toEqual({
        status: 503,
        message: "DB offline",
      });
    });
  });

  describe("updateSubscription error defaults", () => {
    it("defaults to 500 and a generic message when the error has neither", async () => {
      Subscription.findOne.mockRejectedValueOnce({});

      await expect(billingService.updateSubscription("t-1", {})).rejects.toEqual({
        status: 500,
        message: "Failed to update subscription",
      });
    });

    it("passes an empty payload through when no updatable field is supplied", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      Subscription.findOne.mockResolvedValueOnce({ id: "sub-1", update });

      await billingService.updateSubscription("t-1", {});

      expect(update).toHaveBeenCalledWith({});
    });

    it("surfaces the 404 AppError as status 404", async () => {
      Subscription.findOne.mockResolvedValueOnce(null);

      await expect(billingService.updateSubscription("t-1", { planId: "pro" })).rejects.toEqual({
        status: 404,
        message: "Subscription not found for this tenant",
      });
    });
  });

  describe("fetchInvoices coverage gaps", () => {
    it("tolerates an undefined rows array from the model", async () => {
      Invoice.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: undefined });

      const result = await billingService.fetchInvoices({ tenantId: "t-1" });

      expect(result.data.rows).toEqual([]);
    });

    it("maps a null row to null rather than throwing", async () => {
      Invoice.findAndCountAll.mockResolvedValueOnce({ count: 1, rows: [null] });

      const result = await billingService.fetchInvoices({ tenantId: "t-1" });

      expect(result.data.rows).toEqual([null]);
    });

    it("falls back to DEFAULT_LIMIT when limit is not a number", async () => {
      const { DEFAULT_LIMIT } = require("../../constants");
      Invoice.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      await billingService.fetchInvoices({ tenantId: "t-1", limit: "abc" });

      expect(Invoice.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: DEFAULT_LIMIT }),
      );
    });

    it("defaults to 500 and a generic message when the error has neither", async () => {
      Invoice.findAndCountAll.mockRejectedValueOnce({});

      await expect(billingService.fetchInvoices({ tenantId: "t-1" })).rejects.toEqual({
        status: 500,
        message: "Failed to fetch invoices",
      });
    });
  });
});
