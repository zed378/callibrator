/**
 * W-03 / W-04 / W-12 / W-17 / W-30 — the calibration scan, as the scheduler
 * runs it.
 *
 *  - W-30: the scan created every work order with NO actor, and since A-124
 *    logAction refuses an entry with no actor inside a transaction — so every
 *    work order the scheduled scan tried to create was rolled back and counted
 *    as an error. It now names `system:calibration-scan` (or the user, on a
 *    manual run).
 *  - W-03: a 409 from createWorkOrder (the partial unique index of migration
 *    0060 refusing a second open auto-scheduled order) is a SKIP, and nothing
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
jest.mock("../../services/maintenance.service", () => ({ createWorkOrder: jest.fn() }));
jest.mock("../../services/notification.service", () => ({ emitNotification: jest.fn() }));
jest.mock("../../services/webhook.service", () => ({ emitEvent: jest.fn() }));
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
  maintenanceService.createWorkOrder.mockResolvedValue({ data: { id: "wo1" } });
  notificationService.emitNotification.mockResolvedValue({ id: "n1" });
  webhookService.emitEvent.mockResolvedValue({ matched: 0 });
});

describe("W-30 — the scheduled scan's work orders name an actor", () => {
  it("a scheduled scan (no actor) is attributed to system:calibration-scan", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);

    await scheduler.runCalibrationScan();

    expect(maintenanceService.createWorkOrder).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({ autoScheduled: true, type: "Preventative" }),
      { systemActor: "system:calibration-scan" },
    );
  });

  it("a manual run is attributed to the requesting user", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);
    const actor = { userId: "u1", ipAddress: "10.0.0.1", userAgent: "ua" };

    await scheduler.runCalibrationScan({ tenantId: "t1", actor });

    expect(maintenanceService.createWorkOrder.mock.calls[0][2]).toBe(actor);
  });

  it("an actor with no user (e.g. an unauthenticated shape) falls back to the system actor", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);

    await scheduler.runCalibrationScan({ actor: { userId: null } });

    expect(maintenanceService.createWorkOrder.mock.calls[0][2]).toEqual({
      systemActor: "system:calibration-scan",
    });
  });
});

describe("W-03 — a concurrent scan's work order is a skip, not an error", () => {
  it("counts a 409 as skipped and neither notifies nor calls a webhook", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);
    maintenanceService.createWorkOrder.mockRejectedValue({
      status: 409,
      message: "This device already has an open auto-scheduled calibration work order",
    });

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
    maintenanceService.createWorkOrder.mockRejectedValue({ status: 500, message: "db down" });

    const summary = await scheduler.runCalibrationScan();

    expect(summary).toMatchObject({ skipped: 0, errors: 1 });
    expect(summary.details[0]).toEqual({ deviceId: "d1", action: "error", error: "db down" });
  });

  it("a null rejection is an error too", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1")]);
    maintenanceService.createWorkOrder.mockRejectedValue(new Error("x"));

    const summary = await scheduler.runCalibrationScan();
    expect(summary.errors).toBe(1);
  });
});

describe("W-12 — tenant context", () => {
  it("each device's work runs confined to the device's own tenant", async () => {
    CalibrationDevice.findAll.mockResolvedValue([device("d1", "tA"), device("d2", "tB")]);
    const seen = [];
    maintenanceService.createWorkOrder.mockImplementation(async () => {
      seen.push(tenantStorage.getStore());
      return { data: { id: "wo" } };
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
