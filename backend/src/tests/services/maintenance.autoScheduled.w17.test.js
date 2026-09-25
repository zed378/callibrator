/**
 * W-17 (ADR-073) — `createAutoScheduledWorkOrders`: the calibration scan's
 * work orders for one tenant in ONE transaction, with one audit row EACH.
 *
 * The SQL — `INSERT ... ON CONFLICT DO NOTHING` against migration 0060's
 * partial unique index, and the read-back by id — is proved on PostgreSQL 18
 * by calibrationScheduler.batch.w17.live.test.js. This suite pins the shape:
 * what is inserted, what is audited, what is announced, and what is reported.
 */
jest.mock("../../config", () => ({ db: { transaction: jest.fn(async (cb) => cb("TX")) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../services/webhook.service", () => ({ emitAfterCommit: jest.fn() }));
jest.mock("../../services/attachment.service", () => ({ softDeleteForResource: jest.fn() }));
jest.mock("../../models", () => ({
  MaintenanceWorkOrder: { bulkCreate: jest.fn(), findAll: jest.fn() },
  CalibrationDevice: { findAll: jest.fn() },
  Vendor: {},
  User: {},
}));

const { Op } = require("sequelize");
const { MaintenanceWorkOrder, CalibrationDevice } = require("../../models");
const auditService = require("../../services/audit.service");
const webhookService = require("../../services/webhook.service");
const { db } = require("../../config");
const { createAutoScheduledWorkOrders } = require("../../services/maintenance.service");

const ACTOR = { systemActor: "system:calibration-scan" };
const item = (deviceId) => ({ deviceId, title: `Due: ${deviceId}`, description: "d", priority: "High" });
const row = (fields) => ({ ...fields, toJSON: () => ({ ...fields }) });

beforeEach(() => {
  jest.clearAllMocks();
  CalibrationDevice.findAll.mockImplementation(async ({ where }) => where.id[Op.in].map((id) => ({ id })));
  MaintenanceWorkOrder.bulkCreate.mockResolvedValue([]);
  // By default every inserted row is read back.
  MaintenanceWorkOrder.findAll.mockImplementation(async () =>
    MaintenanceWorkOrder.bulkCreate.mock.calls[0][0].map((r) => row(r)),
  );
});

describe("W-17 — createAutoScheduledWorkOrders", () => {
  it("inserts every item in ONE statement, ON CONFLICT DO NOTHING, in one transaction", async () => {
    const result = await createAutoScheduledWorkOrders("t1", [item("d1"), item("d2")], ACTOR);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(MaintenanceWorkOrder.bulkCreate).toHaveBeenCalledTimes(1);
    const [rows, options] = MaintenanceWorkOrder.bulkCreate.mock.calls[0];
    expect(options).toEqual({ transaction: "TX", validate: true, ignoreDuplicates: true, returning: false });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ tenantId: "t1", type: "Preventative", status: "Open", autoScheduled: true, priority: "High" });
      expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(result.created.map((c) => c.deviceId)).toEqual(["d1", "d2"]);
    expect(result).toMatchObject({ conflicted: [], missing: [] });
  });

  it("writes one audit row per created order, naming the actor and that order, in the transaction", async () => {
    await createAutoScheduledWorkOrders("t1", [item("d1"), item("d2")], ACTOR);

    const ids = MaintenanceWorkOrder.bulkCreate.mock.calls[0][0].map((r) => r.id);
    expect(auditService.logAction.mock.calls.map(([entry, opts]) => [entry.resourceId, entry.systemActor, entry.changes.after.deviceId, opts])).toEqual([
      [ids[0], "system:calibration-scan", "d1", { transaction: "TX" }],
      [ids[1], "system:calibration-scan", "d2", { transaction: "TX" }],
    ]);
    expect(auditService.logAction.mock.calls[0][0]).toMatchObject({
      tenantId: "t1",
      action: "CREATE",
      resourceType: "MaintenanceWorkOrder",
      changes: { before: {}, after: expect.objectContaining({ type: "Preventative", status: "Open" }) },
    });
    expect(webhookService.emitAfterCommit).toHaveBeenCalledTimes(2);
    expect(webhookService.emitAfterCommit).toHaveBeenCalledWith(
      "TX",
      "t1",
      "work_order.created",
      expect.objectContaining({ workOrderId: ids[0], deviceId: "d1" }),
    );
  });

  it("reads back what was inserted BY ID, so a conflicted device is reported, not misattributed", async () => {
    // d1 conflicted (0060's index): only d2's row exists afterwards.
    MaintenanceWorkOrder.findAll.mockImplementation(async () => [row(MaintenanceWorkOrder.bulkCreate.mock.calls[0][0][1])]);

    const result = await createAutoScheduledWorkOrders("t1", [item("d1"), item("d2")], ACTOR);

    const ids = MaintenanceWorkOrder.bulkCreate.mock.calls[0][0].map((r) => r.id);
    expect(MaintenanceWorkOrder.findAll).toHaveBeenCalledWith({ where: { id: { [Op.in]: ids } }, transaction: "TX" });
    expect(result.created).toEqual([expect.objectContaining({ id: ids[1], deviceId: "d2" })]);
    expect(result.conflicted).toEqual(["d1"]);
    expect(auditService.logAction).toHaveBeenCalledTimes(1);
  });

  it("a device that is not the tenant's is reported missing and never inserted (A-220)", async () => {
    CalibrationDevice.findAll.mockResolvedValue([{ id: "d2" }]);

    const result = await createAutoScheduledWorkOrders("t1", [item("d1"), item("d2")], ACTOR);

    expect(CalibrationDevice.findAll).toHaveBeenCalledWith({
      where: { id: { [Op.in]: ["d1", "d2"] }, tenantId: "t1" },
      attributes: ["id"],
      transaction: "TX",
    });
    expect(MaintenanceWorkOrder.bulkCreate.mock.calls[0][0].map((r) => r.deviceId)).toEqual(["d2"]);
    expect(result.missing).toEqual(["d1"]);
  });

  it("when no device is the tenant's, nothing is inserted or read back", async () => {
    CalibrationDevice.findAll.mockResolvedValue([]);

    const result = await createAutoScheduledWorkOrders("t1", [item("d1")], ACTOR);

    expect(MaintenanceWorkOrder.bulkCreate).not.toHaveBeenCalled();
    expect(MaintenanceWorkOrder.findAll).not.toHaveBeenCalled();
    expect(result).toEqual({ created: [], conflicted: [], missing: ["d1"] });
  });

  it("an empty list opens no transaction", async () => {
    expect(await createAutoScheduledWorkOrders("t1", [], ACTOR)).toEqual({ created: [], conflicted: [], missing: [] });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("a failed audit insert rejects, so the transaction rolls every order of the batch back", async () => {
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(createAutoScheduledWorkOrders("t1", [item("d1")], ACTOR)).rejects.toThrow("audit insert failed");
  });
});
