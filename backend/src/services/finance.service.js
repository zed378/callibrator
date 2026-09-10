/**
 * Finance & Asset Depreciation Service
 *
 * Financial records for calibration devices (purchase cost, useful life,
 * salvage value) plus depreciation math and a capex/book-value report.
 *
 * Depreciation methods:
 * - straight_line:      annual = (price - salvage) / usefulLifeYears
 * - declining_balance:  double-declining rate = 2 / usefulLifeYears applied
 *                       to opening book value each year, floored at salvage.
 *
 * Elapsed time uses fractional years (days / 365.25) so mid-year reporting
 * dates produce proportional figures.
 */

const { Op } = require("sequelize");
const { AssetFinance, CalibrationDevice, Vendor } = require("../models");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Fractional years elapsed between two dates (never negative).
 */
const yearsBetween = (from, to) => {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, ms / YEAR_MS);
};

/**
 * Compute depreciation figures for one financial record as of a date.
 * Pure function — exported for tests and the report.
 *
 * @returns {{ ageYears, annualDepreciation, accumulatedDepreciation,
 *             bookValue, fullyDepreciated }}
 */
const computeDepreciation = (record, asOf = new Date()) => {
  const price = Number(record.purchasePrice) || 0;
  const salvage = Math.min(Number(record.salvageValue) || 0, price);
  const life = Math.max(1, Number(record.usefulLifeYears) || 1);
  const age = yearsBetween(record.purchaseDate, asOf);
  const depreciableBase = price - salvage;

  let accumulated;
  let annual;

  if (record.depreciationMethod === "declining_balance") {
    // Double-declining balance, floored at salvage value.
    const rate = Math.min(1, 2 / life);
    const bookValueRaw = price * Math.pow(1 - rate, age);
    const bookValue = Math.max(salvage, bookValueRaw);
    accumulated = price - bookValue;
    // "Annual" reported as the current-year charge (opening book × rate)
    annual = Math.max(0, bookValue > salvage ? bookValue * rate : 0);
  } else {
    // straight_line (default)
    annual = depreciableBase / life;
    accumulated = Math.min(depreciableBase, annual * age);
  }

  const bookValue = price - accumulated;
  return {
    ageYears: round2(age),
    annualDepreciation: round2(annual),
    accumulatedDepreciation: round2(accumulated),
    bookValue: round2(bookValue),
    fullyDepreciated: age >= life || bookValue <= salvage + 0.005,
  };
};

const includeRelations = [
  {
    model: CalibrationDevice,
    as: "device",
    attributes: ["id", "name", "serialNumber", "category", "status"],
    required: false,
    paranoid: false,
  },
  {
    model: Vendor,
    as: "vendor",
    attributes: ["id", "name"],
    required: false,
    paranoid: false,
  },
];

// ------------------------------------------------------------------
// LIST
// ------------------------------------------------------------------
exports.fetchAssetFinances = async ({
  tenantId,
  page = 1,
  limit = DEFAULT_LIMIT,
  deviceId,
  method,
}) => {
  const whereClause = { tenantId };
  if (deviceId) {
    whereClause.deviceId = deviceId;
  }
  if (method) {
    whereClause.depreciationMethod = method;
  }

  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = (Number(page) - 1) * safeLimit;

  const { count, rows } = await AssetFinance.findAndCountAll({
    where: whereClause,
    limit: safeLimit,
    offset,
    order: [["purchaseDate", "DESC"]],
    include: includeRelations,
  });

  return {
    success: true,
    status: 200,
    message: "Fetch asset finance records successful",
    data: {
      rows: rows.map((row) => ({
        ...row.toJSON(),
        depreciation: computeDepreciation(row),
      })),
      count,
      meta: {
        total: count,
        page: Number(page),
        limit: safeLimit,
        totalPages: Math.ceil(count / safeLimit),
      },
    },
  };
};

// ------------------------------------------------------------------
// DETAIL
// ------------------------------------------------------------------
exports.getAssetFinanceById = async (tenantId, financeId) => {
  const record = await AssetFinance.findOne({
    where: { id: financeId, tenantId },
    include: includeRelations,
  });
  if (!record) {
    throw new AppError(404, "Asset finance record not found");
  }
  return {
    success: true,
    status: 200,
    message: "Asset finance record retrieved successfully",
    data: { ...record.toJSON(), depreciation: computeDepreciation(record) },
  };
};

