/**
 * Calibration Device service methods
 */
const { Op } = require("sequelize");
const { CalibrationDevice } = require("../models");
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
exports.createCalibrationDevice = async (tenantId, inputData) => {
  try {
    const validated = validate(
      inputData,
      require("../validators/calibrationDevices.validator")
        .createCalibrationDeviceSchema,
    );

    // Check for duplicate serial number (only when one is supplied — a null
    // serialNumber must not be used as a WHERE parameter).
    const existing = validated.serialNumber
      ? await CalibrationDevice.findOne({
          where: {
            tenantId,
            serialNumber: validated.serialNumber,
          },
        })
      : null;

    if (existing) {
      return {
        success: false,
        status: 409,
        message: "Calibration device with this serial number already exists",
        data: null,
      };
    }

    const device = await CalibrationDevice.create({
      ...validated,
      tenantId,
    });

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

    await device.update(validated);

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
exports.deleteCalibrationDevice = async (tenantId, calibrationDeviceId) => {
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

    await device.softDelete();

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
exports.bulkImportCalibrationDevices = async (tenantId, csvFilePath) => {
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

    const existingDevices = await CalibrationDevice.findAll({
      where: { tenantId },
      attributes: ["serialNumber"],
    });
    const existingSerialNumbers = new Set(
      existingDevices.map((d) => d.serialNumber).filter(Boolean),
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
                message: `Duplicate serial number: ${sn}`,
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
      await CalibrationDevice.bulkCreate(toInsert);
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
