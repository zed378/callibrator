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

/**
 * Bucket rows into the last `months` calendar months (dialect-safe:
 * fetches only the date column and buckets in JS).
 * Returns [{ month: "2026-02", count }] oldest → newest.
 */
const monthlyTrend = async (Model, dateField, tenantId, months = 6) => {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - (months - 1));

  const rows = await Model.findAll({
    where: scoped(tenantId, { [dateField]: { [Op.gte]: start } }),
    attributes: [dateField],
    raw: true,
  });

  const buckets = {};
  for (let i = 0; i < months; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    buckets[key] = 0;
  }
  rows.forEach((row) => {
    const value = row[dateField];
    if (!value) return;
    const d = new Date(value);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (key in buckets) buckets[key] += 1;
  });

  return Object.entries(buckets).map(([month, count]) => ({ month, count }));
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
