/**
 * Metered Billing & Usage Analytics Service
 *
 * Tracks per-tenant usage metrics (API calls, storage, calibrations, etc.)
 * and enforces plan quotas with overage handling.
 *
 * Usage:
 *   const { trackUsage, getUsage } = require('./services/meteredBilling.service');
 *   await trackUsage(tenantId, 'api_calls', 1);
 *   const usage = await getUsage(tenantId, 'api_calls');
 */

const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { db } = require("../config");
const { withCircuitBreaker } = require("../utils/circuitBreaker.util");

// ==========================================
// CONFIGURATION
// ==========================================

const getUsageTtlDays = () => parseInt(process.env.USAGE_TTL_DAYS) || 90;
const getUsageAggregationHours = () =>
  parseInt(process.env.USAGE_AGGREGATION_HOURS) || 1;
const isUsageEnabled = () => process.env.USAGE_ENABLED !== "false";

// ==========================================
// USAGE COUNTERS (in-memory, Redis in production)
// ==========================================

class UsageStore {
  constructor() {
    this._counters = new Map();
  }

  // The `amount = 1` default is unreachable: usageStore is module-private and
  // increment has a single call site (trackUsage), which already defaults
  // amount to 1 in its own signature and always forwards it explicitly.
  /* istanbul ignore next */
  increment(tenantId, metric, amount = 1) {
    const key = `${tenantId}:${metric}`;
    const entry = this._counters.get(key) || {
      count: 0,
      lastReset: Date.now(),
    };
    entry.count += amount;
    this._counters.set(key, entry);
  }

  get(tenantId, metric) {
    const key = `${tenantId}:${metric}`;
    const entry = this._counters.get(key);
    return entry ? entry.count : 0;
  }

  reset(tenantId, metric) {
    const key = `${tenantId}:${metric}`;
    this._counters.delete(key);
  }

  size() {
    return this._counters.size;
  }

  clear() {
    this._counters.clear();
  }
}

const usageStore = new UsageStore();

// ==========================================
// USAGE TRACKING
// ==========================================

/**
 * Track usage for a tenant
 * @param {string} tenantId - Tenant ID
 * @param {string} metric - Metric name (api_calls, storage_bytes, calibrations, etc.)
 * @param {number} amount - Amount to increment (default: 1)
 */
exports.trackUsage = async (tenantId, metric, amount = 1) => {
  if (!isUsageEnabled()) {
    return;
  }

  if (!tenantId || !metric) {
    logger.debug("Usage tracking skipped: missing tenantId or metric");
    return;
  }

  try {
    // In-memory counter for performance
    usageStore.increment(tenantId, metric, amount);

    // Persist to database (async, don't block)
    persistUsage(tenantId, metric, amount).catch((err) => {
      logger.error("Failed to persist usage", {
        tenantId,
        metric,
        error: err.message,
      });
    });
  } catch (err) {
    logger.error("Usage tracking failed", {
      tenantId,
      metric,
      error: err.message,
    });
  }
};

/**
 * Persist usage to database
 */
async function persistUsage(tenantId, metric, amount) {
  const { UsageMetric } = require("../models");

  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setHours(
    now.getHours() - (now.getHours() % getUsageAggregationHours()),
    0,
    0,
    0,
  );

  const [record, created] = await UsageMetric.findOrCreate({
    where: {
      tenantId,
      metric,
      periodStart,
    },
    defaults: {
      tenantId,
      metric,
      periodStart,
      count: amount,
    },
  });

  // On create the row is already seeded with `count: amount`, so adding again
  // would double-count the first unit of every new bucket. Only accumulate when
  // the row already existed, and do it atomically (count = count + amount) to
  // stay correct under concurrent increments.
  if (!created) {
    await record.increment("count", { by: amount });
  }
}

// ==========================================
// USAGE QUERIES
// ==========================================

/**
 * Get current usage for a tenant/metric
 * @param {string} tenantId - Tenant ID
 * @param {string} metric - Metric name
 * @param {Object} options - Query options
 * @param {string} options.period - Period (daily, weekly, monthly)
 * @param {number} options.days - Number of days to look back
 * @returns {Promise<{total: number, current: number, history: Array}>}
 */
