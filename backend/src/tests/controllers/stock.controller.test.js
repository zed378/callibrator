/**
 * Tests for Stock Controller
 */

// Mock service FIRST
jest.mock("../../services/stock.service", () => ({
  fetchStocks: jest.fn(),
  fetchSpecificStock: jest.fn(),
  createStock: jest.fn(),
  updateStock: jest.fn(),
  deleteStock: jest.fn(),
  createAdjustment: jest.fn(),
  fetchAdjustments: jest.fn(),
  createTransfer: jest.fn(),
  updateTransferStatus: jest.fn(),
  fetchTransfers: jest.fn(),
  createOpname: jest.fn(),
  updateOpnameStatus: jest.fn(),
  fetchOpnames: jest.fn(),
  getInventoryReport: jest.fn(),
  exportInventoryCsv: jest.fn(),
}));

// Mock response helper
jest.mock("../../utils/response.util", () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

const stockController = require("../../controllers/stock.controller");
const stockService = require("../../services/stock.service");
const { success, error } = require("../../utils/response.util");

describe("stockController", () => {
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

  describe("getAllStocks", () => {
    it("should fetch all stocks and return success response", async () => {
      req.query = { page: "1", limit: "10", find: "Weight" };

      stockService.fetchStocks.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Fetch stocks successful",
        data: {
          rows: [{ id: "st-1", itemName: "Weight" }],
          meta: { total: 1, page: 1, limit: 10 },
        },
      });

      await stockController.getAllStocks(req, res);

      expect(stockService.fetchStocks).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        warehouseId: undefined,
        locationId: undefined,
        find: "Weight",
        page: 1,
        limit: 10,
      });
      expect(success).toHaveBeenCalled();
    });

    it("should reject an invalid query without calling the service", async () => {
      // limit max is 100 in getStocksQuery — this trips the validate() throw.
      req.query = { limit: "500" };

      await stockController.getAllStocks(req, res, next);

      expect(stockService.fetchStocks).not.toHaveBeenCalled();
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

  describe("getSpecificStock", () => {
    it("should fetch specific stock and return success response", async () => {
      req.params = { stockId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" };

      stockService.fetchSpecificStock.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Fetch stock item successful",
        data: { id: "st-1" },
      });

      await stockController.getSpecificStock(req, res);

      expect(stockService.fetchSpecificStock).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createStock", () => {
    it("should create stock and return success response", async () => {
      req.body = {
        warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        itemName: "Item 1",
      };

      stockService.createStock.mockResolvedValueOnce({
        success: true,
        status: 201,
        message: "Stock item created successfully",
        data: { id: "st-1" },
      });

      await stockController.createStock(req, res);

      expect(stockService.createStock).toHaveBeenCalledWith("tenant-1", {
        warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        itemName: "Item 1",
        quantity: 0,
        minQuantity: 0,
      });
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateStock", () => {
    it("should update stock and return success response", async () => {
      req.params = { stockId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" };
      req.body = { itemName: "Updated Item", quantity: 15 };

      stockService.updateStock.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Stock item updated successfully",
        data: { id: "st-1" },
      });

      await stockController.updateStock(req, res);

      expect(stockService.updateStock).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        { itemName: "Updated Item", quantity: 15 },
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("deleteStock", () => {
    it("should delete stock and return success response", async () => {
      req.params = { stockId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" };

      stockService.deleteStock.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Stock item deleted successfully",
        data: null,
      });

      await stockController.deleteStock(req, res);

      expect(stockService.deleteStock).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createAdjustment", () => {
    it("should create stock adjustment and return success response", async () => {
      req.body = {
        stockId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        type: "addition",
        quantity: 5,
        reason: "Excess found",
      };

      stockService.createAdjustment.mockResolvedValueOnce({
        success: true,
        status: 201,
        message: "Stock adjusted successfully",
        data: { id: "adj-1" },
      });

      await stockController.createAdjustment(req, res);

      expect(stockService.createAdjustment).toHaveBeenCalledWith(
        "tenant-1",
        {
          stockId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
          type: "addition",
          quantity: 5,
          reason: "Excess found",
        },
        "user-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getAdjustments", () => {
    it("should fetch adjustments and return success response", async () => {
      req.query = { warehouseId: "wh-1", type: "addition" };

      stockService.fetchAdjustments.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Fetch adjustments successful",
        data: { rows: [], meta: { total: 0 } },
      });

      await stockController.getAdjustments(req, res);

      expect(stockService.fetchAdjustments).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        warehouseId: "wh-1",
        type: "addition",
        page: undefined,
        limit: undefined,
      });
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createTransfer", () => {
    it("should create stock transfer and return success response", async () => {
      req.body = {
        fromWarehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        toWarehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b12",
        itemName: "Item 1",
        quantity: 5,
      };

      stockService.createTransfer.mockResolvedValueOnce({
        success: true,
        status: 201,
        message: "Stock transfer request created successfully",
        data: { id: "tf-1" },
      });

      await stockController.createTransfer(req, res);

      expect(stockService.createTransfer).toHaveBeenCalledWith(
        "tenant-1",
        {
          fromWarehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
          toWarehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b12",
          itemName: "Item 1",
          quantity: 5,
        },
        "user-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateTransferStatus", () => {
    it("should update transfer status and return success response", async () => {
      req.params = { transferId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" };
      req.body = { status: "completed" };

      stockService.updateTransferStatus.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Stock transfer status updated to completed successfully",
        data: { id: "tf-1" },
      });

      await stockController.updateTransferStatus(req, res);

      expect(stockService.updateTransferStatus).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        { status: "completed" },
        "user-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getTransfers", () => {
    it("should fetch transfers and return success response", async () => {
      req.query = { fromWarehouseId: "wh-1", toWarehouseId: "wh-2", status: "completed" };

      stockService.fetchTransfers.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Fetch transfers successful",
        data: { rows: [], meta: { total: 0 } },
      });

      await stockController.getTransfers(req, res);

      expect(stockService.fetchTransfers).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        fromWarehouseId: "wh-1",
        toWarehouseId: "wh-2",
        status: "completed",
        page: undefined,
        limit: undefined,
      });
      expect(success).toHaveBeenCalled();
    });
  });

  describe("createOpname", () => {
    it("should create stock opname and return success response", async () => {
      const scheduledDate = new Date().toISOString();
      req.body = {
        warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        scheduledAt: scheduledDate,
      };

      stockService.createOpname.mockResolvedValueOnce({
        success: true,
        status: 201,
        message: "Stock opname scheduled successfully",
        data: { id: "op-1" },
      });

      await stockController.createOpname(req, res);

      expect(stockService.createOpname).toHaveBeenCalledWith(
        "tenant-1",
        {
          warehouseId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
          scheduledAt: expect.any(Date),
        },
        "user-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("updateOpnameStatus", () => {
    it("should update opname status and return success response", async () => {
      req.params = { opnameId: "8c352a92-d6cf-4b71-b0db-6e69622d1b11" };
      req.body = { status: "completed" };

      stockService.updateOpnameStatus.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Stock opname status updated to completed successfully",
        data: { id: "op-1" },
      });

      await stockController.updateOpnameStatus(req, res);

      expect(stockService.updateOpnameStatus).toHaveBeenCalledWith(
        "tenant-1",
        "8c352a92-d6cf-4b71-b0db-6e69622d1b11",
        { status: "completed" },
        "user-1",
      );
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getOpnames", () => {
    it("should fetch opnames and return success response", async () => {
      req.query = { warehouseId: "wh-1", status: "completed" };

      stockService.fetchOpnames.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Fetch opnames successful",
        data: { rows: [], meta: { total: 0 } },
      });

      await stockController.getOpnames(req, res);

      expect(stockService.fetchOpnames).toHaveBeenCalledWith({
        tenantId: "tenant-1",
        warehouseId: "wh-1",
        status: "completed",
        page: undefined,
        limit: undefined,
      });
      expect(success).toHaveBeenCalled();
    });
  });

  describe("getInventoryReport", () => {
    it("should get inventory report and call success helper", async () => {
      const mockReportData = {
        totalItems: 5,
        totalUnits: 100,
        lowStockCount: 2,
        warehouseDistribution: [],
      };

      stockService.getInventoryReport.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Get inventory report successful",
        data: mockReportData,
      });

      await stockController.getInventoryReport(req, res);

      expect(stockService.getInventoryReport).toHaveBeenCalledWith("tenant-1");
      expect(success).toHaveBeenCalledWith(
        res,
        mockReportData,
        null,
        "Get inventory report successful",
        200,
      );
    });
  });

  describe("exportInventoryCsv", () => {
    it("should export inventory CSV and write headers and send output successfully", async () => {
      const mockCsvString = "Item Name,Quantity\nItem A,10";

      stockService.exportInventoryCsv.mockResolvedValueOnce({
        success: true,
        status: 200,
        message: "Export inventory CSV successful",
        data: mockCsvString,
      });

      res.setHeader = jest.fn();
      res.send = jest.fn();

      await stockController.exportInventoryCsv(req, res);

      expect(stockService.exportInventoryCsv).toHaveBeenCalledWith("tenant-1");
      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
      expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", "attachment; filename=inventory_report.csv");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(mockCsvString);
    });
  });
});
