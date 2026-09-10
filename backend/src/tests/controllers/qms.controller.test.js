/**
 * Tests for qms controller
 */

jest.mock("../../services/qms.service", () => ({
  createNC: jest.fn(),
  getNCs: jest.fn(),
  updateNC: jest.fn(),
  createCapa: jest.fn(),
  getCapas: jest.fn(),
  updateCapa: jest.fn(),
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

const qmsService = require("../../services/qms.service");
const qmsController = require("../../controllers/qms.controller");
const { error: sendError } = require("../../utils/response.util");

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440002";
const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440001";
const VALID_NC_ID = "550e8400-e29b-41d4-a716-446655440010";
const VALID_CAPA_ID = "550e8400-e29b-41d4-a716-446655440011";

describe("qms Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      body: {},
      params: {},
      query: {},
      user: { id: VALID_USER_ID, tenantId: VALID_TENANT_ID },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("createNC", () => {
    it("should create a non-conformance", async () => {
      req.body = { title: "Screen misalignment", description: "Device screen 2px off", severity: "HIGH", deviceId: "dev-1", dateIdentified: "2025-01-01" };
      const result = { id: VALID_NC_ID, ncNumber: "NC-00001" };
      qmsService.createNC.mockResolvedValue(result);

      await qmsController.createNC(req, res, next);

      expect(qmsService.createNC).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_USER_ID, req.body);
      expect(sendError).not.toHaveBeenCalled();
    });
  });

  describe("getNCs", () => {
    it("should return paginated non-conformances", async () => {
      req.query = { page: "1", limit: "10" };
      const result = { total: 5, page: 1, limit: 10, totalPages: 1, nonConformances: [] };
      qmsService.getNCs.mockResolvedValue(result);

      await qmsController.getNCs(req, res, next);

      expect(qmsService.getNCs).toHaveBeenCalledWith(VALID_TENANT_ID, "1", "10", undefined);
      expect(sendError).not.toHaveBeenCalled();
    });

    it("should filter by status", async () => {
      req.query = { page: "1", limit: "10", status: "OPEN" };
      qmsService.getNCs.mockResolvedValue({ total: 2, page: 1, limit: 10, totalPages: 1, nonConformances: [] });

      await qmsController.getNCs(req, res, next);

      expect(qmsService.getNCs).toHaveBeenCalledWith(VALID_TENANT_ID, "1", "10", "OPEN");
    });
  });

  describe("updateNC", () => {
    it("should update a non-conformance", async () => {
      req.params = { id: VALID_NC_ID };
      req.body = { status: "RESOLVED", severity: "LOW" };
      const result = { id: VALID_NC_ID, status: "RESOLVED" };
      qmsService.updateNC.mockResolvedValue(result);

      await qmsController.updateNC(req, res, next);

      expect(qmsService.updateNC).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_NC_ID, req.body);
      expect(sendError).not.toHaveBeenCalled();
    });

    it("should handle not found error", async () => {
      req.params = { id: VALID_NC_ID };
      req.body = { status: "RESOLVED" };
      const AppError = require("../../utils/appError.util");
      qmsService.updateNC.mockRejectedValue(new AppError(404, "Non-Conformance not found"));

      await qmsController.updateNC(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "Non-Conformance not found", 404);
    });
  });

  describe("createCapa", () => {
    it("should create a CAPA", async () => {
      req.body = { ncId: VALID_NC_ID, title: "Fix screen calibration", actionPlan: "Recalibrate display", assignedTo: VALID_USER_ID, dueDate: "2025-02-01" };
      const result = { id: VALID_CAPA_ID, capaNumber: "CAPA-00001" };
      qmsService.createCapa.mockResolvedValue(result);

      await qmsController.createCapa(req, res, next);

      expect(qmsService.createCapa).toHaveBeenCalledWith(VALID_TENANT_ID, req.body);
      expect(sendError).not.toHaveBeenCalled();
    });

    it("should handle NC not found error", async () => {
      req.body = { ncId: VALID_NC_ID };
      const AppError = require("../../utils/appError.util");
      qmsService.createCapa.mockRejectedValue(new AppError(404, "Non-Conformance not found"));

      await qmsController.createCapa(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "Non-Conformance not found", 404);
    });
  });

  describe("getCapas", () => {
    it("should return paginated CAPAs", async () => {
      req.query = { page: "1", limit: "10" };
      qmsService.getCapas.mockResolvedValue({ total: 3, page: 1, limit: 10, totalPages: 1, capas: [] });

      await qmsController.getCapas(req, res, next);

      expect(qmsService.getCapas).toHaveBeenCalledWith(VALID_TENANT_ID, "1", "10", undefined);
    });

    it("should filter by status", async () => {
      req.query = { page: "1", limit: "10", status: "OPEN" };
      qmsService.getCapas.mockResolvedValue({ total: 1, page: 1, limit: 10, totalPages: 1, capas: [] });

      await qmsController.getCapas(req, res, next);

      expect(qmsService.getCapas).toHaveBeenCalledWith(VALID_TENANT_ID, "1", "10", "OPEN");
    });
  });

  describe("updateCapa", () => {
    it("should update a CAPA", async () => {
      req.params = { id: VALID_CAPA_ID };
      req.body = { status: "IN_PROGRESS" };
      qmsService.updateCapa.mockResolvedValue({ id: VALID_CAPA_ID, status: "IN_PROGRESS" });

      await qmsController.updateCapa(req, res, next);

      expect(qmsService.updateCapa).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_CAPA_ID, req.body);
    });

    it("should handle CAPA not found error", async () => {
      req.params = { id: VALID_CAPA_ID };
      req.body = { status: "CLOSED" };
      const AppError = require("../../utils/appError.util");
      qmsService.updateCapa.mockRejectedValue(new AppError(404, "CAPA not found"));

      await qmsController.updateCapa(req, res, next);

      expect(sendError).toHaveBeenCalledWith(res, "CAPA not found", 404);
    });
  });
});