exports.getUsage = async (tenantId, metric, options = {}) => {
  const { period = "daily", days = 30 } = options;

  try {
    let total;
    let history = [];

    if (db.getDialect() === "postgres") {
      const query = `
        SELECT 
          TO_CHAR("periodStart", 'YYYY-MM-DD') as period,
          SUM(count) as total
        FROM "UsageMetrics"
        WHERE "tenantId" = $1 AND metric = $2
        AND "periodStart" >= NOW() - ($3 || ' days')::interval
        GROUP BY "periodStart"
        ORDER BY "periodStart" DESC
      `;
      const results = await db.query(query, {
        replacements: [tenantId, metric, days],
        type: db.QueryTypes.SELECT,
      });

      total = results.reduce((sum, r) => sum + parseInt(r.total || 0), 0);
      history = results.map((r) => ({
        period: r.period,
        count: parseInt(r.total || 0),
      }));
    } else {
      const { UsageMetric } = require("../models");
      const records = await UsageMetric.findAll({
        where: {
          tenantId,
          metric,
          periodStart: {
            [db.Sequelize.Op.gte]: new Date(Date.now() - days * 86400000),
          },
        },
        order: [["periodStart", "DESC"]],
      });

      total = records.reduce((sum, r) => sum + (r.count || 0), 0);
      history = records.map((r) => ({
        period: r.periodStart.toISOString().split("T")[0],
        count: r.count,
      }));
    }

    // Add in-memory counter
    const current = usageStore.get(tenantId, metric);

    return { total, current, history };
  } catch (err) {
    logger.error("Failed to get usage", {
      tenantId,
      metric,
      error: err.message,
    });
    return { total: 0, current: 0, history: [] };
  }
};

/**
 * Get all usage metrics for a tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} All metrics
 */
exports.getAllUsage = async (tenantId) => {
  const metrics = [
    "api_calls",
    "storage_bytes",
    "calibrations",
    "documents",
    "users",
    "notifications",
  ];

  const result = {};
  for (const metric of metrics) {
    result[metric] = await exports.getUsage(tenantId, metric);
  }

  return result;
};

// ==========================================
// QUOTA ENFORCEMENT
// ==========================================

/**
 * Check if a usage limit has been exceeded
 * @param {string} tenantId - Tenant ID
 * @param {string} metric - Metric name
 * @param {number} limit - Quota limit
 * @returns {Promise<{exceeded: boolean, usage: number, limit: number, percentage: number}>}
 */
exports.checkQuota = async (tenantId, metric, limit) => {
  const usage = await exports.getUsage(tenantId, metric);
  const totalUsage = (usage.total || 0) + (usage.current || 0);
  const percentage = limit > 0 ? (totalUsage / limit) * 100 : 0;

  return {
    exceeded: totalUsage >= limit,
    usage: totalUsage,
    limit,
    percentage: Math.min(percentage, 100),
    remaining: Math.max(0, limit - totalUsage),
  };
};

/**
 * Enforce quotas for a tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<{enforced: boolean, violations: Array}>}
 */
exports.enforceQuotas = async (tenantId) => {
  const { PlanQuota } = require("../models");

  const quotas = await PlanQuota.findAll({
    where: { tenantId },
  });

  const violations = [];

  for (const quota of quotas) {
    const check = await exports.checkQuota(tenantId, quota.metric, quota.limit);

    if (check.exceeded) {
      violations.push({
        metric: quota.metric,
        usage: check.usage,
        limit: quota.limit,
        overage: check.usage - quota.limit,
      });

      logger.warn("Quota exceeded", {
        tenantId,
        metric: quota.metric,
        usage: check.usage,
        limit: quota.limit,
      });

      // Trigger overage action. checkQuota returns
      // {exceeded, usage, limit, percentage, remaining} — there is no
      // `overage` key, so this passed undefined and the paid-tier path logged
      // `overage: undefined`. Compute it the same way the violation above does.
      await handleOverage(tenantId, quota.metric, check.usage - quota.limit);
    }
  }

  return {
    enforced: violations.length > 0,
    violations,
  };
};

/**
 * Handle quota overage
 * @param {string} tenantId - Tenant ID
 * @param {string} metric - Metric that was exceeded
 * @param {number} overage - Amount over the limit
 */
async function handleOverage(tenantId, metric, overage) {
  const { Tenant } = require("../models");

  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  // Check if tenant is on a paid plan
  if (!tenant.subscriptionId) {
    logger.warn("Free tier overage - blocking", {
      tenantId,
      metric,
      overage,
    });

    // Block new usage for free tier
    await tenant.update({ status: "suspended" });
    return;
  }

  // Paid tier - allow overage but log
  logger.info("Paid tier overage - allowing", {
    tenantId,
    metric,
    overage,
  });

  // TODO: Send overage notification to tenant admin
  // await notificationService.send(tenantId, "quota_overage", { metric, overage });
}

