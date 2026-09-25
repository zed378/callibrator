// src/services/calibrationScheduler.service.js
//
// Calibration Scheduler + Reminders.
//
// Scans CalibrationDevice rows whose `nextCalibrationDate` is due (or within an
// optional lead window) and, for each, auto-creates a Preventative
// MaintenanceWorkOrder and a tenant-wide CALIBRATION Notification.
//
// Idempotency, for REPEATED runs: a device that already has an Open/InProgress
// Preventative work order is skipped, so repeated daily runs never create
// duplicate work orders or notifications for the same outstanding calibration.
// Once that work order is completed and the device's nextCalibrationDate
// advanced, the next due cycle will produce a fresh work order.
//
// Idempotency, for CONCURRENT runs (W-03): that read alone is a
// check-then-create race — two scans in the same minute (two replicas, or the
// cron and a manual run) both read "none" and both create. The database holds
// the invariant instead: migration 0060's partial unique index allows ONE open
// auto-scheduled work order per device. The losing scan's insert fails with a
// 409, which is counted as a skip BEFORE the notification and the webhook, so
// the hospital is notified once and the webhook fires once.
//
// Tenant context (W-12): the due-device read spans tenants, and says so with
// runAsSystem; each device's work runs inside runForTenant(device.tenantId),
// so the isolation hooks confine and stamp every query it makes.
//
// Bounded (W-17): due devices are read in keyset pages of SCAN_BATCH_SIZE, and
// the open work orders of a page are read in ONE query, not one per device.
//
// Audited (W-04 / W-30): each work order has its own audit row, written in the
// work order's transaction and attributed to `system:calibration-scan` — or to
// the user, on a manual run. Each tenant-wide notification is audited the same
// way, in a transaction after the work orders' (W-04, ADR-069).
//
// Batched (W-17, ADR-073): a transaction holds the work orders of up to
// CALIBRATION_SCAN_TX_BATCH_SIZE (25) due devices of ONE tenant, and a second
// one their notifications — two commits per chunk, not two per device.

const { Op } = require("sequelize");
const { CalibrationDevice, MaintenanceWorkOrder } = require("../models");
const maintenanceService = require("./maintenance.service");
const notificationService = require("./notification.service");
const webhookService = require("./webhook.service");
const { logger } = require("../middlewares/activityLog.middleware");
const { SYSTEM_ACTORS } = require("../constants/systemActors");
const { runForTenant, runAsSystem, SYSTEM_TASKS } = require("../utils/jobContext.util");
const auditService = require("./audit.service");
// `db` from config, NOT from the models barrel (CLAUDE.md, traps).
const { db } = require("../config");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEAD_DAYS = Number(process.env.CALIBRATION_REMINDER_LEAD_DAYS) || 0;
/** Due devices read per page (W-17). */
const SCAN_BATCH_SIZE = Number(process.env.CALIBRATION_SCAN_BATCH_SIZE) || 200;
/** Due devices of one tenant whose work orders share a transaction (W-17, ADR-073). */
const SCAN_TX_BATCH_SIZE = (() => {
  const n = Number(process.env.CALIBRATION_SCAN_TX_BATCH_SIZE);
  return Number.isInteger(n) && n > 0 ? n : 25;
})();
/** Who a scheduled scan's audit rows name. */
const SCAN_ACTOR = Object.freeze({ systemActor: SYSTEM_ACTORS.CALIBRATION_SCAN });

const OPEN_STATUSES = ["Open", "InProgress"];

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

/** One tenant's scan confines itself to that tenant; an all-tenant scan says so. */
const inScanScope = (tenantId, fn) =>
  tenantId
    ? runForTenant(tenantId, fn)
    : runAsSystem(SYSTEM_TASKS.CALIBRATION_SCAN, fn);

/**
 * The open Preventative work order of each device in a page, in ONE query.
 * @param {string[]} deviceIds
 * @returns {Promise<Map<string, string>>} deviceId -> work order id
 */
const openWorkOrdersOf = async (deviceIds) => {
  const rows = await MaintenanceWorkOrder.findAll({
    where: {
      deviceId: { [Op.in]: deviceIds },
      type: "Preventative",
      status: { [Op.in]: OPEN_STATUSES },
    },
    attributes: ["id", "deviceId"],
  });
  return new Map(rows.map((row) => [row.deviceId, row.id]));
};

