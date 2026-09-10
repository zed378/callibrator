/**
 * Tests for maintenance.controller.js
 */

jest.mock("../../services/maintenance.service", () => ({
  fetchWorkOrders: jest.fn(),
  getWorkOrderById: jest.fn(),
  createWorkOrder: jest.fn(),
  updateWorkOrder: jest.fn(),
  deleteWorkOrder: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const maintenanceService = require("../../services/maintenance.service");
const maintenanceController = require("../../controllers/maintenance.controller");
const { success } = require("../../utils/response.util");

const VALID_TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("maintenanceController", () => {
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
      ip: "127.0.0.1",
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe("fetchWorkOrders", () => {
    it("should return paginated work orders with default pagination", async () => {
      maintenanceService.fetchWorkOrders.mockResolvedValue({
        success: true,
        status: 200,
        message: "Fetch maintenance work orders successful",
        data: {
          rows: [{ id: "wo-1", title: "Preventive Maintenance" }],
          meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
        },
      });

      await maintenanceController.fetchWorkOrders(req, res, next);

      expect(maintenanceService.fetchWorkOrders).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        find: undefined,
        page: undefined,
        limit: undefined,
        status: undefined,
        type: undefined,
        priority: undefined,
        deviceId: undefined,
      });
      expect(success).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("should filter by query parameters", async () => {
      maintenanceService.fetchWorkOrders.mockResolvedValue({
        success: true,
        status: 200,
        message: "Fetch maintenance work orders successful",
        data: {
          rows: [{ id: "wo-1", title: "Preventive Maintenance" }],
          meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
        },
      });

      req.query = {
        find: "preventive",
        page: "1",
        limit: "10",
        status: "Open",
        type: "Preventive",
        priority: "High",
        deviceId: "device-1",
      };

      await maintenanceController.fetchWorkOrders(req, res, next);

      expect(maintenanceService.fetchWorkOrders).toHaveBeenCalledWith({
        tenantId: VALID_TENANT_ID,
        find: "preventive",
        page: "1",
        limit: "10",
        status: "Open",
        type: "Preventive",
        priority: "High",
        deviceId: "device-1",
      });
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getWorkOrderById", () => {
    it("should return a specific work order", async () => {
      req.params = { orderId: "wo-1" };
      maintenanceService.getWorkOrderById.mockResolvedValue({
        success: true,
        status: 200,
        message: "Maintenance work order retrieved successfully",
        data: { id: "wo-1", title: "Work Order" },
      });

      await maintenanceController.getWorkOrderById(req, res, next);

      expect(maintenanceService.getWorkOrderById).toHaveBeenCalledWith(VALID_TENANT_ID, "wo-1");
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createWorkOrder", () => {
    it("should create a work order with valid data", async () => {
      req.body = {
        title: "Preventive Maintenance",
        type: "Preventive",
        status: "Open",
        deviceId: "device-1",
      };
      maintenanceService.createWorkOrder.mockResolvedValue({
        success: true,
        status: 201,
        message: "Maintenance work order created successfully",
        data: { id: "wo-new", ...req.body },
      });

      await maintenanceController.createWorkOrder(req, res, next);

      expect(maintenanceService.createWorkOrder).toHaveBeenCalledWith(VALID_TENANT_ID, req.body);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateWorkOrder", () => {
    it("should update a work order", async () => {
      req.params = { orderId: "wo-1" };
      req.body = { status: "InProgress" };
      maintenanceService.updateWorkOrder.mockResolvedValue({
        success: true,
        status: 200,
        message: "Maintenance work order updated successfully",
        data: { id: "wo-1", status: "InProgress" },
      });

      await maintenanceController.updateWorkOrder(req, res, next);

      expect(maintenanceService.updateWorkOrder).toHaveBeenCalledWith(VALID_TENANT_ID, "wo-1", req.body);
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteWorkOrder", () => {
    it("should delete a work order", async () => {
      req.params = { orderId: "wo-1" };
      maintenanceService.deleteWorkOrder.mockResolvedValue({
        success: true,
        status: 200,
        message: "Maintenance work order deleted successfully",
      });

      await maintenanceController.deleteWorkOrder(req, res, next);

      expect(maintenanceService.deleteWorkOrder).toHaveBeenCalledWith(VALID_TENANT_ID, "wo-1");
      expect(success).toHaveBeenCalled();
    });
  });
});
