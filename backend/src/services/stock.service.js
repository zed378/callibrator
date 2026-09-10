// src/services/stock.service.js
const { Op } = require("sequelize");
const { db } = require("../config");
const { Stock, StockTransfer, StockAdjustment, StockOpname, Warehouse, StorageLocation, User } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT } = require("../constants");
const {
  validate: validateInput,
  formatErrors,
  createStockSchema,
  updateStockSchema,
  createTransferSchema,
  updateTransferStatusSchema,
  createAdjustmentSchema,
  createOpnameSchema,
  updateOpnameStatusSchema,
} = require("../validators/stock.validator");

// ==========================================
// VALIDATION HELPERS
// ==========================================

const validate = (data, schema) => {
  const { error, value } = validateInput(data, schema);
  if (error) {
    throw {
      status: 400,
      message: "Validation failed",
      errors: formatErrors(error.details),
    };
  }
  return value;
};

// ==========================================
// STOCK SERVICE METHODS
// ==========================================

exports.fetchStocks = async ({ tenantId, warehouseId, locationId, find, page = 1, limit = DEFAULT_LIMIT }) => {
  try {
    const whereClause = { tenantId, isDeleted: false };

    if (warehouseId) {
      whereClause.warehouseId = warehouseId;
    }
    if (locationId) {
      whereClause.locationId = locationId;
    }

    if (find) {
      const searchTerm = `%${find.toLowerCase()}%`;
      whereClause[Op.or] = [
        { itemName: { [Op.like]: searchTerm } },
        { sku: { [Op.like]: searchTerm } },
        { serialNumber: { [Op.like]: searchTerm } },
      ];
    }

    const { rows, count } = await Stock.findAndCountAll({
      where: whereClause,
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["id", "name", "code"] },
        { model: StorageLocation, as: "location", attributes: ["id", "name", "code"] },
      ],
      order: [["itemName", "ASC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    return {
      success: true,
      status: 200,
      message: "Fetch stocks successful",
      data: {
        rows,
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(count / Number(limit)),
        },
      },
    };
  } catch (error) {
    logger.error("Error fetching stocks", { error: error.message });
    throw error;
  }
};

exports.fetchSpecificStock = async (tenantId, stockId) => {
  try {
    const stock = await Stock.findOne({
      where: { id: stockId, tenantId, isDeleted: false },
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["id", "name", "code"] },
        { model: StorageLocation, as: "location", attributes: ["id", "name", "code"] },
      ],
    });

    if (!stock) {
      throw new AppError(404, "Stock item not found");
    }

    return {
      success: true,
      status: 200,
      message: "Fetch stock item successful",
      data: stock,
    };
  } catch (error) {
    logger.error("Error fetching specific stock", { error: error.message });
    throw error;
  }
};