// ------------------------------------------------------------------
// CREATE
// ------------------------------------------------------------------
exports.createAssetFinance = async (tenantId, data) => {
  const device = await CalibrationDevice.findOne({
    where: { id: data.deviceId, tenantId },
  });
  if (!device) {
    throw new AppError(404, "Calibration device not found");
  }

  const existing = await AssetFinance.findOne({
    where: { deviceId: data.deviceId },
    paranoid: false,
  });
  if (existing && !existing.deletedAt) {
    throw new AppError(
      409,
      "A finance record already exists for this device — update it instead",
    );
  }
  if (existing && existing.deletedAt) {
    // Revive the soft-deleted record with the new figures.
    await existing.restore();
    await existing.update({ ...data, tenantId });
    return {
      success: true,
      status: 201,
      message: "Asset finance record created successfully",
      data: {
        ...existing.toJSON(),
        depreciation: computeDepreciation(existing),
      },
    };
  }

  const record = await AssetFinance.create({ ...data, tenantId });
  return {
    success: true,
    status: 201,
    message: "Asset finance record created successfully",
    data: { ...record.toJSON(), depreciation: computeDepreciation(record) },
  };
};

// ------------------------------------------------------------------
// UPDATE
// ------------------------------------------------------------------
exports.updateAssetFinance = async (tenantId, financeId, data) => {
  const record = await AssetFinance.findOne({
    where: { id: financeId, tenantId },
  });
  if (!record) {
    throw new AppError(404, "Asset finance record not found");
  }
  await record.update(data);
  return {
    success: true,
    status: 200,
    message: "Asset finance record updated successfully",
    data: { ...record.toJSON(), depreciation: computeDepreciation(record) },
  };
};

// ------------------------------------------------------------------
// DELETE (soft)
// ------------------------------------------------------------------
exports.deleteAssetFinance = async (tenantId, financeId) => {
  const record = await AssetFinance.findOne({
    where: { id: financeId, tenantId },
  });
  if (!record) {
    throw new AppError(404, "Asset finance record not found");
  }
  await record.destroy();
  return {
    success: true,
    status: 200,
    message: "Asset finance record deleted successfully",
    data: null,
  };
};

// ------------------------------------------------------------------
// DEPRECIATION REPORT
// ------------------------------------------------------------------
exports.getDepreciationReport = async (tenantId, { asOf } = {}) => {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(asOfDate.getTime())) {
    throw new AppError(400, "Invalid asOf date");
  }

  const records = await AssetFinance.findAll({
    where: { tenantId, purchaseDate: { [Op.lte]: asOfDate } },
    include: includeRelations,
    order: [["purchaseDate", "ASC"]],
  });

  const rows = records.map((record) => {
    const dep = computeDepreciation(record, asOfDate);
    return {
      financeId: record.id,
      deviceId: record.deviceId,
      deviceName: record.device?.name || "Unknown device",
      serialNumber: record.device?.serialNumber || null,
      purchaseDate: record.purchaseDate,
      purchasePrice: round2(Number(record.purchasePrice)),
      salvageValue: round2(Number(record.salvageValue)),
      usefulLifeYears: record.usefulLifeYears,
      method: record.depreciationMethod,
      ...dep,
    };
  });

  const totals = rows.reduce(
    (acc, row) => {
      acc.totalPurchase = round2(acc.totalPurchase + row.purchasePrice);
      acc.totalAccumulatedDepreciation = round2(
        acc.totalAccumulatedDepreciation + row.accumulatedDepreciation,
      );
      acc.totalBookValue = round2(acc.totalBookValue + row.bookValue);
      if (row.fullyDepreciated) {
        acc.fullyDepreciatedCount += 1;
      }
      return acc;
    },
    {
      totalPurchase: 0,
      totalAccumulatedDepreciation: 0,
      totalBookValue: 0,
      fullyDepreciatedCount: 0,
    },
  );

  // CSV scaffold (stripped from JSON responses by the controller, used for
  // ?format=csv — mirrors reporting.service conventions)
  const csvHeader =
    "Device,Serial Number,Purchase Date,Purchase Price,Salvage,Life (yrs),Method,Age (yrs),Annual Depreciation,Accumulated,Book Value,Fully Depreciated";
  const csvRows = rows.map((r) =>
    [
      // deviceName is built above as `record.device?.name || "Unknown device"`,
      // so it is never falsy here; the `|| ""` is an unreachable defensive guard.
      `"${(/* istanbul ignore next */ r.deviceName || "").replace(/"/g, '""')}"`,
      r.serialNumber || "",
      r.purchaseDate,
      r.purchasePrice,
      r.salvageValue,
      r.usefulLifeYears,
      r.method,
      r.ageYears,
      r.annualDepreciation,
      r.accumulatedDepreciation,
      r.bookValue,
      r.fullyDepreciated ? "yes" : "no",
    ].join(","),
  );

  return {
    success: true,
    status: 200,
    message: "Depreciation report generated successfully",
    data: {
      asOf: asOfDate.toISOString(),
      totals,
      count: rows.length,
      rows,
      csv: [csvHeader, ...csvRows].join("\n"),
    },
  };
};

exports.computeDepreciation = computeDepreciation;
