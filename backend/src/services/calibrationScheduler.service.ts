/**
 * Calibration Scheduler + Reminders.
 *
 * Scans CalibrationDevice rows whose `nextCalibrationDate` is due (or within an
 * optional lead window) and, for each, auto-creates a Preventative
 * MaintenanceWorkOrder and a tenant-wide CALIBRATION Notification.
 *
 * Idempotency, for REPEATED runs: a device that already has an Open/InProgress
 * Preventative work order is skipped, so repeated daily runs never create
 * duplicate work orders or notifications for the same outstanding calibration.
 * Once that work order is completed and the device's nextCalibrationDate
 * advanced, the next due cycle will produce a fresh work order.
 *
 * Idempotency, for CONCURRENT runs (W-03): that read alone is a
 * check-then-create race — two scans in the same minute (two replicas, or the
 * cron and a manual run) both read "none" and both create. The database holds
 * the invariant instead: migration 0060's partial unique index allows ONE open
 * auto-scheduled work order per device. The losing scan's insert fails with a
 * 409, which is counted as a skip BEFORE the notification and the webhook, so
 * the hospital is notified once and the webhook fires once.
 *
 * Tenant context (W-12): the due-device read spans tenants, and says so with
 * runAsSystem; each device's work runs inside runForTenant(device.tenantId),
 * so the isolation hooks confine and stamp every query it makes.
 *
 * Bounded (W-17): due devices are read in keyset pages of SCAN_BATCH_SIZE, and
 * the open work orders of a page are read in ONE query, not one per device.
 *
 * Audited (W-04 / W-30): each work order has its own audit row, written in the
 * work order's transaction and attributed to `system:calibration-scan` — or to
 * the user, on a manual run. Each tenant-wide notification is audited the same
 * way, in a transaction after the work orders' (W-04, ADR-069).
 *
 * Batched (W-17, ADR-073): a transaction holds the work orders of up to
 * CALIBRATION_SCAN_TX_BATCH_SIZE (25) due devices of ONE tenant, and a second
 * one their notifications — two commits per chunk, not two per device.
 *
 * P9-20 (ADR-087, Stage C): converted from calibrationScheduler.service.js with
 * no behaviour change. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order). No exported method calls a sibling. `Op`,
 * the two models, the maintenance, notification, webhook and audit service
 * objects, `logger`, `SYSTEM_ACTORS`, the three job-context exports, the two
 * audit helpers and `db` are captured once at load, in the `.js`'s require
 * order; the three environment settings are read once at load, through
 * `config/env`.
 */
import { Op as LoadedOp, type WhereOptions } from "sequelize";
import models from "../models";
import loadedMaintenanceService from "./maintenance.service";
import loadedNotificationService from "./notification.service";
import loadedWebhookService from "./webhook.service";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { SYSTEM_ACTORS as LOADED_SYSTEM_ACTORS } from "../constants/systemActors";
import {
  runForTenant as loadedRunForTenant,
  runAsSystem as loadedRunAsSystem,
  SYSTEM_TASKS as LOADED_SYSTEM_TASKS,
} from "../utils/jobContext.util";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
// `db` from config, NOT from the models barrel (CLAUDE.md, traps).
import { db as loadedDb } from "../config";
import { recipientsFor } from "./notificationRecipients";
import { env } from "../config/env";
import type { ModelInstance } from "../types/models";

const Op = LoadedOp;
const { CalibrationDevice, MaintenanceWorkOrder } = models;
const maintenanceService = loadedMaintenanceService;
const notificationService = loadedNotificationService;
const webhookService = loadedWebhookService;
const logger = loadedLogger;
const SYSTEM_ACTORS = LOADED_SYSTEM_ACTORS;
const runForTenant = loadedRunForTenant;
const runAsSystem = loadedRunAsSystem;
const SYSTEM_TASKS = LOADED_SYSTEM_TASKS;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const db = loadedDb;

type DeviceRow = ModelInstance<"CalibrationDevice">;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEAD_DAYS = Number(env("CALIBRATION_REMINDER_LEAD_DAYS")) || 0;
/** Due devices read per page (W-17). */
const SCAN_BATCH_SIZE = Number(env("CALIBRATION_SCAN_BATCH_SIZE")) || 200;
/** Due devices of one tenant whose work orders share a transaction (W-17, ADR-073). */
const SCAN_TX_BATCH_SIZE = ((): number => {
  const n = Number(env("CALIBRATION_SCAN_TX_BATCH_SIZE"));
  return Number.isInteger(n) && n > 0 ? n : 25;
})();
/** Who a scheduled scan's audit rows name. */
const SCAN_ACTOR: AuditActorInput = Object.freeze({ systemActor: SYSTEM_ACTORS.CALIBRATION_SCAN });

