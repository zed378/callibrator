const { Op } = require("sequelize");
const { db } = require("../config");
const { MaintenanceWorkOrder, CalibrationDevice, Vendor, User } = require("../models");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");

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

exports.createWorkOrder = async (tenantId, data) => {
  try {
    const newOrder = await MaintenanceWorkOrder.create({
      ...toModelFields(data),
      tenantId,
    });

    return {
      success: true,
      status: 201,
      message: "Maintenance work order created successfully",
      data: transformWorkOrder(newOrder),
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to create maintenance work order",
    };
  }
};

// ------------------------------------------------------------------
// UPDATE WORK ORDER
// ------------------------------------------------------------------
exports.updateWorkOrder = async (tenantId, orderId, data) => {
  try {
    const order = await MaintenanceWorkOrder.findOne({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw new AppError(404, "Maintenance work order not found");
    }

    await order.update(toModelFields(data));

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
exports.deleteWorkOrder = async (tenantId, orderId) => {
  try {
    const order = await MaintenanceWorkOrder.findOne({
      where: { id: orderId, tenantId },
    });

    if (!order) {
      throw new AppError(404, "Maintenance work order not found");
    }

    await order.destroy();

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
