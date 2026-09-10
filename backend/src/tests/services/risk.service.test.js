/**
 * Tests for Risk Service
 */

jest.mock("../../models", () => ({
  Risk: {
    create: jest.fn(),
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
  },
  User: {
    findOne: jest.fn(),
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

const riskService = require("../../services/risk.service");
const { Risk, User } = require("../../models");
const { AppError } = require("../../utils/appError.util");

// Helper to create a properly mocked Sequelize instance
function createMockInstance(overrides = {}) {
  const mockInstance = {
    update: jest.fn().mockResolvedValue({}),
    destroy: jest.fn().mockResolvedValue(true),
    get({ plain = false } = {}) { return plain ? { ...this } : this; }
  };
  return { ...mockInstance, ...overrides };
}

describe("riskService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createRisk", () => {
    it("should create a risk with the provided data", async () => {
      const riskData = {
        title: "Test Risk",
        category: "security",
        status: "open",
        description: "A test risk",
      };
      const tenantId = "tenant-1";
      const userId = "user-1";

      Risk.create.mockResolvedValueOnce({ ...riskData, id: "risk-1" });

      const result = await riskService.createRisk(tenantId, riskData, userId);

      expect(Risk.create).toHaveBeenCalledWith({
        ...riskData,
        tenantId,
        identifiedBy: userId,
      });
      expect(result).toEqual({ ...riskData, id: "risk-1" });
    });
  });

  describe("getRisks", () => {
    it("should return paginated risks with filters", async () => {
      const tenantId = "tenant-1";
      const query = {
        limit: 10,
        page: 1,
        status: "open",
        category: "security",
      };
      const mockRisks = [
        { id: "risk-1", title: "Risk 1" },
        { id: "risk-2", title: "Risk 2" },
      ];

      Risk.findAndCountAll.mockResolvedValueOnce({
        count: 2,
        rows: mockRisks,
      });

      const result = await riskService.getRisks(tenantId, query);

      expect(Risk.findAndCountAll).toHaveBeenCalledWith({
        where: { tenantId, status: "open", category: "security" },
        limit: 10,
        offset: 0,
        order: [["createdAt", "DESC"]],
        include: [
          {
            model: User,
            as: "identifier",
            attributes: ["id", "firstName", "lastName", "email"],
            required: false,
          },
          {
            model: User,
            as: "assignee",
            attributes: ["id", "firstName", "lastName", "email"],
            required: false,
          },
        ],
      });

      expect(result).toEqual({
        rows: mockRisks,
        total: 2,
        page: 1,
        totalPages: 1,
      });
    });

    it("should apply limit/page defaults for an empty query", async () => {
      Risk.findAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

      const result = await riskService.getRisks("tenant-1", {});

      // limit = 10, page = 1 come from destructuring defaults.
      expect(Risk.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 0 }),
      );
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(0);
    });

    it("should return risks without filters when not provided", async () => {
      const tenantId = "tenant-1";
      const query = { limit: 20, page: 2 };
      const mockRisks = [{ id: "risk-1", title: "Risk 1" }];

      Risk.findAndCountAll.mockResolvedValueOnce({
        count: 1,
        rows: mockRisks,
      });

      const result = await riskService.getRisks(tenantId, query);

      expect(Risk.findAndCountAll).toHaveBeenCalledWith({
        where: { tenantId },
        limit: 20,
        offset: 20,
        order: [["createdAt", "DESC"]],
        include: [
          {
            model: User,
            as: "identifier",
            attributes: ["id", "firstName", "lastName", "email"],
            required: false,
          },
          {
            model: User,
            as: "assignee",
            attributes: ["id", "firstName", "lastName", "email"],
            required: false,
          },
        ],
      });

      expect(result).toEqual({
        rows: mockRisks,
        total: 1,
        page: 2,
        totalPages: 1,
      });
    });

    it("should calculate totalPages correctly for non-exact divisions", async () => {
      const tenantId = "tenant-1";
      const query = { limit: 10, page: 1 };

      Risk.findAndCountAll.mockResolvedValueOnce({
        count: 25,
        rows: [],
      });

      const result = await riskService.getRisks(tenantId, query);

      expect(result.totalPages).toBe(3);
    });
  });

  describe("getRiskById", () => {
    it("should return a risk by id", async () => {
      const tenantId = "tenant-1";
      const riskId = "risk-1";
      const mockRisk = {
        id: riskId,
        title: "Test Risk",
        status: "open",
        get({ plain = false } = {}) { return plain ? { ...this } : this; }
      };

      Risk.findOne.mockResolvedValueOnce(mockRisk);

      const result = await riskService.getRiskById(tenantId, riskId);

      expect(Risk.findOne).toHaveBeenCalledWith({
        where: { id: riskId, tenantId },
        include: [
          {
            model: User,
            as: "identifier",
            attributes: ["id", "firstName", "lastName", "email"],
            required: false,
          },
          {
            model: User,
            as: "assignee",
            attributes: ["id", "firstName", "lastName", "email"],
            required: false,
          },
        ],
      });
      expect(result).toEqual(mockRisk);
    });

    it("should throw AppError when risk not found", async () => {
      const tenantId = "tenant-1";
      const riskId = "nonexistent";

      Risk.findOne.mockResolvedValueOnce(null);

      await expect(riskService.getRiskById(tenantId, riskId)).rejects.toThrow(
        "Risk not found",
      );
      await expect(
        riskService.getRiskById(tenantId, riskId),
      ).rejects.toBeInstanceOf(AppError);
      await expect(
        riskService.getRiskById(tenantId, riskId),
      ).rejects.toHaveProperty("status", 404);
    });
  });

  describe("updateRisk", () => {
    it("should update a risk", async () => {
      const tenantId = "tenant-1";
      const riskId = "risk-1";
      const updateData = { status: "closed" };
      
      const mockRisk = createMockInstance({
        id: riskId,
        title: "Test Risk",
        status: "open",
      });
      
      // Override update to mutate the instance
      mockRisk.update.mockImplementation(async (data) => {
        Object.assign(mockRisk, data);
        return mockRisk;
      });

      // When Risk.findOne is called, return our mockRisk instance
      Risk.findOne.mockResolvedValueOnce(mockRisk);

      const result = await riskService.updateRisk(tenantId, riskId, updateData);

      // The update should have been called with the updateData
      expect(mockRisk.update).toHaveBeenCalledWith(updateData);
      
      // The result should have the updated properties
      expect(result).toHaveProperty("id", riskId);
      expect(result).toHaveProperty("title", "Test Risk");
      expect(result).toHaveProperty("status", "closed");
    });

    it("should throw error when risk not found during update", async () => {
      const tenantId = "tenant-1";
      const riskId = "nonexistent";
      const updateData = { status: "closed" };

      Risk.findOne.mockResolvedValueOnce(null);

      await expect(
        riskService.updateRisk(tenantId, riskId, updateData),
      ).rejects.toThrow("Risk not found");
    });
  });

  describe("deleteRisk", () => {
    it("should delete a risk", async () => {
      const tenantId = "tenant-1";
      const riskId = "risk-1";
      const mockRisk = createMockInstance({
        id: riskId,
        title: "Test Risk",
        destroy: jest.fn().mockResolvedValue(true),
      });

      Risk.findOne.mockResolvedValueOnce(mockRisk);

      const result = await riskService.deleteRisk(tenantId, riskId);

      expect(mockRisk.destroy).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should throw error when risk not found during delete", async () => {
      const tenantId = "tenant-1";
      const riskId = "nonexistent";

      Risk.findOne.mockResolvedValueOnce(null);

      await expect(riskService.deleteRisk(tenantId, riskId)).rejects.toThrow(
        "Risk not found",
      );
    });
  });
});