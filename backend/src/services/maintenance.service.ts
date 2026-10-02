// P9-18 (ADR-087): converted from maintenance.service.js, behaviour unchanged.
// Its interim `.d.ts` is deleted with it; the types it declared are kept here
// as the floor (maintenance.controller, calibrationScheduler.service). The
// export is the same object, its keys in the JavaScript's order
// (`exports.x = …`). What the JavaScript destructured at load is captured at
// load; webhook.service and audit.service stay module objects, read at call
// time; attachment.service is still required lazily, in deleteWorkOrder.
import { randomUUID as loadedRandomUUID } from "crypto";
import { Op as loadedOp } from "sequelize";
import type { CreationAttributes, Transaction, WhereOptions } from "sequelize";
import config from "../config";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { DEFAULT_LIMIT as loadedDefaultLimit, MAX_LIMIT as loadedMaxLimit } from "../constants";
import webhookService from "./webhook.service";
import auditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
} from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import { WEBHOOK_EVENTS as loadedWebhookEvents } from "../constants/webhookEvents";
import type { AuditAction } from "../constants/auditActions";
import type * as AttachmentServiceModule from "./attachment.service";

const randomUUID = loadedRandomUUID;
const Op = loadedOp;
const { db } = config;
const { MaintenanceWorkOrder, CalibrationDevice, Vendor, User } = models;
const AppError = LoadedAppError;
const DEFAULT_LIMIT = loadedDefaultLimit;
const MAX_LIMIT = loadedMaxLimit;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const WEBHOOK_EVENTS = loadedWebhookEvents;

/** One device's auto-scheduled work order, as the calibration scan describes it. */
interface AutoScheduledItem {
  deviceId: string;
  title: string;
  description: string;
  priority: string;
}

/** A work order as `transformWorkOrder` returns it (the fields a caller reads). */
interface CreatedWorkOrder {
  id: string;
  deviceId: string;
  [field: string]: unknown;
}

/** A service answer: the handlers forward `status`, `message` and `data`. */
interface WorkOrderResult<T> {
  success: true;
  status: number;
  message: string;
  data: T;
}

/** A work order as `transformWorkOrder` returns it: the row's JSON (with its includes on reads). */
type WorkOrderJson = Record<string, unknown>;

/** `fetchWorkOrders`' filters, as the controller passes them: straight from `req.query`, unvalidated. */
interface WorkOrderListQuery {
  tenantId: unknown;
  find?: unknown;
  page?: unknown;
  limit?: unknown;
  status?: unknown;
  type?: unknown;
  priority?: unknown;
  deviceId?: unknown;
}

/** A work-order row as these functions read and change it. */
type WorkOrderRow = Record<string, unknown> & {
  id: string;
  status?: unknown;
  deviceId?: unknown;
  type?: unknown;
  priority?: unknown;
  resolutionNotes?: unknown;
  toJSON?: () => unknown;
  update(values: object, options: object): Promise<unknown>;
  destroy(options: object): Promise<unknown>;
};

/** `{ id, tenantId }`: one row of the tenant. */
const byId = (id: unknown, tenantId: unknown): WhereOptions => {
  const where: WhereOptions = { id, tenantId };
  return where;
};

/** The tenant's rows among `ids`. */
const inTenant = (ids: readonly string[], tenantId: unknown): WhereOptions => {
  const where: WhereOptions = { id: { [Op.in]: ids }, tenantId };
  return where;
};

/** A field of a thrown value, read as the JavaScript read it (a null throw throws again). */
const errorField = (error: unknown, field: "status" | "message" | "name"): unknown => (error as Record<string, unknown>)[field];

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformWorkOrder = (order: unknown): WorkOrderJson | null => {
  if (!order) {return null;}
  const row = order as { toJSON?: () => unknown };
  return (row.toJSON ? row.toJSON() : { ...order }) as WorkOrderJson;
};

// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `rows || []`
const transformWorkOrders = (rows: readonly unknown[] | null | undefined): (WorkOrderJson | null)[] => (rows || []).map(transformWorkOrder);

