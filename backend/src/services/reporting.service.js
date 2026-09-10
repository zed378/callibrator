// src/services/reporting.service.js
//
// Tenant-scoped read-model aggregates for dashboards/reporting. All queries are
// grouped counts / sums over existing tables (no new schema). Each report can be
// returned as JSON or, where tabular, exported as CSV via toCsv().
//
// NOTE: monetary "inventory value" and "cost trends" are intentionally omitted —
// Stock has no unit-price column and MaintenanceWorkOrder has no cost column, so
// those would require a schema change. Inventory reporting is quantity/low-stock
// based instead.

const { Op, fn, col } = require("sequelize");
const {
  CalibrationDevice,
  CalibrationRecord,
  Certificate,
  MaintenanceWorkOrder,
  Stock,
} = require("../models");

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;

// Grouped COUNT(*) over `attribute`, returned as { value: count }.
const groupCount = async (Model, tenantId, attribute) => {
  const rows = await Model.findAll({
    where: { tenantId },
    attributes: [attribute, [fn("COUNT", col("id")), "count"]],
    group: [attribute],
    raw: true,
  });
  return rows.reduce((acc, r) => {
    const key = r[attribute] === null || r[attribute] === undefined ? "unknown" : r[attribute];
    acc[key] = Number(r.count);
    return acc;
  }, {});
};

// ------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------
// Cells beginning with one of these are evaluated as a formula by Excel,
// LibreOffice and Google Sheets — including DDE payloads such as
// `=cmd|'/c calc'!A1`. Reports export user-controlled text (device names, stock
// item names), so a value has to be neutralised before it reaches a spreadsheet.
// Quoting alone does NOT help: a quoted cell is still evaluated.
const CSV_FORMULA_PREFIX = /^[=+\-@\t\r]/;

// Genuine numbers must survive intact — "-5" is a quantity, not an attack.
const CSV_PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

