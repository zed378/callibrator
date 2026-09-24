/**
 * Calibration Device service methods
 */
const { Op } = require("sequelize");
const { CalibrationDevice } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT } = require("../constants");
const auditService = require("./audit.service");
const { db } = require("../config");

/**
 * A-133 — a device register entry is the anchor of every calibration record
 * and certificate (ISO 17025 §6.4.13). Create, update, delete and bulk import
 * write their audit row inside the SAME transaction as the change (the A-41
 * rule, MEMORY/specs/A-41-audit-inside-transaction.md): a rollback takes the
 * row with it, and a failed audit insert (re-thrown by logAction) rolls the
 * change back. The impersonator, when there is one, is added by logAction
 * from the request context (F-8).
 *
 * @param {object} transaction
 * @param {string} tenantId
 * @param {string|null} resourceId - null for a bulk import (many devices)
 * @param {"CREATE"|"UPDATE"|"DELETE"} action
 * @param {object} changes
 * @param {{userId?: string|null, ipAddress?: string|null, userAgent?: string|null}} actor
 */
const auditDevice = (transaction, tenantId, resourceId, action, changes, actor) =>
  auditService.logAction(
    {
      tenantId,
      userId: actor.userId || null,
      action,
      resourceType: "CalibrationDevice",
      resourceId,
      changes,
      ipAddress: actor.ipAddress || null,
      userAgent: actor.userAgent || null,
    },
    { transaction },
  );

/** The values of `device` for the keys in `changes` — the audit row's `before`. */
const beforeOf = (device, changes) =>
  Object.fromEntries(Object.keys(changes).map((key) => [key, device[key] ?? null]));

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
// SERIAL-NUMBER CONFLICTS (A-92, ADR-049)
// ==========================================
//
// `calibration_devices` carries UNIQUE (tenant_id, serial_number) — migration
// 0026. The index covers SOFT-DELETED rows (a soft delete only sets
// `isDeleted`), so a serial held by a deleted device is still taken. The model's
// defaultScope hides those rows, so a duplicate check through it missed them and
// the insert failed on the index with a 500.
//
// Decided behaviour: a serial held by a deleted device is a 409 that says so.
// It is NOT silently restored: a create that resurrected the old row would hand
// back an old id with that device's calibration history attached, overwrite its
// fields without an audit trail of the restore, and turn a "register" into a
// "restore" the caller never asked for. No code path restores a device
// (`restoreStatic` has no route), so the message does not promise one.
//
// The index is per tenant, so a violation is always in the caller's own tenant:
// answering it with a 409 discloses nothing about another tenant.

/** The composite unique index created by migration 0026. */
const SERIAL_UNIQUE_INDEX = "calibration_devices_tenant_id_serial_number_unique";

/**
 * An empty serial is "no serial". The validator allows "" (and trims "  " to
 * ""), and "" is not NULL — two serial-less devices stored as "" collided on the
 * unique index, where two NULLs never do.
 *
 * @param {object} validated - validated input; `serialNumber` is normalised in place
 */
const normaliseSerial = (validated) => {
  if (validated.serialNumber === "") {
    validated.serialNumber = null;
  }
};

/**
 * The device in `tenantId` holding `serialNumber`, deleted or not.
 * `unscoped()` drops the defaultScope's `isDeleted = false`; `paranoid: false`
 * sees a row destroyed rather than soft-deleted. Both matter because the unique
 * index covers every row. The tenant predicate is explicit, and the global
 * tenant hooks still apply (they are hooks, not a scope).
 *
 * @param {string} tenantId
 * @param {string} serialNumber
 * @returns {Promise<{id: string, isDeleted: boolean, deletedAt?: Date}|null>}
 */
const findSerialHolder = (tenantId, serialNumber) =>
  CalibrationDevice.unscoped().findOne({
    where: { tenantId, serialNumber },
    attributes: ["id", "isDeleted", "deletedAt"],
    paranoid: false,
  });

/**
 * The 409 for a serial number already held in the tenant, explaining which
 * kind of device holds it and what the caller can do.
 *
 * @param {string} serialNumber
 * @param {{isDeleted?: boolean, deletedAt?: Date}|null} holder - null when unknown (a lost race)
 * @returns {{success: false, status: 409, message: string, data: null}}
 */
const serialConflict = (serialNumber, holder) => {
  let message;
  if (holder && (holder.isDeleted || holder.deletedAt)) {
    message =
      `Serial number "${serialNumber}" is held by a deleted calibration device in this organisation. ` +
      "A serial number stays reserved after its device is deleted, so the deleted device's " +
      "calibration history stays attributable to it. Ask an administrator to restore that device " +
      "(restoring is not available in the application), or register this device with a different serial number.";
  } else {
    message =
      `A calibration device with serial number "${serialNumber}" already exists in this organisation. ` +
      "Serial numbers are unique per organisation — edit that device, or use a different serial number.";
  }
  return { success: false, status: 409, message, data: null };
};

