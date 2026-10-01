/**
 * Tests for warehouse.service.js
 */

// ================================================================
// MOCKS
// ================================================================

jest.mock("sequelize", () => ({
  Op: {
    like: Symbol("like"),
    iLike: Symbol("iLike"), // A-320: the search matches with ILIKE
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
  Warehouse: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  },
  StorageLocation: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  Stock: {
    count: jest.fn(),
  },
}));

// P6-11: every write commits with one audit row in its transaction.
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(),
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

// The validator is REAL (P9-11: Zod schemas through validators/input), so the
// inputs below are ones the API would accept and the 400 cases are real refusals.

// ================================================================
// IMPORTS (after mocks)
// ================================================================
const { db } = require("../../config");
const { Warehouse, StorageLocation, Stock } = require("../../models");

const {
  fetchWarehouses,
  fetchSpecificWarehouse,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  fetchLocations,
  createLocation,
  updateLocation,
  deleteLocation,
} = require("../../services/warehouse.service");

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

/** A warehouse id the schema accepts (the create-location body carries it). */
const WH_ID = "11111111-1111-4111-8111-111111111111";

/** The 400 validateInput throws, with the field errors in Zod's words. */
const expectValidationFailure = async (promise, errors) => {
  await expect(promise).rejects.toEqual({ status: 400, message: "Validation failed", errors });
};

const mockTransaction = () => ({
  commit: jest.fn().mockResolvedValue(),
  rollback: jest.fn().mockResolvedValue(),
});

