/**
 * P9-21 / P9-25 (ADR-103) — the contract of `meteredBilling.route.ts`,
 * code-first.
 *
 * Bodies and the two validated queries are the objects `validate()` mounts
 * (`validators/meteredBilling.validator` → `@callibrator/contracts/meteredBilling`).
 * Responses are the contract's usage, estimate, plan, alert and analytics
 * shapes; the history lists invoice rows. Examples are synthetic.
 *
 * The JSDoc this replaces said the estimate needs WRITE access; the route has
 * always gated it on read (ADR-043), and that is what is published now.
 */
import { z } from "zod";
import {
  createUsageAlert,
  estimateCost,
  getAnalytics,
  getBillingHistory,
} from "../../validators/meteredBilling.validator";
import {
  costEstimate,
  planDetails,
  tenantUsage,
  usageAlertResponse,
  usageAnalytics,
} from "@callibrator/contracts/meteredBilling";
import { invoiceRow } from "@callibrator/contracts/billing";
import { defineRouteDocs } from "../../docs/openapi/operation";

/** `:alertId`, checked by `validateUuid` (the SHAPE: `z.guid()`). */
const params = z.object({
  alertId: z.guid().meta({ description: "The usage alert's id", example: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b" }),
});

const access = (action: "read" | "write") => ({ kind: "dynamicAccess", resource: "metered-billing", action }) as const;

export default defineRouteDocs({
  router: "api/meteredBilling.route",
  mount: "/api/v1/metered-billing",
  tag: "MeteredBilling",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/usage",
      operationId: "getUsageMetrics",
      summary: "Get current usage metrics",
      description: "The tenant's usage of every metered metric (API calls, storage, calibrations, users, …), now.",
      permission: access("read"),
      audited: false,
      success: { status: 200, description: "Usage metrics retrieved", data: tenantUsage },
    },
    {
      method: "get",
      path: "/history",
      operationId: "getMeteredBillingHistory",
      summary: "Get billing history",
      description: "The tenant's invoices, newest first, optionally between two dates.",
      permission: access("read"),
      audited: false,
      query: getBillingHistory,
      success: { status: 200, description: "A page of invoices; pagination in the top-level `meta`", list: invoiceRow },
    },
    {
      method: "post",
      path: "/estimate",
      operationId: "estimateUsageCost",
      summary: "Estimate cost for planned usage",
      description: "Prices `metrics` (units per metric) × `quantity` at the overage rate card; writes nothing.",
      permission: access("read"),
      audited: false,
      body: estimateCost,
      success: { status: 200, description: "Cost estimate calculated", data: costEstimate },
    },
    {
      method: "get",
      path: "/plan",
      operationId: "getPlanDetails",
      summary: "Get current plan details",
      description: "The tenant's plan, its included limits and the overage pricing.",
      permission: access("read"),
      audited: false,
      success: { status: 200, description: "Plan details retrieved", data: planDetails },
      errors: [404],
    },
    {
      method: "get",
      path: "/alerts",
      operationId: "listUsageAlerts",
      summary: "Get usage alerts",
      description: "The tenant's usage alerts, newest first.",
      permission: access("read"),
      audited: false,
      success: { status: 200, description: "Usage alerts retrieved (an array, not paginated)", data: z.array(usageAlertResponse) },
    },
    {
      method: "post",
      path: "/alerts",
      operationId: "createUsageAlert",
      summary: "Create a usage alert",
      permission: access("write"),
      audited: true,
      body: createUsageAlert,
      success: { status: 201, description: "Usage alert created", data: usageAlertResponse },
    },
    {
      method: "delete",
      path: "/alerts/:alertId",
      operationId: "deleteUsageAlert",
      summary: "Delete a usage alert",
      description: "Removes the alert (another tenant's answers 404).",
      permission: access("write"),
      audited: true,
      params,
      success: { status: 200, description: "Usage alert deleted; `data` is null", empty: true },
    },
    {
      method: "get",
      path: "/analytics",
      operationId: "getUsageAnalytics",
      summary: "Get analytics dashboard data",
      description: "Per-metric totals and daily trends over the period (7d, 30d, 90d or 1y), and a summary.",
      permission: access("read"),
      audited: false,
      query: getAnalytics,
      success: { status: 200, description: "Analytics data retrieved", data: usageAnalytics },
    },
  ],
});
