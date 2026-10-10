/**
 * Dashboard Metrics Service
 *
 * Aggregates operational metrics for the dashboard page.
 * When `tenantId` is provided the numbers are scoped to that tenant;
 * when it is null (SUPERADMIN) the numbers are global and a per-tenant
 * breakdown is included.
 *
 * P9-18 (ADR-087, Stage C): converted from dashboard.service.js with no
 * behaviour change. `export =` keeps the object `require()` returned (the
 * same keys, in the same order). Every model, `Op` and `Sequelize` is captured
 * from the models barrel at load, as the `.js` destructured them. The queries
 * are aggregate reads over many models, so each model is read through the
 * narrow `AggregateModel` surface below (count / sum / findAll / findByPk and
 * the two properties monthlyTrend reads).
 */

import models from "../models";
import { countDue, type IpmDueCounts } from "./ipmDue.service";
import type { DEVICE_CONDITIONS } from "@callibrator/contracts/deviceValues";

/** The surface of a model the dashboard's aggregates use. */
interface AggregateModel {
  count(options?: Record<string, unknown>): Promise<number>;
  sum(field: string, options?: Record<string, unknown>): Promise<number | null>;
  findAll(options?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  findByPk(id: unknown, options?: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  sequelize?: { options: { timezone?: string } };
  rawAttributes?: Record<string, { field?: string } | undefined>;
}

/** A model read through the aggregate surface (the barrel's types are per model). */
const agg = (model: unknown): AggregateModel => model as AggregateModel;

const { Op, Sequelize } = models;
const User = agg(models.User);
const Tenant = agg(models.Tenant);
const CalibrationDevice = agg(models.CalibrationDevice);
const CalibrationRecord = agg(models.CalibrationRecord);
const Certificate = agg(models.Certificate);
const Stock = agg(models.Stock);
const Warehouse = agg(models.Warehouse);
const StockTransfer = agg(models.StockTransfer);
const StockOpname = agg(models.StockOpname);
const MaintenanceWorkOrder = agg(models.MaintenanceWorkOrder);
const InspectionSession = agg(models.InspectionSession);

type Where = Record<string | symbol, unknown>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * P8-04 (ADR-096) — how many of the dashboard's aggregate queries run at once.
 * They ran in one `Promise.all` of 20 against a 20-connection pool, so one
 * dashboard request could hold every connection and a list request queued
 * behind it (P8-07: device p95 320 ms alone, 726 ms beside dashboard traffic).
 * Each query still runs; at most this many hold a connection at a time.
 */
const DASHBOARD_CONCURRENCY = 4;

/**
 * Run `tasks` (functions returning promises) with at most `limit` in flight,
 * resolving to their results in the order given. The first rejection rejects
 * the whole, as `Promise.all` did; tasks not yet started are then not started.
 *
 * @param tasks
 * @param limit
 */
const runBounded = async <T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> => {
  const results = new Array<T>(tasks.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < tasks.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await (tasks[index] as () => Promise<T>)();
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
};

/** Tenant scope helper — {} means global. */
const scoped = (tenantId: string | null | undefined, extra: Where = {}): Where =>
  tenantId ? { tenantId, ...extra } : { ...extra };

/** Group-by-status count → { [status]: count } */
const countByStatus = async (
  Model: AggregateModel,
  tenantId: string | null | undefined,
  extraWhere: Where = {},
): Promise<Record<string, number>> => {
  const rows = await Model.findAll({
    where: scoped(tenantId, extraWhere),
    attributes: ["status", [Sequelize.fn("COUNT", Sequelize.col("id")), "count"]],
    group: ["status"],
    raw: true,
  });
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row["status"] as string] = parseInt(row["count"] as string, 10);
    return acc;
  }, {});
};

/** P21-07 (F-70) — devices per physical condition; a device with none counts as `unset`. */
type ConditionCounts = Record<(typeof DEVICE_CONDITIONS)[number] | "unset", number>;

/**
 * P21-07 (F-70, D-03: upstream "Laik" — fit — is stored as `good`) — the devices per condition, by
 * one grouped count: `{ good, not_good, broken, unset }`, every key present. Through the hooked
 * model, so a facility-bound caller counts its facility's devices only (A-10).
 */
const countByCondition = async (tenantId: string | null | undefined): Promise<ConditionCounts> => {
  const rows = await CalibrationDevice.findAll({
    where: scoped(tenantId),
    attributes: ["condition", [Sequelize.fn("COUNT", Sequelize.col("id")), "count"]],
    group: ["condition"],
    raw: true,
  });
  const counts: ConditionCounts = { good: 0, not_good: 0, broken: 0, unset: 0 };
  for (const row of rows) {
    const condition = row["condition"];
    const key = typeof condition === "string" && Object.hasOwn(counts, condition) ? (condition as keyof ConditionCounts) : "unset";
    // COUNT is a bigint: pg returns it as a string (D-21).
    counts[key] += parseInt(row["count"] as string, 10);
  }
  return counts;
};

