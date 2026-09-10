/**
 * Tests for stock.service.js
 */

// ================================================================
// MOCKS
// ================================================================

jest.mock("sequelize", () => ({
  Op: {
    like: Symbol("like"),
    ne: Symbol("ne"),
    or: Symbol("or"),
  },
}));

jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(),
  },
}));

jest.mock("../../models", () => ({
  Stock: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    findOrCreate: jest.fn(),
  },
  StockTransfer: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  StockAdjustment: {
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  },
  StockOpname: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  Warehouse: {
    findOne: jest.fn(),
  },
  StorageLocation: {
    findOne: jest.fn(),
  },
  User: {},
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
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

jest.mock("../../validators/stock.validator", () => {
  return {
    validate: jest.fn((data, schema) => {
      if (data.failValidation) {
        return {
          error: {
            details: [{ path: ["itemName"], message: "Validation error" }],
          },
          value: null,
        };
      }
      return { error: null, value: data };
    }),
    formatErrors: jest.fn((details) => {
      return details.map((item) => ({
        field: item.path.join("."),
        message: item.message,
      }));
    }),
    createStockSchema: "createStockSchema",
    updateStockSchema: "updateStockSchema",
    createTransferSchema: "createTransferSchema",
    updateTransferStatusSchema: "updateTransferStatusSchema",
    createAdjustmentSchema: "createAdjustmentSchema",
    createOpnameSchema: "createOpnameSchema",
    updateOpnameStatusSchema: "updateOpnameStatusSchema",
  };
});

// ================================================================
// IMPORTS (after mocks)
// ================================================================
const { db } = require("../../config");
const { Stock, StockTransfer, StockAdjustment, StockOpname, Warehouse, StorageLocation } = require("../../models");
const { validate: validateInput } = require("../../validators/stock.validator");

const {
  fetchStocks,
  fetchSpecificStock,
  createStock,
  updateStock,
  deleteStock,
  createAdjustment,
  fetchAdjustments,
  createTransfer,
  updateTransferStatus,
  fetchTransfers,
  createOpname,
  updateOpnameStatus,
  fetchOpnames,
  getInventoryReport,
  exportInventoryCsv,
} = require("../../services/stock.service");

const expectRejectsWithMessage = async (promise, message) => {
  try {
    await promise;
    expect(true).toBe(false);
  } catch (err) {
    expect(err).toBeDefined();
    const actual = err.message || JSON.stringify(err);
    expect(actual).toContain(message);
  }
};

const mockTransaction = () => ({
  commit: jest.fn().mockResolvedValue(),
  rollback: jest.fn().mockResolvedValue(),
});

describe("stock.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validateInput.mockImplementation((data, schema) => {
      if (data.failValidation) {
        return {
          error: {
            details: [{ path: ["itemName"], message: "Validation error" }],
          },
          value: null,
        };
      }
      return { error: null, value: data };
    });
  });

  describe("fetchStocks", () => {
    it("should fetch stocks successfully with all query params", async () => {
      Stock.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: "st-1", itemName: "Item 1" }],
        count: 1,
      });

      const result = await fetchStocks({
        tenantId: "tenant-1",
        warehouseId: "wh-1",
        locationId: "loc-1",
        find: "search",
        page: 2,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.data.rows).toHaveLength(1);
      expect(Stock.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-1",
            warehouseId: "wh-1",
            locationId: "loc-1",
          }),
        }),
      );
    });

    it("should fetch stocks without optional parameters", async () => {
      Stock.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      const result = await fetchStocks({ tenantId: "tenant-1" });
      expect(result.success).toBe(true);
    });

    it("should propagate error on failure", async () => {
      Stock.findAndCountAll.mockRejectedValueOnce(new Error("Fetch failed"));
      await expectRejectsWithMessage(fetchStocks({ tenantId: "tenant-1" }), "Fetch failed");
    });
  });

  describe("fetchSpecificStock", () => {
    it("should fetch specific stock successfully by ID", async () => {
      Stock.findOne.mockResolvedValueOnce({ id: "st-1", itemName: "Item 1" });
      const result = await fetchSpecificStock("tenant-1", "st-1");
      expect(result.success).toBe(true);
      expect(result.data.itemName).toBe("Item 1");
    });

    it("should throw 404 if stock not found", async () => {
      Stock.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(fetchSpecificStock("tenant-1", "st-1"), "Stock item not found");
    });
  });

  describe("createStock", () => {
    it("should throw 400 if validation fails", async () => {
      await expectRejectsWithMessage(createStock("tenant-1", { failValidation: true }), "Validation failed");
    });

    it("should throw 404 if warehouse not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        createStock("tenant-1", { warehouseId: "wh-1", itemName: "Item" }),
        "Warehouse not found",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should throw 404 if storage location not found in warehouse", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      StorageLocation.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        createStock("tenant-1", { warehouseId: "wh-1", locationId: "loc-1", itemName: "Item" }),
        "Storage location not found in this warehouse",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should throw 409 if duplicate stock SKU/serial number already exists", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      StorageLocation.findOne.mockResolvedValueOnce({ id: "loc-1" });
      Stock.findOne.mockResolvedValueOnce({ id: "st-existing" });

      await expectRejectsWithMessage(
        createStock("tenant-1", {
          warehouseId: "wh-1",
          locationId: "loc-1",
          itemName: "Item",
          sku: "SKU-1",
          serialNumber: "SN-1",
        }),
        "Stock item with matching SKU or serial number already exists",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should create stock successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      StorageLocation.findOne.mockResolvedValueOnce({ id: "loc-1" });
      Stock.findOne.mockResolvedValueOnce(null); // duplicate check
      Stock.create.mockResolvedValueOnce({
        id: "st-new",
        itemName: "Item 1",
      });

      const result = await createStock("tenant-1", {
        warehouseId: "wh-1",
        locationId: "loc-1",
        itemName: "Item 1",
        sku: "SKU-1",
        serialNumber: "SN-1",
        quantity: 10,
        minQuantity: 2,
        description: "Standard",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should create stock without location and optional fields successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      Stock.create.mockResolvedValueOnce({
        id: "st-new-no-loc",
        itemName: "Item 1",
      });

      const result = await createStock("tenant-1", {
        warehouseId: "wh-1",
        itemName: "Item 1",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should check duplicate stock with only SKU successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      Stock.findOne.mockResolvedValueOnce({ id: "st-existing" });

      await expectRejectsWithMessage(
        createStock("tenant-1", {
          warehouseId: "wh-1",
          itemName: "Item",
          sku: "SKU-1",
        }),
        "Stock item with matching SKU or serial number already exists",
      );
    });

    it("should check duplicate stock with only serialNumber successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      Stock.findOne.mockResolvedValueOnce({ id: "st-existing" });

      await expectRejectsWithMessage(
        createStock("tenant-1", {
          warehouseId: "wh-1",
          itemName: "Item",
          serialNumber: "SN-1",
        }),
        "Stock item with matching SKU or serial number already exists",
      );
    });

    it("should rollback transaction and throw error on database failure during stock creation", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      Stock.create.mockRejectedValueOnce(new Error("Db creation error"));

      await expectRejectsWithMessage(
        createStock("tenant-1", { warehouseId: "wh-1", itemName: "Item 1" }),
        "Db creation error",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should handle rollback error during stock creation gracefully", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockRejectedValueOnce(new Error("Db query error"));

      await expectRejectsWithMessage(
        createStock("tenant-1", { warehouseId: "wh-1", itemName: "Item 1" }),
        "Db query error",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("updateStock", () => {
    it("should throw 404 if stock not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Stock.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        updateStock("tenant-1", "st-1", { itemName: "Updated" }),
        "Stock item not found",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should update stock successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockStock = {
        id: "st-1",
        itemName: "Old Name",
        sku: "Old SKU",
        serialNumber: "Old SN",
        quantity: 5,
        minQuantity: 1,
        description: "Old",
        update: jest.fn().mockResolvedValue(),
      };
      Stock.findOne.mockResolvedValueOnce(mockStock);

      const result = await updateStock("tenant-1", "st-1", {
        itemName: "New Name",
        sku: "New SKU",
        serialNumber: "New SN",
        quantity: 10,
        minQuantity: 2,
        description: "New",
      });

      expect(result.success).toBe(true);
      expect(mockStock.update).toHaveBeenCalledWith(
        {
          itemName: "New Name",
          sku: "New SKU",
          serialNumber: "New SN",
          quantity: 10,
          minQuantity: 2,
          description: "New",
        },
        expect.any(Object),
      );
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should rollback transaction and throw error on database failure during stock update", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      const mockStock = {
        id: "st-1",
        update: jest.fn().mockRejectedValueOnce(new Error("Db update error")),
      };
      Stock.findOne.mockResolvedValueOnce(mockStock);

      await expectRejectsWithMessage(
        updateStock("tenant-1", "st-1", { itemName: "New Name" }),
        "Db update error",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("deleteStock", () => {
    it("should throw 404 if stock not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Stock.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(deleteStock("tenant-1", "st-1"), "Stock item not found");
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should delete stock successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockStock = {
        id: "st-1",
        softDelete: jest.fn().mockResolvedValue(),
      };
      Stock.findOne.mockResolvedValueOnce(mockStock);

      const result = await deleteStock("tenant-1", "st-1");
      expect(result.success).toBe(true);
      expect(mockStock.softDelete).toHaveBeenCalled();
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should rollback transaction and throw error on database failure during stock deletion", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      const mockStock = {
        id: "st-1",
        softDelete: jest.fn().mockRejectedValueOnce(new Error("Db delete error")),
      };
      Stock.findOne.mockResolvedValueOnce(mockStock);

      await expectRejectsWithMessage(
        deleteStock("tenant-1", "st-1"),
        "Db delete error",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should not rollback transaction if it is already finished during deletion error", async () => {
      const tx = mockTransaction();
      tx.finished = true;
      db.transaction.mockResolvedValueOnce(tx);
      Stock.findOne.mockRejectedValueOnce(new Error("Db query error"));

      await expectRejectsWithMessage(
        deleteStock("tenant-1", "st-1"),
        "Db query error",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });
  });

  describe("createAdjustment", () => {
    it("should throw 404 if stock not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Stock.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        createAdjustment("tenant-1", { stockId: "st-1", type: "addition", quantity: 5 }, "usr-1"),
        "Stock item not found",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should adjust stock addition successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockStock = {
        id: "st-1",
        warehouseId: "wh-1",
        locationId: "loc-1",
        quantity: 10,
        update: jest.fn().mockResolvedValue(),
      };
      Stock.findOne.mockResolvedValueOnce(mockStock);
      StockAdjustment.create.mockResolvedValueOnce({ id: "adj-1" });

      const result = await createAdjustment(
        "tenant-1",
        { stockId: "st-1", type: "addition", quantity: 5, reason: "Excess" },
        "usr-1",
      );

      expect(result.success).toBe(true);
      expect(mockStock.update).toHaveBeenCalledWith({ quantity: 15 }, expect.any(Object));
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should throw 400 on subtraction if stock is insufficient", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockStock = {
        id: "st-1",
        quantity: 4,
      };
      Stock.findOne.mockResolvedValueOnce(mockStock);

      await expectRejectsWithMessage(
        createAdjustment("tenant-1", { stockId: "st-1", type: "subtraction", quantity: 5 }, "usr-1"),
        "Insufficient stock quantity for adjustment",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should adjust stock subtraction successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockStock = {
        id: "st-1",
        warehouseId: "wh-1",
        locationId: null,
        quantity: 10,
        update: jest.fn().mockResolvedValue(),
      };
      Stock.findOne.mockResolvedValueOnce(mockStock);
      StockAdjustment.create.mockResolvedValueOnce({ id: "adj-1" });

      const result = await createAdjustment(
        "tenant-1",
        { stockId: "st-1", type: "subtraction", quantity: 5 },
        "usr-1",
      );

      expect(result.success).toBe(true);
      expect(mockStock.update).toHaveBeenCalledWith({ quantity: 5 }, expect.any(Object));
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should adjust stock write_off successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockStock = {
        id: "st-1",
        warehouseId: "wh-1",
        locationId: null,
        quantity: 10,
        update: jest.fn().mockResolvedValue(),
      };
      Stock.findOne.mockResolvedValueOnce(mockStock);
      StockAdjustment.create.mockResolvedValueOnce({ id: "adj-1" });

      const result = await createAdjustment(
        "tenant-1",
        { stockId: "st-1", type: "write_off", quantity: 5 },
        "usr-1",
      );

      expect(result.success).toBe(true);
      expect(mockStock.update).toHaveBeenCalledWith({ quantity: 5 }, expect.any(Object));
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should rollback transaction and throw error on database failure during adjustment", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      Stock.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expectRejectsWithMessage(
        createAdjustment("tenant-1", { stockId: "st-1", type: "addition", quantity: 5 }, "usr-1"),
        "Db error",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("fetchAdjustments", () => {
    it("should fetch adjustment history", async () => {
      StockAdjustment.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      const result = await fetchAdjustments({ tenantId: "tenant-1", warehouseId: "wh-1", type: "addition" });
      expect(result.success).toBe(true);
    });

    it("should propagate database error in fetchAdjustments", async () => {
      StockAdjustment.findAndCountAll.mockRejectedValueOnce(new Error("Query failed"));
      await expectRejectsWithMessage(fetchAdjustments({ tenantId: "tenant-1" }), "Query failed");
    });
  });

  describe("createTransfer", () => {
    it("should throw 400 if from and to warehouse are the same", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);

      await expectRejectsWithMessage(
        createTransfer("tenant-1", { fromWarehouseId: "wh-1", toWarehouseId: "wh-1", itemName: "Item", quantity: 5 }, "usr-1"),
        "Source and destination warehouses must be different",
      );
    });

    it("should throw 404 if source warehouse not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce(null); // fromWarehouse check

      await expectRejectsWithMessage(
        createTransfer("tenant-1", { fromWarehouseId: "wh-1", toWarehouseId: "wh-2", itemName: "Item", quantity: 5 }, "usr-1"),
        "Source warehouse not found",
      );
    });

    it("should throw 404 if destination warehouse not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" }); // fromWarehouse
      Warehouse.findOne.mockResolvedValueOnce(null); // toWarehouse

      await expectRejectsWithMessage(
        createTransfer("tenant-1", { fromWarehouseId: "wh-1", toWarehouseId: "wh-2", itemName: "Item", quantity: 5 }, "usr-1"),
        "Destination warehouse not found",
      );
    });

    it("should throw 400 if stock is missing or insufficient in source warehouse", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-2" });
      Stock.findOne.mockResolvedValueOnce(null); // Stock check

      await expectRejectsWithMessage(
        createTransfer("tenant-1", { fromWarehouseId: "wh-1", toWarehouseId: "wh-2", itemName: "Item", quantity: 5 }, "usr-1"),
        "Insufficient stock in source warehouse",
      );
    });

    it("should create transfer request successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-2" });
      Stock.findOne.mockResolvedValueOnce({ id: "st-1", quantity: 10 });
      StockTransfer.create.mockResolvedValueOnce({ id: "tf-1" });

      const result = await createTransfer(
        "tenant-1",
        { fromWarehouseId: "wh-1", toWarehouseId: "wh-2", itemName: "Item 1", quantity: 5, notes: "Transfer" },
        "usr-1",
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should rollback transaction and throw error on database failure during transfer creation", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expectRejectsWithMessage(
        createTransfer("tenant-1", { fromWarehouseId: "wh-1", toWarehouseId: "wh-2", itemName: "Item", quantity: 5 }, "usr-1"),
        "Db error",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("updateTransferStatus", () => {
    it("should throw 404 if transfer not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StockTransfer.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        updateTransferStatus("tenant-1", "tf-1", { status: "in_transit" }, "usr-1"),
        "Stock transfer not found",
      );
    });

    it("should throw 400 if transfer is already completed/cancelled", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StockTransfer.findOne.mockResolvedValueOnce({ id: "tf-1", status: "completed" });

      await expectRejectsWithMessage(
        updateTransferStatus("tenant-1", "tf-1", { status: "cancelled" }, "usr-1"),
        "Cannot update transfer in 'completed' status",
      );
    });

    it("should update status to cancelled or in_transit successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockTransfer = {
        id: "tf-1",
        status: "pending",
        update: jest.fn().mockResolvedValue(),
      };
      StockTransfer.findOne.mockResolvedValueOnce(mockTransfer);

      const result = await updateTransferStatus("tenant-1", "tf-1", { status: "in_transit" }, "usr-1");
      expect(result.success).toBe(true);
      expect(mockTransfer.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "in_transit" }),
        expect.any(Object),
      );
    });

    it("records the approver when cancelling, but not when moving to in_transit", async () => {
      const tx1 = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx1);
      const cancelled = { id: "tf-1", status: "pending", update: jest.fn().mockResolvedValue() };
      StockTransfer.findOne.mockResolvedValueOnce(cancelled);

      await updateTransferStatus("tenant-1", "tf-1", { status: "cancelled" }, "usr-1");
      expect(cancelled.update).toHaveBeenCalledWith(
        { status: "cancelled", approvedBy: "usr-1" },
        { transaction: tx1 },
      );

      const tx2 = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx2);
      const inTransit = { id: "tf-2", status: "pending", update: jest.fn().mockResolvedValue() };
      StockTransfer.findOne.mockResolvedValueOnce(inTransit);

      await updateTransferStatus("tenant-1", "tf-2", { status: "in_transit" }, "usr-1");
      expect(inTransit.update).toHaveBeenCalledWith(
        { status: "in_transit", approvedBy: null },
        { transaction: tx2 },
      );
    });

    it("should throw 400 on complete status if source stock is missing/insufficient", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StockTransfer.findOne.mockResolvedValueOnce({
        id: "tf-1",
        fromWarehouseId: "wh-1",
        toWarehouseId: "wh-2",
        itemName: "Item 1",
        quantity: 5,
        status: "pending",
      });
      Stock.findOne.mockResolvedValueOnce(null); // sourceStock check

      await expectRejectsWithMessage(
        updateTransferStatus("tenant-1", "tf-1", { status: "completed" }, "usr-1"),
        "Insufficient stock in source warehouse to complete transfer",
      );
    });

    it("should complete transfer successfully, deducting source and creating dest stock", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockTransfer = {
        id: "tf-1",
        fromWarehouseId: "wh-1",
        toWarehouseId: "wh-2",
        itemName: "Item 1",
        quantity: 5,
        status: "pending",
        update: jest.fn().mockResolvedValue(),
      };
      const mockSourceStock = {
        id: "st-src",
        quantity: 10,
        sku: "SKU-1",
        serialNumber: "SN-1",
        minQuantity: 1,
        description: "Desc",
        update: jest.fn().mockResolvedValue(),
      };

      StockTransfer.findOne.mockResolvedValueOnce(mockTransfer);
      Stock.findOne.mockResolvedValueOnce(mockSourceStock);
      Stock.findOrCreate.mockResolvedValueOnce([
        {
          id: "st-dest",
          quantity: 5,
          update: jest.fn().mockResolvedValue(),
        },
        true, // created
      ]);

      const result = await updateTransferStatus("tenant-1", "tf-1", { status: "completed" }, "usr-1");
      expect(result.success).toBe(true);
      expect(mockSourceStock.update).toHaveBeenCalledWith({ quantity: 5 }, expect.any(Object));
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should complete transfer successfully, deducting source and updating existing dest stock", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockTransfer = {
        id: "tf-1",
        fromWarehouseId: "wh-1",
        toWarehouseId: "wh-2",
        itemName: "Item 1",
        quantity: 5,
        status: "pending",
        update: jest.fn().mockResolvedValue(),
      };
      const mockSourceStock = {
        id: "st-src",
        quantity: 10,
        update: jest.fn().mockResolvedValue(),
      };
      const mockDestStock = {
        id: "st-dest",
        quantity: 8,
        update: jest.fn().mockResolvedValue(),
      };

      StockTransfer.findOne.mockResolvedValueOnce(mockTransfer);
      Stock.findOne.mockResolvedValueOnce(mockSourceStock);
      Stock.findOrCreate.mockResolvedValueOnce([
        mockDestStock,
        false, // not created, already exists
      ]);

      await updateTransferStatus("tenant-1", "tf-1", { status: "completed" }, "usr-1");
      expect(mockDestStock.update).toHaveBeenCalledWith({ quantity: 13 }, expect.any(Object));
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should rollback transaction and throw error on database failure during transfer status update", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      StockTransfer.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expectRejectsWithMessage(
        updateTransferStatus("tenant-1", "tf-1", { status: "in_transit" }, "usr-1"),
        "Db error",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("fetchTransfers", () => {
    it("should fetch transfer history", async () => {
      StockTransfer.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      const result = await fetchTransfers({
        tenantId: "tenant-1",
        fromWarehouseId: "wh-1",
        toWarehouseId: "wh-2",
        status: "completed",
      });
      expect(result.success).toBe(true);
    });

    it("should propagate database error in fetchTransfers", async () => {
      StockTransfer.findAndCountAll.mockRejectedValueOnce(new Error("Query failed"));
      await expectRejectsWithMessage(fetchTransfers({ tenantId: "tenant-1" }), "Query failed");
    });
  });

  describe("createOpname", () => {
    it("should throw 404 if warehouse not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        createOpname("tenant-1", { warehouseId: "wh-1", scheduledAt: new Date() }, "usr-1"),
        "Warehouse not found",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should schedule opname successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      StockOpname.create.mockResolvedValueOnce({ id: "op-1", status: "draft" });

      const result = await createOpname(
        "tenant-1",
        { warehouseId: "wh-1", scheduledAt: new Date(), notes: "Notes" },
        "usr-1",
      );
      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should rollback transaction and throw error on database failure during opname creation", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expectRejectsWithMessage(
        createOpname("tenant-1", { warehouseId: "wh-1", scheduledAt: new Date() }, "usr-1"),
        "Db error",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("updateOpnameStatus", () => {
    it("should throw 404 if opname not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StockOpname.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        updateOpnameStatus("tenant-1", "op-1", { status: "in_progress" }, "usr-1"),
        "Stock opname not found",
      );
    });

    it("should throw 400 if opname is already completed", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StockOpname.findOne.mockResolvedValueOnce({ id: "op-1", status: "completed" });

      await expectRejectsWithMessage(
        updateOpnameStatus("tenant-1", "op-1", { status: "completed" }, "usr-1"),
        "Cannot update completed stock opname",
      );
    });

    it("should update opname status successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockOpname = {
        id: "op-1",
        status: "draft",
        update: jest.fn().mockResolvedValue(),
      };
      StockOpname.findOne.mockResolvedValueOnce(mockOpname);

      const result = await updateOpnameStatus("tenant-1", "op-1", { status: "completed" }, "usr-1");
      expect(result.success).toBe(true);
      expect(mockOpname.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed" }),
        expect.any(Object),
      );
    });

    it("should rollback transaction and throw error on database failure during opname status update", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      StockOpname.findOne.mockRejectedValueOnce(new Error("Db error"));

      await expectRejectsWithMessage(
        updateOpnameStatus("tenant-1", "op-1", { status: "completed" }, "usr-1"),
        "Db error",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("fetchOpnames", () => {
    it("should fetch opname history", async () => {
      StockOpname.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      const result = await fetchOpnames({ tenantId: "tenant-1", warehouseId: "wh-1", status: "completed" });
      expect(result.success).toBe(true);
    });

    it("should propagate database error in fetchOpnames", async () => {
      StockOpname.findAndCountAll.mockRejectedValueOnce(new Error("Query failed"));
      await expectRejectsWithMessage(fetchOpnames({ tenantId: "tenant-1" }), "Query failed");
    });
  });

  describe("getInventoryReport", () => {
    it("should aggregate stock items, units, low stock count, and warehouse distribution successfully", async () => {
      const mockStocks = [
        {
          id: "st-1",
          quantity: 10,
          minQuantity: 5,
          warehouse: { id: "wh-1", name: "Warehouse 1", code: "WH1" },
        },
        {
          id: "st-2",
          quantity: 3,
          minQuantity: 5, // low stock
          warehouse: { id: "wh-1", name: "Warehouse 1", code: "WH1" },
        },
        {
          id: "st-3",
          quantity: 15,
          minQuantity: 10,
          warehouse: { id: "wh-2", name: "Warehouse 2", code: "WH2" },
        },
        {
          id: "st-4",
          quantity: 0,
          minQuantity: 0,
          warehouse: null,
        },
      ];

      // Mock Stock.findAll
      Stock.findAll = jest.fn().mockResolvedValueOnce(mockStocks);

      const result = await getInventoryReport("tenant-1");

      expect(result.success).toBe(true);
      expect(result.data.totalItems).toBe(4);
      expect(result.data.totalUnits).toBe(28); // 10 + 3 + 15 + 0
      expect(result.data.lowStockCount).toBe(1); // st-2 quantity (3) < minQuantity (5)
      expect(result.data.warehouseDistribution).toHaveLength(2);

      const wh1 = result.data.warehouseDistribution.find(w => w.id === "wh-1");
      expect(wh1.itemCount).toBe(2);
      expect(wh1.unitCount).toBe(13); // 10 + 3
    });

    it("should propagate error on failure", async () => {
      Stock.findAll = jest.fn().mockRejectedValueOnce(new Error("Database error"));
      await expectRejectsWithMessage(getInventoryReport("tenant-1"), "Database error");
    });
  });

  describe("exportInventoryCsv", () => {
    it("should compile and format tenant stock levels into CSV successfully", async () => {
      const mockStocks = [
        {
          itemName: "Item A, with comma",
          sku: 'SKU"quotes"',
          serialNumber: "SN1",
          quantity: 10,
          minQuantity: 2,
          description: "Line\nBreak",
          warehouse: { name: "Warehouse A" },
          location: { name: "Location A" },
        },
        {
          itemName: "Item B",
          sku: null,
          serialNumber: null,
          quantity: 5,
          minQuantity: 1,
          description: null,
          warehouse: null,
          location: null,
        },
      ];

      Stock.findAll = jest.fn().mockResolvedValueOnce(mockStocks);

      const result = await exportInventoryCsv("tenant-1");

      expect(result.success).toBe(true);
      expect(result.data).toContain("Item Name,SKU,Serial Number,Warehouse,Storage Location,Quantity,Min Quantity,Description");
      expect(result.data).toContain('"Item A, with comma"');
      expect(result.data).toContain('"SKU""quotes"""');
      expect(result.data).toContain('"Line\nBreak"');
      expect(result.data).toContain("Item B");
    });

    it("should propagate error on failure", async () => {
      Stock.findAll = jest.fn().mockRejectedValueOnce(new Error("Database error"));
      await expectRejectsWithMessage(exportInventoryCsv("tenant-1"), "Database error");
    });
  });

  // ================================================================
  // Optional-field defaults
  // ================================================================
  describe("optional field defaults", () => {
    it("updateStock keeps the existing itemName when none is supplied", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const stock = {
        id: "st-1",
        itemName: "Existing Item",
        sku: "SKU-1",
        serialNumber: "SN-1",
        quantity: 5,
        minQuantity: 1,
        description: "desc",
        update: jest.fn().mockResolvedValue(),
      };
      Stock.findOne.mockResolvedValueOnce(stock);

      await updateStock("tenant-1", "st-1", { quantity: 9 });

      expect(stock.update).toHaveBeenCalledWith(
        {
          itemName: "Existing Item",
          sku: "SKU-1",
          serialNumber: "SN-1",
          quantity: 9,
          minQuantity: 1,
          description: "desc",
        },
        { transaction: tx },
      );
    });

    it("createTransfer defaults notes to null when omitted", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-2" });
      Stock.findOne.mockResolvedValueOnce({ id: "st-1", quantity: 10 });
      StockTransfer.create.mockResolvedValueOnce({ id: "tf-1" });

      await createTransfer(
        "tenant-1",
        { fromWarehouseId: "wh-1", toWarehouseId: "wh-2", itemName: "Item 1", quantity: 5 },
        "usr-1",
      );

      expect(StockTransfer.create).toHaveBeenCalledWith(
        expect.objectContaining({ notes: null, status: "pending", requestedBy: "usr-1" }),
        { transaction: tx },
      );
    });

    it("createOpname defaults notes to null when omitted", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      StockOpname.create.mockResolvedValueOnce({ id: "op-1" });
      const scheduledAt = new Date();

      await createOpname("tenant-1", { warehouseId: "wh-1", scheduledAt }, "usr-1");

      expect(StockOpname.create).toHaveBeenCalledWith(
        {
          tenantId: "tenant-1",
          warehouseId: "wh-1",
          status: "draft",
          scheduledAt,
          performedBy: "usr-1",
          notes: null,
        },
        { transaction: tx },
      );
    });

    it("updateOpnameStatus stamps completedAt only when completing", async () => {
      const tx1 = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx1);
      const completing = { id: "op-1", status: "in_progress", update: jest.fn().mockResolvedValue() };
      StockOpname.findOne.mockResolvedValueOnce(completing);

      await updateOpnameStatus("tenant-1", "op-1", { status: "completed" }, "usr-1");
      expect(completing.update).toHaveBeenCalledWith(
        { status: "completed", completedAt: expect.any(Date) },
        { transaction: tx1 },
      );

      const tx2 = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx2);
      const progressing = { id: "op-2", status: "draft", update: jest.fn().mockResolvedValue() };
      StockOpname.findOne.mockResolvedValueOnce(progressing);

      await updateOpnameStatus("tenant-1", "op-2", { status: "in_progress" }, "usr-1");
      expect(progressing.update).toHaveBeenCalledWith(
        { status: "in_progress", completedAt: null },
        { transaction: tx2 },
      );
    });
  });

  // ================================================================
  // A transaction that has already finished must never be rolled back.
  // Sequelize sets `finished = "commit"` as part of commit(), so a commit that
  // then fails leaves a finished transaction — rolling it back would throw
  // "Transaction cannot be rolled back because it has been finished".
  // ================================================================
  describe("no rollback after the transaction has finished", () => {
    const failingCommitTransaction = () => {
      const tx = {
        rollback: jest.fn().mockResolvedValue(),
        commit: jest.fn(async () => {
          tx.finished = "commit";
          throw new Error("Commit failed");
        }),
      };
      return tx;
    };

    it("createStock does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      Stock.create.mockResolvedValueOnce({ id: "st-1" });

      await expectRejectsWithMessage(
        createStock("tenant-1", { warehouseId: "wh-1", itemName: "Item" }),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("updateStock does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Stock.findOne.mockResolvedValueOnce({ id: "st-1", update: jest.fn().mockResolvedValue() });

      await expectRejectsWithMessage(
        updateStock("tenant-1", "st-1", { itemName: "New" }),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("createAdjustment does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Stock.findOne.mockResolvedValueOnce({
        id: "st-1",
        quantity: 10,
        warehouseId: "wh-1",
        update: jest.fn().mockResolvedValue(),
      });
      StockAdjustment.create.mockResolvedValueOnce({ id: "adj-1" });

      await expectRejectsWithMessage(
        createAdjustment("tenant-1", { stockId: "st-1", type: "addition", quantity: 2 }, "usr-1"),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("createTransfer does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-2" });
      Stock.findOne.mockResolvedValueOnce({ id: "st-1", quantity: 10 });
      StockTransfer.create.mockResolvedValueOnce({ id: "tf-1" });

      await expectRejectsWithMessage(
        createTransfer(
          "tenant-1",
          { fromWarehouseId: "wh-1", toWarehouseId: "wh-2", itemName: "Item", quantity: 5 },
          "usr-1",
        ),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("updateTransferStatus does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StockTransfer.findOne.mockResolvedValueOnce({
        id: "tf-1",
        status: "pending",
        update: jest.fn().mockResolvedValue(),
      });

      await expectRejectsWithMessage(
        updateTransferStatus("tenant-1", "tf-1", { status: "in_transit" }, "usr-1"),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("createOpname does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-1" });
      StockOpname.create.mockResolvedValueOnce({ id: "op-1" });

      await expectRejectsWithMessage(
        createOpname("tenant-1", { warehouseId: "wh-1", scheduledAt: new Date() }, "usr-1"),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("updateOpnameStatus does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StockOpname.findOne.mockResolvedValueOnce({
        id: "op-1",
        status: "draft",
        update: jest.fn().mockResolvedValue(),
      });

      await expectRejectsWithMessage(
        updateOpnameStatus("tenant-1", "op-1", { status: "in_progress" }, "usr-1"),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });
  });
});
