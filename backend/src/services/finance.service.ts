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
 *
 * P9-17 (ADR-087, Stage C): converted from finance.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order: `computeDepreciation` last, where the `.js`
 * assigned it). The three models, `AppError`, the two limits, `db`,
 * `auditService` and the two audit helpers are captured once at load, as the
 * `.js` destructured them. The methods call `computeDepreciation` through the
 * local binding, as the `.js` did (never through `exports`), so a spy on the
 * export does not reach them — as built.
 */
import { Op, type CreationAttributes, type Includeable, type Transaction, type WhereOptions } from "sequelize";
import models from "../models";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT, MAX_LIMIT as LOADED_MAX_LIMIT } from "../constants";
import { db as loadedDb } from "../config";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
import { csvDocument } from "../utils/csv.util";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { AssetFinance, CalibrationDevice, Vendor } = models;
const AppError = LoadedAppError;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const MAX_LIMIT = LOADED_MAX_LIMIT;
const db = loadedDb;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;

type AssetFinanceRow = ModelInstance<"AssetFinance">;
type AssetFinanceUpdate = Parameters<AssetFinanceRow["update"]>[0];
type AssetFinanceCreate = CreationAttributes<AssetFinanceRow>;

/** The service's answer; the controller forwards it. */
interface ServiceResult<T> {
  success: true;
  status: number;
  message: string;
  data: T;
}

/** A validated create/update body (finance.validator); a JavaScript caller may pass anything. */
type FinanceInput = Record<string, unknown> & { deviceId?: unknown; vendorId?: unknown };

/**
 * A-278 (ADR-094) — a asset-finance change commits with one audit row in its
 * transaction. The actor is a user, or an API key as `system:api-key` (A-282).
 *
 * @param transaction
 * @param actor - auditPrincipal(req)
 * @param tenantId
 * @param action
 * @param id
 * @param changes - { operation, before, after }
 */
const auditAssetFinance = (
  transaction: Transaction,
  actor: AuditActorInput,
  tenantId: TenantId,
  action: "CREATE" | "UPDATE" | "DELETE",
  id: string,
  changes: Record<string, unknown>,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId,
      ...auditEntryActor(actor),
      action,
      resourceType: "AssetFinance",
      resourceId: id,
      changes: { ...changes, ...actorChanges(actor) },
    },
    { transaction },
  );

/** The named attributes of a row, as plain values (null when absent). */
const pick = (row: object, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]));

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** What `new Date(x)` is given: the `.js` passed whatever the record held. */
type DateInput = string | number | Date;

/**
 * Fractional years elapsed between two dates (never negative).
 */
const yearsBetween = (from: unknown, to: unknown): number => {
  const ms = new Date(to as DateInput).getTime() - new Date(from as DateInput).getTime();
  return Math.max(0, ms / YEAR_MS);
};

/** The fields computeDepreciation reads: a row, or any object a caller hands it. */
interface DepreciationInput {
  purchasePrice?: unknown;
  salvageValue?: unknown;
  usefulLifeYears?: unknown;
  purchaseDate?: unknown;
  depreciationMethod?: unknown;
}

interface Depreciation {
  ageYears: number;
  annualDepreciation: number;
  accumulatedDepreciation: number;
  bookValue: number;
  fullyDepreciated: boolean;
}

/**
 * Compute depreciation figures for one financial record as of a date.
 * Pure function — exported for tests and the report.
 */