const OPEN_STATUSES = ["Open", "InProgress"];

/** A caught value's `message`, read exactly as the `.js` read it (a thrown `null` still throws here). */
const messageOf = (error: unknown): unknown => (error as { message?: unknown }).message;

const toDateLabel = (date: Date | string | null | undefined): string =>
  date ? new Date(date).toISOString().slice(0, 10) : "unknown";

// Builds the WHERE clause for "due" devices: active, not soft-deleted (default
// scope), with a nextCalibrationDate at or before the due threshold.
const buildDueWhere = (tenantId: string | null, dueThreshold: Date): Record<string, unknown> => {
  const where: Record<string, unknown> = {
    status: "active",
    nextCalibrationDate: { [Op.ne]: null, [Op.lte]: dueThreshold },
  };
  if (tenantId) {
    where["tenantId"] = tenantId;
  }
  return where;
};

const resolveWindow = (now: Date | string | number, leadDays: number): { reference: Date; dueThreshold: Date } => {
  const reference = now instanceof Date ? now : new Date(now);
  const effectiveLead = Number.isFinite(leadDays) ? leadDays : DEFAULT_LEAD_DAYS;
  const dueThreshold = new Date(reference.getTime() + effectiveLead * DAY_MS);
  return { reference, dueThreshold };
};

/** One tenant's scan confines itself to that tenant; an all-tenant scan says so. */
const inScanScope = <T>(tenantId: string | null, fn: () => Promise<T>): Promise<T> =>
  tenantId
    ? runForTenant(tenantId, fn)
    : runAsSystem(SYSTEM_TASKS.CALIBRATION_SCAN, fn);

/**
 * The open Preventative work order of each device in a page, in ONE query.
 * @param deviceIds
 * @returns deviceId -> work order id
 */
const openWorkOrdersOf = async (deviceIds: string[]): Promise<Map<string, string>> => {
  const where: WhereOptions = {
    deviceId: { [Op.in]: deviceIds },
    type: "Preventative",
    status: { [Op.in]: OPEN_STATUSES },
  };
  const rows = await MaintenanceWorkOrder.findAll({
    where,
    attributes: ["id", "deviceId"],
  });
  return new Map(rows.map((row) => [row.deviceId, row.id]));
};