// ==========================================
// USAGE REPORTING
// ==========================================

/**
 * Generate usage report for a tenant
 * @param {string} tenantId - Tenant ID
 * @param {number} days - Number of days
 * @returns {Promise<Object>} Usage report
 */
exports.generateUsageReport = async (tenantId, days = 30) => {
  const { UsageMetric } = require("../models");
  try {
    await UsageMetric.findAll({ where: { tenantId }, limit: 1 });
  } catch (err) {
    return {
      tenantId,
      period: {
        days,
        start: new Date(Date.now() - days * 86400000).toISOString(),
      },
      generatedAt: new Date().toISOString(),
      metrics: {},
      summary: {
        totalApiCalls: 0,
        totalStorageBytes: 0,
        totalCalibrations: 0,
      },
    };
  }

  const allUsage = await exports.getAllUsage(tenantId);

  const report = {
    tenantId,
    period: {
      days,
      start: new Date(Date.now() - days * 86400000).toISOString(),
    },
    generatedAt: new Date().toISOString(),
    metrics: {},
    summary: {
      totalApiCalls: 0,
      totalStorageBytes: 0,
      totalCalibrations: 0,
    },
  };

  for (const [metric, data] of Object.entries(allUsage)) {
    report.metrics[metric] = {
      current: data.current,
      total: data.total,
      trend: data.history.slice(-7).map((h) => h.count),
    };

    // Update summary
    if (metric === "api_calls") report.summary.totalApiCalls = data.total;
    if (metric === "storage_bytes")
      report.summary.totalStorageBytes = data.total;
    if (metric === "calibrations")
      report.summary.totalCalibrations = data.total;
  }

  return report;
};

// ==========================================
// USAGE ANALYTICS
// ==========================================

/**
 * Get usage analytics across all tenants
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Platform-wide analytics
 */
exports.getPlatformAnalytics = async (options = {}) => {
  const { days = 30 } = options;

  try {
    const { UsageMetric } = require("../models");

    const metrics = await UsageMetric.findAll({
      attributes: [
        "metric",
        [db.Sequelize.fn("SUM", db.Sequelize.col("count")), "total"],
        [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "records"],
      ],
      where: {
        periodStart: {
          [db.Sequelize.Op.gte]: new Date(Date.now() - days * 86400000),
        },
      },
      group: ["metric"],
      raw: true,
    });

    return {
      period: days,
      metrics: metrics.map((m) => ({
        metric: m.metric,
        total: parseInt(m.total),
        records: parseInt(m.records),
      })),
    };
  } catch (err) {
    logger.error("Platform analytics failed", { error: err.message });
    return { period: days, metrics: [] };
  }
};

// ==========================================
// TENANT-FACING BILLING API (consumed by meteredBilling.controller)
// ==========================================

// Overage / estimate rate card (USD per unit).
const RATE_CARD = {
  api_calls: 0.0001,
  storage_bytes: 0.00000001,
  calibrations: 0.5,
  documents: 0.01,
  users: 2.0,
  notifications: 0.001,
};

// Included limits per plan (null = unlimited).
const PLAN_LIMITS = {
  free: { api_calls: 10000, storage_bytes: 1073741824, calibrations: 50, users: 5 },
  professional: {
    api_calls: 100000,
    storage_bytes: 10737418240,
    calibrations: 500,
    users: 25,
  },
  business: {
    api_calls: 1000000,
    storage_bytes: 107374182400,
    calibrations: 5000,
    users: 100,
  },
  enterprise: {
    api_calls: null,
    storage_bytes: null,
    calibrations: null,
    users: null,
  },
};

const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

/** Current usage snapshot for a tenant (all metrics). */
exports.getTenantUsage = async (tenantId) => {
  return {
    tenantId,
    metrics: await exports.getAllUsage(tenantId),
    generatedAt: new Date().toISOString(),
  };
};

/** Paginated billing history for a tenant (backed by invoices). */
exports.getBillingHistory = async (
  tenantId,
  page = 1,
  limit = 20,
  startDate,
  endDate,
) => {
  const { Invoice } = require("../models");
  const where = { tenantId };
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt[db.Sequelize.Op.gte] = new Date(startDate);
    }
    if (endDate) {
      where.createdAt[db.Sequelize.Op.lte] = new Date(endDate);
    }
  }
  const safeLimit = Math.min(Number(limit) || 20, 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const { count, rows } = await Invoice.findAndCountAll({
    where,
    limit: safeLimit,
    offset: (safePage - 1) * safeLimit,
    order: [["createdAt", "DESC"]],
  });
  return {
    rows,
    meta: {
      total: count,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(count / safeLimit),
    },
  };
};

