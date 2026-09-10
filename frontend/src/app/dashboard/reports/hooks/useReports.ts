// src/app/dashboard/reports/hooks/useReports.ts
import { useCallback, useEffect, useState } from "react";
import { useToastStore } from "@/stores/toastStore";
import {
  reportService,
  ReportSummary,
  ComplianceReport,
  CalibrationWorkload,
  OverdueDevicesReport,
  InventoryReport,
} from "@/api/services/report.service";

export type ReportsTab =
  | "overview"
  | "compliance"
  | "workload"
  | "overdue"
  | "inventory";

const downloadCsv = (filename: string, csvContent: string) => {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export function useReports() {
  const { addToast } = useToastStore();

  const [activeTab, setActiveTab] = useState<ReportsTab>("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Data per section
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [compliance, setCompliance] = useState<ComplianceReport | null>(null);
  const [workload, setWorkload] = useState<CalibrationWorkload | null>(null);
  const [overdue, setOverdue] = useState<OverdueDevicesReport | null>(null);
  const [inventory, setInventory] = useState<InventoryReport | null>(null);

  // Compliance date range filter
  const [complianceFrom, setComplianceFrom] = useState("");
  const [complianceTo, setComplianceTo] = useState("");
  // Applied values (only change when the user clicks Apply)
  const [appliedRange, setAppliedRange] = useState<{
    from: string;
    to: string;
  }>({ from: "", to: "" });

  const fetchForTab = useCallback(
    async (tab: ReportsTab, range?: { from: string; to: string }) => {
      setIsLoading(true);
      setError(null);
      try {
        if (tab === "overview") {
          setSummary(await reportService.getSummary());
        } else if (tab === "compliance") {
          const r = range ?? appliedRange;
          setCompliance(await reportService.getCompliance(r.from, r.to));
        } else if (tab === "workload") {
          setWorkload(await reportService.getCalibrationWorkload());
        } else if (tab === "overdue") {
          setOverdue(await reportService.getOverdueDevices());
        } else if (tab === "inventory") {
          setInventory(await reportService.getInventory());
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load report data",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [appliedRange],
  );

  useEffect(() => {
    fetchForTab(activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleTabChange = (tab: ReportsTab) => {
    setActiveTab(tab);
    setError(null);
  };

  const handleApplyComplianceRange = () => {
    const range = { from: complianceFrom, to: complianceTo };
    setAppliedRange(range);
    fetchForTab("compliance", range);
  };

  const runExport = async (
    exporter: () => Promise<string>,
    filename: string,
  ) => {
    setIsExporting(true);
    try {
      const csv = await exporter();
      downloadCsv(filename, csv);
      addToast({ type: "success", title: "Export downloaded" });
    } catch (err) {
      addToast({
        type: "error",
        title: err instanceof Error ? err.message : "Failed to export CSV",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportCompliance = () =>
    runExport(
      () =>
        reportService.exportComplianceCsv(appliedRange.from, appliedRange.to),
      "compliance-report.csv",
    );

  const handleExportOverdue = () =>
    runExport(
      () => reportService.exportOverdueDevicesCsv(),
      "overdue-devices.csv",
    );

  const handleExportInventory = () =>
    runExport(
      () => reportService.exportInventoryCsv(),
      "inventory-report.csv",
    );

  return {
    activeTab,
    handleTabChange,
    isLoading,
    error,
    isExporting,
    summary,
    compliance,
    workload,
    overdue,
    inventory,
    complianceFrom,
    setComplianceFrom,
    complianceTo,
    setComplianceTo,
    handleApplyComplianceRange,
    handleExportCompliance,
    handleExportOverdue,
    handleExportInventory,
  };
}

export default useReports;