exports.createStock = async (tenantId, input) => {
  const data = validate(input, createStockSchema);
  const transaction = await db.transaction();

  try {
    // Verify warehouse
    const warehouse = await Warehouse.findOne({
      where: { id: data.warehouseId, tenantId, isDeleted: false },
      transaction,
    });
    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    // Verify location if provided
    if (data.locationId) {
      const location = await StorageLocation.findOne({
        where: { id: data.locationId, warehouseId: data.warehouseId, tenantId },
        transaction,
      });
      if (!location) {
        throw new AppError(404, "Storage location not found in this warehouse");
      }
    }

    // Check if stock with same SKU/serial number already exists
    if (data.sku || data.serialNumber) {
      const existingQuery = {
        tenantId,
        warehouseId: data.warehouseId,
        isDeleted: false,
      };
      if (data.locationId) {
        existingQuery.locationId = data.locationId;
      }
      if (data.sku) {
        existingQuery.sku = data.sku;
      }
      if (data.serialNumber) {
        existingQuery.serialNumber = data.serialNumber;
      }

      const existing = await Stock.findOne({
        where: existingQuery,
        transaction,
      });

      if (existing) {
        throw new AppError(409, "Stock item with matching SKU or serial number already exists");
      }
    }

    const stock = await Stock.create(
      {
        tenantId,
        warehouseId: data.warehouseId,
        locationId: data.locationId || null,
        itemName: data.itemName,
        sku: data.sku || null,
        serialNumber: data.serialNumber || null,
        quantity: data.quantity || 0,
        minQuantity: data.minQuantity || 0,
        description: data.description || null,
      },
      { transaction },
    );

    await transaction.commit();
    logger.info("Stock item created", { stockId: stock.id, tenantId });

    return {
      success: true,
      status: 201,
      message: "Stock item created successfully",
      data: stock,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error creating stock", { error: error.message });
    throw error;
  }
};

exports.updateStock = async (tenantId, stockId, input) => {
  const data = validate(input, updateStockSchema);
  const transaction = await db.transaction();

  try {
    const stock = await Stock.findOne({
      where: { id: stockId, tenantId, isDeleted: false },
      transaction,
    });

    if (!stock) {
      throw new AppError(404, "Stock item not found");
    }

    await stock.update(
      {
        itemName: data.itemName || stock.itemName,
        sku: data.sku !== undefined ? data.sku : stock.sku,
        serialNumber: data.serialNumber !== undefined ? data.serialNumber : stock.serialNumber,
        quantity: data.quantity !== undefined ? data.quantity : stock.quantity,
        minQuantity: data.minQuantity !== undefined ? data.minQuantity : stock.minQuantity,
        description: data.description !== undefined ? data.description : stock.description,
      },
      { transaction },
    );

    await transaction.commit();
    logger.info("Stock item updated", { stockId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Stock item updated successfully",
      data: stock,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating stock", { error: error.message });
    throw error;
  }
};

exports.deleteStock = async (tenantId, stockId) => {
  const transaction = await db.transaction();

  try {
    const stock = await Stock.findOne({
      where: { id: stockId, tenantId, isDeleted: false },
      transaction,
    });

    if (!stock) {
      throw new AppError(404, "Stock item not found");
    }

    await stock.softDelete();
    await transaction.commit();
    logger.info("Stock item deleted", { stockId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Stock item deleted successfully",
      data: null,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error deleting stock", { error: error.message });
    throw error;
  }
};

// ==========================================
// STOCK ADJUSTMENT METHODS
// ==========================================

exports.createAdjustment = async (tenantId, input, userId) => {
  const data = validate(input, createAdjustmentSchema);
  const transaction = await db.transaction();

  try {
    const stock = await Stock.findOne({
      where: { id: data.stockId, tenantId, isDeleted: false },
      transaction,
    });

    if (!stock) {
      throw new AppError(404, "Stock item not found");
    }

    let newQuantity = stock.quantity;
    /* istanbul ignore else -- createAdjustmentSchema restricts `type` to
       exactly "addition" | "subtraction" | "write_off" and validate() runs
       above, so the implicit else (quantity unchanged) is unreachable. */
    if (data.type === "addition") {
      newQuantity += data.quantity;
    } else if (data.type === "subtraction" || data.type === "write_off") {
      if (stock.quantity < data.quantity) {
        throw new AppError(400, "Insufficient stock quantity for adjustment");
      }
      newQuantity -= data.quantity;
    }

    // Update stock quantity
    await stock.update({ quantity: newQuantity }, { transaction });

    // Log adjustment
    const adjustment = await StockAdjustment.create(
      {
        tenantId,
        warehouseId: stock.warehouseId,
        locationId: stock.locationId || null,
        type: data.type,
        quantity: data.quantity,
        reason: data.reason || null,
        adjustedBy: userId,
      },
      { transaction },
    );

    await transaction.commit();
    logger.info("Stock adjusted", { stockId: stock.id, adjustmentId: adjustment.id, tenantId });

    return {
      success: true,
      status: 201,
      message: "Stock adjusted successfully",
      data: adjustment,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error adjusting stock", { error: error.message });
    throw error;
  }
};

exports.fetchAdjustments = async ({ tenantId, warehouseId, type, page = 1, limit = DEFAULT_LIMIT }) => {
  try {
    const whereClause = { tenantId };
    if (warehouseId) {
      whereClause.warehouseId = warehouseId;
    }
    if (type) {
      whereClause.type = type;
    }

    const { rows, count } = await StockAdjustment.findAndCountAll({
      where: whereClause,
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["id", "name", "code"] },
        { model: User, as: "adjuster", attributes: ["id", "username", "firstName", "lastName"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    return {
      success: true,
      status: 200,
      message: "Fetch adjustments successful",
      data: {
        rows,
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(count / Number(limit)),
        },
      },
    };
  } catch (error) {
    logger.error("Error fetching adjustments", { error: error.message });
    throw error;
  }
};

// ==========================================
// STOCK TRANSFER METHODS
// ==========================================

exports.createTransfer = async (tenantId, input, userId) => {
  const data = validate(input, createTransferSchema);
  const transaction = await db.transaction();

  try {
    if (data.fromWarehouseId === data.toWarehouseId) {
      throw new AppError(400, "Source and destination warehouses must be different");
    }

    // Verify source warehouse
    const fromWarehouse = await Warehouse.findOne({
      where: { id: data.fromWarehouseId, tenantId, isDeleted: false },
      transaction,
    });
    if (!fromWarehouse) {
      throw new AppError(404, "Source warehouse not found");
    }

    // Verify destination warehouse
    const toWarehouse = await Warehouse.findOne({
      where: { id: data.toWarehouseId, tenantId, isDeleted: false },
      transaction,
    });
    if (!toWarehouse) {
      throw new AppError(404, "Destination warehouse not found");
    }

    // Verify stock exists and quantity is sufficient in source warehouse
    const stock = await Stock.findOne({
      where: {
        warehouseId: data.fromWarehouseId,
        itemName: data.itemName,
        tenantId,
        isDeleted: false,
      },
      transaction,
    });

    if (!stock || stock.quantity < data.quantity) {
      throw new AppError(400, "Insufficient stock in source warehouse");
    }

    const transfer = await StockTransfer.create(
      {
        tenantId,
        fromWarehouseId: data.fromWarehouseId,
        toWarehouseId: data.toWarehouseId,
        itemName: data.itemName,
        quantity: data.quantity,
        notes: data.notes || null,
        requestedBy: userId,
        status: "pending",
      },
      { transaction },
    );

    await transaction.commit();
    logger.info("Stock transfer request created", { transferId: transfer.id, tenantId });

    const workflowService = require("./workflow.service");
    await workflowService.startWorkflow(tenantId, "StockTransfer", transfer.id);

    return {
      success: true,
      status: 201,
      message: "Stock transfer request created successfully",
      data: transfer,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error creating transfer request", { error: error.message });
    throw error;
  }
};

exports.updateTransferStatus = async (tenantId, transferId, input, userId) => {
  const data = validate(input, updateTransferStatusSchema);
  const transaction = await db.transaction();

  try {
    const transfer = await StockTransfer.findOne({
      where: { id: transferId, tenantId },
      transaction,
    });

    if (!transfer) {
      throw new AppError(404, "Stock transfer not found");
    }

    if (transfer.status === "completed" || transfer.status === "cancelled") {
      throw new AppError(400, `Cannot update transfer in '${transfer.status}' status`);
    }

    if (data.status === "completed") {
      // Execute the transfer atomically
      const sourceStock = await Stock.findOne({
        where: {
          warehouseId: transfer.fromWarehouseId,
          itemName: transfer.itemName,
          tenantId,
          isDeleted: false,
        },
        transaction,
      });

      if (!sourceStock || sourceStock.quantity < transfer.quantity) {
        throw new AppError(400, "Insufficient stock in source warehouse to complete transfer");
      }

      // Deduct from source
      await sourceStock.update({ quantity: sourceStock.quantity - transfer.quantity }, { transaction });

      // Add to destination
      const [destStock, created] = await Stock.findOrCreate({
        where: {
          warehouseId: transfer.toWarehouseId,
          itemName: transfer.itemName,
          tenantId,
          isDeleted: false,
        },
        defaults: {
          quantity: transfer.quantity,
          sku: sourceStock.sku,
          serialNumber: sourceStock.serialNumber,
          minQuantity: sourceStock.minQuantity,
          description: sourceStock.description,
        },
        transaction,
      });

      if (!created) {
        await destStock.update({ quantity: destStock.quantity + transfer.quantity }, { transaction });
      }

      await transfer.update(
        {
          status: "completed",
          approvedBy: userId,
          transferDate: new Date(),
        },
        { transaction },
      );
    } else {
      // Transition to in_transit or cancelled
      await transfer.update(
        {
          status: data.status,
          approvedBy: data.status === "cancelled" ? userId : null,
        },
        { transaction },
      );
    }

    await transaction.commit();
    logger.info("Stock transfer status updated", { transferId, status: data.status, tenantId });

    return {
      success: true,
      status: 200,
      message: `Stock transfer status updated to ${data.status} successfully`,
      data: transfer,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating transfer status", { error: error.message });
    throw error;
  }
};

exports.fetchTransfers = async ({ tenantId, fromWarehouseId, toWarehouseId, status, page = 1, limit = DEFAULT_LIMIT }) => {
  try {
    const whereClause = { tenantId };
    if (fromWarehouseId) {
      whereClause.fromWarehouseId = fromWarehouseId;
    }
    if (toWarehouseId) {
      whereClause.toWarehouseId = toWarehouseId;
    }
    if (status) {
      whereClause.status = status;
    }

    const { rows, count } = await StockTransfer.findAndCountAll({
      where: whereClause,
      include: [
        { model: Warehouse, as: "fromWarehouse", attributes: ["id", "name", "code"] },
        { model: Warehouse, as: "toWarehouse", attributes: ["id", "name", "code"] },
        { model: User, as: "requester", attributes: ["id", "username", "firstName", "lastName"] },
        { model: User, as: "approver", attributes: ["id", "username", "firstName", "lastName"] },
      ],
      order: [["createdAt", "DESC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    return {
      success: true,
      status: 200,
      message: "Fetch transfers successful",
      data: {
        rows,
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(count / Number(limit)),
        },
      },
    };
  } catch (error) {
    logger.error("Error fetching transfers", { error: error.message });
    throw error;
  }
};

// ==========================================
// STOCK OPNAME METHODS
// ==========================================

exports.createOpname = async (tenantId, input, userId) => {
  const data = validate(input, createOpnameSchema);
  const transaction = await db.transaction();

  try {
    // Verify warehouse
    const warehouse = await Warehouse.findOne({
      where: { id: data.warehouseId, tenantId, isDeleted: false },
      transaction,
    });
    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    const opname = await StockOpname.create(
      {
        tenantId,
        warehouseId: data.warehouseId,
        status: "draft",
        scheduledAt: data.scheduledAt,
        performedBy: userId,
        notes: data.notes || null,
      },
      { transaction },
    );

    await transaction.commit();
    logger.info("Stock opname scheduled", { opnameId: opname.id, tenantId });

    return {
      success: true,
      status: 201,
      message: "Stock opname scheduled successfully",
      data: opname,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error creating opname", { error: error.message });
    throw error;
  }
};

exports.updateOpnameStatus = async (tenantId, opnameId, input, userId) => {
  const data = validate(input, updateOpnameStatusSchema);
  const transaction = await db.transaction();

  try {
    const opname = await StockOpname.findOne({
      where: { id: opnameId, tenantId },
      transaction,
    });

    if (!opname) {
      throw new AppError(404, "Stock opname not found");
    }

    if (opname.status === "completed") {
      throw new AppError(400, "Cannot update completed stock opname");
    }

    await opname.update(
      {
        status: data.status,
        completedAt: data.status === "completed" ? new Date() : null,
      },
      { transaction },
    );

    await transaction.commit();
    logger.info("Stock opname status updated", { opnameId, status: data.status, tenantId });

    return {
      success: true,
      status: 200,
      message: `Stock opname status updated to ${data.status} successfully`,
      data: opname,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating opname status", { error: error.message });
    throw error;
  }
};

exports.fetchOpnames = async ({ tenantId, warehouseId, status, page = 1, limit = DEFAULT_LIMIT }) => {
  try {
    const whereClause = { tenantId };
    if (warehouseId) {
      whereClause.warehouseId = warehouseId;
    }
    if (status) {
      whereClause.status = status;
    }

    const { rows, count } = await StockOpname.findAndCountAll({
      where: whereClause,
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["id", "name", "code"] },
        { model: User, as: "performer", attributes: ["id", "username", "firstName", "lastName"] },
      ],
      order: [["scheduledAt", "DESC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    return {
      success: true,
      status: 200,
      message: "Fetch opnames successful",
      data: {
        rows,
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(count / Number(limit)),
        },
      },
    };
  } catch (error) {
    logger.error("Error fetching opnames", { error: error.message });
    throw error;
  }
};

exports.getInventoryReport = async (tenantId) => {
  try {
    const stocks = await Stock.findAll({
      where: { tenantId, isDeleted: false },
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["id", "name", "code"] },
      ],
    });

    let totalItems = 0;
    let totalUnits = 0;
    let lowStockCount = 0;
    const warehouseMap = {};

    for (const stock of stocks) {
      totalItems += 1;
      const qty = stock.quantity || 0;
      totalUnits += qty;
      if (qty < (stock.minQuantity || 0)) {
        lowStockCount += 1;
      }

      const wh = stock.warehouse;
      if (wh) {
        if (!warehouseMap[wh.id]) {
          warehouseMap[wh.id] = {
            id: wh.id,
            name: wh.name,
            code: wh.code,
            itemCount: 0,
            unitCount: 0,
          };
        }
        warehouseMap[wh.id].itemCount += 1;
        warehouseMap[wh.id].unitCount += qty;
      }
    }

    const warehouseDistribution = Object.values(warehouseMap);

    return {
      success: true,
      status: 200,
      message: "Get inventory report successful",
      data: {
        totalItems,
        totalUnits,
        lowStockCount,
        warehouseDistribution,
      },
    };
  } catch (error) {
    logger.error("Error generating inventory report", { error: error.message });
    throw error;
  }
};

exports.exportInventoryCsv = async (tenantId) => {
  try {
    const stocks = await Stock.findAll({
      where: { tenantId, isDeleted: false },
      include: [
        { model: Warehouse, as: "warehouse", attributes: ["name"] },
        { model: StorageLocation, as: "location", attributes: ["name"] },
      ],
      order: [["itemName", "ASC"]],
    });

    const escapeCsv = (val) => {
      if (val === null || val === undefined) {return "";}
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      "Item Name",
      "SKU",
      "Serial Number",
      "Warehouse",
      "Storage Location",
      "Quantity",
      "Min Quantity",
      "Description",
    ];

    const csvRows = [headers.join(",")];

    for (const stock of stocks) {
      const row = [
        escapeCsv(stock.itemName),
        escapeCsv(stock.sku),
        escapeCsv(stock.serialNumber),
        escapeCsv(stock.warehouse ? stock.warehouse.name : ""),
        escapeCsv(stock.location ? stock.location.name : ""),
        escapeCsv(stock.quantity),
        escapeCsv(stock.minQuantity),
        escapeCsv(stock.description),
      ];
      csvRows.push(row.join(","));
    }

    const csvString = csvRows.join("\n");

    return {
      success: true,
      status: 200,
      message: "Export inventory CSV successful",
      data: csvString,
    };
  } catch (error) {
    logger.error("Error exporting inventory CSV", { error: error.message });
    throw error;
  }
};