/**
 * Estimate cost for planned usage. `metrics` maps metricName -> units; the cost
 * of each is rate * units * quantity.
 */
exports.estimateCost = async (tenantId, metrics, quantity) => {
  if (!metrics || typeof metrics !== "object") {
    throw new AppError(400, "metrics object is required");
  }
  const multiplier = Number(quantity) || 1;
  const lineItems = [];
  let total = 0;
  for (const [metric, units] of Object.entries(metrics)) {
    const rate = RATE_CARD[metric] || 0;
    const qty = (Number(units) || 0) * multiplier;
    const cost = rate * qty;
    lineItems.push({ metric, rate, quantity: qty, cost: Number(cost.toFixed(4)) });
    total += cost;
  }
  return {
    currency: "USD",
    quantity: multiplier,
    lineItems,
    total: Number(total.toFixed(2)),
  };
};

/** Plan details, included limits, and overage pricing for a tenant. */
exports.getPlanDetails = async (tenantId) => {
  const { Tenant } = require("../models");
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }
  const plan = tenant.plan || "free";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  return {
    plan,
    billingCycle: tenant.billingCycle,
    limits: {
      ...limits,
      seats: tenant.limitSeats,
      storageMb: tenant.limitStorageMb,
    },
    overagePricing: RATE_CARD,
  };
};

/** List a tenant's usage alerts. */
exports.getUsageAlerts = async (tenantId) => {
  const { UsageAlert } = require("../models");
  return await UsageAlert.findAll({
    where: { tenantId },
    order: [["createdAt", "DESC"]],
  });
};

/** Create a usage alert. */
exports.createUsageAlert = async (tenantId, alertData = {}) => {
  const { UsageAlert } = require("../models");
  if (
    !alertData.metricName ||
    alertData.threshold === undefined ||
    alertData.threshold === null
  ) {
    throw new AppError(400, "metricName and threshold are required");
  }
  return await UsageAlert.create({
    tenantId,
    metricName: alertData.metricName,
    threshold: alertData.threshold,
    comparison: alertData.comparison || "gte",
    notificationChannels: alertData.notificationChannels || ["email"],
    isEnabled: alertData.isEnabled !== false,
    description: alertData.description || "",
  });
};

/** Delete a tenant-owned usage alert. */
exports.deleteUsageAlert = async (tenantId, alertId) => {
  const { UsageAlert } = require("../models");
  const alert = await UsageAlert.findOne({ where: { id: alertId, tenantId } });
  if (!alert) {
    throw new AppError(404, "Usage alert not found");
  }
  await alert.destroy();
  return { success: true, id: alertId };
};

/** Per-tenant usage analytics for a dashboard period (7d/30d/90d/1y). */
exports.getAnalytics = async (tenantId, period = "30d") => {
  const days = PERIOD_DAYS[period] || 30;
  // Note: destructure explicitly — generateUsageReport also returns a `period`
  // (an object) which would otherwise clobber the period label via a spread.
  const report = await exports.generateUsageReport(tenantId, days);
  return {
    tenantId,
    period,
    days,
    generatedAt: report.generatedAt,
    metrics: report.metrics,
    summary: report.summary,
  };
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

/**
 * Reset usage counters (for billing cycle)
 */
exports.resetUsage = async (tenantId, metric) => {
  usageStore.reset(tenantId, metric);

  if (db.getDialect() === "postgres") {
    await db.query(
      `DELETE FROM "UsageMetrics" WHERE "tenantId" = $1 AND metric = $2`,
      { replacements: [tenantId, metric] },
    );
  } else {
    const { UsageMetric } = require("../models");
    await UsageMetric.destroy({
      where: { tenantId, metric },
    });
  }

  logger.info("Usage counters reset", { tenantId, metric });
};

/**
 * Clear in-memory store (for testing)
 */
exports.clearCache = () => {
  usageStore.clear();
  logger.info("Usage store cleared");
};

/**
 * Get service status
 */
exports.getStatus = () => {
  return {
    enabled: isUsageEnabled(),
    ttlDays: getUsageTtlDays(),
    aggregationHours: getUsageAggregationHours(),
    storeSize: usageStore.size(),
  };
};
