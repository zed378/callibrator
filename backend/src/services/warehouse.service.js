// src/services/warehouse.service.js
const { Op } = require("sequelize");
const { db } = require("../config");
const { Warehouse, StorageLocation, Stock } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT } = require("../constants");
const {
  validate: validateInput,
  formatErrors,
  createWarehouseSchema,
  updateWarehouseSchema,
  createLocationSchema,
  updateLocationSchema,
} = require("../validators/warehouse.validator");

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
// WAREHOUSE SERVICE METHODS
// ==========================================

exports.fetchWarehouses = async ({ tenantId, find, page = 1, limit = DEFAULT_LIMIT }) => {
  try {
    const whereClause = { tenantId, isDeleted: false };

    if (find) {
      const searchTerm = `%${find.toLowerCase()}%`;
      whereClause[Op.or] = [
        { name: { [Op.like]: searchTerm } },
        { code: { [Op.like]: searchTerm } },
      ];
    }

    const { rows, count } = await Warehouse.findAndCountAll({
      where: whereClause,
      order: [["name", "ASC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    return {
      success: true,
      status: 200,
      message: "Fetch warehouses successful",
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
    logger.error("Error fetching warehouses", { error: error.message });
    throw error;
  }
};

exports.fetchSpecificWarehouse = async (tenantId, warehouseId) => {
  try {
    const warehouse = await Warehouse.findOne({
      where: { id: warehouseId, tenantId, isDeleted: false },
      include: [
        {
          model: StorageLocation,
          as: "locations",
          required: false,
        },
      ],
    });

    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    return {
      success: true,
      status: 200,
      message: "Fetch warehouse successful",
      data: warehouse,
    };
  } catch (error) {
    logger.error("Error fetching specific warehouse", { error: error.message });
    throw error;
  }
};

exports.createWarehouse = async (tenantId, input) => {
  const data = validate(input, createWarehouseSchema);
  const transaction = await db.transaction();

  try {
    const existing = await Warehouse.findOne({
      where: { tenantId, code: data.code, isDeleted: false },
      transaction,
    });

    if (existing) {
      throw new AppError(409, "Warehouse code already exists");
    }

    const warehouse = await Warehouse.create(
      {
        tenantId,
        name: data.name,
        code: data.code,
        address: data.address || null,
        description: data.description || null,
        status: data.status || "active",
      },
      { transaction },
    );

    await transaction.commit();
    logger.info("Warehouse created", { warehouseId: warehouse.id, tenantId });

    return {
      success: true,
      status: 201,
      message: "Warehouse created successfully",
      data: warehouse,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error creating warehouse", { error: error.message });
    throw error;
  }
};

exports.updateWarehouse = async (tenantId, warehouseId, input) => {
  const data = validate(input, updateWarehouseSchema);
  const transaction = await db.transaction();

  try {
    const warehouse = await Warehouse.findOne({
      where: { id: warehouseId, tenantId, isDeleted: false },
      transaction,
    });

    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    if (data.code) {
      const existing = await Warehouse.findOne({
        where: {
          tenantId,
          code: data.code,
          id: { [Op.ne]: warehouseId },
          isDeleted: false,
        },
        transaction,
      });

      if (existing) {
        throw new AppError(409, "Warehouse code already exists");
      }
    }

    await warehouse.update(
      {
        name: data.name || warehouse.name,
        code: data.code || warehouse.code,
        address: data.address !== undefined ? data.address : warehouse.address,
        description: data.description !== undefined ? data.description : warehouse.description,
        status: data.status || warehouse.status,
      },
      { transaction },
    );

    await transaction.commit();
    logger.info("Warehouse updated", { warehouseId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Warehouse updated successfully",
      data: warehouse,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating warehouse", { error: error.message });
    throw error;
  }
};

exports.deleteWarehouse = async (tenantId, warehouseId) => {
  const transaction = await db.transaction();

  try {
    const warehouse = await Warehouse.findOne({
      where: { id: warehouseId, tenantId, isDeleted: false },
      transaction,
    });

    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    // Check if warehouse has active stocks
    const stockCount = await Stock.count({
      where: { warehouseId, tenantId, isDeleted: false },
      transaction,
    });

    if (stockCount > 0) {
      throw new AppError(400, `Cannot delete warehouse with ${stockCount} items in stock`);
    }

    await warehouse.softDelete();
    await transaction.commit();
    logger.info("Warehouse deleted", { warehouseId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Warehouse deleted successfully",
      data: null,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error deleting warehouse", { error: error.message });
    throw error;
  }
};

// ==========================================
// STORAGE LOCATION METHODS
// ==========================================

exports.fetchLocations = async (tenantId, warehouseId) => {
  try {
    // Verify warehouse exists for this tenant
    const warehouse = await Warehouse.findOne({
      where: { id: warehouseId, tenantId, isDeleted: false },
    });

    if (!warehouse) {
      throw new AppError(404, "Warehouse not found");
    }

    const locations = await StorageLocation.findAll({
      where: { warehouseId, tenantId },
      order: [["name", "ASC"]],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch storage locations successful",
      data: locations,
    };
  } catch (error) {
    logger.error("Error fetching locations", { error: error.message });
    throw error;
  }
};

exports.createLocation = async (tenantId, input) => {
  const data = validate(input, createLocationSchema);
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

    const existing = await StorageLocation.findOne({
      where: { warehouseId: data.warehouseId, code: data.code, tenantId },
      transaction,
    });

    if (existing) {
      throw new AppError(409, "Storage location code already exists in this warehouse");
    }

    const location = await StorageLocation.create(
      {
        tenantId,
        warehouseId: data.warehouseId,
        name: data.name,
        code: data.code,
        description: data.description || null,
        isActive: data.isActive !== undefined ? data.isActive : true,
      },
      { transaction },
    );

    await transaction.commit();
    logger.info("Storage location created", { locationId: location.id, warehouseId: data.warehouseId });

    return {
      success: true,
      status: 201,
      message: "Storage location created successfully",
      data: location,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error creating location", { error: error.message });
    throw error;
  }
};

exports.updateLocation = async (tenantId, locationId, input) => {
  const data = validate(input, updateLocationSchema);
  const transaction = await db.transaction();

  try {
    const location = await StorageLocation.findOne({
      where: { id: locationId, tenantId },
      transaction,
    });

    if (!location) {
      throw new AppError(404, "Storage location not found");
    }

    if (data.code) {
      const existing = await StorageLocation.findOne({
        where: {
          warehouseId: location.warehouseId,
          code: data.code,
          id: { [Op.ne]: locationId },
          tenantId,
        },
        transaction,
      });

      if (existing) {
        throw new AppError(409, "Storage location code already exists in this warehouse");
      }
    }

    await location.update(
      {
        name: data.name || location.name,
        code: data.code || location.code,
        description: data.description !== undefined ? data.description : location.description,
        isActive: data.isActive !== undefined ? data.isActive : location.isActive,
      },
      { transaction },
    );

    await transaction.commit();
    logger.info("Storage location updated", { locationId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Storage location updated successfully",
      data: location,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating location", { error: error.message });
    throw error;
  }
};

exports.deleteLocation = async (tenantId, locationId) => {
  const transaction = await db.transaction();

  try {
    const location = await StorageLocation.findOne({
      where: { id: locationId, tenantId },
      transaction,
    });

    if (!location) {
      throw new AppError(404, "Storage location not found");
    }

    // Check if location has active stocks
    const stockCount = await Stock.count({
      where: { locationId, tenantId, isDeleted: false },
      transaction,
    });

    if (stockCount > 0) {
      throw new AppError(400, `Cannot delete storage location with ${stockCount} items in stock`);
    }

    await location.destroy({ transaction });
    await transaction.commit();
    logger.info("Storage location deleted", { locationId, tenantId });

    return {
      success: true,
      status: 200,
      message: "Storage location deleted successfully",
      data: null,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error deleting location", { error: error.message });
    throw error;
  }
};
