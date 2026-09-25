/**
 * Dashboard Metrics Service
 *
 * Aggregates operational metrics for the dashboard page.
 * When `tenantId` is provided the numbers are scoped to that tenant;
 * when it is null (SUPERADMIN) the numbers are global and a per-tenant
 * breakdown is included.
 */

const {
  Op,
  Sequelize,
  User,
  Tenant,
  CalibrationDevice,
  CalibrationRecord,
  Certificate,
  Stock,
  Warehouse,
  StockTransfer,
  StockOpname,
  MaintenanceWorkOrder,
} = require("../models");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tenant scope helper — {} means global. */
const scoped = (tenantId, extra = {}) =>
  tenantId ? { tenantId, ...extra } : { ...extra };

/** Group-by-status count → { [status]: count } */
const countByStatus = async (Model, tenantId, extraWhere = {}) => {
  const rows = await Model.findAll({
    where: scoped(tenantId, extraWhere),
    attributes: ["status", [Sequelize.fn("COUNT", Sequelize.col("id")), "count"]],
    group: ["status"],
    raw: true,
  });
  return rows.reduce((acc, row) => {
    acc[row.status] = parseInt(row.count, 10);
    return acc;
  }, {});
};

/** "+07:00" -> 420; anything else -> 0 (UTC). */
const offsetMinutes = (timezone) => {
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
const monthlyTrend = async (Model, dateField, tenantId, months = 6) => {
  const offset = offsetMinutes(Model.sequelize && Model.sequelize.options.timezone) * 60000;
  const local = new Date(Date.now() + offset); // wall clock of the zone, read with UTC getters
  const firstMonth = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - (months - 1), 1);
  const start = new Date(firstMonth - offset);

  // The physical column (`calibration_date`), not the attribute name.
  const attribute = Model.rawAttributes && Model.rawAttributes[dateField];
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

  const buckets = {};
  for (let i = 0; i < months; i += 1) {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - (months - 1) + i, 1));
    buckets[`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`] = 0;
  }
  for (const row of rows) {
    // COUNT is a bigint: pg returns it as a string (D-21).
    if (row.month in buckets) {buckets[row.month] = parseInt(row.count, 10);}
  }

  return Object.entries(buckets).map(([key, count]) => ({ month: key, count }));
};

exports.getDashboardMetrics = async (tenantId = null) => {
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
  ] = await Promise.all([
    User.count({ where: scoped(tenantId) }),
    User.count({ where: scoped(tenantId, { isEmailVerified: true }) }),

    CalibrationDevice.count({ where: scoped(tenantId) }),
    countByStatus(CalibrationDevice, tenantId),
    CalibrationDevice.count({
      where: scoped(tenantId, {
        status: "active",
        nextCalibrationDate: { [Op.between]: [now, in30Days] },
      }),
    }),
    CalibrationDevice.count({
      where: scoped(tenantId, {
        status: "active",
        nextCalibrationDate: { [Op.lt]: now },
      }),
    }),

    CalibrationRecord.count({ where: scoped(tenantId) }),
    CalibrationRecord.count({ where: scoped(tenantId, { isCompliant: true }) }),
    CalibrationRecord.count({
      where: scoped(tenantId, { calibrationDate: { [Op.gte]: last30Days } }),
    }),
    monthlyTrend(CalibrationRecord, "calibrationDate", tenantId),

    Certificate.count({ where: scoped(tenantId) }),
    countByStatus(Certificate, tenantId),
    monthlyTrend(Certificate, "createdAt", tenantId),

    Stock.count({ where: scoped(tenantId) }),
    Stock.sum("quantity", { where: scoped(tenantId) }),
    Stock.count({
      where: scoped(tenantId, {
        // NOTE: models use `underscored: true`, so raw column refs must be
        // snake_case ("min_quantity"), not the attribute name ("minQuantity").
        quantity: { [Op.lte]: Sequelize.col("min_quantity") },
      }),
    }),
    Warehouse.count({ where: scoped(tenantId) }),
    StockTransfer.count({
      where: scoped(tenantId, {
        status: { [Op.in]: ["pending", "in_transit"] },
      }),
    }),
    StockOpname.count({
      where: scoped(tenantId, {
        status: { [Op.in]: ["draft", "in_progress"] },
      }),
    }),

    MaintenanceWorkOrder.count({
      where: scoped(tenantId, {
        status: { [Op.in]: ["Open", "InProgress"] },
      }),
    }),
  ]);

  const metrics = {
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
      totalQuantity: totalQuantity || 0,
      lowStockItems,
      warehouses: totalWarehouses,
      pendingTransfers,
      openOpnames,
    },
    maintenance: {
      openWorkOrders,
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
    metrics.tenant = tenant
      ? { id: tenant.id, name: tenant.name, code: tenant.code, status: tenant.status }
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

  const toMap = (rows) =>
    rows.reduce((acc, row) => {
      if (row.tenantId) acc[row.tenantId] = parseInt(row.count, 10);
      return acc;
    }, {});
  const userCounts = toMap(usersByTenant);
  const deviceCounts = toMap(devicesByTenant);

  metrics.tenants = { total: totalTenants, active: activeTenants };
  metrics.tenantBreakdown = tenants.map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    status: t.status,
    users: userCounts[t.id] || 0,
    devices: deviceCounts[t.id] || 0,
  }));

  return {
    success: true,
    status: 200,
    message: "Dashboard metrics fetched successfully",
    data: metrics,
  };
};