// ------------------------------------------------------------------
// GET ALL WORK ORDERS
// ------------------------------------------------------------------
const fetchWorkOrders = async ({
  tenantId,
  find,
  page = 1,
  limit = DEFAULT_LIMIT,
  status,
  type,
  priority,
  deviceId,
}: WorkOrderListQuery): Promise<
  WorkOrderResult<{
    rows: WorkOrderJson[];
    count: number;
    meta: { total: number; page: number; limit: number; totalPages: number };
  }>
> => {
  try {
    const whereClause: Record<string, unknown> = { tenantId };

    if (find) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string -- as built: the query value is interpolated as given
      whereClause["title"] = { [Op.iLike]: `%${find}%` };
    }
    if (status) {
      whereClause["status"] = status;
    }
    if (type) {
      whereClause["type"] = type;
    }
    if (priority) {
      whereClause["priority"] = priority;
    }
    if (deviceId) {
      whereClause["deviceId"] = deviceId;
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    const { count, rows } = await MaintenanceWorkOrder.findAndCountAll({
      where: whereClause as WhereOptions,
      limit: safeLimit,
      offset,
      order: [["createdAt", "DESC"]],
      // required:false on every include — these are optional relations
      // (vendorId/assignedTo are nullable, and User/Vendor carry scopes that
      // Sequelize would otherwise promote to an INNER JOIN, hiding work orders
      // with no vendor/assignee — e.g. auto-scheduled calibration work orders).
      include: [
        // paranoid:false — work orders may reference soft-deleted devices;
        // their name should still display in historical listings.
        { model: CalibrationDevice, as: "device", attributes: ["id", "name", "serialNumber"], required: false, paranoid: false },
        { model: Vendor, as: "vendor", attributes: ["id", "name"], required: false, paranoid: false },
        { model: User, as: "assignee", attributes: ["id", "username", "firstName", "lastName", "email"], required: false, paranoid: false },
      ],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch maintenance work orders successful",
      data: {
        rows: transformWorkOrders(rows) as WorkOrderJson[],
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: safeLimit,
          totalPages: Math.ceil(count / safeLimit),
        },
      },
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- as built: the controller reads `status` and `message` off a plain object
    throw {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status is 500
      status: errorField(error, "status") || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message is the default
      message: errorField(error, "message") || "Failed to fetch maintenance work orders",
    };
  }
};

// ------------------------------------------------------------------
// GET SPECIFIC WORK ORDER
// ------------------------------------------------------------------
const getWorkOrderById = async (tenantId: unknown, orderId: unknown): Promise<WorkOrderResult<WorkOrderJson | null>> => {
  try {
    const order = await MaintenanceWorkOrder.findOne({
      where: byId(orderId, tenantId),
      // required:false — optional relations; keep work orders with no
      // vendor/assignee visible (see fetchWorkOrders note above).
      include: [
        // paranoid:false — see fetchWorkOrders note (soft-deleted relations
        // should still display for historical work orders).
        { model: CalibrationDevice, as: "device", required: false, paranoid: false },
        { model: Vendor, as: "vendor", required: false, paranoid: false },
        { model: User, as: "assignee", attributes: ["id", "username", "firstName", "lastName", "email"], required: false, paranoid: false },
      ],
    });

    if (!order) {
      throw new AppError(404, "Maintenance work order not found");
    }

    return {
      success: true,
      status: 200,
      message: "Maintenance work order retrieved successfully",
      data: transformWorkOrder(order),
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- as built: the controller reads `status` and `message` off a plain object
    throw {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status is 500
      status: errorField(error, "status") || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message is the default
      message: errorField(error, "message") || "Failed to retrieve maintenance work order",
    };
  }
};

// ------------------------------------------------------------------
// CREATE WORK ORDER
// ------------------------------------------------------------------
// Map public API field names to model columns (assigneeId → assignedTo).
const toModelFields = (data: unknown): Record<string, unknown> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `data || {}`
  const { assigneeId, ...rest } = (data || {}) as Record<string, unknown>;
  const mapped: Record<string, unknown> = { ...rest };
  if (assigneeId !== undefined) {
    mapped["assignedTo"] = assigneeId;
  }
  return mapped;
};

// The work-order columns an audit row records (A-190). Free text
// (description, resolution notes) is left out: the row is permanent.
// Q-55 (migration 0107): the schedule and the costs are audited as values;
// the resolution notes as their LENGTH only (resolutionNotesLength), so that a
// change to them is still evidenced without the permanent row keeping the text.
const AUDITED_FIELDS = [
  "deviceId", "title", "type", "status", "priority", "vendorId", "assignedTo",
  "scheduledDate", "completedDate", "estimatedCost", "actualCost",
];

/** Q-55: `{ resolutionNotesLength }` for an audit row, or {} when the notes are not part of it. */
const notesAudit = (source: { resolutionNotes?: unknown }): { resolutionNotesLength?: number | null } =>
  source.resolutionNotes === undefined
    ? {}
    : // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: the notes are measured as the string they are stored as
    { resolutionNotesLength: source.resolutionNotes === null ? null : String(source.resolutionNotes).length };

const pick = (source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key] ?? null]));

