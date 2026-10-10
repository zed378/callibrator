/**
 * P9-18 / P9-25 (ADR-103) — the contract of `dashboard.route.ts`, code-first.
 * One read, behind `auth` and the `home` read gate (A-304, ADR-100): every
 * role holds it. A super admin gets the global view (or one tenant's, with
 * `?tenantId=`); anyone else always gets their own tenant's, and the query
 * parameter is ignored. Examples are synthetic.
 */
import { z } from "zod";
import { defineRouteDocs } from "../../docs/openapi/operation";

const count = z.number().int();
const byMonth = z.array(z.object({ month: z.string().meta({ example: "2030-01" }), count }));
const byStatus = z.record(z.string(), count);
const tenantRef = z.object({ id: z.guid(), name: z.string(), code: z.string().nullable(), status: z.string() });

/**
 * The home page's numbers (`dashboard.service#getDashboardMetrics`), field for
 * field. P9-25 item 11 (2026-10-02): this was a loose sketch; the frontend's
 * typed client exposed the gap, and it is now the service's object exactly.
 */
const DashboardMetrics = z
  .object({
    scope: z.enum(["tenant", "global"]),
    generatedAt: z.iso.datetime().meta({
      description:
        "When these figures were computed. U-06b (ADR-120): they are served from a per-tenant cache for up to 30 seconds, so this may be up to 30 s before the response",
    }),
    users: z.object({ total: count, verified: count }),
    devices: z.object({
      total: count,
      byStatus,
      dueSoon: count,
      overdue: count,
      byCondition: z
        .object({ good: count, not_good: count, broken: count, unset: count })
        .meta({ description: "P21-07 (F-70): devices per physical condition (upstream \"fit\" is stored as `good`, D-03); no condition = `unset`" }),
    }),
    calibrations: z.object({
      total: count,
      compliant: count,
      complianceRate: z.number().nullable().meta({ description: "Percentage, one decimal; null with no calibration" }),
      last30Days: count,
    }),
    certificates: z.object({ total: count, byStatus }),
    inventory: z.object({
      stockItems: count,
      totalQuantity: z.number(),
      lowStockItems: count,
      warehouses: count,
      pendingTransfers: count,
      openOpnames: count,
    }),
    maintenance: z.object({ openWorkOrders: count }),
    ipm: z
      .object({
        sessionsLast30Days: count.meta({ description: "IPM visits submitted (performed) in the last 30 days" }),
        due: z
          .object({
            scheduled: count.meta({ description: "Devices under an IPM schedule" }),
            due: count.meta({ description: "Due this month in the tenant's zone, never-inspected devices included (`GET /ipm/due`'s rule)" }),
            neverInspected: count,
          })
          .nullable()
          .meta({ description: "A tenant view only (the interval and zone are the tenant's); null in the global view" }),
      })
      .meta({ description: "P21-07 (F-70, F-73, N-9): the IPM figures" }),
    trends: z.object({ calibrations: byMonth, certificates: byMonth }),
    tenant: tenantRef.nullable().optional().meta({ description: "Tenant scope only: the tenant (null when it is gone)" }),
    tenants: z.object({ total: count, active: count }).optional().meta({ description: "Global scope only" }),
    tenantBreakdown: z
      .array(tenantRef.extend({ users: count, devices: count }))
      .optional()
      .meta({ description: "Global scope only: per tenant, its users and devices" }),
  })
  .meta({
    id: "DashboardMetrics",
    description: "Counts for the home page: users, devices (due soon, overdue), calibrations and compliance, certificates, inventory, maintenance and 12-month trends. The global view (super admin) adds tenant totals and a per-tenant breakdown.",
    example: {
      scope: "tenant",
      generatedAt: "2030-01-15T09:00:00.000Z",
      users: { total: 24, verified: 22 },
      devices: { total: 310, byStatus: { active: 290, retired: 20 }, dueSoon: 14, overdue: 3, byCondition: { good: 280, not_good: 12, broken: 8, unset: 10 } },
      calibrations: { total: 1820, compliant: 1791, complianceRate: 98.4, last30Days: 96 },
      certificates: { total: 1750, byStatus: { approved: 1700, draft: 50 } },
      inventory: { stockItems: 120, totalQuantity: 4210, lowStockItems: 6, warehouses: 3, pendingTransfers: 2, openOpnames: 1 },
      maintenance: { openWorkOrders: 7 },
      ipm: { sessionsLast30Days: 41, due: { scheduled: 290, due: 37, neverInspected: 5 } },
      trends: { calibrations: [{ month: "2030-01", count: 96 }], certificates: [{ month: "2030-01", count: 90 }] },
      tenant: { id: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f", name: "Example Hospital", code: "EXH", status: "active" },
    },
  });

export default defineRouteDocs({
  router: "api/dashboard.route",
  mount: "/api/v1/dashboard",
  tag: "Dashboard",
  tagDescription: "Aggregated dashboard metrics (tenant-scoped; global for SUPERADMIN)",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/metrics",
      operationId: "getDashboardMetrics",
      summary: "The home page's metrics",
      description:
        "A non-super-admin always gets their own tenant's numbers (`tenantId` is ignored); a facility-bound account gets its facility's only (P21-07, A-10: provider-internal figures read 0). A super admin gets the global view with a per-tenant breakdown, or one tenant's with `tenantId`. The figures are cached for 30 seconds per scope (never shared between tenants); `generatedAt` says when they were computed.",
      permission: { kind: "dynamicAccess", resource: "home", action: "read" },
      audited: false,
      query: z.object({
        tenantId: z.guid().optional().meta({ description: "Super admin only: scope to one tenant", example: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f" }),
      }),
      success: { status: 200, description: "The metrics", data: DashboardMetrics },
    },
  ],
});
