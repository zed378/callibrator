const { describe, it, expect, beforeEach } = require("@jest/globals");

jest.mock("sequelize", () => ({
  Op: {
    or: Symbol("or"),
    iLike: Symbol("iLike"),
  },
}));

jest.mock("../../config", () => ({
  db: { transaction: jest.fn() },
}));

jest.mock("../../models", () => ({
  MaintenanceWorkOrder: {
    findAndCountAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
  CalibrationDevice: {},
  Vendor: {},
  User: {},
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

const { MaintenanceWorkOrder } = require("../../models");

const {
  fetchWorkOrders,
  getWorkOrderById,
  createWorkOrder,
  updateWorkOrder,
  deleteWorkOrder,
} = require("../../services/maintenance.service");

// ---- helpers ----
const expectRejectsWithMessage = async (promise, message) => {
  try {
    await promise;
    expect(true).toBe(false);
  } catch (err) {
    expect(err).toBeDefined();
    const actual = (err && err.message) || String(err);
    expect(actual).toContain(message);
  }
};

const mockWorkOrder = (extra = {}) => ({
  id: "wo-1",
  title: "Calibration",
  status: "open",
  type: "calibration",
  priority: "high",
  ...extra,
  toJSON: () => ({ ...extra, id: "wo-1", title: "Calibration", status: "open", type: "calibration", priority: "high" }),
});

// ================================================================
describe("maintenance.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ================================================================
  describe("fetchWorkOrders", () => {
    it("should fetch work orders with pagination", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({
        rows: [mockWorkOrder()],
        count: 1,
      });

      const result = await fetchWorkOrders({
        tenantId: "t-1",
        page: 1,
        limit: 10,
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.rows).toHaveLength(1);
      expect(result.data.meta.total).toBe(1);
    });

    it("should filter by status", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchWorkOrders({ tenantId: "t-1", status: "completed" });

      expect(MaintenanceWorkOrder.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "completed" }),
        }),
      );
    });

    it("should filter by type", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchWorkOrders({ tenantId: "t-1", type: "repair" });

      expect(MaintenanceWorkOrder.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ type: "repair" }),
        }),
      );
    });

    it("should filter by priority", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchWorkOrders({ tenantId: "t-1", priority: "critical" });

      expect(MaintenanceWorkOrder.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ priority: "critical" }),
        }),
      );
    });

    it("should filter by deviceId", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchWorkOrders({ tenantId: "t-1", deviceId: "dev-1" });

      expect(MaintenanceWorkOrder.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deviceId: "dev-1" }),
        }),
      );
    });

    it("should filter by search (fuzzy title)", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchWorkOrders({ tenantId: "t-1", find: "calibration" });

      const callArgs = MaintenanceWorkOrder.findAndCountAll.mock.calls[0][0];
      expect(callArgs.where.title).toBeDefined();
      expect(typeof callArgs.where.title).toBe("object");
    });

    it("should cap limit to MAX_LIMIT", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await fetchWorkOrders({ tenantId: "t-1", limit: 9999 });

      const callArgs = MaintenanceWorkOrder.findAndCountAll.mock.calls[0][0];
      expect(callArgs.limit).toBe(200);
    });

    it("should propagate error on failure", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockRejectedValueOnce(new Error("DB error"));
      await expectRejectsWithMessage(fetchWorkOrders({ tenantId: "t-1" }), "DB error");
    });
  });

  // ================================================================
  describe("getWorkOrderById", () => {
    it("should return work order by ID", async () => {
      MaintenanceWorkOrder.findOne.mockResolvedValueOnce(mockWorkOrder());

      const result = await getWorkOrderById("t-1", "wo-1");
      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(result.data.title).toBe("Calibration");
    });

    it("should throw 404 when work order not found", async () => {
      MaintenanceWorkOrder.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        getWorkOrderById("t-1", "missing"),
        "Maintenance work order not found",
      );
    });

    it("should propagate database error", async () => {
      MaintenanceWorkOrder.findOne.mockRejectedValueOnce(new Error("Query failed"));
      await expectRejectsWithMessage(
        getWorkOrderById("t-1", "wo-1"),
        "Query failed",
      );
    });
  });

  // ================================================================
  describe("createWorkOrder", () => {
    it("should create a new work order", async () => {
      const created = mockWorkOrder({ id: "wo-new" });
      MaintenanceWorkOrder.create.mockResolvedValueOnce(created);

      const result = await createWorkOrder("t-1", {
        title: "New Work Order",
        type: "repair",
        priority: "high",
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(201);
      expect(MaintenanceWorkOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "t-1",
          title: "New Work Order",
        }),
      );
    });

    it("should map assigneeId to assignedTo", async () => {
      const created = mockWorkOrder({ id: "wo-mapped" });
      MaintenanceWorkOrder.create.mockResolvedValueOnce(created);

      await createWorkOrder("t-1", {
        title: "Mapped",
        assigneeId: "user-1",
      });

      expect(MaintenanceWorkOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "t-1",
          title: "Mapped",
          assignedTo: "user-1",
        }),
      );
    });

    it("should propagate database error", async () => {
      MaintenanceWorkOrder.create.mockRejectedValueOnce(new Error("Create failed"));
      await expectRejectsWithMessage(
        createWorkOrder("t-1", { title: "X" }),
        "Create failed",
      );
    });
  });

  // ================================================================
  describe("updateWorkOrder", () => {
    it("should update work order fields", async () => {
      const order = mockWorkOrder({ id: "wo-update" });
      order.update = jest.fn().mockResolvedValue({});
      MaintenanceWorkOrder.findOne.mockResolvedValueOnce(order);

      const result = await updateWorkOrder("t-1", "wo-update", {
        status: "in_progress",
        priority: "critical",
      });

      expect(result.success).toBe(true);
      expect(order.update).toHaveBeenCalledWith({
        status: "in_progress",
        priority: "critical",
      });
    });

    it("should map assigneeId to assignedTo in update", async () => {
      const order = mockWorkOrder({ id: "wo-mapped-upd" });
      order.update = jest.fn().mockResolvedValue({});
      MaintenanceWorkOrder.findOne.mockResolvedValueOnce(order);

      await updateWorkOrder("t-1", "wo-mapped-upd", {
        assigneeId: "user-2",
      });

      expect(order.update).toHaveBeenCalledWith({
        assignedTo: "user-2",
      });
    });

    it("should throw 404 when work order not found", async () => {
      MaintenanceWorkOrder.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        updateWorkOrder("t-1", "missing", { status: "closed" }),
        "Maintenance work order not found",
      );
    });

    it("should propagate database error", async () => {
      MaintenanceWorkOrder.findOne.mockRejectedValueOnce(new Error("Update failed"));
      await expectRejectsWithMessage(
        updateWorkOrder("t-1", "wo-1", { status: "closed" }),
        "Update failed",
      );
    });
  });

  // ================================================================
  describe("deleteWorkOrder", () => {
    it("should delete a work order", async () => {
      const order = mockWorkOrder({ id: "wo-del" });
      order.destroy = jest.fn().mockResolvedValue(1);
      MaintenanceWorkOrder.findOne.mockResolvedValueOnce(order);

      const result = await deleteWorkOrder("t-1", "wo-del");
      expect(result.success).toBe(true);
      expect(order.destroy).toHaveBeenCalled();
    });

    it("should throw 404 when work order not found", async () => {
      MaintenanceWorkOrder.findOne.mockResolvedValueOnce(null);
      await expectRejectsWithMessage(
        deleteWorkOrder("t-1", "missing"),
        "Maintenance work order not found",
      );
    });

    it("should propagate database error", async () => {
      MaintenanceWorkOrder.findOne.mockRejectedValueOnce(new Error("Delete failed"));
      await expectRejectsWithMessage(
        deleteWorkOrder("t-1", "wo-1"),
        "Delete failed",
      );
    });
  });

  // ================================================================
  // Branch coverage: transform helpers, field mapping, error fallbacks
  // ================================================================
  describe("transform helpers (via fetchWorkOrders)", () => {
    it("should map a plain (non-Sequelize) row by spreading it when toJSON is absent", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: "plain-1", title: "Plain WO" }],
        count: 1,
      });

      const result = await fetchWorkOrders({ tenantId: "t-1" });

      expect(result.data.rows).toEqual([{ id: "plain-1", title: "Plain WO" }]);
    });

    it("should map a null row to null rather than throwing", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: [null], count: 1 });

      const result = await fetchWorkOrders({ tenantId: "t-1" });

      expect(result.data.rows).toEqual([null]);
    });

    it("should return an empty rows array when the model returns undefined rows", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: undefined, count: 0 });

      const result = await fetchWorkOrders({ tenantId: "t-1" });

      expect(result.data.rows).toEqual([]);
    });

    it("should fall back to DEFAULT_LIMIT when limit is not numeric", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchWorkOrders({ tenantId: "t-1", limit: "not-a-number" });

      expect(MaintenanceWorkOrder.findAndCountAll.mock.calls[0][0].limit).toBe(25); // DEFAULT_LIMIT
    });

    it("should filter by priority", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchWorkOrders({ tenantId: "t-1", priority: "HIGH" });

      expect(MaintenanceWorkOrder.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ priority: "HIGH" }),
        }),
      );
    });

    it("should filter by deviceId", async () => {
      MaintenanceWorkOrder.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await fetchWorkOrders({ tenantId: "t-1", deviceId: "dev-9" });

      expect(MaintenanceWorkOrder.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deviceId: "dev-9" }),
        }),
      );
    });
  });

  describe("toModelFields mapping (via createWorkOrder)", () => {
    it("should tolerate an undefined payload and still stamp the tenantId", async () => {
      MaintenanceWorkOrder.create.mockResolvedValueOnce(mockWorkOrder());

      await createWorkOrder("t-1", undefined);

      expect(MaintenanceWorkOrder.create).toHaveBeenCalledWith({ tenantId: "t-1" });
    });

    it("should map an explicitly null assigneeId to assignedTo (unassigning)", async () => {
      // `assigneeId !== undefined`, so a null must map through as an unassign.
      MaintenanceWorkOrder.create.mockResolvedValueOnce(mockWorkOrder());

      await createWorkOrder("t-1", { title: "X", assigneeId: null });

      expect(MaintenanceWorkOrder.create).toHaveBeenCalledWith({
        title: "X",
        assignedTo: null,
        tenantId: "t-1",
      });
    });

    it("should not emit an assignedTo key when assigneeId is absent", async () => {
      MaintenanceWorkOrder.create.mockResolvedValueOnce(mockWorkOrder());

      await createWorkOrder("t-1", { title: "X" });

      expect(MaintenanceWorkOrder.create.mock.calls[0][0]).not.toHaveProperty("assignedTo");
    });
  });

  describe("error normalisation fallbacks", () => {
    // Every exported method funnels failures through
    // `{ status: error.status || 500, message: error.message || "<default>" }`.
    const cases = [
      ["fetchWorkOrders", () => fetchWorkOrders({ tenantId: "t-1" }), "findAndCountAll", "Failed to fetch maintenance work orders"],
      ["getWorkOrderById", () => getWorkOrderById("t-1", "wo-1"), "findOne", "Failed to retrieve maintenance work order"],
      ["createWorkOrder", () => createWorkOrder("t-1", { title: "X" }), "create", "Failed to create maintenance work order"],
      ["updateWorkOrder", () => updateWorkOrder("t-1", "wo-1", { title: "X" }), "findOne", "Failed to update maintenance work order"],
      ["deleteWorkOrder", () => deleteWorkOrder("t-1", "wo-1"), "findOne", "Failed to delete maintenance work order"],
    ];

    it.each(cases)(
      "%s should default to status 500 and its own message when the error carries neither",
      async (_name, invoke, mockFn, defaultMessage) => {
        MaintenanceWorkOrder[mockFn].mockRejectedValueOnce({});

        await expect(invoke()).rejects.toEqual({
          status: 500,
          message: defaultMessage,
        });
      },
    );

    it.each(cases)(
      "%s should preserve a status carried on the thrown error",
      async (_name, invoke, mockFn) => {
        MaintenanceWorkOrder[mockFn].mockRejectedValueOnce({ status: 409, message: "Conflict" });

        await expect(invoke()).rejects.toEqual({ status: 409, message: "Conflict" });
      },
    );

    it("getWorkOrderById should surface the 404 AppError status, not a generic 500", async () => {
      MaintenanceWorkOrder.findOne.mockResolvedValueOnce(null);

      await expect(getWorkOrderById("t-1", "missing")).rejects.toEqual({
        status: 404,
        message: "Maintenance work order not found",
      });
    });
  });
});
