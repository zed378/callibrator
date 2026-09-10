/**
 * Tests for finance.controller.js
 */

jest.mock("../../services/finance.service", () => ({
  fetchAssetFinances: jest.fn(),
  getAssetFinanceById: jest.fn(),
  createAssetFinance: jest.fn(),
  updateAssetFinance: jest.fn(),
  deleteAssetFinance: jest.fn(),
  getDepreciationReport: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const financeService = require("../../services/finance.service");
const financeController = require("../../controllers/finance.controller");
const { success } = require("../../utils/response.util");

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_FINANCE_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("financeController", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      query: {},
      params: {},
      body: {},
      user: { id: "user-1", tenantId: VALID_TENANT_ID },
      tenantId: VALID_TENANT_ID,
      setHeader: jest.fn().mockReturnThis(),
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("fetchAssetFinances", () => {
    it("should return paginated asset finance records", async () => {
      req.query = { page: "1", limit: "10", deviceId: "device-1", method: "straight_line" };
      financeService.fetchAssetFinances.mockResolvedValue({
        success: true,
        status: 200,
        message: "Fetch asset finance records successful",
        data: {
          rows: [{ id: "fin-1", purchasePrice: 10000 }],
          meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
        },
      });

      await financeController.fetchAssetFinances(req, res, next);

      expect(financeService.fetchAssetFinances).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        page: "1",
        limit: "10",
        deviceId: "device-1",
        method: "straight_line",
      });
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should use req.tenantId when set", async () => {
      req.query = {};
      req.tenantId = "other-tenant-id";
      req.user.tenantId = VALID_TENANT_ID;
      financeService.fetchAssetFinances.mockResolvedValue({
        success: true,
        status: 200,
        message: "Fetch asset finance records successful",
        data: { rows: [], meta: { total: 0 } },
      });

      await financeController.fetchAssetFinances(req, res, next);

      expect(financeService.fetchAssetFinances).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "other-tenant-id" }),
      );
    });
  });

  describe("getAssetFinanceById", () => {
    it("should return a finance record by ID", async () => {
      req.params = { financeId: VALID_FINANCE_ID };
      financeService.getAssetFinanceById.mockResolvedValue({
        success: true,
        status: 200,
        message: "Asset finance record retrieved successfully",
        data: { id: VALID_FINANCE_ID, purchasePrice: 10000 },
      });

      await financeController.getAssetFinanceById(req, res, next);

      expect(financeService.getAssetFinanceById).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_FINANCE_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createAssetFinance", () => {
    it("should create a finance record", async () => {
      req.body = {
        deviceId: "device-1",
        purchasePrice: 50000,
        purchaseDate: "2026-01-01",
        depreciationMethod: "straight_line",
        usefulLifeYears: 5,
        salvageValue: 5000,
      };
      financeService.createAssetFinance.mockResolvedValue({
        success: true,
        status: 201,
        message: "Asset finance record created successfully",
        data: { id: "fin-new", ...req.body },
      });

      await financeController.createAssetFinance(req, res, next);

      expect(financeService.createAssetFinance).toHaveBeenCalledWith(VALID_TENANT_ID, req.body);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateAssetFinance", () => {
    it("should update a finance record", async () => {
      req.params = { financeId: VALID_FINANCE_ID };
      req.body = { purchasePrice: 55000 };
      financeService.updateAssetFinance.mockResolvedValue({
        success: true,
        status: 200,
        message: "Asset finance record updated successfully",
        data: { id: VALID_FINANCE_ID, purchasePrice: 55000 },
      });

      await financeController.updateAssetFinance(req, res, next);

      expect(financeService.updateAssetFinance).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_FINANCE_ID, req.body);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteAssetFinance", () => {
    it("should delete a finance record", async () => {
      req.params = { financeId: VALID_FINANCE_ID };
      financeService.deleteAssetFinance.mockResolvedValue({
        success: true,
        status: 200,
        message: "Asset finance record deleted successfully",
        data: null,
      });

      await financeController.deleteAssetFinance(req, res, next);

      expect(financeService.deleteAssetFinance).toHaveBeenCalledWith(VALID_TENANT_ID, VALID_FINANCE_ID);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getDepreciationReport", () => {
    it("should return JSON depreciation report", async () => {
      req.query = { asOf: "2026-07-14" };
      financeService.getDepreciationReport.mockResolvedValue({
        success: true,
        status: 200,
        message: "Depreciation report generated successfully",
        data: {
          asOf: "2026-07-14T00:00:00.000Z",
          totals: { totalPurchase: 100000, totalBookValue: 80000 },
          count: 5,
          rows: [],
          csv: "Device,Serial Number...\n",
        },
      });

      await financeController.getDepreciationReport(req, res, next);

      expect(financeService.getDepreciationReport).toHaveBeenCalledWith(VALID_TENANT_ID, { asOf: "2026-07-14" });
      expect(success).toHaveBeenCalled();
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    it("should return CSV when format=csv", async () => {
      req.query = { format: "csv" };
      financeService.getDepreciationReport.mockResolvedValue({
        success: true,
        status: 200,
        message: "Depreciation report generated successfully",
        data: {
          asOf: "2026-07-14T00:00:00.000Z",
          totals: {},
          count: 0,
          rows: [],
          csv: "header\nrow1",
        },
      });

      await financeController.getDepreciationReport(req, res, next);

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
      expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", 'attachment; filename="depreciation-report.csv"');
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("sends the raw csv body and omits csv from the JSON payload", async () => {
      req.query = { format: "CSV" };
      financeService.getDepreciationReport.mockResolvedValue({
        success: true,
        status: 200,
        message: "Depreciation report generated successfully",
        data: { asOf: "2026-07-14T00:00:00.000Z", count: 0, rows: [], csv: "header\nrow1" },
      });

      await financeController.getDepreciationReport(req, res, next);

      // format matching is case-insensitive
      expect(res.send).toHaveBeenCalledWith("header\nrow1");
      expect(success).not.toHaveBeenCalled();
    });

    it("strips the csv field out of the JSON report body", async () => {
      req.query = {};
      financeService.getDepreciationReport.mockResolvedValue({
        success: true,
        status: 200,
        message: "Depreciation report generated successfully",
        data: { asOf: "2026-07-14T00:00:00.000Z", count: 2, rows: [], csv: "header\nrow1" },
      });

      await financeController.getDepreciationReport(req, res, next);

      // req.query.format is undefined -> String(undefined) === "undefined" -> JSON branch
      expect(financeService.getDepreciationReport).toHaveBeenCalledWith(VALID_TENANT_ID, { asOf: undefined });
      expect(success).toHaveBeenCalledWith(
        res,
        { asOf: "2026-07-14T00:00:00.000Z", count: 2, rows: [] },
        null,
        "Depreciation report generated successfully",
        200,
      );
    });
  });

  // Every handler resolves the tenant as `req.tenantId || req.user.tenantId`,
  // so an unset req.tenantId must fall back to the JWT's tenant.
  describe("tenant fallback to req.user.tenantId", () => {
    beforeEach(() => {
      req.tenantId = undefined;
      req.user = { id: "user-1", tenantId: "fallback-tenant" };
    });

    it("falls back for fetchAssetFinances", async () => {
      req.query = {};
      financeService.fetchAssetFinances.mockResolvedValue({
        success: true, status: 200, message: "ok", data: { rows: [], meta: { total: 0 } },
      });
      await financeController.fetchAssetFinances(req, res, next);
      expect(financeService.fetchAssetFinances).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "fallback-tenant" }),
      );
    });

    it("falls back for getAssetFinanceById", async () => {
      req.params = { financeId: VALID_FINANCE_ID };
      financeService.getAssetFinanceById.mockResolvedValue({
        success: true, status: 200, message: "ok", data: { id: VALID_FINANCE_ID },
      });
      await financeController.getAssetFinanceById(req, res, next);
      expect(financeService.getAssetFinanceById).toHaveBeenCalledWith("fallback-tenant", VALID_FINANCE_ID);
    });

    it("falls back for createAssetFinance", async () => {
      req.body = { deviceId: "device-1" };
      financeService.createAssetFinance.mockResolvedValue({
        success: true, status: 201, message: "ok", data: { id: "fin-new" },
      });
      await financeController.createAssetFinance(req, res, next);
      expect(financeService.createAssetFinance).toHaveBeenCalledWith("fallback-tenant", req.body);
    });

    it("falls back for updateAssetFinance", async () => {
      req.params = { financeId: VALID_FINANCE_ID };
      req.body = { purchasePrice: 1 };
      financeService.updateAssetFinance.mockResolvedValue({
        success: true, status: 200, message: "ok", data: {},
      });
      await financeController.updateAssetFinance(req, res, next);
      expect(financeService.updateAssetFinance).toHaveBeenCalledWith("fallback-tenant", VALID_FINANCE_ID, req.body);
    });

    it("falls back for deleteAssetFinance", async () => {
      req.params = { financeId: VALID_FINANCE_ID };
      financeService.deleteAssetFinance.mockResolvedValue({
        success: true, status: 200, message: "ok", data: null,
      });
      await financeController.deleteAssetFinance(req, res, next);
      expect(financeService.deleteAssetFinance).toHaveBeenCalledWith("fallback-tenant", VALID_FINANCE_ID);
    });

    it("falls back for getDepreciationReport", async () => {
      req.query = {};
      financeService.getDepreciationReport.mockResolvedValue({
        success: true, status: 200, message: "ok", data: { rows: [], csv: "" },
      });
      await financeController.getDepreciationReport(req, res, next);
      expect(financeService.getDepreciationReport).toHaveBeenCalledWith("fallback-tenant", { asOf: undefined });
    });
  });
});
