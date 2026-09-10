// src/services/calibrationScheduler.service.js
//
// Calibration Scheduler + Reminders.
//
// Scans CalibrationDevice rows whose `nextCalibrationDate` is due (or within an
// optional lead window) and, for each, auto-creates a Preventative
// MaintenanceWorkOrder and a tenant-wide CALIBRATION Notification.
//
// Idempotency: a device that already has an Open/InProgress Preventative work
// order is skipped, so repeated daily runs never create duplicate work orders
// or notifications for the same outstanding calibration. Once that work order is
// completed and the device's nextCalibrationDate advanced, the next due cycle
// will produce a fresh work order.

const { Op } = require("sequelize");
const { CalibrationDevice, MaintenanceWorkOrder } = require("../models");
const maintenanceService = require("./maintenance.service");
const notificationService = require("./notification.service");
const webhookService = require("./webhook.service");
const { logger } = require("../middlewares/activityLog.middleware");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEAD_DAYS = Number(process.env.CALIBRATION_REMINDER_LEAD_DAYS) || 0;

const toDateLabel = (date) =>
  date ? new Date(date).toISOString().slice(0, 10) : "unknown";

// Builds the WHERE clause for "due" devices: active, not soft-deleted (default
// scope), with a nextCalibrationDate at or before the due threshold.
const buildDueWhere = (tenantId, dueThreshold) => {
  const where = {
    status: "active",
    nextCalibrationDate: { [Op.ne]: null, [Op.lte]: dueThreshold },
  };
  if (tenantId) {
    where.tenantId = tenantId;
  }
  return where;
};

const resolveWindow = (now, leadDays) => {
  const reference = now instanceof Date ? now : new Date(now);
  const effectiveLead = Number.isFinite(leadDays) ? leadDays : DEFAULT_LEAD_DAYS;
  const dueThreshold = new Date(reference.getTime() + effectiveLead * DAY_MS);
  return { reference, dueThreshold };
};

// ------------------------------------------------------------------
// RUN SCAN — create work orders + notifications for due devices
// ------------------------------------------------------------------
exports.runCalibrationScan = async ({
  tenantId = null,
  now = new Date(),
  leadDays = DEFAULT_LEAD_DAYS,
} = {}) => {
  const { reference, dueThreshold } = resolveWindow(now, leadDays);

  const devices = await CalibrationDevice.findAll({
    where: buildDueWhere(tenantId, dueThreshold),
  });

  const summary = {
    scanned: devices.length,
    workOrdersCreated: 0,
    notificationsCreated: 0,
    skipped: 0,
    overdue: 0,
    errors: 0,
    details: [],
  };

  for (const device of devices) {
    const isOverdue = new Date(device.nextCalibrationDate) < reference;
    if (isOverdue) {
      summary.overdue++;
    }

    try {
      // Idempotency guard — an outstanding preventative work order means this
      // calibration is already scheduled; don't duplicate it.
      const existing = await MaintenanceWorkOrder.findOne({
        where: {
          deviceId: device.id,
          type: "Preventative",
          status: { [Op.in]: ["Open", "InProgress"] },
        },
      });

      if (existing) {
        summary.skipped++;
        summary.details.push({
          deviceId: device.id,
          action: "skipped",
          reason: "open work order exists",
          workOrderId: existing.id,
        });
        continue;
      }

      const serialSuffix = device.serialNumber
        ? ` (S/N ${device.serialNumber})`
        : "";
      const dueLabel = toDateLabel(device.nextCalibrationDate);

      const woResult = await maintenanceService.createWorkOrder(
        device.tenantId,
        {
          deviceId: device.id,
          title: `${isOverdue ? "Overdue calibration" : "Calibration due"}: ${device.name}`,
          description: `Auto-scheduled by the calibration scheduler. Device "${device.name}"${serialSuffix} is ${isOverdue ? "overdue for" : "due for"} calibration (scheduled ${dueLabel}).`,
          type: "Preventative",
          status: "Open",
          priority: isOverdue ? "Critical" : "High",
        },
      );
      summary.workOrdersCreated++;

      // Tenant-wide notification (userId null → visible to all tenant users).
      const notification = await notificationService.emitNotification({
        tenantId: device.tenantId,
        userId: null,
        type: "CALIBRATION",
        title: isOverdue
          ? "Device calibration overdue"
          : "Device calibration due",
        message: `${device.name}${serialSuffix} is ${isOverdue ? "overdue for" : "due for"} calibration (scheduled ${dueLabel}).`,
        actionUrl: `/dashboard/devices/${device.id}`,
      });
      if (notification) {
        summary.notificationsCreated++;
      }

      // Fan out a domain event to any subscribed webhooks (best-effort).
      await webhookService.emitEvent(
        device.tenantId,
        isOverdue ? "device.overdue" : "device.calibration_due",
        {
          deviceId: device.id,
          name: device.name,
          serialNumber: device.serialNumber,
          nextCalibrationDate: device.nextCalibrationDate,
          workOrderId: woResult?.data?.id || null,
        },
      );

      summary.details.push({
        deviceId: device.id,
        action: "created",
        overdue: isOverdue,
        workOrderId: woResult?.data?.id || null,
      });
    } catch (err) {
      summary.errors++;
      summary.details.push({
        deviceId: device.id,
        action: "error",
        error: err.message,
      });
      logger.error(
        `Calibration scan failed for device ${device.id}: ${err.message}`,
      );
    }
  }

  return summary;
};

// ------------------------------------------------------------------
// LIST DUE — read-only preview of devices the scan would act on
// ------------------------------------------------------------------
exports.getDueDevices = async ({
  tenantId = null,
  now = new Date(),
  leadDays = DEFAULT_LEAD_DAYS,
} = {}) => {
  const { reference, dueThreshold } = resolveWindow(now, leadDays);

  const devices = await CalibrationDevice.findAll({
    where: buildDueWhere(tenantId, dueThreshold),
    order: [["nextCalibrationDate", "ASC"]],
    attributes: [
      "id",
      "name",
      "serialNumber",
      "nextCalibrationDate",
      "calibrationIntervalDays",
      "tenantId",
    ],
  });

  return devices.map((d) => ({
    id: d.id,
    name: d.name,
    serialNumber: d.serialNumber,
    tenantId: d.tenantId,
    nextCalibrationDate: d.nextCalibrationDate,
    calibrationIntervalDays: d.calibrationIntervalDays,
    overdue: new Date(d.nextCalibrationDate) < reference,
  }));
};