/** "+07:00" -> 420; anything else -> 0 (UTC). */
const offsetMinutes = (timezone: string | null | undefined): number => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty zone reads as UTC
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(timezone || "");
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
};

/**
 * Rows per calendar month over the last `months` months, oldest first:
 * [{ month: "2026-02", count }], every month present (0 when empty).
 *
 * D-24 (ADR-064) — this fetched every row's date column for six months and
 * bucketed them in JS, "dialect-safe". ADR-039 made the platform
 * PostgreSQL-only, so the database groups them and returns at most `months`
 * rows instead of six months of them.
 *
 * A month is a calendar month in the connection's timezone (config/index.js
 * sets "+07:00"), because that is the zone date_trunc() works in on this
 * connection. The window start and the bucket keys are computed in the same
 * zone, so a row near midnight on the first of a month lands in one bucket,
 * the same one the database put it in.
 */
const monthlyTrend = async (
  Model: AggregateModel,
  dateField: string,
  tenantId: string | null | undefined,
  months = 6,
): Promise<{ month: string; count: number }[]> => {
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  const offset = offsetMinutes(Model.sequelize && Model.sequelize.options.timezone) * 60000;
  const local = new Date(Date.now() + offset); // wall clock of the zone, read with UTC getters
  const firstMonth = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - (months - 1), 1);
  const start = new Date(firstMonth - offset);

  // The physical column (`calibration_date`), not the attribute name.
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  const attribute = Model.rawAttributes && Model.rawAttributes[dateField];
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  const column = Sequelize.col(attribute && attribute.field ? attribute.field : dateField);
  const month = Sequelize.fn("to_char", Sequelize.fn("date_trunc", "month", column), "YYYY-MM");

  const rows = await Model.findAll({
    where: scoped(tenantId, { [dateField]: { [Op.gte]: start } }),
    attributes: [
      [month, "month"],
      [Sequelize.fn("COUNT", Sequelize.col("id")), "count"],
    ],
    group: [month],
    raw: true,
  });

  const buckets: Record<string, number> = {};
  for (let i = 0; i < months; i += 1) {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - (months - 1) + i, 1));
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the year interpolated as its decimal string
    buckets[`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`] = 0;
  }
  for (const row of rows) {
    // COUNT is a bigint: pg returns it as a string (D-21).
    if ((row["month"] as string) in buckets) {buckets[row["month"] as string] = parseInt(row["count"] as string, 10);}
  }

  return Object.entries(buckets).map(([key, count]) => ({ month: key, count }));
};

