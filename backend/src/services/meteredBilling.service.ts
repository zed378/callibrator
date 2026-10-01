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
 *
 * P9-17 (ADR-087, Stage C): converted from meteredBilling.service.js with no
 * behaviour change (its raw SQL moved to `sql()` first, as its own change).
 * `export =` keeps the exact object `require()` returned (the same keys, in
 * the same order). A method that called a sibling through `exports.x` calls it
 * through that object, so a spy on the export still intercepts it. `logger`,
 * `AppError`, `db` and `sql` are captured once at load, as the `.js`
 * destructured them; circuitBreaker.util is still loaded at load, as the `.js`
 * required it (its import was unused there too). The models barrel is still
 * `require`d inside each function, never at this module's load. The three
 * environment reads stay per call.
 */
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { db as loadedDb } from "../config";
import "../utils/circuitBreaker.util";
import { sql as loadedSql, type SqlRunner } from "../utils/sql.util";
import { env } from "../config/env";
import { SYSTEM_ACTORS as LOADED_SYSTEM_ACTORS } from "../constants/systemActors";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { QUOTA_SUSPENSION_REASON as LOADED_QUOTA_SUSPENSION_REASON } from "../constants/tenantSuspension";
import auditService from "./audit.service";
import { actorChanges, auditEntryActor } from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import { Transaction, type Op as OpNamespace, type CreationAttributes } from "sequelize";
import type Models from "../models";
import type { TenantId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const logger = loadedLogger;
const AppError = LoadedAppError;
const db = loadedDb;
const sql = loadedSql;
const SYSTEM_ACTORS = LOADED_SYSTEM_ACTORS;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;
const QUOTA_SUSPENSION_REASON = LOADED_QUOTA_SUSPENSION_REASON;

/** `db` as sql() takes it: the same object, viewed through the one method sql() calls. */
const dbRunner = db as unknown as SqlRunner;

/** `db.Sequelize.Op`, read at call time as the `.js` read it (Sequelize's typings omit the static). */
const opOf = (): typeof OpNamespace => (db.Sequelize as unknown as { Op: typeof OpNamespace }).Op;

/** The models barrel, required at call time as the `.js` did (never at load). */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: each function loads the barrel when it runs (see the file header)
const loadModels = (): typeof Models => require("../models") as typeof Models;

/** A caught value's `message`, read exactly as the `.js` read it (a thrown `null` still throws here). */
const messageOf = (err: unknown): unknown => (err as { message?: unknown }).message;

// ==========================================
// CONFIGURATION
// ==========================================

const getUsageTtlDays = (): number => parseInt(env("USAGE_TTL_DAYS") as string) || 90;
const getUsageAggregationHours = (): number =>
  parseInt(env("USAGE_AGGREGATION_HOURS") as string) || 1;
const isUsageEnabled = (): boolean => env("USAGE_ENABLED") !== "false";

// ==========================================
// USAGE COUNTERS (in-memory, Redis in production)
// ==========================================

interface CounterEntry {
  count: number;
  lastReset: number;
}

class UsageStore {
  declare _counters: Map<string, CounterEntry>;

  constructor() {
    this._counters = new Map();
  }

  // A-32: no `amount = 1` default here — the single call site (trackUsage)
  // defaults it in its own signature and always forwards it.
  increment(tenantId: unknown, metric: unknown, amount: number): void {
    const key = `${tenantId as string}:${metric as string}`;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3)
    const entry = this._counters.get(key) || {
      count: 0,
      lastReset: Date.now(),
    };
    entry.count += amount;
    this._counters.set(key, entry);
  }

  get(tenantId: unknown, metric: unknown): number {
    const key = `${tenantId as string}:${metric as string}`;
    const entry = this._counters.get(key);
    return entry ? entry.count : 0;
  }

  reset(tenantId: unknown, metric: unknown): void {
    const key = `${tenantId as string}:${metric as string}`;
    this._counters.delete(key);
  }

  size(): number {
    return this._counters.size;
  }

  clear(): void {
    this._counters.clear();
  }
}

const usageStore = new UsageStore();