const csvEscape = (v) => {
  const s = v === null || v === undefined ? "" : String(v);

  // Prefix a single quote to force the cell to be read as text.
  const guarded =
    CSV_FORMULA_PREFIX.test(s) && !CSV_PLAIN_NUMBER.test(s) ? `'${s}` : s;

  // Quote on delimiter, quote char, or ANY newline — a bare \r terminates a
  // row in several parsers, so it has to be inside quotes like \n.
  return /[",\r\n]/.test(guarded)
    ? `"${guarded.replace(/"/g, '""')}"`
    : guarded;
};

// headers: [{ key, label }]
const toCsv = (headers, rows) => {
  const head = headers.map((h) => csvEscape(h.label)).join(",");
  const body = (rows || [])
    .map((r) => headers.map((h) => csvEscape(r[h.key])).join(","))
    .join("\n");
  return `${head}\n${body}`;
};

// ------------------------------------------------------------------
// OVERDUE DEVICES
// ------------------------------------------------------------------
const getOverdueDevices = async (tenantId, { now = new Date() } = {}) => {
  const where = {
    status: "active",
    nextCalibrationDate: { [Op.ne]: null, [Op.lt]: now },
  };
  if (tenantId) {
    where.tenantId = tenantId;
  }
  const devices = await CalibrationDevice.findAll({
    where,
    attributes: ["id", "name", "serialNumber", "category", "nextCalibrationDate"],
    order: [["nextCalibrationDate", "ASC"]],
  });
  const rows = devices.map((d) => ({
    id: d.id,
    name: d.name,
    serialNumber: d.serialNumber || "",
    category: d.category || "",
    nextCalibrationDate: d.nextCalibrationDate
      ? new Date(d.nextCalibrationDate).toISOString().slice(0, 10)
      : "",
    daysOverdue: Math.floor((now - new Date(d.nextCalibrationDate)) / DAY_MS),
  }));
  return {
    total: rows.length,
    rows,
    csv: {
      headers: [
        { key: "name", label: "Device" },
        { key: "serialNumber", label: "Serial Number" },
        { key: "category", label: "Category" },
        { key: "nextCalibrationDate", label: "Due Date" },
        { key: "daysOverdue", label: "Days Overdue" },
      ],
      rows,
    },
  };
};

// ------------------------------------------------------------------
// COMPLIANCE
// ------------------------------------------------------------------
const getCompliance = async (tenantId, { from, to } = {}) => {
  const where = { tenantId };
  if (from || to) {
    where.calibrationDate = {};
    if (from) {
      where.calibrationDate[Op.gte] = new Date(from);
    }
    if (to) {
      where.calibrationDate[Op.lte] = new Date(to);
    }
  }
  const records = await CalibrationRecord.findAll({
    where,
    attributes: ["isCompliant"],
    raw: true,
  });
  const total = records.length;
  const compliant = records.filter((r) => r.isCompliant === true).length;
  const nonCompliant = records.filter((r) => r.isCompliant === false).length;
  const unknown = total - compliant - nonCompliant;
  const complianceRate = total ? round2((compliant / total) * 100) : 0;

  const summary = { total, compliant, nonCompliant, unknown, complianceRate };
  return {
    summary,
    csv: {
      headers: [
        { key: "metric", label: "Metric" },
        { key: "value", label: "Value" },
      ],
      rows: Object.entries(summary).map(([metric, value]) => ({ metric, value })),
    },
  };
};

// ------------------------------------------------------------------
// CALIBRATION WORKLOAD
// ------------------------------------------------------------------
const getCalibrationWorkload = async (tenantId, { now = new Date() } = {}) => {
  const [byStatus, byType, byPriority] = await Promise.all([
    groupCount(MaintenanceWorkOrder, tenantId, "status"),
    groupCount(MaintenanceWorkOrder, tenantId, "type"),
    groupCount(MaintenanceWorkOrder, tenantId, "priority"),
  ]);

  const windowCount = async (days) =>
    CalibrationDevice.count({
      where: {
        tenantId,
        status: "active",
        nextCalibrationDate: {
          [Op.gte]: now,
          [Op.lte]: new Date(now.getTime() + days * DAY_MS),
        },
      },
    });

  const [in30, in60, in90] = await Promise.all([
    windowCount(30),
    windowCount(60),
    windowCount(90),
  ]);

  return {
    workOrders: { byStatus, byType, byPriority },
    upcomingDue: { in30Days: in30, in60Days: in60, in90Days: in90 },
  };
};

// ------------------------------------------------------------------
// INVENTORY (quantity / low-stock based)
// ------------------------------------------------------------------
const getInventory = async (tenantId) => {
  const stocks = await Stock.findAll({
    where: { tenantId },
    attributes: ["id", "itemName", "sku", "quantity", "minQuantity"],
    raw: true,
  });
  const totalItems = stocks.length;
  const totalQuantity = stocks.reduce((s, r) => s + Number(r.quantity || 0), 0);
  const rows = stocks.map((s) => ({
    itemName: s.itemName,
    sku: s.sku || "",
    quantity: Number(s.quantity || 0),
    minQuantity: Number(s.minQuantity || 0),
    lowStock: Number(s.quantity || 0) <= Number(s.minQuantity || 0),
  }));
  const lowStock = rows.filter((r) => r.lowStock);

  return {
    summary: { totalItems, totalQuantity, lowStockCount: lowStock.length },
    lowStock,
    rows,
    csv: {
      headers: [
        { key: "itemName", label: "Item" },
        { key: "sku", label: "SKU" },
        { key: "quantity", label: "Quantity" },
        { key: "minQuantity", label: "Min Quantity" },
        { key: "lowStock", label: "Low Stock" },
      ],
      rows,
    },
  };
};

// ------------------------------------------------------------------
// SUMMARY (dashboard rollup — JSON only)
// ------------------------------------------------------------------
const getSummary = async (tenantId) => {
  const now = new Date();
  const [devicesByStatus, certsByStatus, workOrdersByStatus, compliance, inventory, overdue] =
    await Promise.all([
      groupCount(CalibrationDevice, tenantId, "status"),
      groupCount(Certificate, tenantId, "status"),
      groupCount(MaintenanceWorkOrder, tenantId, "status"),
      getCompliance(tenantId),
      getInventory(tenantId),
      getOverdueDevices(tenantId, { now }),
    ]);

  return {
    devices: { byStatus: devicesByStatus, overdue: overdue.total },
    certificates: { byStatus: certsByStatus },
    workOrders: { byStatus: workOrdersByStatus },
    compliance: compliance.summary,
    inventory: inventory.summary,
  };
};

module.exports = {
  toCsv,
  getSummary,
  getCompliance,
  getCalibrationWorkload,
  getOverdueDevices,
  getInventory,
};
