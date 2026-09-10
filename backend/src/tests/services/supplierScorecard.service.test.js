jest.mock("../../models", () => ({
  SupplierScorecard: {
    create: jest.fn(),
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
  },
  Vendor: {
    findOne: jest.fn(),
  },
  User: {
    name: "User",
  },
}));

jest.mock("../../utils/appError.util", () => ({
  AppError: class AppError extends Error {
    constructor(statusCode, message) {
      super(message);
      this.statusCode = statusCode;
      this.name = "AppError";
    }
  },
}));

const {
  createScorecard,
  getScorecards,
  getScorecardById,
  updateScorecard,
  deleteScorecard,
} = require("../../services/supplierScorecard.service");

describe("supplierScorecard.service", () => {
  const { SupplierScorecard, Vendor, User } = require("../../models");
  const { AppError } = require("../../utils/appError.util");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createScorecard", () => {
    it("should create scorecard after validating vendor exists", async () => {
      Vendor.findOne.mockResolvedValue({ id: "v1", name: "Acme" });
      SupplierScorecard.create.mockResolvedValue({ id: "s1", score: 85 });

      const result = await createScorecard("tenant123", {
        vendorId: "v1",
        score: 85,
        status: "active",
      }, "user456");

      expect(Vendor.findOne).toHaveBeenCalledWith({ where: { id: "v1", tenantId: "tenant123" } });
      expect(SupplierScorecard.create).toHaveBeenCalledWith({
        vendorId: "v1",
        score: 85,
        status: "active",
        tenantId: "tenant123",
        evaluatedBy: "user456",
      });
      expect(result).toEqual({ id: "s1", score: 85 });
    });

    it("should throw 404 when vendor not found", async () => {
      Vendor.findOne.mockResolvedValue(null);

      await expect(
        createScorecard("tenant123", { vendorId: "v999", score: 90 }, "user1")
      ).rejects.toThrow("Vendor not found");
    });

    it("should pass through empty vendor data", async () => {
      Vendor.findOne.mockResolvedValue({ id: "v1" });
      SupplierScorecard.create.mockResolvedValue({ id: "s2" });

      const result = await createScorecard("t1", { vendorId: "v1" }, "u1");

      expect(SupplierScorecard.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "t1", evaluatedBy: "u1" })
      );
      expect(result).toEqual({ id: "s2" });
    });
  });

  describe("getScorecards", () => {
    it("should return paginated scorecards with defaults", async () => {
      const mockRows = [{ id: "s1", score: 80 }];
      SupplierScorecard.findAndCountAll.mockResolvedValue({ count: 1, rows: mockRows });

      const result = await getScorecards("tenant123", {});

      expect(SupplierScorecard.findAndCountAll).toHaveBeenCalledWith({
        where: { tenantId: "tenant123" },
        limit: 10,
        offset: 0,
        order: [["evaluationDate", "DESC"]],
        include: [
          { model: Vendor, as: "vendor", attributes: ["id", "name"] },
          { model: User, as: "evaluator", attributes: ["id", "firstName", "lastName", "email"] },
        ],
      });
      expect(result).toEqual({
        rows: mockRows,
        total: 1,
        page: 1,
        totalPages: 1,
      });
    });

    it("should filter by vendorId and status", async () => {
      SupplierScorecard.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      await getScorecards("t1", { vendorId: "v1", status: "active" });

      expect(SupplierScorecard.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: "t1", vendorId: "v1", status: "active" },
        })
      );
    });

    it("should handle custom pagination", async () => {
      SupplierScorecard.findAndCountAll.mockResolvedValue({ count: 45, rows: [] });

      const result = await getScorecards("t1", { limit: 15, page: 3 });

      expect(SupplierScorecard.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 15,
          offset: 30,
        })
      );
      expect(result.totalPages).toBe(3);
    });

    it("should return totalPages 0 when no results", async () => {
      SupplierScorecard.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      const result = await getScorecards("t1", {});
      expect(result.totalPages).toBe(0);
    });
  });

  describe("getScorecardById", () => {
    it("should return scorecard with vendor and evaluator", async () => {
      const mock = { id: "s1", score: 92 };
      SupplierScorecard.findOne.mockResolvedValue(mock);

      const result = await getScorecardById("tenant123", "s1");

      expect(SupplierScorecard.findOne).toHaveBeenCalledWith({
        where: { id: "s1", tenantId: "tenant123" },
        include: [
          { model: Vendor, as: "vendor", attributes: ["id", "name"] },
          { model: User, as: "evaluator", attributes: ["id", "firstName", "lastName", "email"] },
        ],
      });
      expect(result).toEqual(mock);
    });

    it("should throw 404 when scorecard not found", async () => {
      SupplierScorecard.findOne.mockResolvedValue(null);

      await expect(getScorecardById("tenant123", "nonexistent")).rejects.toThrow("Scorecard not found");
    });
  });

  describe("updateScorecard", () => {
    it("should update and return scorecard", async () => {
      const mock = {
        id: "s1",
        score: 80,
        update: jest.fn(function (data) {
          Object.assign(mock, data);
          return Promise.resolve(mock);
        }),
      };
      SupplierScorecard.findOne.mockResolvedValue(mock);

      const result = await updateScorecard("t1", "s1", { score: 95 });

      expect(mock.update).toHaveBeenCalledWith({ score: 95 });
      expect(result).toEqual(expect.objectContaining({ id: "s1", score: 95 }));
    });

    it("should throw 404 when updating non-existent scorecard", async () => {
      SupplierScorecard.findOne.mockResolvedValue(null);

      await expect(updateScorecard("t1", "nonexistent", { score: 50 })).rejects.toThrow("Scorecard not found");
    });
  });

  describe("deleteScorecard", () => {
    it("should delete scorecard and return true", async () => {
      const mock = {
        id: "s1",
        destroy: jest.fn().mockResolvedValue(true),
      };
      SupplierScorecard.findOne.mockResolvedValue(mock);

      const result = await deleteScorecard("t1", "s1");

      expect(mock.destroy).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should throw 404 when deleting non-existent scorecard", async () => {
      SupplierScorecard.findOne.mockResolvedValue(null);

      await expect(deleteScorecard("t1", "nonexistent")).rejects.toThrow("Scorecard not found");
    });
  });
});
