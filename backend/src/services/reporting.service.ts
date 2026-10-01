// src/services/reporting.service.ts
//
// P9-18 (ADR-087, Stage C leaves): converted from reporting.service.js with no
// behaviour change. `export =` keeps the exact object `require()` returned (the
// same keys, in the same order). The five models are destructured from the
// barrel once at load, as before.
//
// Tenant-scoped read-model aggregates for dashboards/reporting. All queries are
// grouped counts / sums over existing tables (no new schema). Each report can be
// returned as JSON or, where tabular, exported as CSV via toCsv().
//
// NOTE: monetary "inventory value" and "cost trends" are intentionally omitted —
// Stock has no unit-price column and MaintenanceWorkOrder has no cost column, so
// those would require a schema change. Inventory reporting is quantity/low-stock
// based instead.

import { Op, fn, col, type FindOptions, type WhereOptions } from "sequelize";

import models from "../models";
import { csvDocument } from "../utils/csv.util";
import type { TenantId } from "../types/ids";

const {
  CalibrationDevice,
  CalibrationRecord,
  Certificate,
  MaintenanceWorkOrder,
  Stock,
} = models;

/** A grouped count: each group value (or "unknown") mapped to its row count. */
type GroupCounts = Record<PropertyKey, number>;

/** A CSV column: the row key it reads and its header label. */
interface CsvHeader {
  key: string;
  label: string;
}

/** A report row as the CSV writer reads it. */
type CsvRow = Record<string, unknown>;

/** A raw grouped row: the grouped attribute's value and its `count`. */
interface GroupedRow {
  count: unknown;
  [attribute: string]: unknown;
}

/**
 * The one member of a model `groupCount` calls. Each model's own `findAll` is
 * generic over its attributes, and none of them fits one signature, so the
 * call goes through this view; with `raw: true` the rows are plain objects.
 */
interface GroupCountModel {
  findAll(options: FindOptions): Promise<unknown[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n: number): number => Math.round(n * 100) / 100;

// Grouped COUNT(*) over `attribute`, returned as { value: count }.
const groupCount = async (Model: GroupCountModel, tenantId: TenantId, attribute: string): Promise<GroupCounts> => {
  const rows = (await Model.findAll({
    where: { tenantId },
    attributes: [attribute, [fn("COUNT", col("id")), "count"]],
    group: [attribute],
    raw: true,
  })) as GroupedRow[];
  return rows.reduce<GroupCounts>((acc, r) => {
    // As built: a raw value is used as the key exactly as it came back (a
    // property key, so a number keys as its string).
    const key = r[attribute] === null || r[attribute] === undefined ? "unknown" : (r[attribute] as PropertyKey);
    acc[key] = Number(r.count);
    return acc;
  }, {});
};

// ------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------
// A-319: every export writes through utils/csv.util — RFC 4180 (every field
// quoted, CRLF) and formula-neutralised (a cell starting = + - @ TAB or CR is
// prefixed with ', a plain number is kept). The rules this file used to carry
// (neutralisation, quoting on demand) moved there and now apply to the stock
// and finance exports too.
// headers: [{ key, label }]
const toCsv = (headers: readonly CsvHeader[], rows: readonly CsvRow[] | null | undefined): string => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `rows || []`
  const body = (rows || []).map((r) => headers.map((h) => r[h.key]));
  // As before, a report with no rows still ends its header with a record
  // separator (an empty last record).
  return `${csvDocument([headers.map((h) => h.label)])}\r\n${body.length ? csvDocument(body) : ""}`;
};

// ------------------------------------------------------------------
// OVERDUE DEVICES
// ------------------------------------------------------------------
/**
 * As built, the Date constructor is handed the stored value as it is (a null
 * reads as the epoch, an undefined as an invalid date). The typings accept
 * only a number, string or Date, so the value is viewed as one here.
 */
const dateOf = (value: unknown): Date => new Date(value as string);

interface OverdueRow {
  id: string;
  name: string;
  serialNumber: string;
  category: string;
  nextCalibrationDate: string;
  daysOverdue: number;
}

interface CsvReport<Row> {
  headers: CsvHeader[];
  rows: Row[];
}

interface OverdueReport {
  total: number;
  rows: OverdueRow[];
  csv: CsvReport<OverdueRow>;
}

