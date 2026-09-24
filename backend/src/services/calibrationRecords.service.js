/**
 * Calibration Record service methods
 */
const { Op, Transaction } = require("sequelize");
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
  includeSuperseded = false,
}) => {
  try {
    const whereClause = { tenantId };

    // P6-03: a corrected record stays, but the list shows the record in force
    // — the latest correction — unless the caller asks for the history too.
    if (!includeSuperseded) {
      whereClause.supersededById = null;
    }

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
        // LEFT JOINs (A-90): User and CalibrationDevice have a defaultScope
        // `where`, so an include without `required: false` is an INNER JOIN
        // that drops the RECORD when its device is soft-deleted or its
        // performer is deleted or outside the tenant (the super admin acting
        // inside a tenant). The relation reads as null instead.
        {
          association: "device",
          attributes: ["id", "name", "serialNumber", "manufacturer", "model"],
          required: false,
        },
        {
          association: "performer",
          attributes: ["id", "firstName", "lastName"],
          required: false,
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
          required: false, // A-90: a record outlives its device's soft delete
        },
        {
          association: "performer",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false, // A-90: nor does a missing performer hide the record
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

// ==========================================
// P6-03 — APPEND-ONLY: CORRECT AND VOID
// ==========================================
//
// A calibration record's content never changes after it is written (BR-7,
// 21 CFR 11.10(e)): the database trigger from migration 0057 refuses it for
// every role, and the application role has no UPDATE/DELETE on the table
// except the lifecycle columns. The two operations that replace PUT and
// DELETE therefore only ever INSERT a row or set a lifecycle column once:
//
//   correct — a NEW row carrying the corrected content, `supersedesId` and a
//             reason; the original gains `supersededById`/`supersededAt`.
//             Both rows stay, and the audit trail shows both.
//   void    — `isDeleted`, `voidReason`, `voidedBy` set once.
//             Final: there is no restore.

/** The content columns a correction may carry; everything else is lifecycle. */
const CONTENT_FIELDS = Object.freeze([
  "deviceId",
  "calibrationDate",
  "dueDate",
  "standard",
  "results",
  "measurementUncertainty",
  "isCompliant",
  "certificateNumber",
  "certificateFileUrl",
  "notes",
]);

/**
 * The record `id` in the caller's tenant, locked for the transaction, INCLUDING
 * a voided one (so a void can be explained as a 409 rather than reported as
 * missing). Another tenant's record is not found: 404, never 403.
 */
const lockRecord = (tenantId, calibrationRecordId, transaction) =>
  CalibrationRecord.unscoped().findOne({
    where: { id: calibrationRecordId, tenantId },
    paranoid: false,
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

const notFound = () => ({
  success: false,
  status: 404,
  message: "Calibration record not found",
  data: null,
});

/**
 * @param {object} record - a locked calibration record
 * @param {"correct"|"void"} operation
 * @returns {object|null} the 409 explaining why `operation` is refused, or null
 */
const lifecycleConflict = (record, operation) => {
  if (record.isDeleted) {
    return {
      success: false,
      status: 409,
      message:
        `This calibration record was voided${record.voidReason ? ` ("${record.voidReason}")` : ""} and ` +
        `cannot be ${operation === "correct" ? "corrected" : "voided again"}: a void is final.`,
      data: null,
    };
  }
  if (record.supersededById) {
    return {
      success: false,
      status: 409,
      message:
        `This calibration record was already corrected by record ${record.supersededById}. ` +
        `${operation === "correct" ? "Correct" : "Void"} the latest correction instead — a record is ` +
        "superseded at most once, so the correction history stays a single line.",
      data: null,
    };
  }
  return null;
};

/**
 * Correct a calibration record: write a new record that supersedes it.
 *
 * @param {string} tenantId
 * @param {string} userId - who is writing the correction (audit actor)
 * @param {string} calibrationRecordId - the record being corrected
 * @param {object} inputData - corrected content fields plus a required `reason`
 * @param {object} [actor] - ipAddress / userAgent for the audit rows
 * @returns {Promise<object>} service result: 201 with the NEW record, 404, or 409
 */
exports.correctCalibrationRecord = async (
  tenantId,
  userId,
  calibrationRecordId,
  inputData,
  actor = {},
) => {
  try {
    const { reason, ...changes } = validate(
      inputData,
      require("../validators/calibrationRecords.validator")
        .correctCalibrationRecordSchema,
    );

    if (changes.deviceId) {
      const device = await CalibrationDevice.findOne({
        where: { id: changes.deviceId, tenantId },
      });
      if (!device) {
        return {
          success: false,
          status: 404,
          message: "Device not found or not belonging to this tenant",
          data: null,
        };
      }
    }

    const outcome = await db.transaction(async (transaction) => {
      const original = await lockRecord(tenantId, calibrationRecordId, transaction);
      if (!original) {
        return notFound();
      }
      const conflict = lifecycleConflict(original, "correct");
      if (conflict) {
        return conflict;
      }

      const content = Object.fromEntries(
        CONTENT_FIELDS.map((field) => [
          field,
          Object.hasOwn(changes, field) ? changes[field] : original[field],
        ]),
      );
      const correction = await CalibrationRecord.create(
        {
          ...content,
          tenantId,
          // Who PERFORMED the calibration does not change because someone
          // corrected its record; who corrected it is the audit row's actor.
          performedBy: original.performedBy,
          supersedesId: original.id,
          correctionReason: reason,
        },
        { transaction },
      );
      const supersededAt = new Date();
      await original.update(
        { supersededById: correction.id, supersededAt },
        { transaction },
      );

      const actorWithUser = { ...actor, userId };
      await auditRecord(transaction, tenantId, correction.id, "CREATE", {}, {
        ...content,
        supersedesId: original.id,
        correctionReason: reason,
      }, actorWithUser);
      await auditRecord(
        transaction,
        tenantId,
        original.id,
        "UPDATE",
        { supersededById: null },
        { supersededById: correction.id, supersededAt, correctionReason: reason, changed: Object.keys(changes) },
        actorWithUser,
      );

      return {
        success: true,
        status: 201,
        message: "Calibration record corrected: a superseding record was written and the original kept",
        data: correction,
      };
    });

    return outcome;
  } catch (error) {
    logger.error("Error correcting calibration record", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Void a calibration record entered in error. Final — there is no restore.
 *
 * @param {string} tenantId
 * @param {string} userId - who voids it
 * @param {string} calibrationRecordId
 * @param {object} inputData - `{ reason }`, required
 * @param {object} [actor] - ipAddress / userAgent for the audit row
 * @returns {Promise<object>} service result: 200, 404, or 409
 */
exports.voidCalibrationRecord = async (
  tenantId,
  userId,
  calibrationRecordId,
  inputData,
  actor = {},
) => {
  try {
    const { reason } = validate(
      inputData,
      require("../validators/calibrationRecords.validator")
        .voidCalibrationRecordSchema,
    );

    return await db.transaction(async (transaction) => {
      const record = await lockRecord(tenantId, calibrationRecordId, transaction);
      if (!record) {
        return notFound();
      }
      const conflict = lifecycleConflict(record, "void");
      if (conflict) {
        return conflict;
      }

      // `deletedAt` is not written: Sequelize treats the paranoid timestamp as
      // read-only on update and would drop it silently. `isDeleted` is what
      // every read filters on (the defaultScope), as it was for soft deletes.
      const voided = { isDeleted: true, voidReason: reason, voidedBy: userId };
      await record.update(voided, { transaction });
      await auditRecord(
        transaction,
        tenantId,
        record.id,
        "DELETE",
        { isDeleted: false },
        voided,
        { ...actor, userId },
      );

      return {
        success: true,
        status: 200,
        message: "Calibration record voided. The record is kept; a void is final.",
        data: null,
      };
    });
  } catch (error) {
    logger.error("Error voiding calibration record", {
      error: error.message,
    });
    throw error;
  }
};