/** The work-order fields and labels of one due device. */
const describeDevice = (device, isOverdue) => {
  const serialSuffix = device.serialNumber ? ` (S/N ${device.serialNumber})` : "";
  const dueLabel = toDateLabel(device.nextCalibrationDate);
  const verb = isOverdue ? "overdue for" : "due for";
  return {
    serialSuffix,
    dueLabel,
    item: {
      deviceId: device.id,
      title: `${isOverdue ? "Overdue calibration" : "Calibration due"}: ${device.name}`,
      description: `Auto-scheduled by the calibration scheduler. Device "${device.name}"${serialSuffix} is ${verb} calibration (scheduled ${dueLabel}).`,
      priority: isOverdue ? "Critical" : "High",
    },
  };
};

/**
 * Schedule a chunk of ONE tenant's due devices, inside that tenant's context
 * (W-17, ADR-073). Two transactions per chunk instead of two per device:
 *
 *  1. every work order of the chunk, and one audit row EACH
 *     (`maintenanceService.createAutoScheduledWorkOrders`). A device whose
 *     order a concurrent scan created first (W-03) is a skip;
 *  2. the tenant-wide notification of every created order, and one audit row
 *     EACH (W-04). Best-effort towards the scan, as before: the work orders
 *     have committed, so a failure is logged and not counted — now for the
 *     whole chunk.
 *
 * Then the webhook event of each created order (best-effort; its first
 * attempts are capped in webhook.service). A failure of step 1 is an error for
 * every device of the chunk, and the next chunk still runs.
 *
 * @param {string} tenantId
 * @param {Array<{device: object, isOverdue: boolean}>} chunk
 * @param {object} actor - `{ systemActor }` or the requesting user
 * @param {object} summary - the scan's running summary (mutated)
 */
const scheduleChunk = async (tenantId, chunk, actor, summary) => {
  const described = new Map(
    chunk.map((entry) => [entry.device.id, { ...entry, ...describeDevice(entry.device, entry.isOverdue) }]),
  );

  let result;
  try {
    result = await maintenanceService.createAutoScheduledWorkOrders(
      tenantId,
      [...described.values()].map((entry) => entry.item),
      actor,
    );
  } catch (err) {
    for (const deviceId of described.keys()) {
      summary.errors++;
      summary.details.push({ deviceId, action: "error", error: err.message });
    }
    logger.error(`Calibration scan failed for ${described.size} device(s) of tenant ${tenantId}: ${err.message}`);
    return;
  }

  for (const deviceId of result.conflicted) {
    // W-03: a concurrent scan created it first — the index said no.
    summary.skipped++;
    summary.details.push({ deviceId, action: "skipped", reason: "created by a concurrent scan" });
  }
  for (const deviceId of result.missing) {
    summary.errors++;
    summary.details.push({ deviceId, action: "error", error: "Device not found" });
  }
  summary.workOrdersCreated += result.created.length;

  const created = result.created.map((order) => ({ order, ...described.get(order.deviceId) }));
  if (!created.length) {
    return;
  }

  // Tenant-wide notifications (userId null → visible to all tenant users).
  // W-04: each with its own audit row, all in ONE transaction, announced only
  // after the commit.
  try {
    await db.transaction(async (transaction) => {
      for (const { order, device, isOverdue, serialSuffix, dueLabel } of created) {
        const notification = await notificationService.emitNotification(
          {
            tenantId,
            userId: null,
            type: "CALIBRATION",
            title: isOverdue ? "Device calibration overdue" : "Device calibration due",
            message: `${device.name}${serialSuffix} is ${isOverdue ? "overdue for" : "due for"} calibration (scheduled ${dueLabel}).`,
            actionUrl: `/dashboard/devices/${device.id}`,
          },
          { transaction },
        );
        await auditService.logAction(
          {
            tenantId,
            ...(actor.userId
              ? { userId: actor.userId, ipAddress: actor.ipAddress, userAgent: actor.userAgent }
              : { systemActor: actor.systemActor }),
            action: "CREATE",
            resourceType: "Notification",
            resourceId: notification.id,
            changes: {
              operation: "CALIBRATION_REMINDER",
              audience: "tenant",
              deviceId: device.id,
              workOrderId: order.id,
              overdue: isOverdue,
            },
          },
          { transaction },
        );
      }
    });
    summary.notificationsCreated += created.length;
  } catch (err) {
    logger.error(
      `Calibration scan: the notifications for ${created.length} device(s) of tenant ${tenantId} were not created: ${err.message}`,
    );
  }

  // Fan out a domain event to any subscribed webhooks (best-effort).
  for (const { order, device, isOverdue } of created) {
    await webhookService.emitEvent(tenantId, isOverdue ? "device.overdue" : "device.calibration_due", {
      deviceId: device.id,
      name: device.name,
      serialNumber: device.serialNumber,
      nextCalibrationDate: device.nextCalibrationDate,
      workOrderId: order.id,
    });
    summary.details.push({ deviceId: device.id, action: "created", overdue: isOverdue, workOrderId: order.id });
  }
};

