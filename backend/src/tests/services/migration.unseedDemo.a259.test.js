/**
 * A-259 — `unseedDemoData` is all-or-nothing and never touches a calibration
 * record.
 *
 * Before: it force-deleted the demo rows table by table with no transaction,
 * calibration records included. Since P6-03 (migration 0057) the append-only
 * trigger refuses every DELETE on `calibration_records`, for every role — so
 * it deleted the posts, notifications, kanban, tickets, workflows, QMS rows
 * and certificates, then failed on the records and stopped, leaving the demo
 * half-removed with no way to finish.
 *
 * Now: one transaction; the demo devices' calibration records are counted
 * FIRST, and if there are any the whole unseed is refused before anything is
 * deleted, with the reason. With none, every delete runs in the transaction.
 *
 * The live counterpart — the real trigger refusing, and the old code stopping
 * part-way — is authCards.a215.live.test.js.
 */
const mockTx = { id: "tx-unseed" };
const mockDb = { events: [] };

jest.mock("../../config", () => ({
  db: {
    transaction: jest.fn(async (cb) => {
      mockDb.events.push("begin");
      try {
        const out = await cb(mockTx);
        mockDb.events.push("commit");
        return out;
      } catch (err) {
        mockDb.events.push("rollback");
        throw err;
      }
    }),
  },
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../models", () => {
  const model = (name) => ({
    findAll: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    destroy: jest.fn(async (options) => {
      mockDb.events.push(`destroy:${name}`);
      mockDb.calls.push({ name, options });
      return 1;
    }),
  });
  const names = [
    "Users", "Roles", "MenuGroup", "RoleMenuPermission", "Warehouse", "StorageLocation", "Stock",
    "StockTransfer", "StockAdjustment", "StockOpname", "Tenant", "Vendor", "SupplierScorecard",
    "CalibrationDevice", "CalibrationRecord", "Certificate", "MaintenanceWorkOrder", "IotReading",
    "NonConformance", "Capa", "SopDocument", "Risk", "Workflow", "WorkflowStep", "Ticket", "TicketComment",
    "TicketCounter", "KanbanProject", "KanbanColumn", "KanbanCard", "KanbanLabel", "Notification", "Post",
    "Category", "PostCategory",
  ];
  return Object.fromEntries(names.map((n) => [n, model(n)]));
});

const models = require("../../models");
const migrationService = require("../../services/migration.service");

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.events = [];
  mockDb.calls = [];
  models.CalibrationDevice.findAll.mockResolvedValue([{ id: "dev-1" }, { id: "dev-2" }]);
  models.CalibrationRecord.count.mockResolvedValue(0);
});

describe("A-259: unseedDemoData", () => {
  it("refuses — before deleting anything — once demo calibration records exist, and says why", async () => {
    models.CalibrationRecord.count.mockResolvedValue(3);

    const result = await migrationService.unseedDemoData();

    expect(result.refused).toBe(true);
    expect(result.deleted).toEqual({});
    expect(result.errors).toEqual([
      "Demo unseeding error: Demo data cannot be removed: its devices hold 3 calibration record(s), which are append-only (ADR-062) and are never deleted. Nothing was removed.",
    ]);
    expect(mockDb.events).toEqual(["begin", "rollback"]);
    expect(models.CalibrationRecord.count).toHaveBeenCalledWith(
      expect.objectContaining({ paranoid: false, transaction: mockTx }),
    );
  });

  it("never issues a DELETE on calibration_records", async () => {
    await migrationService.unseedDemoData();

    expect(models.CalibrationRecord.destroy).not.toHaveBeenCalled();
  });

  it("with no records, every delete runs inside the one transaction, and it commits", async () => {
    models.Post.findAll.mockResolvedValue([{ id: "p1" }]);
    models.KanbanProject.findAll.mockResolvedValue([{ id: "k1" }]);
    models.Ticket.findAll.mockResolvedValue([{ id: "t1" }]);
    models.Workflow.findAll.mockResolvedValue([{ id: "w1" }]);
    models.Vendor.findAll.mockResolvedValue([{ id: "v1" }]);
    models.Warehouse.findAll.mockResolvedValue([{ id: "wh1" }]);

    const result = await migrationService.unseedDemoData();

    expect(result.errors).toEqual([]);
    expect(result.refused).toBeUndefined();
    expect(mockDb.events[0]).toBe("begin");
    expect(mockDb.events[mockDb.events.length - 1]).toBe("commit");
    expect(mockDb.calls.length).toBeGreaterThan(20);
    expect(mockDb.calls.filter((c) => c.options.transaction !== mockTx)).toEqual([]);
    expect(result.deleted.calibrationDevices).toBe(1);
  });

  it("a failure part-way rolls the whole unseed back and reports nothing as deleted", async () => {
    models.Warehouse.findAll.mockResolvedValue([{ id: "wh1" }]);
    models.Stock.destroy.mockRejectedValueOnce(new Error("update or delete violates foreign key constraint"));

    const result = await migrationService.unseedDemoData();

    expect(mockDb.events[mockDb.events.length - 1]).toBe("rollback");
    expect(result.deleted).toEqual({});
    expect(result.errors).toEqual([
      "Demo unseeding error: update or delete violates foreign key constraint",
    ]);
    expect(result.refused).toBeUndefined();
  });
});