/**
 * A-190 — the audit row of a work-order change, in the tenant's trail and in
 * the change's transaction. A failed insert is re-thrown by logAction and
 * rolls the change back.
 *
 * W-30 — the actor is a user (`actor.userId`) or a job (`actor.systemActor`,
 * from constants/systemActors.js): the calibration scan has no user, and
 * logAction refuses an entry that names neither — which rolled back every
 * work order the scan tried to create.
 *
 * @param transaction - the change's transaction
 * @param tenantId - the tenant
 * @param actor - auditPrincipal(req), or `{ systemActor }`
 * @param row - action, resource and changes
 * @returns logAction's answer
 */
const auditWorkOrder = (
  transaction: Transaction,
  tenantId: unknown,
  actor: AuditActorInput | null | undefined,
  { action, resourceId, changes }: { action: AuditAction; resourceId: string; changes: Record<string, unknown> },
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId: tenantId as string,
      // A-282 (ADR-100): a user, a key (system:api-key, its id in changes) or
      // the scan's system actor.
      ...auditEntryActor(actor),
      action,
      resourceType: "MaintenanceWorkOrder",
      resourceId,
      changes: { ...changes, ...actorChanges(actor) },
    },
    { transaction },
  );

/**
 * A-220 — a work order may reference only its own tenant's device, vendor and
 * assignee. The foreign keys accept any tenant's id, so until 2026-09-24 a
 * body naming another hospital's device created a work order pointing into
 * that tenant (and, since ADR-048, one whose device then reads as null). A
 * reference that is not in the tenant is 404 — the same answer as one that
 * does not exist, so the check is not an oracle for other tenants' ids.
 *
 * @param tenantId - the tenant
 * @param fields - model fields (after toModelFields)
 * @param transaction - the change's transaction
 * @throws {AppError} 404 naming the reference that was not found
 */
const assertReferencesInTenant = async (tenantId: unknown, fields: Record<string, unknown>, transaction: Transaction): Promise<void> => {
  const checks: [unknown, { findOne(options: object): Promise<unknown> }, string][] = [
    [fields["deviceId"], CalibrationDevice, "Device not found"],
    [fields["vendorId"], Vendor, "Vendor not found"],
    [fields["assignedTo"], User, "Assignee not found"],
  ];
  for (const [id, Model, message] of checks) {
    if (id) {
      const found = await Model.findOne({ where: { id, tenantId }, attributes: ["id"], transaction });
      if (!found) {
        throw new AppError(404, message);
      }
    }
  }
};

/**
 * Create a work order, its audit row and (after the commit) its webhook.
 *
 * @param tenantId - the tenant
 * @param data - validated body
 * @param actor - auditPrincipal(req)
 * @returns the service answer
 */
