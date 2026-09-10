/**
 * Finance Controller
 *
 * Asset finance records + depreciation reporting for calibration devices.
 */

const financeService = require("../services/finance.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

/** GET /api/v1/finance */
exports.fetchAssetFinances = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const { page, limit, deviceId, method } = req.query;
  const result = await financeService.fetchAssetFinances({
    tenantId,
    page,
    limit,
    deviceId,
    method,
  });
  success(res, result.data.rows, result.data.meta, result.message, result.status);
});

/** GET /api/v1/finance/:financeId */
exports.getAssetFinanceById = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const result = await financeService.getAssetFinanceById(
    tenantId,
    req.params.financeId,
  );
  success(res, result.data, null, result.message, result.status);
});

/** POST /api/v1/finance */
exports.createAssetFinance = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const result = await financeService.createAssetFinance(tenantId, req.body);
  success(res, result.data, null, result.message, result.status);
});

/** PATCH /api/v1/finance/:financeId */
exports.updateAssetFinance = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const result = await financeService.updateAssetFinance(
    tenantId,
    req.params.financeId,
    req.body,
  );
  success(res, result.data, null, result.message, result.status);
});

/** DELETE /api/v1/finance/:financeId */
exports.deleteAssetFinance = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const result = await financeService.deleteAssetFinance(
    tenantId,
    req.params.financeId,
  );
  success(res, result.data, null, result.message, result.status);
});

/** GET /api/v1/finance/reports/depreciation[?asOf=&format=csv] */
exports.getDepreciationReport = asyncHandler(async (req, res) => {
  const tenantId = req.tenantId || req.user.tenantId;
  const result = await financeService.getDepreciationReport(tenantId, {
    asOf: req.query.asOf,
  });

  if (String(req.query.format).toLowerCase() === "csv") {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="depreciation-report.csv"',
    );
    return res.status(200).send(result.data.csv);
  }

  const { csv, ...data } = result.data;
  return success(res, data, null, result.message, result.status);
});
