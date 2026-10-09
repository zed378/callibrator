/**
 * P21-05 (ADR-133 § 4; spec P19-05 § 6, § 12 `calibrationScheduler.requested`): the calibration
 * scan includes a device an IPM visit flagged `needs_calibration` (`calibration_requested_at`),
 * whatever its date says — a flagged device with NO date is scheduled, labelled "Calibration
 * requested", and is not counted overdue; the preview (`getDueDevices`) says the same. 0060's "one
 * open auto-scheduled order per device" still holds (the open-order guard runs first).
 */
import type * as SchedulerModule from "../../services/calibrationScheduler.service";
import type * as ModelsModule from "../../models";
import type * as MaintenanceModule from "../../services/maintenance.service";

jest.mock("../../models", () => ({
  CalibrationDevice: { findAll: jest.fn() },
  MaintenanceWorkOrder: { findAll: jest.fn() },
}));
jest.mock("../../services/maintenance.service", () => ({ createAutoScheduledWorkOrders: jest.fn() }));
jest.mock("../../services/notification.service", () => ({ emitNotification: jest.fn().mockResolvedValue({ id: "n1" }) }));
jest.mock("../../services/webhook.service", () => ({ emitEvent: jest.fn().mockResolvedValue({ matched: 0 }) }));
jest.mock("../../config", () => ({ db: { transaction: jest.fn((cb: (t: string) => unknown) => Promise.resolve(cb("TX"))) } }));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));
jest.mock("../../middlewares/activityLog.middleware", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const scheduler = jest.requireActual<typeof SchedulerModule>("../../services/calibrationScheduler.service");
const models = jest.requireMock<{ CalibrationDevice: { findAll: jest.Mock }; MaintenanceWorkOrder: { findAll: jest.Mock } } & typeof ModelsModule>("../../models");
const maintenance = jest.requireMock<{ createAutoScheduledWorkOrders: jest.Mock } & typeof MaintenanceModule>("../../services/maintenance.service");

const flagged = { id: "d1", tenantId: "t1", name: "Pompa", serialNumber: null, nextCalibrationDate: null, calibrationRequestedAt: new Date("2026-10-01T00:00:00Z") };

beforeEach(() => {
  jest.clearAllMocks();
  maintenance.createAutoScheduledWorkOrders.mockImplementation((_t: string, items: { deviceId: string }[]) =>
    Promise.resolve({ created: items.map((item, i) => ({ id: `wo${String(i + 1)}`, deviceId: item.deviceId })), conflicted: [], missing: [] }),
  );
  models.MaintenanceWorkOrder.findAll.mockResolvedValue([]);
});

describe("P21-05 — the calibration scan includes an IPM's request", () => {
  it("schedules a flagged device with no date, labelled 'Calibration requested', not overdue", async () => {
    models.CalibrationDevice.findAll.mockResolvedValue([flagged]);
    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });
    expect(summary).toMatchObject({ scanned: 1, overdue: 0, workOrdersCreated: 1 });
    const [, items] = maintenance.createAutoScheduledWorkOrders.mock.calls[0] as [string, { title: string; description: string; priority: string }[]];
    expect(items[0]).toMatchObject({
      title: "Calibration requested: Pompa",
      description: 'Auto-scheduled by the calibration scheduler. Device "Pompa" was flagged for calibration by an IPM visit.',
      priority: "High",
    });
    const [options] = models.CalibrationDevice.findAll.mock.calls[0] as [{ attributes: string[] }];
    expect(options.attributes).toContain("calibrationRequestedAt");
  });

  it("a flagged device already overdue keeps the overdue wording", async () => {
    models.CalibrationDevice.findAll.mockResolvedValue([{ ...flagged, nextCalibrationDate: new Date("2020-01-01T00:00:00Z") }]);
    await scheduler.runCalibrationScan({ tenantId: "t1" });
    const [, items] = maintenance.createAutoScheduledWorkOrders.mock.calls[0] as [string, { title: string }[]];
    expect(items[0]?.title).toBe("Overdue calibration: Pompa");
  });

  it("an open order still skips it (0060)", async () => {
    models.CalibrationDevice.findAll.mockResolvedValue([flagged]);
    models.MaintenanceWorkOrder.findAll.mockResolvedValue([{ id: "wo-open", deviceId: "d1" }]);
    const summary = await scheduler.runCalibrationScan({ tenantId: "t1" });
    expect(summary).toMatchObject({ workOrdersCreated: 0, skipped: 1 });
  });

  it("the preview lists it, not overdue", async () => {
    models.CalibrationDevice.findAll.mockResolvedValue([{ ...flagged, calibrationIntervalDays: null }]);
    const due = await scheduler.getDueDevices({ tenantId: "t1" });
    expect(due).toEqual([expect.objectContaining({ id: "d1", overdue: false, nextCalibrationDate: null })]);
  });
});
