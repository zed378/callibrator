import { api } from "../client";

/**
 * Metered billing — usage snapshots, invoices, plan limits and alerts.
 *
 * The tenant comes from the caller's JWT.
 * Backend: src/routes/api/meteredBilling.route.js (mounted /api/v1/metered-billing)
 *   GET    /usage                 current snapshot
 *   GET    /history               ?page&limit&startDate&endDate
 *   POST   /estimate              { metrics, quantity, period }
 *   GET    /plan                  plan limits + rate card
 *   GET    /alerts
 *   POST   /alerts
 *   DELETE /alerts/:alertId
 *   GET    /analytics             ?period&metrics
 *
 * Usage is recorded internally — there is no POST /usage. Alerts can be
 * created and deleted, but NOT acknowledged.
 *
 * Response shapes differ per endpoint; each method documents its own:
 *  - /usage and /plan return a single OBJECT (not a list)
 *  - /alerts returns a plain ARRAY
 *  - /history is the one endpoint that really does nest { rows, meta } in data
 */

const BASE = "/api/v1/metered-billing";

// ---------- Types ----------

/** Accepted by POST /estimate. */
export type EstimatePeriod = "hourly" | "daily" | "monthly" | "yearly";

/** Accepted by GET /analytics. */
export type AnalyticsPeriod = "7d" | "30d" | "90d" | "1y";

export type AlertComparison = "gte" | "lte" | "eq" | "gt" | "lt";
export type NotificationChannel = "email" | "webhook";

/** metricName -> units, for REQUEST bodies (estimate/track usage). */
export type UsageMetrics = Record<string, number>;

/** Per-metric usage breakdown for one period (in the GET /usage RESPONSE). */
export interface UsageMetric {
  total: number;
  current: number;
  history: { period: string; count: number }[];
}

/**
 * metricName -> its usage breakdown. `getUsage` returns each metric as an
 * object (total/current/history), NOT a bare number.
 */
export type UsageBreakdown = Record<string, UsageMetric>;

/** GET /usage — a point-in-time snapshot, not a paginated list. */
export interface UsageSnapshot {
  tenantId: string;
  metrics: UsageBreakdown;
  generatedAt: string;
}

export interface Invoice {
  id: string;
  tenantId?: string;
  amount?: number;
  currency?: string;
  status?: string;
  periodStart?: string;
  periodEnd?: string;
  createdAt?: string;
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** GET /plan — a single object describing the tenant's plan. */
export interface PlanDetails {
  plan: string;
  billingCycle?: string;
  limits: Record<string, number>;
  /** Rate card: metricName -> price per unit over the included limit. */
  overagePricing: Record<string, number>;
}

export interface CostEstimate {
  [key: string]: unknown;
}

export interface UsageAlert {
  id: string;
  tenantId?: string;
  metricName: string;
  threshold: number;
  comparison: AlertComparison;
  notificationChannels: NotificationChannel[];
  isEnabled: boolean;
  description?: string;
  createdAt?: string;
}

/** POST /alerts — only metricName and threshold are required. */
export interface CreateAlertInput {
  metricName: string;
  threshold: number;
  /** Server default: "gte". */
  comparison?: AlertComparison;
  /** Server default: ["email"]. */
  notificationChannels?: NotificationChannel[];
  /** Server default: true. */
  isEnabled?: boolean;
  description?: string;
}

export interface HistoryParams {
  page?: number;
  limit?: number;
  startDate?: string;
  /** Must be after startDate — the validator rejects otherwise. */
  endDate?: string;
}

export interface AnalyticsResult {
  [key: string]: unknown;
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const meteredBillingService = {
  /**
   * GET /usage — current usage snapshot for the tenant.
   * Returns an object, not a list; takes no paging params.
   */
  getUsage: async (): Promise<UsageSnapshot> => {
    const response = await api.get<BackendResponse<UsageSnapshot>>(
      `${BASE}/usage`,
    );
    return response.data;
  },

  /**
   * GET /history — past invoices.
   * This endpoint genuinely nests { rows, meta } inside `data`.
   */
  getUsageHistory: async (
    params: HistoryParams = {},
  ): Promise<{ rows: Invoice[]; meta: PageMeta }> => {
    const response = await api.get<
      BackendResponse<{ rows: Invoice[]; meta: PageMeta }>
    >(`${BASE}/history`, { params });
    const rows = response.data?.rows ?? [];
    return {
      rows,
      meta:
        response.data?.meta ?? {
          total: rows.length,
          page: params.page ?? 1,
          limit: params.limit ?? 20,
          totalPages: 1,
        },
    };
  },

  /**
   * POST /estimate — cost of planned usage.
   * `metrics` maps metricName -> units and `quantity` is required; the
   * backend 400s without them.
   */
  estimateUsage: async (
    metrics: UsageMetrics,
    quantity: number,
    period: EstimatePeriod = "monthly",
  ): Promise<CostEstimate> => {
    const response = await api.post<BackendResponse<CostEstimate>>(
      `${BASE}/estimate`,
      { metrics, quantity, period },
    );
    return response.data;
  },

  /** GET /plan — a single plan object (not an array of plans). */
  getPlan: async (): Promise<PlanDetails> => {
    const response = await api.get<BackendResponse<PlanDetails>>(
      `${BASE}/plan`,
    );
    return response.data;
  },

  /** GET /alerts — plain array; the backend does not filter or paginate. */
  getAlerts: async (): Promise<UsageAlert[]> => {
    const response = await api.get<BackendResponse<UsageAlert[]>>(
      `${BASE}/alerts`,
    );
    return response.data ?? [];
  },

  /** POST /alerts — returns 201. */
  createAlert: async (input: CreateAlertInput): Promise<UsageAlert> => {
    const response = await api.post<BackendResponse<UsageAlert>>(
      `${BASE}/alerts`,
      input,
    );
    return response.data;
  },

  /**
   * DELETE /alerts/:alertId — alerts are deleted, not acknowledged.
   * (There is no acknowledge route.)
   */
  deleteAlert: async (alertId: string): Promise<void> => {
    await api.delete<BackendResponse<null>>(`${BASE}/alerts/${alertId}`);
  },

  /**
   * GET /analytics — usage report over a fixed period.
   * Only the periods in AnalyticsPeriod are accepted; anything else is
   * silently coerced to "30d" server-side.
   */
  getAnalytics: async (
    period: AnalyticsPeriod = "30d",
    metrics?: string[],
  ): Promise<AnalyticsResult> => {
    const response = await api.get<BackendResponse<AnalyticsResult>>(
      `${BASE}/analytics`,
      { params: metrics ? { period, metrics } : { period } },
    );
    return response.data;
  },
};

export default meteredBillingService;
