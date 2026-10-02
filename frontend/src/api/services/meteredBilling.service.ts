import { typedApi, unwrap, type DataOf, type JsonBody, type Op, type QueryOf, type components } from "../typed";

/**
 * Metered billing — usage snapshots, invoices, plan limits and alerts.
 *
 * The tenant comes from the caller's JWT.
 * Backend: src/routes/api/meteredBilling.route.ts (mounted /api/v1/metered-billing)
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
 *  - /history is a paginated list: invoices in `data`, pagination in the
 *    top-level `meta` (F-13, ADR-074 — it used to nest { rows, meta } in data)
 *
 * P9-25 (ADR-103 item 11): on the GENERATED client; the types are the
 * contract's (backend/src/routes/api/meteredBilling.openapi.ts). The exported
 * names are unchanged.
 */

type MB = "/api/v1/metered-billing";
type Schemas = components["schemas"];

// ---------- Types ----------

type EstimateBody = JsonBody<Op<`${MB}/estimate`, "post">>;

/** Accepted by POST /estimate. */
export type EstimatePeriod = NonNullable<EstimateBody["period"]>;

/** Accepted by GET /analytics. */
export type AnalyticsPeriod = NonNullable<QueryOf<Op<`${MB}/analytics`, "get">>["period"]>;

/** POST /alerts — only metricName and threshold are required (server defaults: "gte", ["email"], enabled). */
export type CreateAlertInput = JsonBody<Op<`${MB}/alerts`, "post">>;
export type AlertComparison = NonNullable<CreateAlertInput["comparison"]>;
export type NotificationChannel = NonNullable<CreateAlertInput["notificationChannels"]>[number];

/** metricName -> units, for REQUEST bodies (estimate). */
export type UsageMetrics = Record<string, number>;

/** GET /usage — a point-in-time snapshot, not a paginated list. */
export type UsageSnapshot = Schemas["TenantUsage"];

/**
 * metricName -> its usage breakdown. `getUsage` returns each metric as an
 * object (total/current/history), NOT a bare number.
 */
export type UsageBreakdown = UsageSnapshot["metrics"];

/** Per-metric usage breakdown for one period (in the GET /usage RESPONSE). */
export type UsageMetric = UsageBreakdown[string];

/**
 * A row of GET /history: an Invoice row (amountDue / amountPaid, currency, a
 * capitalised status, createdAt) — no `amount` and no billing period.
 */
export type Invoice = Schemas["InvoiceRow"];

export type PageMeta = Schemas["PaginationMeta"];

/** GET /plan — a single object describing the tenant's plan (a null limit is unlimited). */
export type PlanDetails = Schemas["PlanDetails"];

export type CostEstimate = Schemas["CostEstimate"];

export type UsageAlert = Schemas["UsageAlert"];

/** GET /history filters; `endDate` must be after `startDate` (the validator rejects otherwise). */
export type HistoryParams = QueryOf<Op<`${MB}/history`, "get">>;

export type AnalyticsResult = DataOf<Op<`${MB}/analytics`, "get">>;

// ---------- Service ----------

export const meteredBillingService = {
  /**
   * GET /usage — current usage snapshot for the tenant.
   * Returns an object, not a list; takes no paging params.
   */
  getUsage: async (): Promise<UsageSnapshot> =>
    (await typedApi.GET("/api/v1/metered-billing/usage").then(unwrap)).data,

  /**
   * GET /history — past invoices. The house envelope (F-13, ADR-074): the
   * invoices are `data`, the pagination is the top-level `meta`, a sibling of
   * `data`. The backend used to nest `{ rows, meta }` inside `data`.
   */
  getUsageHistory: async (
    params: HistoryParams = {},
  ): Promise<{ rows: Invoice[]; meta: PageMeta }> => {
    const response = await typedApi
      .GET("/api/v1/metered-billing/history", { params: { query: params } })
      .then(unwrap);
    // Defensive, as built: a body without rows or `meta` still renders.
    const rows = response.data ?? [];
    return {
      rows,
      meta:
        (response.meta as PageMeta | undefined) ?? {
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
  ): Promise<CostEstimate> =>
    (await typedApi.POST("/api/v1/metered-billing/estimate", { body: { metrics, quantity, period } }).then(unwrap))
      .data,

  /** GET /plan — a single plan object (not an array of plans). */
  getPlan: async (): Promise<PlanDetails> =>
    (await typedApi.GET("/api/v1/metered-billing/plan").then(unwrap)).data,

  /** GET /alerts — plain array; the backend does not filter or paginate. */
  getAlerts: async (): Promise<UsageAlert[]> =>
    (await typedApi.GET("/api/v1/metered-billing/alerts").then(unwrap)).data ?? [],

  /** POST /alerts — returns 201. */
  createAlert: async (input: CreateAlertInput): Promise<UsageAlert> =>
    (await typedApi.POST("/api/v1/metered-billing/alerts", { body: input }).then(unwrap)).data,

  /**
   * DELETE /alerts/:alertId — alerts are deleted, not acknowledged.
   * (There is no acknowledge route.)
   */
  deleteAlert: async (alertId: string): Promise<void> => {
    await typedApi.DELETE("/api/v1/metered-billing/alerts/{alertId}", { params: { path: { alertId } } });
  },

  /**
   * GET /analytics — usage report over a fixed period.
   * Only the periods in AnalyticsPeriod are accepted; anything else is
   * silently coerced to "30d" server-side.
   */
  getAnalytics: async (
    period: AnalyticsPeriod = "30d",
    metrics?: string[],
  ): Promise<AnalyticsResult> =>
    (
      await typedApi
        .GET("/api/v1/metered-billing/analytics", { params: { query: metrics ? { period, metrics } : { period } } })
        .then(unwrap)
    ).data,
};

export default meteredBillingService;
