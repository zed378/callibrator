/**
 * Tests for Warehouse Controller
 */

// Mock service FIRST
jest.mock("../../services/warehouse.service", () => ({
  fetchWarehouses: jest.fn(),
  fetchSpecificWarehouse: jest.fn(),
  createWarehouse: jest.fn(),
  updateWarehouse: jest.fn(),
  deleteWarehouse: jest.fn(),
  fetchLocations: jest.fn(),
  createLocation: jest.fn(),
  updateLocation: jest.fn(),
  deleteLocation: jest.fn(),
}));

// Mock response helper
jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const warehouseController = require("../../controllers/warehouse.controller");
const warehouseService = require("../../services/warehouse.service");
const { success, error } = require("../../utils/response.util");

describe("warehouseController", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    jest.clearAllMocks();

    next = jest.fn();
    req = {
      body: {},
      query: {},
      params: {},
      headers: {},
      user: { id: "user-1", tenantId: "tenant-1" },
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {},
    };

    success.mockImplementation((response, data, meta, message, status) => {
      response.status(status || 200).json({ success: true, data, meta, message });
    });
  });

  describe("getAllWarehouses", () => {
    it("should fetch all warehouses and return success response", async () => {
      req.query = { page: "1", limit: "10", find: "Central" };

      warehouseService.fetchWarehouses.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Fetch warehouses successful",
        data: {
          rows: [{ id: "wh-1", name: "Central WH" }],
          meta: { total: 1, page: 1, limit: 10 },
        },
      });

      await warehouseController.getAllWarehouses(req, res);

      expect(warehouseService.fetchWarehouses).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        find: "Central",
        page: 1,
        limit: 10,
      });
      expect(success).toHaveBeenCalledWith(
        res,
        [{ id: "wh-1", name: "Central WH" }],
        { total: 1, page: 1, limit: 10 },
        "Fetch warehouses successful",
        200,
      );
    });

    it("should reject an invalid query without calling the service", async () => {
      // `status` only accepts active/inactive — this trips the validate() throw.
      req.query = { status: "archived" };

      await warehouseController.getAllWarehouses(req, res, next);

      expect(warehouseService.fetchWarehouses).not.toHaveBeenCalled();
      // asyncHandler maps the thrown { status, message } onto response.util.error
      expect(error).toHaveBeenCalledWith(
        res,
        "Validation failed",
        400,
        expect.anything(),
      );
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 400,
          message: "Validation failed",
          errors: expect.any(Array),
        }),
      );
    });
  });

  describe("getSpecificWarehouse", () => {
    it("should fetch a warehouse and return success response", async () => {
      req.params = { warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" };

      warehouseService.fetchSpecificWarehouse.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Fetch warehouse successful",
        data: { id: "wh-1", name: "WH 1" },
      });

      await warehouseController.getSpecificWarehouse(req, res);

      expect(warehouseService.fetchSpecificWarehouse).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      );
      expect(success).toHaveBeenCalledWith(
        res,
        { id: "wh-1", name: "WH 1" },
        null,
        "Fetch warehouse successful",
        200,
      );
    });
  });

  describe("createWarehouse", () => {
    it("should create a warehouse and return success response", async () => {
      req.body = { name: "New WH", code: "CODE-1" };

      warehouseService.createWarehouse.mockResolvedValueOnce({
        success: true,
        status: 201,
        message: "Warehouse created successfully",
        data: { id: "wh-1", name: "New WH" },
      });

      await warehouseController.createWarehouse(req, res);

      expect(warehouseService.createWarehouse).toHaveBeenCalledWith("tenant-1", {
        name: "New WH",
        code: "CODE-1",
        status: "active",
      });
      expect(success).toHaveBeenCalledWith(
        res,
        { id: "wh-1", name: "New WH" },
        null,
        "Warehouse created successfully",
        201,
      );
    });
  });

  describe("updateWarehouse", () => {
    it("should update a warehouse and return success response", async () => {
      req.params = { warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" };
      req.body = { name: "Updated WH", status: "inactive" };

      warehouseService.updateWarehouse.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Warehouse updated successfully",
        data: { id: "wh-1", name: "Updated WH" },
      });

      await warehouseController.updateWarehouse(req, res);

      expect(warehouseService.updateWarehouse).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        { name: "Updated WH", status: "inactive" },
      );
      expect(success).toHaveBeenCalledWith(
        res,
        { id: "wh-1", name: "Updated WH" },
        null,
        "Warehouse updated successfully",
        200,
      );
    });
  });

  describe("deleteWarehouse", () => {
    it("should delete a warehouse and return success response", async () => {
      req.params = { warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" };

      warehouseService.deleteWarehouse.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Warehouse deleted successfully",
        data: null,
      });

      await warehouseController.deleteWarehouse(req, res);

      expect(warehouseService.deleteWarehouse).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      );
      expect(success).toHaveBeenCalledWith(
        res,
        null,
        null,
        "Warehouse deleted successfully",
        200,
      );
    });
  });

  describe("getLocations", () => {
    it("should fetch locations and return success response", async () => {
      req.params = { warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" };

      warehouseService.fetchLocations.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Fetch storage locations successful",
        data: [{ id: "loc-1", name: "Loc 1" }],
      });

      await warehouseController.getLocations(req, res);

      expect(warehouseService.fetchLocations).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      );
      expect(success).toHaveBeenCalledWith(
        res,
        [{ id: "loc-1", name: "Loc 1" }],
        null,
        "Fetch storage locations successful",
        200,
      );
    });
  });

  describe("createLocation", () => {
    it("should create storage location and return success response", async () => {
      req.body = {
        warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        name: "Loc New",
        code: "L1",
      };

      warehouseService.createLocation.mockResolvedValueOnce({
        success: true,
        status: 201,
        message: "Storage location created successfully",
        data: { id: "loc-1", name: "Loc New" },
      });

      await warehouseController.createLocation(req, res);

      expect(warehouseService.createLocation).toHaveBeenCalledWith("tenant-1", {
        warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        name: "Loc New",
        code: "L1",
        isActive: true,
      });
      expect(success).toHaveBeenCalledWith(
        res,
        { id: "loc-1", name: "Loc New" },
        null,
        "Storage location created successfully",
        201,
      );
    });
  });

  describe("updateLocation", () => {
    it("should update storage location and return success response", async () => {
      req.params = { locationId: "8c352a92-d6cf-4b71-b0db-6e69622d1b12" };
      req.body = { name: "Loc Updated", isActive: false };

      warehouseService.updateLocation.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Storage location updated successfully",
        data: { id: "loc-1", name: "Loc Updated" },
      });

      await warehouseController.updateLocation(req, res);

      expect(warehouseService.updateLocation).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b12",
        { name: "Loc Updated", isActive: false },
      );
      expect(success).toHaveBeenCalledWith(
        res,
        { id: "loc-1", name: "Loc Updated" },
        null,
        "Storage location updated successfully",
        200,
      );
    });
  });

  describe("deleteLocation", () => {
    it("should delete storage location and return success response", async () => {
      req.params = { locationId: "8c352a92-d6cf-4b71-b0db-6e69622d1b12" };

      warehouseService.deleteLocation.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Storage location deleted successfully",
        data: null,
      });

      await warehouseController.deleteLocation(req, res);

      expect(warehouseService.deleteLocation).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b12",
      );
      expect(success).toHaveBeenCalledWith(
        res,
        null,
        null,
        "Storage location deleted successfully",
        200,
      );
    });
  });
});