const createWorkOrder = async (
  tenantId: unknown,
  data: unknown,
  actor: AuditActorInput = {},
): Promise<WorkOrderResult<WorkOrderJson | null>> => {
  try {
    const fields = toModelFields(data);
    const newOrder = await db.transaction(async (transaction) => {
      await assertReferencesInTenant(tenantId, fields, transaction);
      const created = (await MaintenanceWorkOrder.create(
        { ...fields, tenantId } as unknown as CreationAttributes<InstanceType<typeof MaintenanceWorkOrder>>,
        { transaction },
      )) as unknown as WorkOrderRow;
      await auditWorkOrder(transaction, tenantId, actor, {
        action: "CREATE",
        resourceId: created.id,
        changes: { before: {}, after: { ...pick(created, AUDITED_FIELDS), ...notesAudit(created) } },
      });
      // A-11: announced once, and only if the transaction commits.
      webhookService.emitAfterCommit(transaction, tenantId as string, WEBHOOK_EVENTS.WORK_ORDER_CREATED, {
        workOrderId: created.id, deviceId: created.deviceId, type: created.type, status: created.status, priority: created.priority,
      });
      return created;
    });

    return {
      success: true,
      status: 201,
      message: "Maintenance work order created successfully",
      data: transformWorkOrder(newOrder),
    };
  } catch (error) {
    // W-03 — the partial unique index of migration 0060 allows one open
    // auto-scheduled work order per device. A second one is a state conflict
    // (a concurrent scan got there first), not a server error.
    if (errorField(error, "name") === "SequelizeUniqueConstraintError") {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- as built: the controller reads `status` and `message` off a plain object
      throw {
        status: 409,
        message: "This device already has an open auto-scheduled calibration work order",
      };
    }
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- as built: as above
    throw {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status is 500
      status: errorField(error, "status") || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message is the default
      message: errorField(error, "message") || "Failed to create maintenance work order",
    };
  }
};

/**
 * W-17 (ADR-073) — the calibration scan's work orders for ONE tenant, in ONE
 * transaction: one INSERT for all of them, one audit row EACH (per-device
 * attribution is unchanged), and one WORK_ORDER_CREATED webhook each after
 * the commit. `createWorkOrder` made a transaction — a commit — per device.
 *
 * W-03 still holds: the INSERT is `ON CONFLICT DO NOTHING`, so a device that
 * already has an open auto-scheduled order (migration 0060's partial unique
 * index, e.g. a concurrent scan's) inserts nothing instead of aborting the
 * whole batch, and is returned in `conflicted`.
 *
 * The rows get their ids here, and what was inserted is read back by those
 * ids: Sequelize maps `RETURNING` rows onto the built instances BY POSITION,
 * which misattributes every row after a skipped one.
 *
 * @param tenantId - the tenant
 * @param items - one per device
 * @param actor - `{ systemActor }` or auditPrincipal(req)
 * @returns `missing`: devices that are not this tenant's (A-220), nothing written for them
 */
const createAutoScheduledWorkOrders = async (
  tenantId: string,
  items: AutoScheduledItem[],
  actor: object,
): Promise<{ created: CreatedWorkOrder[]; conflicted: string[]; missing: string[] }> => {
  if (!items.length) {
    return { created: [], conflicted: [], missing: [] };
  }
  return db.transaction(async (transaction) => {
    const deviceIds = items.map((item) => item.deviceId);
    const owned = new Set(
      (
        (await CalibrationDevice.findAll({
          where: inTenant(deviceIds, tenantId),
          attributes: ["id"],
          transaction,
        })) as unknown as { id: string }[]
      ).map((device) => device.id),
    );
    const rows = items
      .filter((item) => owned.has(item.deviceId))
      .map((item) => ({
        ...toModelFields(item),
        id: randomUUID(),
        tenantId,
        type: "Preventative",
        status: "Open",
        autoScheduled: true,
      }));

    let inserted: WorkOrderRow[] = [];
    if (rows.length) {
      await MaintenanceWorkOrder.bulkCreate(rows as unknown as CreationAttributes<InstanceType<typeof MaintenanceWorkOrder>>[], {
        transaction,
        validate: true,
        ignoreDuplicates: true,
        returning: false,
      });
      inserted = (await MaintenanceWorkOrder.findAll({
        where: { id: { [Op.in]: rows.map((row) => row.id) } },
        transaction,
      })) as unknown as WorkOrderRow[];
    }

    for (const created of inserted) {
      await auditWorkOrder(transaction, tenantId, actor, {
        action: "CREATE",
        resourceId: created.id,
        changes: { before: {}, after: pick(created, AUDITED_FIELDS) },
      });
      webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.WORK_ORDER_CREATED, {
        workOrderId: created.id, deviceId: created.deviceId, type: created.type, status: created.status, priority: created.priority,
      });
    }

    const createdDevices = new Set(inserted.map((row) => row.deviceId));
    return {
      created: inserted.map(transformWorkOrder) as CreatedWorkOrder[],
      conflicted: deviceIds.filter((id) => owned.has(id) && !createdDevices.has(id)),
      missing: deviceIds.filter((id) => !owned.has(id)),
    };
  });
};