// ==========================================
// USAGE TRACKING
// ==========================================

/**
 * Track usage for a tenant
 * @param tenantId - Tenant ID
 * @param metric - Metric name (api_calls, storage_bytes, calibrations, etc.)
 * @param amount - Amount to increment (default: 1)
 */
// eslint-disable-next-line @typescript-eslint/require-await -- as built: async, and the persist is deliberately not awaited (ADR-038 rule 3)
const trackUsage = async (tenantId: TenantId | null | undefined, metric: string | null | undefined, amount = 1): Promise<void> => {
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
    persistUsage(tenantId, metric, amount).catch((err: unknown) => {
      logger.error("Failed to persist usage", {
        tenantId,
        metric,
        error: messageOf(err),
      });
    });
  } catch (err) {
    logger.error("Usage tracking failed", {
      tenantId,
      metric,
      error: messageOf(err),
    });
  }
};

/**
 * Persist usage to database
 */
async function persistUsage(tenantId: TenantId, metric: string, amount: number): Promise<void> {
  const { UsageMetric } = loadModels();

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

interface UsageHistoryEntry {
  period: string;
  count: number;
}

interface Usage {
  total: number;
  current: number;
  history: UsageHistoryEntry[];
}

/** One row of the grouped usage query (SUM comes back from pg as a string). */
interface UsageRow {
  period: string;
  total: string | number | null;
}

/**
 * Get current usage for a tenant/metric
 * @param tenantId - Tenant ID
 * @param metric - Metric name
 * @param options - Query options: `period` (daily, weekly, monthly), `days` to look back
 */
const getUsage = async (tenantId: TenantId, metric: string, options: { period?: string; days?: number } = {}): Promise<Usage> => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- as built: `period` is destructured (its default applied) and never read (ADR-038 rule 3)
  const { period: _period = "daily", days = 30 } = options;

  try {
    let history: UsageHistoryEntry[] = [];

    // PostgreSQL only (ADR-039). `bind`, not `replacements`: `$1`-style
    // placeholders are bind parameters, and Sequelize's `replacements` only
    // substitutes `?` / `:name`. Passed as replacements, PostgreSQL answered
    // "there is no parameter $1" on every call — and the catch below turned
    // that into { total: 0 }, so every tenant's usage read as ZERO in
    // production with nothing but a log line to show for it.
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
    // P9-07: through sql() — bind only, `type: "SELECT"`, the tenant bound as $1.
    const results = await sql<UsageRow>(dbRunner, query, [tenantId, metric, days]);

    /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): parseInt of the SUM, 0 when it is empty */
    const total = results.reduce((sum, r) => sum + parseInt((r.total || 0) as string), 0);
    history = results.map((r) => ({
      period: r.period,
      count: parseInt((r.total || 0) as string),
    }));
    /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

    // Add in-memory counter
    const current = usageStore.get(tenantId, metric);

    return { total, current, history };
  } catch (err) {
    logger.error("Failed to get usage", {
      tenantId,
      metric,
      error: messageOf(err),
    });
    return { total: 0, current: 0, history: [] };
  }
};

/**
 * Get all usage metrics for a tenant
 * @param tenantId - Tenant ID
 * @returns All metrics
 */
const getAllUsage = async (tenantId: TenantId): Promise<Record<string, Usage>> => {
  const metrics = [
    "api_calls",
    "storage_bytes",
    "calibrations",
    "documents",
    "users",
    "notifications",
  ];

  const result: Record<string, Usage> = {};
  for (const metric of metrics) {
    result[metric] = await service.getUsage(tenantId, metric);
  }

  return result;
};

// ==========================================
// QUOTA ENFORCEMENT
// ==========================================

interface QuotaCheck {
  exceeded: boolean;
  usage: number;
  limit: number;
  percentage: number;
  remaining: number;
}

/**
 * Check if a usage limit has been exceeded
 * @param tenantId - Tenant ID
 * @param metric - Metric name
 * @param limit - Quota limit
 */
