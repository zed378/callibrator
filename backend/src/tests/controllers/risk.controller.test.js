jest.mock("../../services/risk.service", () => ({
  createRisk: jest.fn(),
  getRisks: jest.fn(),
  getRiskById: jest.fn(),
  updateRisk: jest.fn(),
  deleteRisk: jest.fn(),
}));

jest.mock("../../utils/appError.util", () => {
  return class AppError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
      this.statusCode = status;
    }
  };
});

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const riskService = require("../../services/risk.service");
const riskController = require("../../controllers/risk.controller");
const { success, error: sendError } = require("../../utils/response.util");

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440002";
const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_RISK_ID = "550e8400-e29b-41d4-a716-446655440010";

describe("risk Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      params: {},
      body: {},
      query: {},
      user: { id: VALID_USER_ID, tenantId: VALID_TENANT_ID },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("createRisk", () => {
    it("should create risk", async () => {
      riskService.createRisk.mockResolvedValue({ id: VALID_RISK_ID });
      req.body = { title: "Test risk" };
      await riskController.createRisk(req, res, next);
      expect(success).toHaveBeenCalledWith(
        res,
        expect.any(Object),
        null,
        "Risk created successfully",
        201,
      );
    });
  });

  describe("getRisks", () => {
    it("reshapes the paged result into rows + top-level meta", async () => {
      riskService.getRisks.mockResolvedValue({
        rows: [{ id: VALID_RISK_ID }],
        total: 7,
        page: 2,
        totalPages: 4,
      });
      req.query = { page: "2", limit: "2" };

      await riskController.getRisks(req, res, next);

      // data is the array; pagination is the meta sibling.
      expect(success).toHaveBeenCalledWith(
        res,
        [{ id: VALID_RISK_ID }],
        { total: 7, page: 2, limit: 2, totalPages: 4 },
        "Risks retrieved successfully",
        200,
      );
    });

    it("defaults limit to 10 when the query omits it", async () => {
      riskService.getRisks.mockResolvedValue({
        rows: [],
        total: 0,
        page: 1,
        totalPages: 0,
      });
      req.query = {};

      await riskController.getRisks(req, res, next);

      expect(success).toHaveBeenCalledWith(
        res,
        [],
        { total: 0, page: 1, limit: 10, totalPages: 0 },
        "Risks retrieved successfully",
        200,
      );
    });
  });

  describe("getRiskById", () => {
    it("should return risk by id", async () => {
      riskService.getRiskById.mockResolvedValue({ id: VALID_RISK_ID });
      req.params = { id: VALID_RISK_ID };
      await riskController.getRiskById(req, res, next);
      expect(success).toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      const AppError = require("../../utils/appError.util");
      riskService.getRiskById.mockRejectedValue(new AppError(404, "Risk not found"));
      await riskController.getRiskById(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Risk not found", 404);
    });
  });

  describe("updateRisk", () => {
    it("should update risk", async () => {
      riskService.updateRisk.mockResolvedValue({ id: VALID_RISK_ID });
      req.params = { id: VALID_RISK_ID };
      req.body = { title: "Updated" };
      await riskController.updateRisk(req, res, next);
      expect(success).toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      req.body = { title: "Updated" };
      const AppError = require("../../utils/appError.util");
      riskService.updateRisk.mockRejectedValue(new AppError(404, "Risk not found"));
      await riskController.updateRisk(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Risk not found", 404);
    });
  });

  describe("deleteRisk", () => {
    it("should delete risk", async () => {
      riskService.deleteRisk.mockResolvedValue(true);
      req.params = { id: VALID_RISK_ID };
      await riskController.deleteRisk(req, res, next);
      expect(success).toHaveBeenCalled();
    });

    it("should handle 404", async () => {
      req.params = { id: "nonexistent" };
      const AppError = require("../../utils/appError.util");
      riskService.deleteRisk.mockRejectedValue(new AppError(404, "Risk not found"));
      await riskController.deleteRisk(req, res, next);
      expect(sendError).toHaveBeenCalledWith(res, "Risk not found", 404);
    });
  });
});
