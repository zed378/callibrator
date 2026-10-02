/**
 * P9-18 / P9-25 (ADR-103) — the contract of `reports.route.ts`, code-first.
 *
 * Every report sits behind `auth` and the seeded `reports` read gate (AZ-01 /
 * G-02): every seeded role holds it, and a custom role or an API key needs it
 * (`reports:read`). Every report is the caller's tenant only. Three reports
 * also answer a CSV download with `?format=csv`; the JSON answer is documented
 * here. Examples are synthetic.
 *
 * As built (A-343): the overdue-devices and inventory reports carry their rows
 * at `data.rows` — the report object is the data. Documented as it is.
 */
import { z } from "zod";
import { defineRouteDocs, type DocumentedOperation } from "../../docs/openapi/operation";

const counts = z.record(z.string(), z.number().int());
const ComplianceSummary = z
  .object({ total: z.number().int(), compliant: z.number().int(), nonCompliant: z.number().int(), unknown: z.number().int(), complianceRate: z.number() })
  .meta({ id: "ReportComplianceSummary", example: { total: 120, compliant: 112, nonCompliant: 6, unknown: 2, complianceRate: 93.33 } });
const InventorySummary = z.object({ totalItems: z.number().int(), totalQuantity: z.number(), lowStockCount: z.number().int() });
const InventoryRow = z.object({}).loose();

const SummaryReport = z
  .object({
    devices: z.object({ byStatus: counts, overdue: z.number().int() }),
    certificates: z.object({ byStatus: counts }),
    workOrders: z.object({ byStatus: counts }),
    compliance: ComplianceSummary,
    inventory: InventorySummary,
  })
  .meta({ id: "SummaryReport", description: "The dashboard rollup." });
const ComplianceReport = z.object({ summary: ComplianceSummary }).meta({ id: "ComplianceReport" });
const WorkloadReport = z
  .object({
    workOrders: z.object({ byStatus: counts, byType: counts, byPriority: counts }),
    upcomingDue: z.object({ in30Days: z.number().int(), in60Days: z.number().int(), in90Days: z.number().int() }),
  })
  .meta({ id: "CalibrationWorkloadReport" });
const OverdueReport = z
  .object({
    total: z.number().int(),
    rows: z.array(
      z.object({
        id: z.guid(),
        name: z.string(),
        serialNumber: z.string().nullable(),
        category: z.string().nullable(),
        nextCalibrationDate: z.string(),
        daysOverdue: z.number().int(),
      }),
    ),
  })
  .meta({ id: "OverdueDevicesReport", description: "As built (A-343): the rows are at `data.rows`." });
const InventoryReport = z
  .object({ summary: InventorySummary, lowStock: z.array(InventoryRow), rows: z.array(InventoryRow) })
  .meta({ id: "InventoryStockReport", description: "As built (A-343): the rows are at `data.rows`." });

const csvQuery = z.object({
  format: z.enum(["json", "csv"]).optional().meta({ description: "`csv` answers a CSV download (text/csv) instead of JSON", example: "json" }),
});
const PERMISSION = { kind: "dynamicAccess", resource: "reports", action: "read" } as const;
const report = (op: Omit<DocumentedOperation, "method" | "permission" | "audited">): DocumentedOperation => ({
  method: "get",
  permission: PERMISSION,
  audited: false,
  ...op,
});

export default defineRouteDocs({
  router: "api/reports.route",
  mount: "/api/v1/reports",
  tag: "Reports",
  tagDescription: "Tenant-scoped analytics and reporting",
  tenantScoped: true,
  operations: [
    report({
      path: "/summary",
      operationId: "getReportsSummary",
      summary: "Dashboard rollup (devices, certificates, work orders, compliance, inventory)",
      success: { status: 200, description: "The report", data: SummaryReport },
    }),
    report({
      path: "/compliance",
      operationId: "getReportsCompliance",
      summary: "Calibration compliance rate (JSON or CSV via ?format=csv)",
      query: csvQuery.extend({
        from: z.string().optional().meta({ description: "Calibration date from (inclusive)", example: "2030-01-01" }),
        to: z.string().optional().meta({ description: "Calibration date to (inclusive)", example: "2030-03-31" }),
      }),
      success: { status: 200, description: "The report", data: ComplianceReport },
    }),
    report({
      path: "/calibration-workload",
      operationId: "getReportsCalibrationWorkload",
      summary: "Work orders by status, type and priority, and upcoming due counts",
      success: { status: 200, description: "The report", data: WorkloadReport },
    }),
    report({
      path: "/overdue-devices",
      operationId: "getReportsOverdueDevices",
      summary: "Devices overdue for calibration (JSON or CSV via ?format=csv)",
      query: csvQuery,
      success: { status: 200, description: "The report", data: OverdueReport },
    }),
    report({
      path: "/inventory",
      operationId: "getReportsInventory",
      summary: "Inventory summary and low stock (JSON or CSV via ?format=csv)",
      query: csvQuery,
      success: { status: 200, description: "The report", data: InventoryReport },
    }),
  ],
});
