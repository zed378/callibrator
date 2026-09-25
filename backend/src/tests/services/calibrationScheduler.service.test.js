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
const { logger } = require("../../middlewares/activityLog.middleware");
const auditService = require("../../services/audit.service");

// W-17 (ADR-073): the scan hands each tenant's chunk to ONE batch call. By
// default the batch creates every item, numbering the orders wo1, wo2, ...
const createsAll = (ids = null) =>
  jest.fn(async (tenantId, items) => ({
    created: items.map((item, i) => ({ id: ids ? ids[i] : `wo${i + 1}`, deviceId: item.deviceId })),
    conflicted: [],
    missing: [],
  }));
const batchItems = (call = 0) => maintenanceService.createAutoScheduledWorkOrders.mock.calls[call][1];

describe("calibrationScheduler.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    maintenanceService.createAutoScheduledWorkOrders.mockImplementation(createsAll());
    notificationService.emitNotification.mockResolvedValue({ id: "n1" });
    webhookService.emitEvent.mockResolvedValue({ matched: 0 });
  });

  it("creates a work order + notification for a due device with no open WO", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", serialNumber: "s", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findAll.mockResolvedValue([]);

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(summary.scanned).toBe(1);
    expect(summary.workOrdersCreated).toBe(1);
    expect(summary.notificationsCreated).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(maintenanceService.createAutoScheduledWorkOrders).toHaveBeenCalled();
    expect(webhookService.emitEvent).toHaveBeenCalledWith(
      "t1",
      "device.overdue",
      expect.objectContaining({ deviceId: "d1" }),
    );
  });

  it("is idempotent — skips a due device that already has an open WO", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findAll.mockResolvedValue([{ id: "existing", deviceId: "d1" }]);

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(summary.workOrdersCreated).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(maintenanceService.createAutoScheduledWorkOrders).not.toHaveBeenCalled();
    expect(summary.details[0]).toEqual({
      deviceId: "d1",
      action: "skipped",
      reason: "open work order exists",
      workOrderId: "existing",
    });
  });

  it("labels a not-yet-due device as 'due' rather than 'overdue'", async () => {
    const now = new Date("2025-01-01T00:00:00Z");
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", serialNumber: "SN9", nextCalibrationDate: new Date("2025-01-05") },
    ]);
    MaintenanceWorkOrder.findAll.mockResolvedValue([]);

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1", now, leadDays: 30 });

    expect(summary.overdue).toBe(0);
    expect(maintenanceService.createAutoScheduledWorkOrders).toHaveBeenCalledWith(
      "t1",
      [
        {
          deviceId: "d1",
          title: "Calibration due: Dev",
          priority: "High",
          description: expect.stringContaining("(S/N SN9) is due for calibration (scheduled 2025-01-05)"),
        },
      ],
      { systemActor: "system:calibration-scan" },
    );
    expect(notificationService.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        type: "CALIBRATION",
        title: "Device calibration due",
        actionUrl: "/dashboard/devices/d1",
      }),
      { transaction: "TX" },
    );
    expect(webhookService.emitEvent).toHaveBeenCalledWith(
      "t1",
      "device.calibration_due",
      expect.objectContaining({ workOrderId: "wo1" }),
    );
    expect(summary.details[0]).toEqual({
      deviceId: "d1",
      action: "created",
      overdue: false,
      workOrderId: "wo1",
    });
  });

  it("omits the serial suffix and labels an unknown due date when those fields are absent", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", serialNumber: null, nextCalibrationDate: null },
    ]);
    MaintenanceWorkOrder.findAll.mockResolvedValue([]);

    await scheduler.runCalibrationScan({ tenantId: "t1" });

    const [wo] = batchItems();
    expect(wo.description).toContain('Device "Dev" is');
    expect(wo.description).not.toContain("S/N");
    expect(wo.description).toContain("(scheduled unknown)");
  });

  it("W-04: a notification whose transaction fails is logged and not counted; the device is not an error", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findAll.mockResolvedValue([]);
    notificationService.emitNotification.mockRejectedValue(new Error("insert failed"));

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(summary.workOrdersCreated).toBe(1);
    expect(summary.notificationsCreated).toBe(0);
    expect(summary.errors).toBe(0);
    expect(auditService.logAction).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("the notifications for 1 device(s) of tenant t1 were not created"),
    );
  });

  it("W-04: a scheduled scan's tenant-wide notification is audited as system:calibration-scan, in its transaction", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findAll.mockResolvedValue([]);

    await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(auditService.logAction).toHaveBeenCalledTimes(1);
    expect(auditService.logAction).toHaveBeenCalledWith(
      {
        tenantId: "t1",
        systemActor: "system:calibration-scan",
        action: "CREATE",
        resourceType: "Notification",
        resourceId: "n1",
        changes: {
          operation: "CALIBRATION_REMINDER",
          audience: "tenant",
          deviceId: "d1",
          workOrderId: "wo1",
          overdue: true,
        },
      },
      { transaction: "TX" },
    );
  });

  it("W-04: a manual run's notification names the requesting user, not the job", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findAll.mockResolvedValue([]);

    await scheduler.runCalibrationScan({
      tenantId: "t1",
      actor: { userId: "u1", ipAddress: "10.0.0.1", userAgent: "ua" },
    });

    const [entry] = auditService.logAction.mock.calls[0];
    expect(entry).toMatchObject({ userId: "u1", ipAddress: "10.0.0.1", userAgent: "ua" });
    expect(entry).not.toHaveProperty("systemActor");
    expect(entry.changes.workOrderId).toBe("wo1");
    expect(maintenanceService.createAutoScheduledWorkOrders.mock.calls[0][2]).toEqual({
      userId: "u1",
      ipAddress: "10.0.0.1",
      userAgent: "ua",
    });
  });

  it("W-04: a failed audit insert means no notification is counted", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findAll.mockResolvedValue([]);
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(summary.notificationsCreated).toBe(0);
  });

  it("a device the batch reports as not the tenant's is an error, and nothing is notified for it", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findAll.mockResolvedValue([]);
    maintenanceService.createAutoScheduledWorkOrders.mockResolvedValue({ created: [], conflicted: [], missing: ["d1"] });

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(summary).toMatchObject({ errors: 1, workOrdersCreated: 0, notificationsCreated: 0 });
    expect(summary.details).toEqual([{ deviceId: "d1", action: "error", error: "Device not found" }]);
    expect(notificationService.emitNotification).not.toHaveBeenCalled();
    expect(webhookService.emitEvent).not.toHaveBeenCalled();
  });

  it("a failed chunk is an error for each of its devices, and the next chunk still runs", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Bad", nextCalibrationDate: new Date("2020-01-01") },
      { id: "d2", tenantId: "t1", name: "Good", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findAll.mockResolvedValue([]);
    maintenanceService.createAutoScheduledWorkOrders
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation(createsAll(["wo2"]));

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1", txBatchSize: 1 });

    expect(summary.scanned).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.workOrdersCreated).toBe(1);
    expect(summary.details).toEqual([
      { deviceId: "d1", action: "error", error: "boom" },
      { deviceId: "d2", action: "created", overdue: true, workOrderId: "wo2" },
    ]);
    expect(logger.error).toHaveBeenCalledWith("Calibration scan failed for 1 device(s) of tenant t1: boom");
  });

  it("scans every tenant when tenantId is omitted", async () => {
    CalibrationDevice.findAll.mockResolvedValue([]);

    const summary = await scheduler.runCalibrationScan();

    expect(summary).toMatchObject({ scanned: 0, workOrdersCreated: 0, errors: 0 });
    const where = CalibrationDevice.findAll.mock.calls[0][0].where;
    expect(where).not.toHaveProperty("tenantId");
    expect(where.status).toBe("active");
    expect(where.nextCalibrationDate[Op.ne]).toBeNull();
    expect(where.nextCalibrationDate[Op.lte]).toBeInstanceOf(Date);
  });

  it("accepts a non-Date `now` and a non-numeric leadDays", async () => {
    CalibrationDevice.findAll.mockResolvedValue([]);

    await scheduler.runCalibrationScan({ now: "2025-01-01T00:00:00Z", leadDays: "oops" });

    // leadDays is not finite -> falls back to the default lead of 0 days.
    const where = CalibrationDevice.findAll.mock.calls[0][0].where;
    expect(where.nextCalibrationDate[Op.lte]).toEqual(new Date("2025-01-01T00:00:00Z"));
  });

  describe("getDueDevices", () => {
    it("maps due devices and flags the overdue ones", async () => {
      const now = new Date("2025-06-01T00:00:00Z");
      CalibrationDevice.findAll.mockResolvedValue([
        {
          id: "d1",
          name: "Past",
          serialNumber: "SN1",
          tenantId: "t1",
          nextCalibrationDate: new Date("2025-05-01"),
          calibrationIntervalDays: 365,
        },
        {
          id: "d2",
          name: "Future",
          serialNumber: "SN2",
          tenantId: "t1",
          nextCalibrationDate: new Date("2025-06-10"),
          calibrationIntervalDays: 90,
        },
      ]);

      const result = await scheduler.getDueDevices({ tenantId: "t1", now, leadDays: 30 });

      expect(result).toEqual([
        {
          id: "d1",
          name: "Past",
          serialNumber: "SN1",
          tenantId: "t1",
          nextCalibrationDate: new Date("2025-05-01"),
          calibrationIntervalDays: 365,
          overdue: true,
        },
        {
          id: "d2",
          name: "Future",
          serialNumber: "SN2",
          tenantId: "t1",
          nextCalibrationDate: new Date("2025-06-10"),
          calibrationIntervalDays: 90,
          overdue: false,
        },
      ]);
      expect(CalibrationDevice.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: "active", tenantId: "t1" }),
          order: [["nextCalibrationDate", "ASC"]],
        }),
      );
    });

    it("creates no work orders — it is a read-only preview", async () => {
      CalibrationDevice.findAll.mockResolvedValue([]);

      const result = await scheduler.getDueDevices();

      expect(result).toEqual([]);
      expect(maintenanceService.createAutoScheduledWorkOrders).not.toHaveBeenCalled();
      expect(CalibrationDevice.findAll.mock.calls[0][0].where).not.toHaveProperty("tenantId");
    });
  });
});