// ------------------------------------------------------------------
// UPDATE WORK ORDER
// ------------------------------------------------------------------
const updateWorkOrder = async (
  tenantId: unknown,
  orderId: unknown,
  data: unknown,
  actor: AuditActorInput = {},
): Promise<WorkOrderResult<WorkOrderJson | null>> => {
  try {
    const order = (await MaintenanceWorkOrder.findOne({
      where: byId(orderId, tenantId),
    })) as unknown as WorkOrderRow | null;

    if (!order) {
      throw new AppError(404, "Maintenance work order not found");
    }

    const fields = toModelFields(data);
    const previousStatus = order.status;
    // Read before the update: the instance is mutated in place.
    const audited = AUDITED_FIELDS.filter((key) => fields[key] !== undefined);
    const before = {
      ...Object.fromEntries(audited.map((key) => [key, order[key] ?? null])),
      ...(fields["resolutionNotes"] === undefined ? {} : notesAudit({ resolutionNotes: order.resolutionNotes ?? null })),
    };

    await db.transaction(async (transaction) => {
      await assertReferencesInTenant(tenantId, fields, transaction);
      await order.update(fields, { transaction });
      await auditWorkOrder(transaction, tenantId, actor, {
        action: "UPDATE",
        resourceId: order.id,
        changes: { before, after: { ...pick(fields, audited), ...notesAudit(fields) } },
      });
      // A-11: announce the transition into Completed once, after the commit.
      if (order.status === "Completed" && previousStatus !== "Completed") {
        webhookService.emitAfterCommit(transaction, tenantId as string, WEBHOOK_EVENTS.WORK_ORDER_COMPLETED, {
          workOrderId: order.id, deviceId: order.deviceId, type: order.type, status: order.status,
        });
      }
    });

    return {
      success: true,
      status: 200,
      message: "Maintenance work order updated successfully",
      data: transformWorkOrder(order),
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- as built: the controller reads `status` and `message` off a plain object
    throw {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status is 500
      status: errorField(error, "status") || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message is the default
      message: errorField(error, "message") || "Failed to update maintenance work order",
    };
  }
};

// ------------------------------------------------------------------
// DELETE WORK ORDER
// ------------------------------------------------------------------
const deleteWorkOrder = async (
  tenantId: unknown,
  orderId: unknown,
  actor: AuditActorInput = {},
): Promise<Omit<WorkOrderResult<never>, "data">> => {
  try {
    const order = (await MaintenanceWorkOrder.findOne({
      where: byId(orderId, tenantId),
    })) as unknown as WorkOrderRow | null;

    if (!order) {
      throw new AppError(404, "Maintenance work order not found");
    }

    const before = { ...pick(order, AUDITED_FIELDS), ...notesAudit(order) };
    await db.transaction(async (transaction) => {
      await order.destroy({ transaction });
      // D-22 (ADR-070): its attachments go with it, in this transaction.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required here, per call
      await (require("./attachment.service") as typeof AttachmentServiceModule).softDeleteForResource(
        tenantId as string,
        "MaintenanceWorkOrder",
        order.id,
        { transaction, actor },
      );
      await auditWorkOrder(transaction, tenantId, actor, {
        action: "DELETE",
        resourceId: order.id,
        changes: { before, after: { deleted: true } },
      });
    });

    return {
      success: true,
      status: 200,
      message: "Maintenance work order deleted successfully",
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- as built: the controller reads `status` and `message` off a plain object
    throw {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a 0 status is 500
      status: errorField(error, "status") || 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty message is the default
      message: errorField(error, "message") || "Failed to delete maintenance work order",
    };
  }
};

// The exported object, its keys in the JavaScript's order (`exports.x = …`).
export = {
  fetchWorkOrders,
  getWorkOrderById,
  createWorkOrder,
  createAutoScheduledWorkOrders,
  updateWorkOrder,
  deleteWorkOrder,
};
