// src/api/services/report.service.ts
//
// P9-25 (ADR-103 item 11): the JSON reads are on the GENERATED client and every
// type is the contract's (backend/src/routes/api/reports.openapi.ts); the names
// are unchanged. The CSV exports stay on `api` (text, not the envelope).
import { api } from "../client";
import { typedApi, unwrap, type components } from "../typed";

// ---------- Types ----------

type S = components["schemas"];

export type ReportSummary = S["SummaryReport"];
export type ComplianceReport = S["ComplianceReport"];
export type ComplianceSummary = ComplianceReport["summary"];
export type CalibrationWorkload = S["CalibrationWorkloadReport"];
export type OverdueDevicesReport = S["OverdueDevicesReport"];
export type OverdueDeviceRow = OverdueDevicesReport["rows"][number];
export type InventoryReport = S["InventoryStockReport"];
export type InventoryReportRow = InventoryReport["rows"][number];

// ---------- Service ----------

export const reportService = {
  getSummary: async (): Promise<ReportSummary> =>
    (await typedApi.GET("/api/v1/reports/summary").then(unwrap)).data,

  getCompliance: async (from?: string, to?: string): Promise<ComplianceReport> =>
    (
      await typedApi
        .GET("/api/v1/reports/compliance", { params: { query: { from: from || undefined, to: to || undefined } } })
        .then(unwrap)
    ).data,

  getCalibrationWorkload: async (): Promise<CalibrationWorkload> =>
    (await typedApi.GET("/api/v1/reports/calibration-workload").then(unwrap)).data,

  getOverdueDevices: async (): Promise<OverdueDevicesReport> =>
    (await typedApi.GET("/api/v1/reports/overdue-devices").then(unwrap)).data,

  getInventory: async (): Promise<InventoryReport> =>
    (await typedApi.GET("/api/v1/reports/inventory").then(unwrap)).data,

  // ---------- CSV exports ----------

  exportComplianceCsv: async (from?: string, to?: string): Promise<string> => {
    return api.get<string>("/api/v1/reports/compliance", {
      params: { format: "csv", from: from || undefined, to: to || undefined },
      responseType: "text",
    });
  },

  exportOverdueDevicesCsv: async (): Promise<string> => {
    return api.get<string>("/api/v1/reports/overdue-devices", {
      params: { format: "csv" },
      responseType: "text",
    });
  },

  exportInventoryCsv: async (): Promise<string> => {
    return api.get<string>("/api/v1/reports/inventory", {
      params: { format: "csv" },
      responseType: "text",
    });
  },
};

export default reportService;