/**
 * Whether `error` is a violation of the per-tenant serial unique index — the
 * backstop when a concurrent request registered the same serial between the
 * check and the write. Any other unique violation (`iot_device_token` is
 * GLOBALLY unique) is not claimed here and propagates unchanged.
 *
 * @param {Error & {name?: string, parent?: {constraint?: string}, fields?: object}} error
 * @returns {boolean}
 */
const isSerialUniqueViolation = (error) =>
  error.name === "SequelizeUniqueConstraintError" &&
  (error.parent?.constraint === SERIAL_UNIQUE_INDEX ||
    // UniqueConstraintError always carries `fields` (`{}` when none were parsed)
    Object.hasOwn(error.fields, "serial_number"));

// ==========================================
// SERVICE METHODS
// ==========================================

/**
 * Fetch all calibration devices for a tenant with pagination and filtering
 */
exports.fetchCalibrationDevices = async ({
  tenantId,
  find,
  page = 1,
  limit = DEFAULT_LIMIT,
  status,
  category,
}) => {
  try {
    const whereClause = { tenantId };

    if (find) {
      const searchTerm = `%${find.toLowerCase()}%`;
      whereClause[Op.or] = [
        { name: { [Op.iLike]: searchTerm } },
        { serialNumber: { [Op.iLike]: searchTerm } },
        { manufacturer: { [Op.iLike]: searchTerm } },
      ];
    }

    if (status) {
      whereClause.status = status.toLowerCase();
    }

    if (category) {
      whereClause.category = category;
    }

    const { rows, count } = await CalibrationDevice.findAndCountAll({
      where: whereClause,
      order: [["name", "ASC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
      include: [
        {
          association: "warehouse",
          attributes: ["id", "name", "code"],
          // LEFT JOIN (A-90) — a device may have no warehouse. Warehouse has a
          // defaultScope `where`, so without this the list dropped every such
          // device, and every device whose warehouse was soft-deleted.
          required: false,
        },
      ],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch calibration devices successful",
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
    logger.error("Error fetching calibration devices", {
      error: error.message,
    });
    throw error;
  }
};

/**
 * Fetch a specific calibration device by ID
 */
exports.fetchSpecificCalibrationDevice = async (
  tenantId,
  calibrationDeviceId,
) => {
  try {
    const device = await CalibrationDevice.findOne({
      where: { id: calibrationDeviceId, tenantId },
      include: [
        {
          association: "warehouse",
          attributes: ["id", "name", "code"],
          required: false, // LEFT JOIN — a device may have no warehouse
        },
        {
          association: "calibrationRecords",
          separate: true, // avoid a limit-in-join that can drop the parent row
          order: [["calibrationDate", "DESC"]],
          limit: 10,
          attributes: { exclude: ["results"] },
        },
      ],
    });

    if (!device) {
      return {
        success: false,
        status: 404,
        message: "Calibration device not found",
        data: null,
      };
    }

    return {
      success: true,
      status: 200,
      message: "Fetch calibration device successful",
      data: device,
    };
  } catch (error) {
    logger.error("Error fetching specific calibration device", {
      error: error.message,
      calibrationDeviceId,
    });
    throw error;
  }
};

/**
 * Create a new calibration device
 */
exports.createCalibrationDevice = async (tenantId, inputData, actor = {}) => {
  try {
    const validated = validate(
      inputData,
      require("../validators/calibrationDevices.validator")
        .createCalibrationDeviceSchema,
    );

    normaliseSerial(validated);

    // Check for a duplicate serial number (only when one is supplied — a null
    // serialNumber must not be used as a WHERE parameter). Deleted devices
    // count: the unique index covers them (A-92).
    const holder = validated.serialNumber
      ? await findSerialHolder(tenantId, validated.serialNumber)
      : null;

    if (holder) {
      return serialConflict(validated.serialNumber, holder);
    }

    let device;
    try {
      device = await db.transaction(async (transaction) => {
        const created = await CalibrationDevice.create(
          { ...validated, tenantId },
          { transaction },
        );
        await auditDevice(transaction, tenantId, created.id, "CREATE", { before: {}, after: validated }, actor);
        return created;
      });
    } catch (error) {
      // A concurrent request registered the serial after the check above.
      if (isSerialUniqueViolation(error)) {
        return serialConflict(
          validated.serialNumber,
          await findSerialHolder(tenantId, validated.serialNumber),
        );
      }
      throw error;
    }

    return {
      success: true,
      status: 201,
      message: "Calibration device created successfully",
      data: device,
    };
  } catch (error) {
    logger.error("Error creating calibration device", { error: error.message });
    throw error;
  }
};

/**
 * Update an existing calibration device
 */
exports.updateCalibrationDevice = async (
  tenantId,
  calibrationDeviceId,
  inputData,
  actor = {},
) => {
  try {
    const validated = validate(
      inputData,
      require("../validators/calibrationDevices.validator")
        .updateCalibrationDeviceSchema,
    );

    const device = await CalibrationDevice.findOne({
      where: { id: calibrationDeviceId, tenantId },
    });

    if (!device) {
      return {
        success: false,
        status: 404,
        message: "Calibration device not found",
        data: null,
      };
    }

    normaliseSerial(validated);

    // A serial another device of the tenant holds — live or deleted — is a
    // 409, not a 500 from the unique index (A-92). Keeping the device's own
    // serial is not a conflict.
    const changesSerial =
      validated.serialNumber && validated.serialNumber !== device.serialNumber;
    if (changesSerial) {
      const holder = await findSerialHolder(tenantId, validated.serialNumber);
      if (holder && holder.id !== device.id) {
        return serialConflict(validated.serialNumber, holder);
      }
    }

    try {
      const before = beforeOf(device, validated);
      await db.transaction(async (transaction) => {
        await device.update(validated, { transaction });
        await auditDevice(transaction, tenantId, device.id, "UPDATE", { before, after: validated }, actor);
      });
    } catch (error) {
      // A concurrent request took the serial after the check above.
      if (isSerialUniqueViolation(error)) {
        return serialConflict(
          validated.serialNumber,
          await findSerialHolder(tenantId, validated.serialNumber),
        );
      }
      throw error;
    }

    return {
      success: true,
      status: 200,
      message: "Calibration device updated successfully",
      data: device,
    };
  } catch (error) {
    logger.error("Error updating calibration device", { error: error.message });
    throw error;
  }
};

/**
 * Soft-delete a calibration device
 */
exports.deleteCalibrationDevice = async (tenantId, calibrationDeviceId, actor = {}) => {
  try {
    const device = await CalibrationDevice.findOne({
      where: { id: calibrationDeviceId, tenantId },
    });

    if (!device) {
      return {
        success: false,
        status: 404,
        message: "Calibration device not found",
        data: null,
      };
    }

    // softDelete() takes no options; it joins this transaction through
    // Sequelize CLS (config/index.js `useCLS`), as certificate.approve() does.
    await db.transaction(async (transaction) => {
      await device.softDelete();
      await auditDevice(
        transaction,
        tenantId,
        device.id,
        "DELETE",
        { before: { isDeleted: false }, after: { isDeleted: true } },
        actor,
      );
    });

    return {
      success: true,
      status: 200,
      message: "Calibration device deleted successfully",
      data: null,
    };
  } catch (error) {
    logger.error("Error deleting calibration device", { error: error.message });
    throw error;
  }
};

// ==========================================
// CSV PARSING HELPER
// ==========================================

const parseCSV = (filePath) => {
  const fs = require("fs");
  const content = fs.readFileSync(filePath, "utf8");
  const lines = [];
  let currentLine = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentLine.push(currentField.trim());
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }
      currentLine.push(currentField.trim());
      if (currentLine.length > 1 || (currentLine.length === 1 && currentLine[0] !== "")) {
        lines.push(currentLine);
      }
      currentField = "";
      currentLine = [];
    } else {
      currentField += char;
    }
  }

  if (currentField !== "" || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    if (currentLine.length > 1 || (currentLine.length === 1 && currentLine[0] !== "")) {
      lines.push(currentLine);
    }
  }
  return lines;
};

/**
 * Bulk import calibration devices from a CSV file
 */
exports.bulkImportCalibrationDevices = async (tenantId, csvFilePath, actor = {}) => {
  try {
    const parsedLines = parseCSV(csvFilePath);
    if (parsedLines.length < 2) {
      return {
        success: false,
        status: 400,
        message: "CSV file must contain a header row and at least one data row",
        data: {
          successCount: 0,
          failedCount: 0,
          totalCount: 0,
          errors: [{ row: 1, errors: "CSV is empty or missing headers" }],
        },
      };
    }

    const headers = parsedLines[0].map((h) => h.toLowerCase().trim());
    const dataRows = parsedLines.slice(1);

    // Every serial the tenant holds, DELETED devices included: the unique
    // index (tenant_id, serial_number) covers them, so a row re-using one
    // failed the whole bulkCreate with a 500 (A-92). Same lookup rules as
    // findSerialHolder: unscoped (no isDeleted filter), paranoid off, tenant
    // predicate explicit.
    const existingDevices = await CalibrationDevice.unscoped().findAll({
      where: { tenantId },
      attributes: ["serialNumber", "isDeleted", "deletedAt"],
      paranoid: false,
    });
    /** serial → true when only a deleted device holds it */
    const existingSerialNumbers = new Map(
      existingDevices
        .filter((d) => d.serialNumber)
        .map((d) => [d.serialNumber, Boolean(d.isDeleted || d.deletedAt)]),
    );

    const processedSerialNumbers = new Set();
    const toInsert = [];
    const errors = [];

    const headerMap = {
      "device name": "name",
      "name": "name",
      "manufacturer": "manufacturer",
      "model": "model",
      "serial number": "serialNumber",
      "serialnumber": "serialNumber",
      "status": "status",
      "next calibration": "nextCalibrationDate",
      "next calibration date": "nextCalibrationDate",
      "nextcalibrationdate": "nextCalibrationDate",
      "category": "category",
      "installation date": "installationDate",
      "installationdate": "installationDate",
      "calibration interval days": "calibrationIntervalDays",
      "calibrationintervaldays": "calibrationIntervalDays",
      "remarks": "remarks",
    };

    const schema = require("../validators/calibrationDevices.validator").createCalibrationDeviceSchema;

    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index];
      const rowNum = index + 2;

      const rowObj = {};
      for (let c = 0; c < headers.length; c++) {
        const fieldName = headerMap[headers[c]];
        if (fieldName && row[c] !== undefined) {
          if (fieldName === "calibrationIntervalDays") {
            const val = row[c] === "" ? null : Number(row[c]);
            rowObj[fieldName] = isNaN(val) ? row[c] : val;
          } else {
            rowObj[fieldName] = row[c] === "" ? null : row[c];
          }
        }
      }

      const isEmpty = Object.values(rowObj).every((v) => v === null || v === "");
      if (isEmpty) {
        continue;
      }

      const sn = rowObj.serialNumber ? String(rowObj.serialNumber).trim() : null;
      if (sn) {
        if (existingSerialNumbers.has(sn) || processedSerialNumbers.has(sn)) {
          errors.push({
            row: rowNum,
            errors: [
              {
                field: "serialNumber",
                message: existingSerialNumbers.get(sn)
                  ? `Duplicate serial number: ${sn} is held by a deleted device in this organisation. ` +
                    "Ask an administrator to restore it, or use a different serial number."
                  : `Duplicate serial number: ${sn}`,
              },
            ],
          });
          continue;
        }
        processedSerialNumbers.add(sn);
      }

      const { error, value } = schema.validate(rowObj, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        errors.push({
          row: rowNum,
          errors: error.details.map((d) => ({
            field: d.path.join("."),
            message: d.message,
          })),
        });
      } else {
        toInsert.push({
          ...value,
          tenantId,
        });
      }
    }

    if (toInsert.length > 0) {
      try {
        // One INSERT and ONE audit row summarising the import (counts and the
        // ids created), in one transaction: all of it, or none of it.
        await db.transaction(async (transaction) => {
          const created = await CalibrationDevice.bulkCreate(toInsert, { transaction });
          await auditDevice(
            transaction,
            tenantId,
            null,
            "CREATE",
            {
              operation: "bulk_import",
              after: {
                successCount: created.length,
                failedCount: errors.length,
                totalCount: created.length + errors.length,
                ids: created.map((d) => d.id),
              },
            },
            actor,
          );
        });
      } catch (error) {
        // A concurrent request registered one of these serials after the
        // lookup above. bulkCreate is one INSERT statement, so NOTHING was
        // written — say so, rather than a 500 or a partial count.
        if (isSerialUniqueViolation(error)) {
          return {
            success: false,
            status: 409,
            message:
              "Bulk import was not applied: a serial number in the file was registered in this " +
              "organisation while the import ran. No device was imported — upload the file again.",
            data: null,
          };
        }
        throw error;
      }
    }

    return {
      success: true,
      status: 200,
      message: `Bulk import completed: ${toInsert.length} succeeded, ${errors.length} failed.`,
      data: {
        successCount: toInsert.length,
        failedCount: errors.length,
        totalCount: toInsert.length + errors.length,
        errors,
      },
    };
  } catch (error) {
    logger.error("Error bulk importing calibration devices", {
      error: error.message,
    });
    throw error;
  }
};
