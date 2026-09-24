const { Op } = require("sequelize");
const { db } = require("../config");
const { MaintenanceWorkOrder, CalibrationDevice, Vendor, User } = require("../models");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");
const webhookService = require("./webhook.service");
const auditService = require("./audit.service");
const { WEBHOOK_EVENTS } = require("../constants/webhookEvents");

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformWorkOrder = (order) => {
  if (!order) {return null;}
  return order.toJSON ? order.toJSON() : { ...order };
};

const transformWorkOrders = (rows) => (rows || []).map(transformWorkOrder);

// ------------------------------------------------------------------
// GET ALL WORK ORDERS
// ------------------------------------------------------------------
exports.fetchWorkOrders = async ({
  tenantId,
  find,
  page = 1,
  limit = DEFAULT_LIMIT,
  status,
  type,
  priority,
  deviceId,
}) => {
  try {
    const whereClause = { tenantId };

    if (find) {
      whereClause.title = { [Op.iLike]: `%${find}%` };
    }
    if (status) {
      whereClause.status = status;
    }
    if (type) {
      whereClause.type = type;
    }
    if (priority) {
      whereClause.priority = priority;
    }
    if (deviceId) {
      whereClause.deviceId = deviceId;
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    const { count, rows } = await MaintenanceWorkOrder.findAndCountAll({
      where: whereClause,
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
        rows: transformWorkOrders(rows),
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
    throw {
      status: error.status || 500,
      message: error.message || "Failed to fetch maintenance work orders",
    };
  }
};

// ------------------------------------------------------------------
// GET SPECIFIC WORK ORDER
// ------------------------------------------------------------------
exports.getWorkOrderById = async (tenantId, orderId) => {
  try {
    const order = await MaintenanceWorkOrder.findOne({
      where: { id: orderId, tenantId },
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
    throw {
      status: error.status || 500,
      message: error.message || "Failed to retrieve maintenance work order",
    };
  }
};

// ------------------------------------------------------------------
// CREATE WORK ORDER
// ------------------------------------------------------------------
// Map public API field names to model columns (assigneeId → assignedTo).
const toModelFields = (data) => {
  const { assigneeId, ...rest } = data || {};
  const mapped = { ...rest };
  if (assigneeId !== undefined) {
    mapped.assignedTo = assigneeId;
  }
  return mapped;
};

// The work-order columns an audit row records (A-190). Free text
// (description, resolution notes) is left out: the row is permanent.
const AUDITED_FIELDS = ["deviceId", "title", "type", "status", "priority", "vendorId", "assignedTo"];

const pick = (source, keys) =>
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
 */
const auditWorkOrder = (transaction, tenantId, actor, { action, resourceId, changes }) =>
  auditService.logAction(
    {
      tenantId,
      userId: actor.userId,
      systemActor: actor.systemActor,
      action,
      resourceType: "MaintenanceWorkOrder",
      resourceId,
      changes,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
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
 * @param {string} tenantId
 * @param {object} fields - model fields (after toModelFields)
 * @param {object} transaction
 * @throws {AppError} 404 naming the reference that was not found
 */
const assertReferencesInTenant = async (tenantId, fields, transaction) => {
  const checks = [
    [fields.deviceId, CalibrationDevice, "Device not found"],
    [fields.vendorId, Vendor, "Vendor not found"],
    [fields.assignedTo, User, "Assignee not found"],
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
 * @param {string} tenantId
 * @param {object} data - validated body
 * @param {object} actor - auditActor(req)
 */
exports.createWorkOrder = async (tenantId, data, actor = {}) => {
  try {
    const fields = toModelFields(data);
    const newOrder = await db.transaction(async (transaction) => {
      await assertReferencesInTenant(tenantId, fields, transaction);
      const created = await MaintenanceWorkOrder.create({ ...fields, tenantId }, { transaction });
      await auditWorkOrder(transaction, tenantId, actor, {
        action: "CREATE",
        resourceId: created.id,
        changes: { before: {}, after: pick(created, AUDITED_FIELDS) },
      });
      // A-11: announced once, and only if the transaction commits.
      webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.WORK_ORDER_CREATED, {
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
    if (error.name === "SequelizeUniqueConstraintError") {
      throw {
        status: 409,
        message: "This device already has an open auto-scheduled calibration work order",
      };
    }
    throw {
      status: error.status || 500,
      message: error.message || "Failed to create maintenance work order",
    };
  }
};

// ------------------------------------------------------------------
// UPDATE WORK ORDER
// ------------------------------------------------------------------
exports.updateWorkOrder = async (tenantId, orderId, data, actor = {}) => {
  try {
    const order = await MaintenanceWorkOrder.findOne({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw new AppError(404, "Maintenance work order not found");
    }

    const fields = toModelFields(data);
    const previousStatus = order.status;
    // Read before the update: the instance is mutated in place.
    const audited = AUDITED_FIELDS.filter((key) => fields[key] !== undefined);
    const before = Object.fromEntries(audited.map((key) => [key, order[key] ?? null]));

    await db.transaction(async (transaction) => {
      await assertReferencesInTenant(tenantId, fields, transaction);
      await order.update(fields, { transaction });
      await auditWorkOrder(transaction, tenantId, actor, {
        action: "UPDATE",
        resourceId: order.id,
        changes: { before, after: pick(fields, audited) },
      });
      // A-11: announce the transition into Completed once, after the commit.
      if (order.status === "Completed" && previousStatus !== "Completed") {
        webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.WORK_ORDER_COMPLETED, {
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
    throw {
      status: error.status || 500,
      message: error.message || "Failed to update maintenance work order",
    };
  }
};

// ------------------------------------------------------------------
// DELETE WORK ORDER
// ------------------------------------------------------------------
exports.deleteWorkOrder = async (tenantId, orderId, actor = {}) => {
  try {
    const order = await MaintenanceWorkOrder.findOne({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw new AppError(404, "Maintenance work order not found");
    }

    const before = pick(order, AUDITED_FIELDS);
    await db.transaction(async (transaction) => {
      await order.destroy({ transaction });
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
    throw {
      status: error.status || 500,
      message: error.message || "Failed to delete maintenance work order",
    };
  }
};
