/**
 * Metered Billing Validators.
 *
 * P9-11 (ADR-093): moved to Zod. The file's own `validateBody` / `validateQuery`
 * middleware (surface B) is gone: the route mounts `validate(schema)` and
 * `validate(schema, { from: "query" })` like every other route, so a
 * metered-billing 400 now has the common envelope — and, in production, the
 * "Validation Error" message instead of the generic 500-style one.
 *
 * P9-22 (ADR-097): moved here from backend/src/validators/meteredBilling.validator.ts,
 * which re-exports these same objects; the frontend derives its request
 * types from them. The contract for the meteredBilling routes.
 */
import { z } from "zod";
import { booleanish, dateLike, jsonObject, numeric } from "./fields";

/** Validate usage alert creation. */
const createUsageAlert = z.object({
  metricName: z.string().min(1),
  threshold: numeric(z.number().positive()),
  comparison: z.enum(["gte", "lte", "eq", "gt", "lt"]).default("gte"),
  notificationChannels: z.array(z.enum(["email", "webhook"])).default(["email"]),
  isEnabled: booleanish().default(true),
  description: z.string().default(""),
});

/** Validate cost estimation request. */
const estimateCost = z.object({
  metrics: jsonObject(),
  quantity: numeric(z.number().int().positive()),
  period: z.enum(["hourly", "daily", "monthly", "yearly"]).default("monthly"),
});

/** Validate analytics period (query). */
const getAnalytics = z.object({
  period: z.enum(["7d", "30d", "90d", "1y"]).default("30d"),
  metrics: z.array(z.string().min(1)).optional(),
});

/** Validate billing history query. */
const getBillingHistory = z
  .object({
    page: numeric(z.number().int().min(1)).default(1),
    limit: numeric(z.number().int().min(1).max(100)).default(20),
    startDate: dateLike().optional(),
    endDate: dateLike().optional(),
  })
  // As before P9-11: an endDate needs a startDate at or before it.
  .refine((q) => q.endDate === undefined || (q.startDate !== undefined && q.endDate >= q.startDate), {
    error: "endDate must be after startDate",
    path: ["endDate"],
  });

// ==========================================
// RESPONSES (P9-20/21, ADR-097 Am. 5: what the API answers, published code-first)
// ==========================================

const timestamp = z.iso.datetime();
const rowId = z.guid();

/** One metric's usage: the period total, the current counter, and its history by period. */
const usage = z.object({
  total: z.number(),
  current: z.number(),
  history: z.array(z.object({ period: z.string(), count: z.number() })),
});

/** `GET /usage`: every metric's usage now. */
const tenantUsage = z
  .object({ tenantId: rowId, metrics: z.record(z.string(), usage), generatedAt: timestamp })
  .meta({
    id: "TenantUsage",
    description: "The tenant's usage of every metered metric, now.",
    example: {
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      metrics: { api_calls: { total: 1200, current: 40, history: [{ period: "2026-09-30", count: 40 }] } },
      generatedAt: "2026-10-01T00:00:00.000Z",
    },
  });

/** `POST /estimate`: the cost of the planned usage at the rate card. */
const costEstimate = z
  .object({
    currency: z.literal("USD"),
    quantity: z.number().meta({ description: "The multiplier applied to every metric's units" }),
    lineItems: z.array(z.object({ metric: z.string(), rate: z.number(), quantity: z.number(), cost: z.number() })),
    total: z.number().meta({ description: "Rounded to 2 places" }),
  })
  .meta({
    id: "CostEstimate",
    description: "An unknown metric is priced at 0.",
    example: { currency: "USD", quantity: 1, lineItems: [{ metric: "calibrations", rate: 0.5, quantity: 10, cost: 5 }], total: 5 },
  });

/** `GET /plan`: the tenant's plan, its included limits, and the overage rate card. */
const planDetails = z
  .object({
    plan: z.string().meta({ description: "\"free\" when the tenant has none" }),
    billingCycle: z.string().nullable(),
    limits: z
      .record(z.string(), z.number().nullable())
      .meta({ description: "Included units per metric (null: unlimited), plus the tenant's `seats` and `storageMb`" }),
    overagePricing: z.record(z.string(), z.number()),
  })
  .meta({
    id: "PlanDetails",
    example: {
      plan: "professional",
      billingCycle: "Monthly",
      limits: { api_calls: 100000, storage_bytes: 10737418240, calibrations: 500, users: 25, seats: 25, storageMb: 10240 },
      overagePricing: { api_calls: 0.0001, calibrations: 0.5 },
    },
  });

/** A usage alert (`UsageAlert.toJSON()`). */
const usageAlertResponse = z
  .object({
    id: rowId,
    tenantId: rowId,
    metricName: z.string(),
    threshold: z.number(),
    comparison: z.enum(["gte", "lte", "eq", "gt", "lt"]),
    notificationChannels: z.array(z.string()),
    isEnabled: z.boolean(),
    description: z.string().nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .meta({
    id: "UsageAlert",
    example: {
      id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      metricName: "api_calls",
      threshold: 90000,
      comparison: "gte",
      notificationChannels: ["email"],
      isEnabled: true,
      description: "",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  });

/** `GET /analytics`: per-metric totals and daily trends over the period, and a summary. */
const usageAnalytics = z
  .object({
    tenantId: rowId,
    period: z.string(),
    days: z.number().int(),
    generatedAt: timestamp,
    metrics: z.record(z.string(), z.object({ current: z.number(), total: z.number(), trend: z.array(z.number()) })),
    summary: z.object({ totalApiCalls: z.number(), totalStorageBytes: z.number(), totalCalibrations: z.number() }),
  })
  .meta({
    id: "UsageAnalytics",
    example: {
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      period: "30d",
      days: 30,
      generatedAt: "2026-10-01T00:00:00.000Z",
      metrics: { api_calls: { current: 40, total: 1200, trend: [30, 40] } },
      summary: { totalApiCalls: 1200, totalStorageBytes: 0, totalCalibrations: 12 },
    },
  });

export { createUsageAlert, estimateCost, getAnalytics, getBillingHistory };
export { tenantUsage, costEstimate, planDetails, usageAlertResponse, usageAnalytics };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateUsageAlertInput = z.input<typeof createUsageAlert>;
export type CreateUsageAlertBody = z.output<typeof createUsageAlert>;
export type EstimateCostInput = z.input<typeof estimateCost>;
export type EstimateCostBody = z.output<typeof estimateCost>;
export type GetAnalyticsInput = z.input<typeof getAnalytics>;
export type GetAnalyticsBody = z.output<typeof getAnalytics>;
export type GetBillingHistoryInput = z.input<typeof getBillingHistory>;
export type GetBillingHistoryBody = z.output<typeof getBillingHistory>;