describe("warehouse.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("fetchWarehouses", () => {
    it("should fetch warehouses successfully without find query", async () => {
      Warehouse.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: WH_ID, name: "Warehouse 1" }],
        count: 1,
      });

      const result = await fetchWarehouses({ tenantId: "tenant-1" });

      expect(result.success).toBe(true);
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.meta.total).toBe(1);
    });

    it("should fetch warehouses with find search term", async () => {
      Warehouse.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: WH_ID, name: "Search WH" }],
        count: 1,
      });

      const result = await fetchWarehouses({
        tenantId: "tenant-1",
        find: "search",
        page: 2,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(Warehouse.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-1",
            isDeleted: false,
          }),
        }),
      );
    });

    it("should propagate database error", async () => {
      Warehouse.findAndCountAll.mockRejectedValueOnce(new Error("Database error"));
      await expectRejectsWithMessage(
        fetchWarehouses({ tenantId: "tenant-1" }),
        "Database error",
      );
    });
  });

  describe("fetchSpecificWarehouse", () => {
    it("should fetch a warehouse successfully by id", async () => {
      Warehouse.findOne.mockResolvedValueOnce({
        id: WH_ID,
        name: "WH 1",
        locations: [],
      });

      const result = await fetchSpecificWarehouse("tenant-1", WH_ID);
      expect(result.success).toBe(true);
      expect(result.data.name).toBe("WH 1");
    });

    it("should throw 404 if warehouse not found", async () => {
      Warehouse.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        fetchSpecificWarehouse("tenant-1", WH_ID),
        "Warehouse not found",
      );
    });

    it("should propagate database error", async () => {
      Warehouse.findOne.mockRejectedValueOnce(new Error("Database error"));
      await expectRejectsWithMessage(
        fetchSpecificWarehouse("tenant-1", WH_ID),
        "Database error",
      );
    });
  });

  describe("createWarehouse", () => {
    it("should throw 400 if validation fails", async () => {
      await expectValidationFailure(createWarehouse("tenant-1", { code: "C" }), [
        { field: "name", message: "Invalid input: expected string, received undefined" },
        { field: "code", message: "Too small: expected string to have >=2 characters" },
      ]);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("should throw 409 if warehouse code already exists", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-existing", code: "CODE-1" });

      await expectRejectsWithMessage(
        createWarehouse("tenant-1", { name: "WH New", code: "CODE-1" }),
        "Warehouse code already exists",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should create a warehouse successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce(null);
      Warehouse.create.mockResolvedValueOnce({
        id: "wh-new",
        name: "WH New",
        code: "CODE-1",
      });

      const result = await createWarehouse("tenant-1", {
        name: "WH New",
        code: "CODE-1",
        address: "123 Street",
        description: "New",
        status: "active",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(result.data.id).toBe("wh-new");
      expect(tx.commit).toHaveBeenCalled();
    });

    it("stores status \"active\" when the body sends status: null (the schema allows null)", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce(null);
      Warehouse.create.mockResolvedValueOnce({ id: "wh-new" });

      await createWarehouse("tenant-1", { name: "WH New", code: "CODE-1", status: null });

      expect(Warehouse.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: "active", address: null, description: null }),
        { transaction: tx },
      );
    });

    it("should rollback transaction and throw error on database failure", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce(null);
      Warehouse.create.mockRejectedValueOnce(new Error("Creation failed"));

      await expectRejectsWithMessage(
        createWarehouse("tenant-1", { name: "WH New", code: "CODE-1" }),
        "Creation failed",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should handle transaction start error", async () => {
      db.transaction.mockRejectedValueOnce(new Error("Tx start failed"));
      await expectRejectsWithMessage(
        createWarehouse("tenant-1", { name: "WH New", code: "CODE-1" }),
        "Tx start failed",
      );
    });

    it("should handle rollback failure gracefully", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockRejectedValueOnce(new Error("Query failed"));

      await expectRejectsWithMessage(
        createWarehouse("tenant-1", { name: "WH New", code: "CODE-1" }),
        "Query failed",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("updateWarehouse", () => {
    it("should throw 400 if validation fails", async () => {
      await expectValidationFailure(updateWarehouse("tenant-1", WH_ID, { status: "archived" }), [
        { field: "status", message: 'Invalid option: expected one of "active"|"inactive"' },
      ]);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("should throw 404 if warehouse not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        updateWarehouse("tenant-1", WH_ID, { name: "Updated WH" }),
        "Warehouse not found",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should throw 409 if updated code already exists on another warehouse", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: WH_ID, name: "WH 1", code: "CODE-1" });
      Warehouse.findOne.mockResolvedValueOnce({ id: "wh-2", name: "WH 2", code: "CODE-2" }); // duplicate check

      await expectRejectsWithMessage(
        updateWarehouse("tenant-1", WH_ID, { code: "CODE-2" }),
        "Warehouse code already exists",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should update warehouse successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockWarehouse = {
        id: WH_ID,
        name: "WH 1",
        code: "CODE-1",
        address: "Old address",
        description: "Old description",
        status: "active",
        update: jest.fn().mockResolvedValue({}),
      };
      Warehouse.findOne.mockResolvedValueOnce(mockWarehouse); // find current
      Warehouse.findOne.mockResolvedValueOnce(null); // duplicate check for updated code

      const result = await updateWarehouse("tenant-1", WH_ID, {
        name: "Updated WH 1",
        code: "CODE-NEW",
        address: "New address",
        description: "New description",
        status: "inactive",
      });

      expect(result.success).toBe(true);
      expect(mockWarehouse.update).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Updated WH 1",
          code: "CODE-NEW",
          address: "New address",
          description: "New description",
          status: "inactive",
        }),
        expect.any(Object),
      );
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should fallback to current warehouse properties if not provided", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockWarehouse = {
        id: WH_ID,
        name: "WH 1",
        code: "CODE-1",
        address: "Address 1",
        description: "Desc 1",
        status: "active",
        update: jest.fn().mockResolvedValue({}),
      };
      Warehouse.findOne.mockResolvedValueOnce(mockWarehouse);

      await updateWarehouse("tenant-1", WH_ID, {});

      expect(mockWarehouse.update).toHaveBeenCalledWith(
        {
          name: "WH 1",
          code: "CODE-1",
          address: "Address 1",
          description: "Desc 1",
          status: "active",
        },
        expect.any(Object),
      );
    });

    it("should handle transaction start error in updateWarehouse", async () => {
      db.transaction.mockRejectedValueOnce(new Error("Tx start failed"));
      await expectRejectsWithMessage(
        updateWarehouse("tenant-1", WH_ID, { name: "Updated WH" }),
        "Tx start failed",
      );
    });

    it("should handle rollback failure in updateWarehouse", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockRejectedValueOnce(new Error("Query failed"));

      await expectRejectsWithMessage(
        updateWarehouse("tenant-1", WH_ID, { name: "Updated WH" }),
        "Query failed",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("deleteWarehouse", () => {
    it("should throw 404 if warehouse not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        deleteWarehouse("tenant-1", WH_ID),
        "Warehouse not found",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should throw 400 if warehouse has active stocks", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: WH_ID });
      Stock.count.mockResolvedValueOnce(5);

      await expectRejectsWithMessage(
        deleteWarehouse("tenant-1", WH_ID),
        "Cannot delete warehouse with 5 items in stock",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should delete warehouse successfully if no stock", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockWarehouse = {
        id: WH_ID,
        save: jest.fn().mockResolvedValue(),
      };
      Warehouse.findOne.mockResolvedValueOnce(mockWarehouse);
      Stock.count.mockResolvedValueOnce(0);

      const result = await deleteWarehouse("tenant-1", WH_ID);
      expect(result.success).toBe(true);
      // P6-11: soft-deleted INSIDE the transaction (softDelete() takes no options).
      expect(mockWarehouse.isDeleted).toBe(true);
      expect(mockWarehouse.save).toHaveBeenCalledWith({ hooks: false, transaction: tx });
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should handle transaction start error in deleteWarehouse", async () => {
      db.transaction.mockRejectedValueOnce(new Error("Tx start failed"));
      await expectRejectsWithMessage(
        deleteWarehouse("tenant-1", WH_ID),
        "Tx start failed",
      );
    });

    it("should handle rollback failure in deleteWarehouse", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockRejectedValueOnce(new Error("Query failed"));

      await expectRejectsWithMessage(
        deleteWarehouse("tenant-1", WH_ID),
        "Query failed",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should not rollback if transaction is finished in deleteWarehouse", async () => {
      const tx = mockTransaction();
      tx.finished = true;
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockRejectedValueOnce(new Error("Query failed"));

      await expectRejectsWithMessage(
        deleteWarehouse("tenant-1", WH_ID),
        "Query failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });
  });

  describe("fetchLocations", () => {
    it("should throw 404 if warehouse not found", async () => {
      Warehouse.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        fetchLocations("tenant-1", WH_ID),
        "Warehouse not found",
      );
    });

    it("should fetch locations successfully", async () => {
      Warehouse.findOne.mockResolvedValueOnce({ id: WH_ID });
      StorageLocation.findAll.mockResolvedValueOnce([{ id: "loc-1", name: "Loc 1" }]);

      const result = await fetchLocations("tenant-1", WH_ID);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe("createLocation", () => {
    it("should throw 400 if validation fails", async () => {
      await expectValidationFailure(createLocation("tenant-1", { warehouseId: "wh-1", name: "Loc 1", code: "L1" }), [
        { field: "warehouseId", message: "Invalid GUID" },
      ]);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("should throw 404 if warehouse not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        createLocation("tenant-1", { warehouseId: WH_ID, name: "Loc 1", code: "L1" }),
        "Warehouse not found",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should throw 409 if storage location code already exists in the warehouse", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: WH_ID });
      StorageLocation.findOne.mockResolvedValueOnce({ id: "loc-existing" });

      await expectRejectsWithMessage(
        createLocation("tenant-1", { warehouseId: WH_ID, name: "Loc 1", code: "L1" }),
        "Storage location code already exists in this warehouse",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should create location successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: WH_ID });
      StorageLocation.findOne.mockResolvedValueOnce(null);
      StorageLocation.create.mockResolvedValueOnce({
        id: "loc-new",
        name: "Loc New",
        code: "L2",
      });

      const result = await createLocation("tenant-1", {
        warehouseId: WH_ID,
        name: "Loc New",
        code: "L2",
        description: "Top shelf",
        isActive: true,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should default description to null and isActive to true when omitted", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: WH_ID });
      StorageLocation.findOne.mockResolvedValueOnce(null);
      StorageLocation.create.mockResolvedValueOnce({ id: "loc-new" });

      await createLocation("tenant-1", {
        warehouseId: WH_ID,
        name: "Loc New",
        code: "L2",
      });

      expect(StorageLocation.create).toHaveBeenCalledWith(
        {
          tenantId: "tenant-1",
          warehouseId: WH_ID,
          name: "Loc New",
          code: "L2",
          description: null,
          isActive: true,
        },
        { transaction: tx },
      );
    });

    // The schema itself defaults isActive to true, so the service's own
    // fallback is reached only by a caller that skips the schema. Load the
    // service against a pass-through validateInput to pin that fallback too.
    it("the service still defaults isActive to true when validation hands it no value", async () => {
      await jest.isolateModulesAsync(async () => {
        jest.doMock("../../validators/input", () => ({ validateInput: (data) => ({ ...data }) }));
        const isolatedModels = require("../../models");
        const isolatedDb = require("../../config").db;
        const isolatedService = require("../../services/warehouse.service");
        const tx = mockTransaction();
        isolatedDb.transaction.mockResolvedValueOnce(tx);
        isolatedModels.Warehouse.findOne.mockResolvedValueOnce({ id: WH_ID });
        isolatedModels.StorageLocation.findOne.mockResolvedValueOnce(null);
        isolatedModels.StorageLocation.create.mockResolvedValueOnce({ id: "loc-new" });

        await isolatedService.createLocation("tenant-1", { warehouseId: WH_ID, name: "Loc New", code: "L2" });

        expect(isolatedModels.StorageLocation.create).toHaveBeenCalledWith(
          expect.objectContaining({ isActive: true }),
          { transaction: tx },
        );
      });
    });

    it("should preserve an explicit isActive:false rather than defaulting it to true", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: WH_ID });
      StorageLocation.findOne.mockResolvedValueOnce(null);
      StorageLocation.create.mockResolvedValueOnce({ id: "loc-new" });

      await createLocation("tenant-1", {
        warehouseId: WH_ID,
        name: "Loc New",
        code: "L2",
        isActive: false,
      });

      expect(StorageLocation.create).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
        { transaction: tx },
      );
    });

    it("should handle transaction start error in createLocation", async () => {
      db.transaction.mockRejectedValueOnce(new Error("Tx start failed"));
      await expectRejectsWithMessage(
        createLocation("tenant-1", { warehouseId: WH_ID, name: "Loc 1", code: "L1" }),
        "Tx start failed",
      );
    });

    it("should handle rollback failure in createLocation", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockRejectedValueOnce(new Error("Query failed"));

      await expectRejectsWithMessage(
        createLocation("tenant-1", { warehouseId: WH_ID, name: "Loc 1", code: "L1" }),
        "Query failed",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("updateLocation", () => {
    it("should throw 400 if validation fails", async () => {
      await expectValidationFailure(updateLocation("tenant-1", "loc-1", { isActive: "maybe" }), [
        { field: "isActive", message: "Invalid input: expected boolean, received string" },
      ]);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it("should throw 404 if storage location not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StorageLocation.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        updateLocation("tenant-1", "loc-1", { name: "Loc Updated" }),
        "Storage location not found",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should throw 409 if updated code already exists in the warehouse", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StorageLocation.findOne.mockResolvedValueOnce({ id: "loc-1", warehouseId: WH_ID });
      StorageLocation.findOne.mockResolvedValueOnce({ id: "loc-2", warehouseId: WH_ID }); // duplicate check

      await expectRejectsWithMessage(
        updateLocation("tenant-1", "loc-1", { code: "CODE-DUP" }),
        "Storage location code already exists in this warehouse",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should update location successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockLoc = {
        id: "loc-1",
        warehouseId: WH_ID,
        name: "Old Name",
        code: "Old Code",
        description: "Old desc",
        isActive: true,
        update: jest.fn().mockResolvedValue(),
      };
      StorageLocation.findOne.mockResolvedValueOnce(mockLoc);
      StorageLocation.findOne.mockResolvedValueOnce(null); // duplicate check for updated code

      const result = await updateLocation("tenant-1", "loc-1", {
        name: "New Name",
        code: "New Code",
        description: "New desc",
        isActive: false,
      });

      expect(result.success).toBe(true);
      expect(mockLoc.update).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "New Name",
          code: "New Code",
          description: "New desc",
          isActive: false,
        }),
        expect.any(Object),
      );
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should fallback to current properties when not provided", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockLoc = {
        id: "loc-1",
        warehouseId: WH_ID,
        name: "Old Name",
        code: "Old Code",
        description: "Old desc",
        isActive: true,
        update: jest.fn().mockResolvedValue(),
      };
      StorageLocation.findOne.mockResolvedValueOnce(mockLoc);

      await updateLocation("tenant-1", "loc-1", {});

      expect(mockLoc.update).toHaveBeenCalledWith(
        {
          name: "Old Name",
          code: "Old Code",
          description: "Old desc",
          isActive: true,
        },
        expect.any(Object),
      );
    });

    it("should handle transaction start error in updateLocation", async () => {
      db.transaction.mockRejectedValueOnce(new Error("Tx start failed"));
      await expectRejectsWithMessage(
        updateLocation("tenant-1", "loc-1", { name: "Loc Updated" }),
        "Tx start failed",
      );
    });

    it("should handle rollback failure in updateLocation", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      StorageLocation.findOne.mockRejectedValueOnce(new Error("Query failed"));

      await expectRejectsWithMessage(
        updateLocation("tenant-1", "loc-1", { name: "Loc Updated" }),
        "Query failed",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });
  });

  describe("deleteLocation", () => {
    it("should throw 404 if storage location not found", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StorageLocation.findOne.mockResolvedValueOnce(null);

      await expectRejectsWithMessage(
        deleteLocation("tenant-1", "loc-1"),
        "Storage location not found",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should throw 400 if storage location has active stocks", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StorageLocation.findOne.mockResolvedValueOnce({ id: "loc-1" });
      Stock.count.mockResolvedValueOnce(3);

      await expectRejectsWithMessage(
        deleteLocation("tenant-1", "loc-1"),
        "Cannot delete storage location with 3 items in stock",
      );
      expect(tx.rollback).toHaveBeenCalled();
    });

    it("should delete storage location successfully", async () => {
      const tx = mockTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      const mockLoc = {
        id: "loc-1",
        destroy: jest.fn().mockResolvedValue(),
      };
      StorageLocation.findOne.mockResolvedValueOnce(mockLoc);
      Stock.count.mockResolvedValueOnce(0);

      const result = await deleteLocation("tenant-1", "loc-1");
      expect(result.success).toBe(true);
      expect(mockLoc.destroy).toHaveBeenCalled();
      expect(tx.commit).toHaveBeenCalled();
    });

    it("should handle transaction start error in deleteLocation", async () => {
      db.transaction.mockRejectedValueOnce(new Error("Tx start failed"));
      await expectRejectsWithMessage(
        deleteLocation("tenant-1", "loc-1"),
        "Tx start failed",
      );
    });

    it("should handle rollback failure in deleteLocation", async () => {
      const tx = mockTransaction();
      tx.rollback.mockRejectedValueOnce(new Error("Rollback failed"));
      db.transaction.mockResolvedValueOnce(tx);
      StorageLocation.findOne.mockRejectedValueOnce(new Error("Query failed"));

      await expectRejectsWithMessage(
        deleteLocation("tenant-1", "loc-1"),
        "Query failed",
      );
      expect(tx.rollback).toHaveBeenCalled();
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

    it("createWarehouse does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce(null);
      Warehouse.create.mockResolvedValueOnce({ id: "wh-new" });

      await expectRejectsWithMessage(
        createWarehouse("tenant-1", { name: "WH", code: "W1" }),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("updateWarehouse does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({
        id: WH_ID,
        name: "Old",
        code: "W1",
        update: jest.fn().mockResolvedValue(true),
      });

      await expectRejectsWithMessage(
        updateWarehouse("tenant-1", WH_ID, { name: "New" }),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("deleteWarehouse does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({
        id: WH_ID,
        save: jest.fn().mockResolvedValue(true),
      });
      Stock.count.mockResolvedValueOnce(0);

      await expectRejectsWithMessage(
        deleteWarehouse("tenant-1", WH_ID),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("createLocation does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      Warehouse.findOne.mockResolvedValueOnce({ id: WH_ID });
      StorageLocation.findOne.mockResolvedValueOnce(null);
      StorageLocation.create.mockResolvedValueOnce({ id: "loc-new" });

      await expectRejectsWithMessage(
        createLocation("tenant-1", { warehouseId: WH_ID, name: "Lo", code: "L1" }),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("updateLocation does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StorageLocation.findOne.mockResolvedValueOnce({
        id: "loc-1",
        warehouseId: WH_ID,
        update: jest.fn().mockResolvedValue(true),
      });

      await expectRejectsWithMessage(
        updateLocation("tenant-1", "loc-1", { name: "New" }),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });

    it("deleteLocation does not roll back when commit fails", async () => {
      const tx = failingCommitTransaction();
      db.transaction.mockResolvedValueOnce(tx);
      StorageLocation.findOne.mockResolvedValueOnce({
        id: "loc-1",
        destroy: jest.fn().mockResolvedValue(true),
      });
      Stock.count.mockResolvedValueOnce(0);

      await expectRejectsWithMessage(
        deleteLocation("tenant-1", "loc-1"),
        "Commit failed",
      );
      expect(tx.rollback).not.toHaveBeenCalled();
    });
  });
});
