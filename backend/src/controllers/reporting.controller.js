// src/controllers/reporting.controller.js
const reportingService = require("../services/reporting.service");
const { asyncHandler } = require("../utils/controllerWrapper.util");
const { success } = require("../utils/response.util");

// Send a report as JSON, or as a CSV download when ?format=csv and the report
// exposes a tabular `csv` shape.
const respond = (req, res, result, name) => {
  if (req.query.format === "csv" && result.csv) {
    const csv = reportingService.toCsv(result.csv.headers, result.csv.rows);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${name}.csv`);
    return res.status(200).send(csv);
  }
  // Strip the internal csv scaffold from JSON responses.
  const { csv, ...json } = result;
  void csv;
  return success(res, json, null, "Report generated", 200);
};

exports.summary = asyncHandler(async (req, res) => {
  const data = await reportingService.getSummary(req.user.tenantId);
  success(res, data, null, "Report generated", 200);
});

exports.compliance = asyncHandler(async (req, res) => {
  const data = await reportingService.getCompliance(req.user.tenantId, {
    from: req.query.from,
    to: req.query.to,
  });
  respond(req, res, data, "compliance_report");
});

exports.calibrationWorkload = asyncHandler(async (req, res) => {
  const data = await reportingService.getCalibrationWorkload(req.user.tenantId);
  success(res, data, null, "Report generated", 200);
});

exports.overdueDevices = asyncHandler(async (req, res) => {
  const data = await reportingService.getOverdueDevices(req.user.tenantId);
  respond(req, res, data, "overdue_devices");
});

exports.inventory = asyncHandler(async (req, res) => {
  const data = await reportingService.getInventory(req.user.tenantId);
  respond(req, res, data, "inventory_report");
});
