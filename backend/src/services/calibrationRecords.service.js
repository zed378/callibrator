/**
 * Calibration Record service methods
 */
const { Op } = require("sequelize");
const { CalibrationRecord, CalibrationDevice } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT } = require("../constants");

// ==========================================
// VALIDATION HELPERS
// ==========================================

const validate = (data, schema) => {
  const { error, value } = schema.validate(data, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    throw {
      status: 400,
      message: "Validation failed",
      errors: error.details.map((d) => ({
        field: d.path.join("."),
        message: d.message,
      })),
    };
  }
  return value;
};

// ==========================================
// SERVICE METHODS
// ==========================================

/**
 * Fetch all calibration records for a tenant with pagination and filtering
 */
exports.fetchCalibrationRecords = async ({
  tenantId,
  page = 1,
  limit = DEFAULT_LIMIT,
  deviceId,
  isCompliant,
  from,
  to,
}) => {
  try {
    const whereClause = { tenantId };

    if (deviceId) {
      whereClause.deviceId = deviceId;
    }

    if (isCompliant !== null && isCompliant !== undefined) {
      whereClause.isCompliant = isCompliant;
    }

    if (from || to) {
      whereClause.calibrationDate = {};
      if (from) {whereClause.calibrationDate[Op.gte] = from;}
      if (to) {whereClause.calibrationDate[Op.lte] = to;}
    }

    const { rows, count } = await CalibrationRecord.findAndCountAll({
      where: whereClause,
      order: [["calibrationDate", "DESC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
      include: [
        {
          association: "device",
          attributes: ["id", "name", "serialNumber", "manufacturer", "model"],
        },
        {
          association: "performer",
          attributes: ["id", "firstName", "lastName"],
        },
      ],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch calibration records successful",
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
    logger.error("Error fetching calibration records", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Fetch a specific calibration record by ID
 */
exports.fetchSpecificCalibrationRecord = async (
  tenantId,
  calibrationRecordId,
) => {
  try {
    const record = await CalibrationRecord.findOne({
      where: { id: calibrationRecordId, tenantId },
      include: [
        {
          association: "device",
          attributes: [
            "id",
            "name",
            "serialNumber",
            "manufacturer",
            "model",
            "category",
          ],
        },
        {
          association: "performer",
          attributes: ["id", "firstName", "lastName", "email"],
        },
      ],
    });

    if (!record) {
      return {
        success: false,
        status: 404,
        message: "Calibration record not found",
        data: null,
      };
    }

    return {
      success: true,
      status: 200,
      message: "Fetch calibration record successful",
      data: record,
    };
  } catch (error) {
    logger.error("Error fetching specific calibration record", {
      error: error.message,
      calibrationRecordId,
    });
    throw error;
  }
};

/**
 * Create a new calibration record
 */
exports.createCalibrationRecord = async (tenantId, userId, inputData) => {
  try {
    const validated = validate(
      inputData,
      require("../validators/calibrationRecords.validator")
        .createCalibrationRecordSchema,
    );

    // Verify device belongs to tenant
    const device = await CalibrationDevice.findOne({
      where: { id: validated.deviceId, tenantId },
    });

    if (!device) {
      return {
        success: false,
        status: 404,
        message: "Device not found or not belonging to this tenant",
        data: null,
      };
    }

    const record = await CalibrationRecord.create({
      ...validated,
      tenantId,
      performedBy: userId,
    });

    // Update the device's nextCalibrationDate based on the record
    if (validated.calibrationDate && device.calibrationIntervalDays) {
      const nextDate = new Date(validated.calibrationDate);
      nextDate.setDate(nextDate.getDate() + device.calibrationIntervalDays);
      await device.update({ nextCalibrationDate: nextDate });
    }

    return {
      success: true,
      status: 201,
      message: "Calibration record created successfully",
      data: record,
    };
  } catch (error) {
    logger.error("Error creating calibration record", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Update an existing calibration record
 */
exports.updateCalibrationRecord = async (
  tenantId,
  calibrationRecordId,
  inputData,
) => {
  try {
    const validated = validate(
      inputData,
      require("../validators/calibrationRecords.validator")
        .updateCalibrationRecordSchema,
    );

    const record = await CalibrationRecord.findOne({
      where: { id: calibrationRecordId, tenantId },
    });

    if (!record) {
      return {
        success: false,
        status: 404,
        message: "Calibration record not found",
        data: null,
      };
    }

    await record.update(validated);

    return {
      success: true,
      status: 200,
      message: "Calibration record updated successfully",
      data: record,
    };
  } catch (error) {
    logger.error("Error updating calibration record", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Soft-delete a calibration record
 */
exports.deleteCalibrationRecord = async (tenantId, calibrationRecordId) => {
  try {
    const record = await CalibrationRecord.findOne({
      where: { id: calibrationRecordId, tenantId },
    });

    if (!record) {
      return {
        success: false,
        status: 404,
        message: "Calibration record not found",
        data: null,
      };
    }

    await record.softDelete();

    return {
      success: true,
      status: 200,
      message: "Calibration record deleted successfully",
      data: null,
    };
  } catch (error) {
    logger.error("Error deleting calibration record", {
      error: error.message,
    });
    throw error;
  }
};
