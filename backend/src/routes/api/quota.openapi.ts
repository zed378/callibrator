/**
 * P9-21 / P9-25 (ADR-103) — the contract of `quota.route.ts`, code-first. One
 * read, behind `auth` and the `billing` read gate (AZ-01 / G-03, ADR-088): the
 * billing page's plan card is its only consumer. Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";

/** A limit: a number, or null for unlimited. */
const Limit = z.number().nullable();

/** The tenant's plan and usage (`quota.service#getUsageSummary`). */
const QuotaUsage = z
  .object({
    plan: z.string().nullable(),
    status: z.string().nullable(),
    features: z.array(z.string()),
    seats: z.object({ used: z.number().int(), limit: Limit }),
    storage: z.object({ usedMb: z.number(), limitMb: Limit }),
  })
  .meta({
    id: "QuotaUsage",
    description: "The caller's tenant: its plan and status, seats used against the limit, storage used against the limit (MB), and the features the plan unlocks.",
    example: {
      plan: "professional",
      status: "active",
      features: ["calibration", "certificates", "qms"],
      seats: { used: 12, limit: 50 },
      storage: { usedMb: 812.45, limitMb: 10240 },
    },
  });

export default defineRouteDocs({
  router: "api/quota.route",
  mount: "/api/v1/quota",
  tag: "Quota",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "getQuotaUsage",
      summary: "The current tenant's plan, quota usage and features",
      description: "404 when the caller's tenant cannot be read.",
      permission: { kind: "dynamicAccess", resource: "billing", action: "read" },
      audited: false,
      errors: [404],
      success: { status: 200, description: "The plan and usage", data: QuotaUsage },
    },
  ],
});