/** The work-order fields and labels of one due device. */
const describeDevice = (
  device: DeviceRow,
  isOverdue: boolean,
): { serialSuffix: string; dueLabel: string; item: { deviceId: string; title: string; description: string; priority: string } } => {
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

/** One due device of a chunk. */
interface DueEntry {
  device: DeviceRow;
  isOverdue: boolean;
}

/** A line of the scan's report. */
type ScanDetail = Record<string, unknown> & { deviceId: string; action: string };

/** The scan's running summary. */
interface ScanSummary {
  scanned: number;
  workOrdersCreated: number;
  notificationsCreated: number;
  skipped: number;
  overdue: number;
  errors: number;
  details: ScanDetail[];
}

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
 * @param tenantId
 * @param chunk
 * @param actor - `{ systemActor }` or the requesting user
 * @param summary - the scan's running summary (mutated)
 */
const scheduleChunk = async (tenantId: string, chunk: DueEntry[], actor: AuditActorInput, summary: ScanSummary): Promise<void> => {
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
      summary.details.push({ deviceId, action: "error", error: messageOf(err) });
    }
    logger.error(`Calibration scan failed for ${String(described.size)} device(s) of tenant ${tenantId}: ${String(messageOf(err))}`);
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

  // A created order is always one of the chunk's devices (it was described above).
  const created = result.created.map((order) => ({ order, ...(described.get(order.deviceId) as DueEntry & ReturnType<typeof describeDevice>) }));
  if (!created.length) {
    return;
  }

  // Tenant-wide notifications (userId null → visible to all tenant users).
  // W-04: each with its own audit row, all in ONE transaction, announced only
  // after the commit.
  try {
    await db.transaction(async (transaction) => {
      for (const { order, device, isOverdue, serialSuffix, dueLabel } of created) {
        // P21-09d (spec § 9.6): the tenant broadcast reaches the unbound users; the users BOUND to
        // the device's facility (never another facility's) who hold `calibration` read are each
        // addressed — a bound user never sees a broadcast.
        const audience = await recipientsFor(
          { tenantId, clientFacilityId: (device as { clientFacilityId?: string | null }).clientFacilityId ?? null },
          "calibration",
          { transaction },
        );
        for (const userId of [null, ...audience.boundUserIds]) {
          const notification = await notificationService.emitNotification(
            {
              tenantId,
              userId,
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
              // A-282 (ADR-100): the requesting user, an API key
              // (system:api-key, its id in changes) or the scan itself.
              ...auditEntryActor(actor),
              action: "CREATE",
              resourceType: "Notification",
              // With a transaction emitNotification re-throws rather than
              // resolving null, so the row is there.
              resourceId: (notification as { id: string }).id,
              changes: {
                operation: "CALIBRATION_REMINDER",
                audience: userId === null ? "tenant" : "facility-user",
                deviceId: device.id,
                workOrderId: order.id,
                overdue: isOverdue,
                ...actorChanges(actor),
              },
            },
            { transaction },
          );
        }
      }
    });
    summary.notificationsCreated += created.length;
  } catch (err) {
    logger.error(
      `Calibration scan: the notifications for ${String(created.length)} device(s) of tenant ${tenantId} were not created: ${String(messageOf(err))}`,
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

// ------------------------------------------------------------------
// RUN SCAN — create work orders + notifications for due devices
// ------------------------------------------------------------------

/** A scan's options. */
interface ScanOptions {
  /** one tenant, or null for every tenant */
  tenantId?: string | null;
  now?: Date | string | number;
  leadDays?: number | undefined;
  /** auditPrincipal(req) on a manual run; the scheduled scan omits it and is recorded as `system:calibration-scan` */
  actor?: AuditActorInput | null;
  batchSize?: number;
  /** due devices of one tenant per transaction */
  txBatchSize?: number;
}

const runCalibrationScan = async ({
  tenantId = null,
  now = new Date(),
  leadDays = DEFAULT_LEAD_DAYS,
  actor = null,
  batchSize = SCAN_BATCH_SIZE,
  txBatchSize = SCAN_TX_BATCH_SIZE,
}: ScanOptions = {}): Promise<ScanSummary> => {
  const { reference, dueThreshold } = resolveWindow(now, leadDays);
  // A-282 (ADR-100): a manual run by a user or by an API key is theirs.
  const auditActor = actor && (actor.userId || actor.apiKeyId) ? actor : SCAN_ACTOR;

  const summary: ScanSummary = {
    scanned: 0,
    workOrdersCreated: 0,
    notificationsCreated: 0,
    skipped: 0,
    overdue: 0,
    errors: 0,
    details: [],
  };

  let afterId: string | null = null;
  for (;;) {
    const where = buildDueWhere(tenantId, dueThreshold);
    if (afterId) {
      where["id"] = { [Op.gt]: afterId };
    }
    const { devices, open } = await inScanScope(tenantId, async () => {
      const page = await CalibrationDevice.findAll({
        where: where as WhereOptions,
        order: [["id", "ASC"]],
        limit: batchSize,
        attributes: ["id", "tenantId", "clientFacilityId", "name", "serialNumber", "nextCalibrationDate"],
      });
      return {
        devices: page,
        open: page.length ? await openWorkOrdersOf(page.map((d) => d.id)) : new Map<string, string>(),
      };
    });

    const byTenant = new Map<string, DueEntry[]>();
    for (const device of devices) {
      summary.scanned++;
      const isOverdue = new Date(device.nextCalibrationDate as Date) < reference;
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

      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3)
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
    afterId = (devices[devices.length - 1] as DeviceRow).id;
  }

  return summary;
};

// ------------------------------------------------------------------
// LIST DUE — read-only preview of devices the scan would act on
// ------------------------------------------------------------------

/** One device the scan would act on. */
interface DueDevice {
  id: string;
  name: string;
  serialNumber: string | null;
  tenantId: string;
  nextCalibrationDate: Date | null;
  calibrationIntervalDays: number | null;
  overdue: boolean;
}

const getDueDevices = async ({
  tenantId = null,
  now = new Date(),
  leadDays = DEFAULT_LEAD_DAYS,
}: Pick<ScanOptions, "tenantId" | "now" | "leadDays"> = {}): Promise<DueDevice[]> => {
  const { reference, dueThreshold } = resolveWindow(now, leadDays);

  const devices = await CalibrationDevice.findAll({
    where: buildDueWhere(tenantId, dueThreshold) as WhereOptions,
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
    overdue: new Date(d.nextCalibrationDate as Date) < reference,
  }));
};

export = {
  SCAN_TX_BATCH_SIZE,
  runCalibrationScan,
  getDueDevices,
};
