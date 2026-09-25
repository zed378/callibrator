/**
 * W-03 / W-04 / W-12 / W-17 / W-30 — the calibration scan, as the scheduler
 * runs it.
 *
 *  - W-30: the scan created every work order with NO actor, and since A-124
 *    logAction refuses an entry with no actor inside a transaction — so every
 *    work order the scheduled scan tried to create was rolled back and counted
 *    as an error. It now names `system:calibration-scan` (or the user, on a
 *    manual run).
 *  - W-03: a device the batch insert conflicted on (the partial unique index
 *    of migration 0060 refusing a second open auto-scheduled order) is a SKIP, and nothing
 *    is notified or sent to a webhook for it.
 *  - W-12: each device's work runs in that device's tenant context; the
 *    cross-tenant read runs as an explicit, named system task.
 *  - W-17: devices are read in keyset pages, and open work orders once per
 *    page rather than once per device.
 *
 * The concurrency itself (two scans, one row) is proven on a real PostgreSQL
 * by calibrationScheduler.w03.live.test.js.
 */
jest.mock("../../models", () => ({
  CalibrationDevice: { findAll: jest.fn() },
  MaintenanceWorkOrder: { findAll: jest.fn() },
}));
jest.mock("../../services/maintenance.service", () => ({ createAutoScheduledWorkOrders: jest.fn() }));
jest.mock("../../services/notification.service", () => ({ emitNotification: jest.fn() }));
jest.mock("../../services/webhook.service", () => ({ emitEvent: jest.fn() }));
// W-04: the tenant-wide notification and its audit row are one transaction.
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { Op } = require("sequelize");
const scheduler = require("../../services/calibrationScheduler.service");
const { CalibrationDevice, MaintenanceWorkOrder } = require("../../models");
const maintenanceService = require("../../services/maintenance.service");
const notificationService = require("../../services/notification.service");
const webhookService = require("../../services/webhook.service");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

// W-17 (ADR-073): the scan hands each tenant's chunk to ONE batch call. By
// default the batch creates every item, numbering the orders wo1, wo2, ...
const createsAll = (ids = null) =>
  jest.fn(async (tenantId, items) => ({
    created: items.map((item, i) => ({ id: ids ? ids[i] : `wo${i + 1}`, deviceId: item.deviceId })),
    conflicted: [],
    missing: [],
  }));

const device = (id, tenantId = "t1") => ({
  id,
  tenantId,
  name: `Dev ${id}`,
  serialNumber: null,
  nextCalibrationDate: new Date("2020-01-01"),
});

beforeEach(() => {
  jest.clearAllMocks();
  MaintenanceWorkOrder.findAll.mockResolvedValue([]);
  maintenanceService.createAutoScheduledWorkOrders.mockImplementation(createsAll());
  notificationService.emitNotification.mockResolvedValue({ id: "n1" });
  webhookService.emitEvent.mockResolvedValue({ matched: 0 });
});

describe("W-30 — the scheduled scan's work orders name an actor", () => {
  it("a scheduled scan (no actor) is attributed to system:calibration-scan", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);

    await scheduler.runCalibrationScan();

    expect(maintenanceService.createAutoScheduledWorkOrders).toHaveBeenCalledWith(
      "t1",
      [expect.objectContaining({ deviceId: "d1", title: "Overdue calibration: Dev d1" })],
      { systemActor: "system:calibration-scan" },
    );
  });

  it("a manual run is attributed to the requesting user", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);
    const actor = { userId: "u1", ipAddress: "10.0.0.1", userAgent: "ua" };

    await scheduler.runCalibrationScan({ tenantId: "t1", actor });

    expect(maintenanceService.createAutoScheduledWorkOrders.mock.calls[0][2]).toBe(actor);
  });

  it("an actor with no user (e.g. an unauthenticated shape) falls back to the system actor", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);

    await scheduler.runCalibrationScan({ actor: { userId: null } });

    expect(maintenanceService.createAutoScheduledWorkOrders.mock.calls[0][2]).toEqual({
      systemActor: "system:calibration-scan",
    });
  });
});

describe("W-03 — a concurrent scan's work order is a skip, not an error", () => {
  it("counts a conflicted insert as skipped and neither notifies nor calls a webhook", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);
    maintenanceService.createAutoScheduledWorkOrders.mockResolvedValue({ created: [], conflicted: ["d1"], missing: [] });

    const summary = await scheduler.runCalibrationScan();

    expect(summary).toMatchObject({ scanned: 1, skipped: 1, errors: 0, workOrdersCreated: 0 });
    expect(summary.details).toEqual([
      { deviceId: "d1", action: "skipped", reason: "created by a concurrent scan" },
    ]);
    expect(notificationService.emitNotification).not.toHaveBeenCalled();
    expect(webhookService.emitEvent).not.toHaveBeenCalled();
  });

  it("any other failure is still an error", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);
    maintenanceService.createAutoScheduledWorkOrders.mockRejectedValue({ status: 500, message: "db down" });

    const summary = await scheduler.runCalibrationScan();

    expect(summary).toMatchObject({ skipped: 0, errors: 1 });
    expect(summary.details[0]).toEqual({ deviceId: "d1", action: "error", error: "db down" });
  });

  it("a null rejection is an error too", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);
    maintenanceService.createAutoScheduledWorkOrders.mockRejectedValue(new Error("x"));

    const summary = await scheduler.runCalibrationScan();
    expect(summary.errors).toBe(1);
  });
});

