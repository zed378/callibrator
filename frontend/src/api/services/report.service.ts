// src/api/services/report.service.ts
import { api } from "../client";

// ---------- Types ----------

export interface ComplianceSummary {
  total: number;
  compliant: number;
  nonCompliant: number;
  unknown: number;
  complianceRate: number;
}

export interface ReportSummary {
  devices: {
    byStatus: Record<string, number>;
    overdue: number;
  };
  certificates: {
    byStatus: Record<string, number>;
  };
  workOrders: {
    byStatus: Record<string, number>;
  };
  compliance: ComplianceSummary;
  inventory: {
    totalItems: number;
    totalQuantity: number;
    lowStockCount: number;
  };
}

export interface ComplianceReport {
  summary: ComplianceSummary;
}

export interface CalibrationWorkload {
  workOrders: {
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    byPriority: Record<string, number>;
  };
  upcomingDue: {
    in30Days: number;
    in60Days: number;
    in90Days: number;
  };
}

export interface OverdueDeviceRow {
  id: string;
  name: string;
  serialNumber: string;
  category: string;
  nextCalibrationDate: string;
  daysOverdue: number;
}

export interface OverdueDevicesReport {
  total: number;
  rows: OverdueDeviceRow[];
}

export interface InventoryReportRow {
  itemName: string;
  sku: string;
  quantity: number;
  minQuantity: number;
  lowStock: boolean;
}

export interface InventoryReport {
  summary: {
    totalItems: number;
    totalQuantity: number;
    lowStockCount: number;
  };
  lowStock: InventoryReportRow[];
  rows: InventoryReportRow[];
}

// Backend response envelope
interface BackendResponse<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ---------- Service ----------

export const reportService = {
  getSummary: async (): Promise<ReportSummary> => {
    const response = await api.get<BackendResponse<ReportSummary>>(
      "/api/v1/reports/summary",
    );
    return response.data;
  },

  getCompliance: async (
    from?: string,
    to?: string,
  ): Promise<ComplianceReport> => {
    const response = await api.get<BackendResponse<ComplianceReport>>(
      "/api/v1/reports/compliance",
      { params: { from: from || undefined, to: to || undefined } },
    );
    return response.data;
  },

  getCalibrationWorkload: async (): Promise<CalibrationWorkload> => {
    const response = await api.get<BackendResponse<CalibrationWorkload>>(
      "/api/v1/reports/calibration-workload",
    );
    return response.data;
  },

  getOverdueDevices: async (): Promise<OverdueDevicesReport> => {
    const response = await api.get<BackendResponse<OverdueDevicesReport>>(
      "/api/v1/reports/overdue-devices",
    );
    return response.data;
  },

  getInventory: async (): Promise<InventoryReport> => {
    const response = await api.get<BackendResponse<InventoryReport>>(
      "/api/v1/reports/inventory",
    );
    return response.data;
  },

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