exports.SCAN_TX_BATCH_SIZE = SCAN_TX_BATCH_SIZE;

// ------------------------------------------------------------------
// RUN SCAN — create work orders + notifications for due devices
// ------------------------------------------------------------------
/**
 * @param {object} [options]
 * @param {string|null} [options.tenantId] - one tenant, or null for every tenant
 * @param {Date} [options.now]
 * @param {number} [options.leadDays]
 * @param {object|null} [options.actor] - auditActor(req) on a manual run; the
 *   scheduled scan omits it and is recorded as `system:calibration-scan`
 * @param {number} [options.batchSize]
 * @param {number} [options.txBatchSize] - due devices of one tenant per transaction
 */
exports.runCalibrationScan = async ({
  tenantId = null,
  now = new Date(),
  leadDays = DEFAULT_LEAD_DAYS,
  actor = null,
  batchSize = SCAN_BATCH_SIZE,
  txBatchSize = SCAN_TX_BATCH_SIZE,
} = {}) => {
  const { reference, dueThreshold } = resolveWindow(now, leadDays);
  const auditActor = actor && actor.userId ? actor : SCAN_ACTOR;

  const summary = {
    scanned: 0,
    workOrdersCreated: 0,
    notificationsCreated: 0,
    skipped: 0,
    overdue: 0,
    errors: 0,
    details: [],
  };

  let afterId = null;
  for (;;) {
    const where = buildDueWhere(tenantId, dueThreshold);
    if (afterId) {
      where.id = { [Op.gt]: afterId };
    }
    const { devices, open } = await inScanScope(tenantId, async () => {
      const page = await CalibrationDevice.findAll({
        where,
        order: [["id", "ASC"]],
        limit: batchSize,
        attributes: ["id", "tenantId", "name", "serialNumber", "nextCalibrationDate"],
      });
      return {
        devices: page,
        open: page.length ? await openWorkOrdersOf(page.map((d) => d.id)) : new Map(),
      };
    });

    const byTenant = new Map();
    for (const device of devices) {
      summary.scanned++;
      const isOverdue = new Date(device.nextCalibrationDate) < reference;
      if (isOverdue) {
        summary.overdue++;
      }

      // Idempotency guard — an outstanding preventative work order means this
      // calibration is already scheduled; don't duplicate it.
      if (open.has(device.id)) {
        summary.skipped++;
        summary.details.push({
          deviceId: device.id,
          action: "skipped",
          reason: "open work order exists",
          workOrderId: open.get(device.id),
        });
        continue;
      }

      const pending = byTenant.get(device.tenantId) || [];
      pending.push({ device, isOverdue });
      byTenant.set(device.tenantId, pending);
    }

    // W-17: each tenant's due devices of this page, in chunks of txBatchSize,
    // each chunk inside that tenant's context.
    for (const [deviceTenant, entries] of byTenant) {
      for (let i = 0; i < entries.length; i += txBatchSize) {
        const chunk = entries.slice(i, i + txBatchSize);
        await runForTenant(deviceTenant, () => scheduleChunk(deviceTenant, chunk, auditActor, summary));
      }
    }

    if (devices.length < batchSize) {
      break;
    }
    afterId = devices[devices.length - 1].id;
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
