jest.mock("../../models", () => ({
  CalibrationDevice: { findAll: jest.fn() },
  MaintenanceWorkOrder: { findOne: jest.fn() },
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
const { logger } = require("../../middlewares/activityLog.middleware");

describe("calibrationScheduler.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    maintenanceService.createWorkOrder.mockResolvedValue({ data: { id: "wo1" } });
    notificationService.emitNotification.mockResolvedValue({ id: "n1" });
    webhookService.emitEvent.mockResolvedValue({ matched: 0 });
  });

  it("creates a work order + notification for a due device with no open WO", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", serialNumber: "s", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findOne.mockResolvedValue(null);

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(summary.scanned).toBe(1);
    expect(summary.workOrdersCreated).toBe(1);
    expect(summary.notificationsCreated).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(maintenanceService.createWorkOrder).toHaveBeenCalled();
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
    MaintenanceWorkOrder.findOne.mockResolvedValue({ id: "existing" });

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(summary.workOrdersCreated).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(maintenanceService.createWorkOrder).not.toHaveBeenCalled();
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
    MaintenanceWorkOrder.findOne.mockResolvedValue(null);

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1", now, leadDays: 30 });

    expect(summary.overdue).toBe(0);
    expect(maintenanceService.createWorkOrder).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        title: "Calibration due: Dev",
        priority: "High",
        type: "Preventative",
        status: "Open",
        description: expect.stringContaining("(S/N SN9) is due for calibration (scheduled 2025-01-05)"),
      }),
    );
    expect(notificationService.emitNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        type: "CALIBRATION",
        title: "Device calibration due",
        actionUrl: "/dashboard/devices/d1",
      }),
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
    MaintenanceWorkOrder.findOne.mockResolvedValue(null);

    await scheduler.runCalibrationScan({ tenantId: "t1" });

    const wo = maintenanceService.createWorkOrder.mock.calls[0][1];
    expect(wo.description).toContain('Device "Dev" is');
    expect(wo.description).not.toContain("S/N");
    expect(wo.description).toContain("(scheduled unknown)");
  });

  it("does not count a notification when emitNotification returns nothing", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findOne.mockResolvedValue(null);
    notificationService.emitNotification.mockResolvedValue(null);

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(summary.workOrdersCreated).toBe(1);
    expect(summary.notificationsCreated).toBe(0);
  });

  it("reports a null workOrderId when createWorkOrder returns no data envelope", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Dev", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findOne.mockResolvedValue(null);
    maintenanceService.createWorkOrder.mockResolvedValue(null);

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(summary.details[0].workOrderId).toBeNull();
    expect(webhookService.emitEvent).toHaveBeenCalledWith(
      "t1",
      "device.overdue",
      expect.objectContaining({ workOrderId: null }),
    );
  });

  it("records an error for a failing device and keeps scanning the rest", async () => {
    CalibrationDevice.findAll.mockResolvedValue([
      { id: "d1", tenantId: "t1", name: "Bad", nextCalibrationDate: new Date("2020-01-01") },
      { id: "d2", tenantId: "t1", name: "Good", nextCalibrationDate: new Date("2020-01-01") },
    ]);
    MaintenanceWorkOrder.findOne.mockResolvedValue(null);
    maintenanceService.createWorkOrder
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ data: { id: "wo2" } });

    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });

    expect(summary.scanned).toBe(2);
    expect(summary.errors).toBe(1);
    expect(summary.workOrdersCreated).toBe(1);
    expect(summary.details).toEqual([
      { deviceId: "d1", action: "error", error: "boom" },
      { deviceId: "d2", action: "created", overdue: true, workOrderId: "wo2" },
    ]);
    expect(logger.error).toHaveBeenCalledWith("Calibration scan failed for device d1: boom");
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
      expect(maintenanceService.createWorkOrder).not.toHaveBeenCalled();
      expect(CalibrationDevice.findAll.mock.calls[0][0].where).not.toHaveProperty("tenantId");
    });
  });
});
