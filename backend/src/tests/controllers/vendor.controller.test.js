/**
 * Tests for vendor controller
 */

jest.mock("../../services/vendor.service", () => ({
  fetchVendors: jest.fn(),
  getVendorById: jest.fn(),
  createVendor: jest.fn(),
  updateVendor: jest.fn(),
  deleteVendor: jest.fn(),
  qualifyVendor: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const vendorController = require("../../controllers/vendor.controller");
const vendorService = require("../../services/vendor.service");
const { success } = require("../../utils/response.util");

const VENDOR_ID = "550e8400-e29b-41d4-a716-446655440000";
const TENANT_ID = "550e8400-e29b-41d4-a716-446655440001";

describe("vendor Controller", () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    success.mockImplementation((res, data, meta, message, status) => {
      res.status(status || 200).json({ success: true, data, message });
    });
    req = {
      params: {},
      body: {},
      query: {},
      user: { id: "user-1", tenantId: TENANT_ID },
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("fetchVendors", () => {
    it("should list vendors with pagination", async () => {
      req.query = { page: "1", limit: "10", find: "Acme" };
      vendorService.fetchVendors.mockResolvedValue({
        success: true,
        status: 200,
        message: "Fetch vendors successful",
        data: {
          rows: [{ id: VENDOR_ID, name: "Acme Corp" }],
          meta: { total: 1, page: 1, limit: 10 },
        },
      });

      await vendorController.fetchVendors(req, res, next);

      expect(vendorService.fetchVendors).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          find: "Acme",
          page: "1",
          limit: "10",
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should filter by status", async () => {
      req.query = { page: "1", limit: "10", status: "active" };
      vendorService.fetchVendors.mockResolvedValue({
        success: true,
        status: 200,
        data: { rows: [], meta: { total: 0 } },
      });

      await vendorController.fetchVendors(req, res, next);

      expect(vendorService.fetchVendors).toHaveBeenCalledWith(
        expect.objectContaining({ status: "active" }),
      );
    });
  });

  describe("getVendorById", () => {
    it("should return a specific vendor", async () => {
      req.params = { vendorId: VENDOR_ID };
      vendorService.getVendorById.mockResolvedValue({
        success: true,
        status: 200,
        message: "Vendor retrieved successfully",
        data: { id: VENDOR_ID, name: "Acme Corp" },
      });

      await vendorController.getVendorById(req, res, next);

      expect(vendorService.getVendorById).toHaveBeenCalledWith(
        TENANT_ID,
        VENDOR_ID,
      );
      expect(success).toHaveBeenCalled();
    });

    it("should handle vendor not found", async () => {
      req.params = { vendorId: "invalid-id" };
      vendorService.getVendorById.mockResolvedValue({
        success: false,
        status: 404,
        message: "Vendor not found",
        data: null,
      });

      await vendorController.getVendorById(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("createVendor", () => {
    it("should create a vendor", async () => {
      req.body = { name: "Acme Corp", contact: "john@acme.com" };
      vendorService.createVendor.mockResolvedValue({
        success: true,
        status: 201,
        message: "Vendor created successfully",
        data: { id: "vendor-new", name: "Acme Corp" },
      });

      await vendorController.createVendor(req, res, next);

      expect(vendorService.createVendor).toHaveBeenCalledWith(
        TENANT_ID,
        { name: "Acme Corp", contact: "john@acme.com" },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateVendor", () => {
    it("should update a vendor", async () => {
      req.params = { vendorId: VENDOR_ID };
      req.body = { name: "Acme Corp Updated" };
      vendorService.updateVendor.mockResolvedValue({
        success: true,
        status: 200,
        message: "Vendor updated successfully",
        data: { id: VENDOR_ID, name: "Acme Corp Updated" },
      });

      await vendorController.updateVendor(req, res, next);

      expect(vendorService.updateVendor).toHaveBeenCalledWith(
        TENANT_ID,
        VENDOR_ID,
        { name: "Acme Corp Updated" },
      );
      expect(success).toHaveBeenCalled();
    });

    it("should handle vendor not found on update", async () => {
      req.params = { vendorId: "invalid-id" };
      req.body = { name: "Updated" };
      vendorService.updateVendor.mockResolvedValue({
        success: false,
        status: 404,
        message: "Vendor not found",
        data: null,
      });

      await vendorController.updateVendor(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("deleteVendor", () => {
    it("should delete a vendor", async () => {
      req.params = { vendorId: VENDOR_ID };
      vendorService.deleteVendor.mockResolvedValue({
        success: true,
        status: 200,
        message: "Vendor deleted successfully",
      });

      await vendorController.deleteVendor(req, res, next);

      expect(vendorService.deleteVendor).toHaveBeenCalledWith(
        TENANT_ID,
        VENDOR_ID,
      );
      expect(success).toHaveBeenCalled();
    });

    it("should handle vendor not found on delete", async () => {
      req.params = { vendorId: "invalid-id" };
      vendorService.deleteVendor.mockResolvedValue({
        success: false,
        status: 404,
        message: "Vendor not found",
      });

      await vendorController.deleteVendor(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe("qualifyVendor", () => {
    it("should qualify a vendor", async () => {
      req.params = { vendorId: VENDOR_ID };
      req.body = {
        approvalStatus: "approved",
        scorecard: 95,
        lastAuditDate: "2024-01-01",
        nextAuditDate: "2025-01-01",
      };
      vendorService.qualifyVendor.mockResolvedValue({
        id: VENDOR_ID,
        approvalStatus: "approved",
        scorecard: 95,
      });

      await vendorController.qualifyVendor(req, res, next);

      expect(vendorService.qualifyVendor).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          id: VENDOR_ID,
          approvalStatus: "approved",
          scorecard: 95,
        }),
      );
      expect(success).toHaveBeenCalled();
    });

    it("should qualify with minimal body", async () => {
      req.params = { vendorId: VENDOR_ID };
      req.body = {};
      vendorService.qualifyVendor.mockResolvedValue({
        id: VENDOR_ID,
      });

      await vendorController.qualifyVendor(req, res, next);

      expect(vendorService.qualifyVendor).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          id: VENDOR_ID,
        }),
      );
    });
  });
});
