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

export { createUsageAlert, estimateCost, getAnalytics, getBillingHistory };

// The client-side (input) and handler-side (output) types of each schema.
export type CreateUsageAlertInput = z.input<typeof createUsageAlert>;
export type CreateUsageAlertBody = z.output<typeof createUsageAlert>;
export type EstimateCostInput = z.input<typeof estimateCost>;
export type EstimateCostBody = z.output<typeof estimateCost>;
export type GetAnalyticsInput = z.input<typeof getAnalytics>;
export type GetAnalyticsBody = z.output<typeof getAnalytics>;
export type GetBillingHistoryInput = z.input<typeof getBillingHistory>;
export type GetBillingHistoryBody = z.output<typeof getBillingHistory>;