const getDashboardMetrics = async (
  tenantId: string | null = null,
): Promise<{ success: true; status: number; message: string; data: Record<string, unknown> }> => {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * DAY_MS);
  const last30Days = new Date(now.getTime() - 30 * DAY_MS);

  const [
    totalUsers,
    verifiedUsers,
    totalDevices,
    devicesByStatus,
    devicesDueSoon,
    devicesOverdue,
    totalCalibrations,
    compliantCalibrations,
    recentCalibrations,
    calibrationTrend,
    totalCertificates,
    certificatesByStatus,
    certificateTrend,
    stockItems,
    totalQuantity,
    lowStockItems,
    totalWarehouses,
    pendingTransfers,
    openOpnames,
    openWorkOrders,
    devicesByCondition,
    ipmSessionsLast30Days,
  ] = await runBounded<unknown>([
    () => User.count({ where: scoped(tenantId) }),
    () => User.count({ where: scoped(tenantId, { isEmailVerified: true }) }),

    () => CalibrationDevice.count({ where: scoped(tenantId) }),
    () => countByStatus(CalibrationDevice, tenantId),
    () => CalibrationDevice.count({
      where: scoped(tenantId, {
        status: "active",
        nextCalibrationDate: { [Op.between]: [now, in30Days] },
      }),
    }),
    () => CalibrationDevice.count({
      where: scoped(tenantId, {
        status: "active",
        nextCalibrationDate: { [Op.lt]: now },
      }),
    }),

    () => CalibrationRecord.count({ where: scoped(tenantId) }),
    () => CalibrationRecord.count({ where: scoped(tenantId, { isCompliant: true }) }),
    () => CalibrationRecord.count({
      where: scoped(tenantId, { calibrationDate: { [Op.gte]: last30Days } }),
    }),
    () => monthlyTrend(CalibrationRecord, "calibrationDate", tenantId),

    () => Certificate.count({ where: scoped(tenantId) }),
    () => countByStatus(Certificate, tenantId),
    () => monthlyTrend(Certificate, "createdAt", tenantId),

    () => Stock.count({ where: scoped(tenantId) }),
    () => Stock.sum("quantity", { where: scoped(tenantId) }),
    () => Stock.count({
      where: scoped(tenantId, {
        // NOTE: models use `underscored: true`, so raw column refs must be
        // snake_case ("min_quantity"), not the attribute name ("minQuantity").
        quantity: { [Op.lte]: Sequelize.col("min_quantity") },
      }),
    }),
    () => Warehouse.count({ where: scoped(tenantId) }),
    () => StockTransfer.count({
      where: scoped(tenantId, {
        status: { [Op.in]: ["pending", "in_transit"] },
      }),
    }),
    () => StockOpname.count({
      where: scoped(tenantId, {
        status: { [Op.in]: ["draft", "in_progress"] },
      }),
    }),

    () => MaintenanceWorkOrder.count({
      where: scoped(tenantId, {
        status: { [Op.in]: ["Open", "InProgress"] },
      }),
    }),

    // P21-07 (F-70, F-73): the condition cards and the IPM activity of the last 30 days.
    () => countByCondition(tenantId),
    () => InspectionSession.count({
      where: scoped(tenantId, { status: "submitted", performedAt: { [Op.gte]: last30Days } }),
    }),
  ], DASHBOARD_CONCURRENCY) as [
    number, number, number, Record<string, number>, number, number, number, number, number,
    { month: string; count: number }[], number, Record<string, number>, { month: string; count: number }[],
    number, number | null, number, number, number, number, number, ConditionCounts, number,
  ];
  // P21-07 (N-9): the due counts need the tenant's interval and zone — a tenant view only.
  const ipmDue: IpmDueCounts | null = tenantId ? await countDue(tenantId) : null;

  const metrics: Record<string, unknown> = {
    scope: tenantId ? "tenant" : "global",
    generatedAt: now.toISOString(),
    users: {
      total: totalUsers,
      verified: verifiedUsers,
    },
    devices: {
      total: totalDevices,
      byStatus: devicesByStatus,
      dueSoon: devicesDueSoon,
      overdue: devicesOverdue,
      byCondition: devicesByCondition,
    },
    calibrations: {
      total: totalCalibrations,
      compliant: compliantCalibrations,
      complianceRate:
        totalCalibrations > 0
          ? Math.round((compliantCalibrations / totalCalibrations) * 1000) / 10
          : null,
      last30Days: recentCalibrations,
    },
    certificates: {
      total: totalCertificates,
      byStatus: certificatesByStatus,
    },
    inventory: {
      stockItems,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a null sum reads as 0
      totalQuantity: totalQuantity || 0,
      lowStockItems,
      warehouses: totalWarehouses,
      pendingTransfers,
      openOpnames,
    },
    maintenance: {
      openWorkOrders,
    },
    ipm: {
      sessionsLast30Days: ipmSessionsLast30Days,
      due: ipmDue,
    },
    trends: {
      calibrations: calibrationTrend,
      certificates: certificateTrend,
    },
  };

  // Tenant scope: attach tenant identity
  if (tenantId) {
    const tenant = await Tenant.findByPk(tenantId, {
      attributes: ["id", "name", "code", "status"],
    });
    metrics["tenant"] = tenant
      ? { id: tenant["id"], name: tenant["name"], code: tenant["code"], status: tenant["status"] }
      : null;
    return {
      success: true,
      status: 200,
      message: "Dashboard metrics fetched successfully",
      data: metrics,
    };
  }

  // Global scope (SUPERADMIN): tenant totals + per-tenant breakdown
  const [totalTenants, activeTenants, tenants, usersByTenant, devicesByTenant] =
    await Promise.all([
      Tenant.count(),
      Tenant.count({ where: { status: "active" } }),
      Tenant.findAll({
        attributes: ["id", "name", "code", "status"],
        order: [["name", "ASC"]],
        raw: true,
      }),
      // Group by the raw snake_case column (models are `underscored: true`).
      User.findAll({
        attributes: [
          "tenantId",
          [Sequelize.fn("COUNT", Sequelize.col("id")), "count"],
        ],
        group: [Sequelize.col("tenant_id")],
        raw: true,
      }),
      CalibrationDevice.findAll({
        attributes: [
          "tenantId",
          [Sequelize.fn("COUNT", Sequelize.col("id")), "count"],
        ],
        group: [Sequelize.col("tenant_id")],
        raw: true,
      }),
    ]);

  const toMap = (rows: Record<string, unknown>[]): Record<string, number> =>
    rows.reduce<Record<string, number>>((acc, row) => {
      if (row["tenantId"]) {acc[row["tenantId"] as string] = parseInt(row["count"] as string, 10);}
      return acc;
    }, {});
  const userCounts = toMap(usersByTenant);
  const deviceCounts = toMap(devicesByTenant);

  metrics["tenants"] = { total: totalTenants, active: activeTenants };
  metrics["tenantBreakdown"] = tenants.map((t) => ({
    id: t["id"],
    name: t["name"],
    code: t["code"],
    status: t["status"],
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a missing count reads as 0
    users: userCounts[t["id"] as string] || 0,
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: a missing count reads as 0
    devices: deviceCounts[t["id"] as string] || 0,
  }));

  return {
    success: true,
    status: 200,
    message: "Dashboard metrics fetched successfully",
    data: metrics,
  };
};

export = { getDashboardMetrics, runBounded, DASHBOARD_CONCURRENCY };