const computeDepreciation = (record: DepreciationInput, asOf: unknown = new Date()): Depreciation => {
  const price = Number(record.purchasePrice) || 0;
  const salvage = Math.min(Number(record.salvageValue) || 0, price);
  const life = Math.max(1, Number(record.usefulLifeYears) || 1);
  const age = yearsBetween(record.purchaseDate, asOf);
  const depreciableBase = price - salvage;

  let accumulated: number;
  let annual: number;

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

const includeRelations: Includeable[] = [
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

/** A row as the API shows it: its JSON plus the computed figures. */
type FinanceView = Record<string, unknown> & { depreciation: Depreciation };

/**
 * A-337 (2026-10-01) — a record's vendor is a vendor of the record's tenant.
 * Missing, soft-deleted and another tenant's are ONE 404 (never 403: the id
 * must not tell a caller that it exists elsewhere); the predicate is explicit
 * because a super admin's context skips the tenant hooks. An absent or null
 * `vendorId` names no vendor and is not checked.
 *
 * @param tenantId - the caller's tenant
 * @param vendorId - the body's vendorId, if any
 */
const assertVendor = async (tenantId: TenantId, vendorId: unknown): Promise<void> => {
  if (vendorId === undefined || vendorId === null) {return;}
  const vendor = await Vendor.findOne({ where: { id: vendorId as string, tenantId }, attributes: ["id"] });
  if (!vendor) {
    throw new AppError(404, "Vendor not found");
  }
};

// ------------------------------------------------------------------
// LIST
// ------------------------------------------------------------------

/** The list query as the controller passes it (validated; a JavaScript caller may pass anything). */
interface FetchAssetFinancesQuery {
  tenantId: TenantId;
  page?: number | string;
  limit?: number | string;
  deviceId?: string | null;
  method?: string | null;
}

interface FinanceListData {
  rows: FinanceView[];
  count: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const fetchAssetFinances = async ({
  tenantId,
  page = 1,
  limit = DEFAULT_LIMIT,
  deviceId,
  method,
}: FetchAssetFinancesQuery): Promise<ServiceResult<FinanceListData>> => {
  const whereClause: { tenantId: TenantId; deviceId?: string; depreciationMethod?: string } = { tenantId };
  if (deviceId) {
    whereClause.deviceId = deviceId;
  }
  if (method) {
    whereClause.depreciationMethod = method;
  }

  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const offset = (Number(page) - 1) * safeLimit;

  const { count, rows } = await AssetFinance.findAndCountAll({
    where: whereClause as WhereOptions,
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
const getAssetFinanceById = async (tenantId: TenantId, financeId: string): Promise<ServiceResult<FinanceView>> => {
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
const createAssetFinance = async (tenantId: TenantId, data: FinanceInput, actor: AuditActorInput = {}): Promise<ServiceResult<FinanceView>> => {
  const device = await CalibrationDevice.findOne({
    where: { id: data.deviceId as string, tenantId },
  });
  if (!device) {
    throw new AppError(404, "Calibration device not found");
  }
  await assertVendor(tenantId, data.vendorId);

  const existing = await AssetFinance.findOne({
    where: { deviceId: data.deviceId as string },
    paranoid: false,
  });
  if (existing && !existing.deletedAt) {
    throw new AppError(
      409,
      "A finance record already exists for this device — update it instead",
    );
  }
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built: the .js re-tested existing (ADR-038 rule 3)
  if (existing && existing.deletedAt) {
    // Revive the soft-deleted record with the new figures.
    await db.transaction(async (transaction) => {
      await existing.restore({ transaction });
      await existing.update({ ...(data as AssetFinanceUpdate), tenantId }, { transaction });
      await auditAssetFinance(transaction, actor, tenantId, "CREATE", existing.id, {
        operation: "ASSET_FINANCE_CREATE",
        revived: true,
        before: {},
        after: pick(existing, Object.keys(data)),
      });
    });
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

  const record = await db.transaction(async (transaction) => {
    const created = await AssetFinance.create({ ...(data as AssetFinanceCreate), tenantId }, { transaction });
    await auditAssetFinance(transaction, actor, tenantId, "CREATE", created.id, {
      operation: "ASSET_FINANCE_CREATE",
      before: {},
      after: pick(created, Object.keys(data)),
    });
    return created;
  });
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
const updateAssetFinance = async (
  tenantId: TenantId,
  financeId: string,
  data: FinanceInput,
  actor: AuditActorInput = {},
): Promise<ServiceResult<FinanceView>> => {
  const record = await AssetFinance.findOne({
    where: { id: financeId, tenantId },
  });
  if (!record) {
    throw new AppError(404, "Asset finance record not found");
  }
  await assertVendor(tenantId, data.vendorId);
  const fields = Object.keys(data);
  const before = pick(record, fields);
  await db.transaction(async (transaction) => {
    await record.update(data as AssetFinanceUpdate, { transaction });
    await auditAssetFinance(transaction, actor, tenantId, "UPDATE", record.id, {
      operation: "ASSET_FINANCE_UPDATE",
      before,
      after: pick(record, fields),
    });
  });
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
const deleteAssetFinance = async (tenantId: TenantId, financeId: string, actor: AuditActorInput = {}): Promise<ServiceResult<null>> => {
  const record = await AssetFinance.findOne({
    where: { id: financeId, tenantId },
  });
  if (!record) {
    throw new AppError(404, "Asset finance record not found");
  }
  await db.transaction(async (transaction) => {
    await record.destroy({ transaction });
    await auditAssetFinance(transaction, actor, tenantId, "DELETE", record.id, {
      operation: "ASSET_FINANCE_DELETE",
      before: pick(record, ["deviceId", "purchasePrice"]),
    });
  });
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

interface ReportRow extends Depreciation {
  financeId: string;
  deviceId: string;
  deviceName: string;
  serialNumber: string | null;
  purchaseDate: string;
  purchasePrice: number;
  salvageValue: number;
  usefulLifeYears: number;
  method: string;
}

interface ReportTotals {
  totalPurchase: number;
  totalAccumulatedDepreciation: number;
  totalBookValue: number;
  fullyDepreciatedCount: number;
}

interface DepreciationReport {
  asOf: string;
  totals: ReportTotals;
  count: number;
  rows: ReportRow[];
  csv: string;
}

const getDepreciationReport = async (tenantId: TenantId, { asOf }: { asOf?: unknown } = {}): Promise<ServiceResult<DepreciationReport>> => {
  const asOfDate = asOf ? new Date(asOf as DateInput) : new Date();
  if (Number.isNaN(asOfDate.getTime())) {
    throw new AppError(400, "Invalid asOf date");
  }

  const reportWhere: WhereOptions = { tenantId, purchaseDate: { [Op.lte]: asOfDate } };
  const records = await AssetFinance.findAll({
    where: reportWhere,
    include: includeRelations,
    order: [["purchaseDate", "ASC"]],
  });

  const rows: ReportRow[] = records.map((record) => {
    const dep = computeDepreciation(record, asOfDate);
    return {
      financeId: record.id,
      deviceId: record.deviceId,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty name is "Unknown device" too (ADR-038 rule 3)
      deviceName: record.device?.name || "Unknown device",
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty serial is null (ADR-038 rule 3)
      serialNumber: record.device?.serialNumber || null,
      purchaseDate: record.purchaseDate,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a raw DECIMAL is a string (D-21), and Number() is what the .js applied
      purchasePrice: round2(Number(record.purchasePrice)),
      salvageValue: round2(Number(record.salvageValue)),
      usefulLifeYears: record.usefulLifeYears,
      method: record.depreciationMethod,
      ...dep,
    };
  });

  const totals = rows.reduce<ReportTotals>(
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
  // ?format=csv). A-319: through utils/csv.util, like every export — RFC 4180
  // (every field quoted, so a serial holding a comma stays in its column; CRLF)
  // and formula-neutralised (device names and serials are tenant-typed text).
  const csvHeader = [
    "Device",
    "Serial Number",
    "Purchase Date",
    "Purchase Price",
    "Salvage",
    "Life (yrs)",
    "Method",
    "Age (yrs)",
    "Annual Depreciation",
    "Accumulated",
    "Book Value",
    "Fully Depreciated",
  ];
  const csvRows = rows.map((r) =>
    [
      // deviceName is built above as `record.device?.name || "Unknown device"`,
      // so it is never falsy here (A-32: the unreachable `|| ""` is gone).
      r.deviceName,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty serial is an empty cell (ADR-038 rule 3)
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
    ],
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
      csv: csvDocument([csvHeader, ...csvRows]),
    },
  };
};

export = {
  fetchAssetFinances,
  getAssetFinanceById,
  createAssetFinance,
  updateAssetFinance,
  deleteAssetFinance,
  getDepreciationReport,
  computeDepreciation,
};