const getOverdueDevices = async (
  tenantId: TenantId | null | undefined,
  { now = new Date() }: { now?: Date } = {},
): Promise<OverdueReport> => {
  const where: WhereOptions = {
    status: "active",
    nextCalibrationDate: { [Op.ne]: null, [Op.lt]: now },
  };
  if (tenantId) {
    Object.assign(where, { tenantId });
  }
  const devices = await CalibrationDevice.findAll({
    where,
    attributes: ["id", "name", "serialNumber", "category", "nextCalibrationDate"],
    order: [["nextCalibrationDate", "ASC"]],
  });
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: an empty string also reads as "" */
  const rows = devices.map((d) => ({
    id: d.id,
    name: d.name,
    serialNumber: d.serialNumber || "",
    category: d.category || "",
    nextCalibrationDate: d.nextCalibrationDate
      ? dateOf(d.nextCalibrationDate).toISOString().slice(0, 10)
      : "",
    // As built: `now - date`, both operands converted to numbers.
    daysOverdue: Math.floor((+now - +dateOf(d.nextCalibrationDate)) / DAY_MS),
  }));
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
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
interface ComplianceSummary {
  total: number;
  compliant: number;
  nonCompliant: number;
  unknown: number;
  complianceRate: number;
}

interface ComplianceReport {
  summary: ComplianceSummary;
  csv: CsvReport<{ metric: string; value: number }>;
}

/** A calibration-date bound, as JavaScript callers pass it (a date string, usually). */
type DateBound = string | number | Date | null | undefined;

const getCompliance = async (
  tenantId: TenantId,
  { from, to }: { from?: DateBound; to?: DateBound } = {},
): Promise<ComplianceReport> => {
  const where: WhereOptions = { tenantId };
  if (from || to) {
    const calibrationDate: { [Op.gte]?: Date; [Op.lte]?: Date } = {};
    Object.assign(where, { calibrationDate });
    if (from) {
      calibrationDate[Op.gte] = new Date(from);
    }
    if (to) {
      calibrationDate[Op.lte] = new Date(to);
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
interface WorkloadReport {
  workOrders: { byStatus: GroupCounts; byType: GroupCounts; byPriority: GroupCounts };
  upcomingDue: { in30Days: number; in60Days: number; in90Days: number };
}

const getCalibrationWorkload = async (
  tenantId: TenantId,
  { now = new Date() }: { now?: Date } = {},
): Promise<WorkloadReport> => {
  const [byStatus, byType, byPriority] = await Promise.all([
    groupCount(MaintenanceWorkOrder, tenantId, "status"),
    groupCount(MaintenanceWorkOrder, tenantId, "type"),
    groupCount(MaintenanceWorkOrder, tenantId, "priority"),
  ]);

  const windowCount = async (days: number): Promise<number> =>
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
interface InventoryRow {
  itemName: string;
  sku: string;
  quantity: number;
  minQuantity: number;
  lowStock: boolean;
}

interface InventoryReport {
  summary: { totalItems: number; totalQuantity: number; lowStockCount: number };
  lowStock: InventoryRow[];
  rows: InventoryRow[];
  csv: CsvReport<InventoryRow>;
}

const getInventory = async (tenantId: TenantId): Promise<InventoryReport> => {
  const stocks = await Stock.findAll({
    where: { tenantId },
    attributes: ["id", "itemName", "sku", "quantity", "minQuantity"],
    raw: true,
  });
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: `||`, so a 0 or "" also falls back */
  const totalItems = stocks.length;
  const totalQuantity = stocks.reduce((s, r) => s + Number(r.quantity || 0), 0);
  const rows = stocks.map((s) => ({
    itemName: s.itemName,
    sku: s.sku || "",
    quantity: Number(s.quantity || 0),
    minQuantity: Number(s.minQuantity || 0),
    lowStock: Number(s.quantity || 0) <= Number(s.minQuantity || 0),
  }));
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
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
interface SummaryReport {
  devices: { byStatus: GroupCounts; overdue: number };
  certificates: { byStatus: GroupCounts };
  workOrders: { byStatus: GroupCounts };
  compliance: ComplianceSummary;
  inventory: InventoryReport["summary"];
}

const getSummary = async (tenantId: TenantId): Promise<SummaryReport> => {
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

export = {
  toCsv,
  getSummary,
  getCompliance,
  getCalibrationWorkload,
  getOverdueDevices,
  getInventory,
};