const checkQuota = async (tenantId: TenantId, metric: string, limit: number): Promise<QuotaCheck> => {
  const usage = await service.getUsage(tenantId, metric);
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

interface QuotaViolation {
  metric: string;
  usage: number;
  limit: number | null;
  overage: number;
}

/**
 * Enforce quotas for a tenant
 * @param tenantId - Tenant ID
 */
const enforceQuotas = async (tenantId: TenantId): Promise<{ enforced: boolean; violations: QuotaViolation[] }> => {
  const { PlanQuota } = loadModels();

  const quotas = await PlanQuota.findAll({
    where: { tenantId },
  });

  const violations: QuotaViolation[] = [];

  for (const quota of quotas) {
    const check = await service.checkQuota(tenantId, quota.metric, quota.limit as number);

    if (check.exceeded) {
      violations.push({
        metric: quota.metric,
        usage: check.usage,
        limit: quota.limit,
        overage: check.usage - (quota.limit as number),
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
      await handleOverage(tenantId, quota.metric, check.usage - (quota.limit as number));
    }
  }

  return {
    enforced: violations.length > 0,
    violations,
  };
};

/**
 * Handle quota overage
 * @param tenantId - Tenant ID
 * @param metric - Metric that was exceeded
 * @param overage - Amount over the limit
 */
/** The plans a tenant pays for (Tenant.plan; the Stripe webhooks keep it in step with the subscription). */
const PAID_PLANS: readonly string[] = ["professional", "business", "enterprise"];

/** The Tenant fields a suspension decision records, before and after. */
const suspensionSnapshot = (tenant: ModelInstance<"Tenant">): Record<string, unknown> => ({
  status: tenant.status,
  suspensionReason: tenant.suspensionReason ?? null,
  suspendedBy: tenant.suspendedBy ?? null,
});

/**
 * A-322 — suspend an ACTIVE free-plan tenant for a quota overage, marked as the
 * system's (QUOTA_SUSPENSION_REASON, no `suspended_by`), with the lifecycle
 * setting and one audit row under PLATFORM and one under the tenant (the
 * A-165 rule; actor `system:usage-quota`), all in one transaction. The row is
 * locked and re-read inside it: a tenant suspended or offboarded meanwhile is
 * left as it is, and an operator's suspension is never relabelled.
 */
const suspendForQuota = async (tenantId: TenantId, metric: string, overage: number): Promise<void> => {
  const { Tenant, TenantSettings } = loadModels();
  await db.transaction(async (transaction) => {
    const tenant = await Tenant.findByPk(tenantId, { transaction, lock: Transaction.LOCK.UPDATE });
    if (tenant?.status !== "active") {
      return;
    }
    const before = suspensionSnapshot(tenant);
    tenant.status = "suspended";
    tenant.suspensionReason = QUOTA_SUSPENSION_REASON;
    tenant.suspendedAt = new Date();
    tenant.suspendedBy = null;
    await tenant.save({ transaction });
    await TenantSettings.upsert({ tenantId, key: "lifecycle_status", value: "SUSPENDED" }, { transaction });
    const entry = {
      systemActor: SYSTEM_ACTORS.USAGE_QUOTA,
      action: "UPDATE" as const,
      resourceType: "Tenant",
      resourceId: tenant.id,
      changes: { operation: "BILLING_QUOTA_SUSPEND", metric, overage, before, after: suspensionSnapshot(tenant) },
    };
    await auditService.logAction({ ...entry, tenantId: PLATFORM_TENANT_ID }, { transaction });
    await auditService.logAction({ ...entry, tenantId: tenant.id }, { transaction });
  });
};

async function handleOverage(tenantId: TenantId, metric: string, overage: number): Promise<void> {
  const { Tenant } = loadModels();

  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }

  // A-322: paid vs free by the tenant's plan. This read `tenant.subscriptionId`,
  // which the Tenant model does not have, so every over-quota tenant — paying
  // or not — was suspended with a bare status update: no reason, no audit row,
  // and an operator's suspension or an offboarding overwritten.
  if (!PAID_PLANS.includes(tenant.plan ?? "free")) {
    logger.warn("Free tier overage - blocking", {
      tenantId,
      metric,
      overage,
    });

    // Block new usage for free tier: an active tenant only, marked and audited.
    await suspendForQuota(tenantId, metric, overage);
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

interface UsageReport {
  tenantId: TenantId;
  period: { days: number; start: string };
  generatedAt: string;
  metrics: Record<string, { current: number; total: number; trend: number[] }>;
  summary: { totalApiCalls: number; totalStorageBytes: number; totalCalibrations: number };
}

/**
 * Generate usage report for a tenant
 * @param tenantId - Tenant ID
 * @param days - Number of days
 */
const generateUsageReport = async (tenantId: TenantId, days = 30): Promise<UsageReport> => {
  const { UsageMetric } = loadModels();
  try {
    await UsageMetric.findAll({ where: { tenantId }, limit: 1 });
  } catch {
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

  const allUsage = await service.getAllUsage(tenantId);

  const report: UsageReport = {
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
    if (metric === "api_calls") {
      report.summary.totalApiCalls = data.total;
    }
    if (metric === "storage_bytes") {
      report.summary.totalStorageBytes = data.total;
    }
    if (metric === "calibrations") {
      report.summary.totalCalibrations = data.total;
    }
  }

  return report;
};

// ==========================================
// USAGE ANALYTICS
// ==========================================

/** One grouped row of the platform query (`raw: true`: the aggregates are strings). */
interface PlatformRow {
  metric: string;
  total: string;
  records: string;
}

/**
 * Get usage analytics across all tenants
 * @param options - Query options
 */
const getPlatformAnalytics = async (options: { days?: number } = {}): Promise<{ period: number; metrics: { metric: string; total: number; records: number }[] }> => {
  const { days = 30 } = options;

  try {
    const { UsageMetric } = loadModels();

    const metrics = (await UsageMetric.findAll({
      attributes: [
        "metric",
        [db.Sequelize.fn("SUM", db.Sequelize.col("count")), "total"],
        [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "records"],
      ],
      where: {
        periodStart: {
          [opOf().gte]: new Date(Date.now() - days * 86400000),
        },
      },
      group: ["metric"],
      raw: true,
    })) as unknown as PlatformRow[];

    return {
      period: days,
      metrics: metrics.map((m) => ({
        metric: m.metric,
        total: parseInt(m.total),
        records: parseInt(m.records),
      })),
    };
  } catch (err) {
    logger.error("Platform analytics failed", { error: messageOf(err) });
    return { period: days, metrics: [] };
  }
};

// ==========================================
// TENANT-FACING BILLING API (consumed by meteredBilling.controller)
// ==========================================

// Overage / estimate rate card (USD per unit). Looked up by a caller's metric name: a plain object, as built.
const RATE_CARD: Record<string, number> = {
  api_calls: 0.0001,
  storage_bytes: 0.00000001,
  calibrations: 0.5,
  documents: 0.01,
  users: 2.0,
  notifications: 0.001,
};

type PlanLimits = Record<string, number | null>;

// Included limits per plan (null = unlimited).
const PLAN_LIMITS: Record<string, PlanLimits> & { free: PlanLimits } = {
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

const PERIOD_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };

/** Current usage snapshot for a tenant (all metrics). */
const getTenantUsage = async (tenantId: TenantId): Promise<{ tenantId: TenantId; metrics: Record<string, Usage>; generatedAt: string }> => {
  return {
    tenantId,
    metrics: await service.getAllUsage(tenantId),
    generatedAt: new Date().toISOString(),
  };
};

type DateInput = string | number | Date;

/** Paginated billing history for a tenant (backed by invoices). */
const getBillingHistory = async (
  tenantId: TenantId,
  page: unknown = 1,
  limit: unknown = 20,
  startDate?: unknown,
  endDate?: unknown,
): Promise<{ rows: ModelInstance<"Invoice">[]; meta: { total: number; page: number; limit: number; totalPages: number } }> => {
  const { Invoice } = loadModels();
  const where: { tenantId: TenantId; createdAt?: Record<symbol, Date> } = { tenantId };
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt[opOf().gte] = new Date(startDate as DateInput);
    }
    if (endDate) {
      where.createdAt[opOf().lte] = new Date(endDate as DateInput);
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

interface CostLine {
  metric: string;
  rate: number;
  quantity: number;
  cost: number;
}

/**
 * Estimate cost for planned usage. `metrics` maps metricName -> units; the cost
 * of each is rate * units * quantity.
 */
const estimateCost = async (
  _tenantId: TenantId,
  metrics: unknown,
  quantity: unknown,
  // eslint-disable-next-line @typescript-eslint/require-await -- as built: async, so a throw is a rejection (ADR-038 rule 3)
): Promise<{ currency: string; quantity: number; lineItems: CostLine[]; total: number }> => {
  if (!metrics || typeof metrics !== "object") {
    throw new AppError(400, "metrics object is required");
  }
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): NaN, 0 and an unknown metric fall back */
  const multiplier = Number(quantity) || 1;
  const lineItems: CostLine[] = [];
  let total = 0;
  for (const [metric, units] of Object.entries(metrics)) {
    const rate = RATE_CARD[metric] || 0;
    const qty = (Number(units) || 0) * multiplier;
    const cost = rate * qty;
    lineItems.push({ metric, rate, quantity: qty, cost: Number(cost.toFixed(4)) });
    total += cost;
  }
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  return {
    currency: "USD",
    quantity: multiplier,
    lineItems,
    total: Number(total.toFixed(2)),
  };
};

/** Plan details, included limits, and overage pricing for a tenant. */
const getPlanDetails = async (tenantId: TenantId): Promise<{
  plan: string;
  billingCycle: unknown;
  limits: PlanLimits & { seats: unknown; storageMb: unknown };
  overagePricing: Record<string, number>;
}> => {
  const { Tenant } = loadModels();
  const tenant = await Tenant.findByPk(tenantId);
  if (!tenant) {
    throw new AppError(404, "Tenant not found");
  }
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): an empty plan is "free", an unknown one gets free's limits */
  const plan = tenant.plan || "free";
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
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
const getUsageAlerts = async (tenantId: TenantId): Promise<ModelInstance<"UsageAlert">[]> => {
  const { UsageAlert } = loadModels();
  return await UsageAlert.findAll({
    where: { tenantId },
    order: [["createdAt", "DESC"]],
  });
};

/** A usage alert as the controller passes it (validated; a JavaScript caller may pass anything). */
interface UsageAlertInput {
  metricName?: unknown;
  threshold?: unknown;
  comparison?: unknown;
  notificationChannels?: unknown;
  isEnabled?: unknown;
  description?: unknown;
}

/** The fields of a usage alert an audit row records. */
const ALERT_FIELDS = ["metricName", "threshold", "comparison", "notificationChannels", "isEnabled"] as const;

/**
 * P6-11 (A-41 addendum) — a usage-alert write commits with one audit row in its
 * transaction; a rolled-back write leaves none. The actor is
 * auditPrincipal(req): a user, or an API key as `system:api-key` (A-282).
 *
 * @param transaction - the write's transaction
 * @param actor - auditPrincipal(req)
 * @param tenantId - the alert's tenant
 * @param action - CREATE | DELETE
 * @param alert - the UsageAlert row
 * @param operation - what happened
 * @returns logAction's result
 */
const auditUsageAlert = (
  transaction: Transaction,
  actor: AuditActorInput | null | undefined,
  tenantId: TenantId,
  action: "CREATE" | "DELETE",
  alert: ModelInstance<"UsageAlert">,
  operation: string,
): Promise<unknown> => {
  const fields = Object.fromEntries(
    ALERT_FIELDS.map((k) => [k, (alert as unknown as Record<string, unknown>)[k] ?? null]),
  );
  return auditService.logAction(
    {
      tenantId,
      ...auditEntryActor(actor),
      action,
      resourceType: "UsageAlert",
      resourceId: alert.id,
      changes: { operation, ...(action === "CREATE" ? { after: fields } : { before: fields }), ...actorChanges(actor) },
    },
    { transaction },
  );
};

/** Create a usage alert. */
const createUsageAlert = async (
  tenantId: TenantId,
  alertData: UsageAlertInput = {},
  actor: AuditActorInput | null = null,
): Promise<ModelInstance<"UsageAlert">> => {
  const { UsageAlert } = loadModels();
  if (
    !alertData.metricName ||
    alertData.threshold === undefined ||
    alertData.threshold === null
  ) {
    throw new AppError(400, "metricName and threshold are required");
  }
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): empty values take the defaults */
  const values: Record<string, unknown> = {
    tenantId,
    metricName: alertData.metricName,
    threshold: alertData.threshold,
    comparison: alertData.comparison || "gte",
    notificationChannels: alertData.notificationChannels || ["email"],
    isEnabled: alertData.isEnabled !== false,
    description: alertData.description || "",
  };
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  return await db.transaction(async (transaction: Transaction) => {
    const alert = await UsageAlert.create(values as CreationAttributes<ModelInstance<"UsageAlert">>, { transaction });
    await auditUsageAlert(transaction, actor, tenantId, "CREATE", alert, "USAGE_ALERT_CREATE");
    return alert;
  });
};

/** Delete a tenant-owned usage alert. */
const deleteUsageAlert = async (
  tenantId: TenantId,
  alertId: string,
  actor: AuditActorInput | null = null,
): Promise<{ success: true; id: string }> => {
  const { UsageAlert } = loadModels();
  const alert = await UsageAlert.findOne({ where: { id: alertId, tenantId } });
  if (!alert) {
    throw new AppError(404, "Usage alert not found");
  }
  await db.transaction(async (transaction: Transaction) => {
    await alert.destroy({ transaction });
    await auditUsageAlert(transaction, actor, tenantId, "DELETE", alert, "USAGE_ALERT_DELETE");
  });
  return { success: true, id: alertId };
};

/** Per-tenant usage analytics for a dashboard period (7d/30d/90d/1y). */
const getAnalytics = async (tenantId: TenantId, period = "30d"): Promise<{
  tenantId: TenantId;
  period: string;
  days: number;
  generatedAt: string;
  metrics: UsageReport["metrics"];
  summary: UsageReport["summary"];
}> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an unknown period is 30 days (ADR-038 rule 3)
  const days = PERIOD_DAYS[period] || 30;
  // Note: destructure explicitly — generateUsageReport also returns a `period`
  // (an object) which would otherwise clobber the period label via a spread.
  const report = await service.generateUsageReport(tenantId, days);
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
const resetUsage = async (tenantId: TenantId, metric: string): Promise<void> => {
  usageStore.reset(tenantId, metric);

  // PostgreSQL only (ADR-039); `bind` for `$n` placeholders — see getUsage.
  // P9-07: through sql(), which always runs `type: "SELECT"`: a DELETE without
  // RETURNING resolves with no rows, and nothing here reads them.
  await sql(dbRunner, 'DELETE FROM "UsageMetrics" WHERE "tenantId" = $1 AND metric = $2', [tenantId, metric]);

  logger.info("Usage counters reset", { tenantId, metric });
};

/**
 * Clear in-memory store (for testing)
 */
const clearCache = (): void => {
  usageStore.clear();
  logger.info("Usage store cleared");
};

/**
 * Get service status
 */
const getStatus = (): { enabled: boolean; ttlDays: number; aggregationHours: number; storeSize: number } => {
  return {
    enabled: isUsageEnabled(),
    ttlDays: getUsageTtlDays(),
    aggregationHours: getUsageAggregationHours(),
    storeSize: usageStore.size(),
  };
};

const service = {
  trackUsage,
  getUsage,
  getAllUsage,
  checkQuota,
  enforceQuotas,
  generateUsageReport,
  getPlatformAnalytics,
  getTenantUsage,
  getBillingHistory,
  estimateCost,
  getPlanDetails,
  getUsageAlerts,
  createUsageAlert,
  deleteUsageAlert,
  getAnalytics,
  resetUsage,
  clearCache,
  getStatus,
};

export = service;