describe("W-12 — tenant context", () => {
  it("each device's work runs confined to the device's own tenant", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1", "tA"), device("d2", "tB")]);
    const seen = [];
    maintenanceService.createAutoScheduledWorkOrders.mockImplementation(async (tenantId, items) => {
      seen.push(tenantStorage.getStore());
      return { created: items.map((item) => ({ id: "wo", deviceId: item.deviceId })), conflicted: [], missing: [] };
    });

    await scheduler.runCalibrationScan();

    expect(seen).toEqual([
      { tenantId: "tA", isSuperAdmin: false, isSystemTask: false },
      { tenantId: "tB", isSuperAdmin: false, isSystemTask: false },
    ]);
  });

  it("the all-tenant due-device read is an explicit, named system task", async () => {
    let ctx;
    CalibrationDevice.findAll.mockImplementation(async () => {
      ctx = tenantStorage.getStore();
      return [];
    });

    await scheduler.runCalibrationScan();

    expect(ctx).toEqual(
      expect.objectContaining({ isSystemTask: true, systemReason: expect.stringContaining("calibration-scan") }),
    );
  });

  it("a one-tenant scan reads inside that tenant's context", async () => {
    let ctx;
    CalibrationDevice.findAll.mockImplementation(async () => {
      ctx = tenantStorage.getStore();
      return [];
    });

    await scheduler.runCalibrationScan({ tenantId: "tA" });

    expect(ctx).toEqual({ tenantId: "tA", isSuperAdmin: false, isSystemTask: false });
  });
});

describe("W-17 — bounded reads", () => {
  it("reads due devices in keyset pages and open work orders once per page", async () => {
    CalibrationDevice.findAll
      .mockResolvedValueOnce([device("d1"), device("d2")])
      .mockResolvedValueOnce([device("d3")]);
    MaintenanceWorkOrder.findAll
      .mockResolvedValueOnce([{ id: "open-wo", deviceId: "d2" }])
      .mockResolvedValueOnce([]);

    const summary = await scheduler.runCalibrationScan({ batchSize: 2 });

    expect(summary).toMatchObject({ scanned: 3, workOrdersCreated: 2, skipped: 1 });
    expect(CalibrationDevice.findAll).toHaveBeenCalledTimes(2);
    const [first, second] = CalibrationDevice.findAll.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ limit: 2, order: [["id", "ASC"]] });
    expect(first.where.id).toBeUndefined();
    expect(second.where.id).toEqual({ [Op.gt]: "d2" });
    expect(MaintenanceWorkOrder.findAll).toHaveBeenCalledTimes(2);
    expect(MaintenanceWorkOrder.findAll.mock.calls[0][0].where.deviceId).toEqual({ [Op.in]: ["d1", "d2"] });
  });

  it("an empty page issues no work-order query", async () => {
    CalibrationDevice.findAll.mockResolvedValue([]);

    await scheduler.runCalibrationScan();

    expect(MaintenanceWorkOrder.findAll).not.toHaveBeenCalled();
  });
});

describe("W-17 (ADR-073) — work orders and notifications in one transaction per tenant chunk", () => {
  it("one batch call per chunk of one tenant's devices; two tenants never share one", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      device("d1", "tA"),
      device("d2", "tB"),
      device("d3", "tA"),
      device("d4", "tA"),
    ]);

    const summary = await scheduler.runCalibrationScan({ txBatchSize: 2 });

    const calls = maintenanceService.createAutoScheduledWorkOrders.mock.calls.map(([tenantId, items]) => [
      tenantId,
      items.map((item) => item.deviceId),
    ]);
    expect(calls).toEqual([
      ["tA", ["d1", "d3"]],
      ["tA", ["d4"]],
      ["tB", ["d2"]],
    ]);
    expect(summary).toMatchObject({ scanned: 4, workOrdersCreated: 4, notificationsCreated: 4, errors: 0 });
  });

  it("the chunk's notifications share ONE transaction, each with its own audit row naming its device and work order", async () => {
    const { db } = require("../../config");
    const auditService = require("../../services/audit.service");
    CalibrationDevice.findAll.mockResolvedValue([device("d1"), device("d2")]);
    notificationService.emitNotification
      .mockResolvedValueOnce({ id: "n1" })
      .mockResolvedValueOnce({ id: "n2" });

    await scheduler.runCalibrationScan();

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(auditService.logAction.mock.calls.map(([entry, opts]) => [entry.resourceId, entry.changes.deviceId, entry.changes.workOrderId, opts])).toEqual([
      ["n1", "d1", "wo1", { transaction: "TX" }],
      ["n2", "d2", "wo2", { transaction: "TX" }],
    ]);
    expect(webhookService.emitEvent.mock.calls.map(([, , payload]) => payload.workOrderId)).toEqual(["wo1", "wo2"]);
  });

  it("a chunk in which nothing was created opens no notification transaction", async () => {
    const { db } = require("../../config");
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);
    maintenanceService.createAutoScheduledWorkOrders.mockResolvedValue({ created: [], conflicted: ["d1"], missing: [] });

    await scheduler.runCalibrationScan();

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("CALIBRATION_SCAN_TX_BATCH_SIZE defaults to 25, and an invalid value falls back to it", () => {
    const load = (value) => {
      const saved = process.env.CALIBRATION_SCAN_TX_BATCH_SIZE;
      process.env.CALIBRATION_SCAN_TX_BATCH_SIZE = value;
      let size;
      jest.isolateModules(() => {
        size = require("../../services/calibrationScheduler.service").SCAN_TX_BATCH_SIZE;
      });
      if (saved === undefined) {
        delete process.env.CALIBRATION_SCAN_TX_BATCH_SIZE;
      } else {
        process.env.CALIBRATION_SCAN_TX_BATCH_SIZE = saved;
      }
      return size;
    };
    expect(scheduler.SCAN_TX_BATCH_SIZE).toBe(25);
    expect(load("0")).toBe(25);
    expect(load("1.5")).toBe(25);
    expect(load("x")).toBe(25);
    expect(load("7")).toBe(7);
  });
});
