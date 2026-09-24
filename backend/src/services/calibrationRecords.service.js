/**
 * Calibration Record service methods
 */
const { Op } = require("sequelize");
const { CalibrationRecord, CalibrationDevice } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT } = require("../constants");
const auditService = require("./audit.service");
const { db } = require("../config");

/**
 * A-41 — a calibration record is an ISO 17025 §7.5 technical record. Every
 * create/update/delete writes its audit row inside the SAME transaction as the
 * change (MEMORY/specs/A-41-audit-inside-transaction.md, rows 8-10): a
 * rollback takes the row with it, and a failed audit insert (re-thrown by
 * logAction) rolls the change back.
 */
const auditRecord = (transaction, tenantId, recordId, action, before, after, actor) =>
  auditService.logAction(
    {
      tenantId,
      userId: actor.userId,
      action,
      resourceType: "CalibrationRecord",
      resourceId: recordId,
      changes: { before, after },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    },
    { transaction },
  );

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
exports.createCalibrationRecord = async (tenantId, userId, inputData, actor = {}) => {
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

    const record = await db.transaction(async (transaction) => {
      const created = await CalibrationRecord.create(
        {
          ...validated,
          tenantId,
          performedBy: userId,
        },
        { transaction },
      );

      // Update the device's nextCalibrationDate based on the record — in the
      // same transaction, so the due date never moves for a record that
      // did not commit.
      if (validated.calibrationDate && device.calibrationIntervalDays) {
        const nextDate = new Date(validated.calibrationDate);
        nextDate.setDate(nextDate.getDate() + device.calibrationIntervalDays);
        await device.update({ nextCalibrationDate: nextDate }, { transaction });
      }

      await auditRecord(transaction, tenantId, created.id, "CREATE", {}, validated, {
        ...actor,
        userId,
      });
      return created;
    });

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
  actor = {},
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

    const before = Object.fromEntries(
      Object.keys(validated).map((key) => [key, record[key]]),
    );
    await db.transaction(async (transaction) => {
      await record.update(validated, { transaction });
      await auditRecord(transaction, tenantId, record.id, "UPDATE", before, validated, actor);
    });

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
exports.deleteCalibrationRecord = async (tenantId, calibrationRecordId, actor = {}) => {
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

    await db.transaction(async (transaction) => {
      await record.softDelete({ transaction });
      await auditRecord(
        transaction,
        tenantId,
        record.id,
        "DELETE",
        { isDeleted: false },
        { isDeleted: true },
        actor,
      );
    });

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
