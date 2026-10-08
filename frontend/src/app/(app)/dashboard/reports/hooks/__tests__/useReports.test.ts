/**
 * useReports — one fetch per tab; applying a compliance range refetches with
 * it (F-03 removed an exhaustive-deps suppression here: the refetch is now
 * driven by the effect's real dependencies, and this proves it still happens);
 * CSV exports download or say why not.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

const reportService = {
  getSummary: jest.fn(), getCompliance: jest.fn(), getCalibrationWorkload: jest.fn(),
  getOverdueDevices: jest.fn(), getInventory: jest.fn(), exportComplianceCsv: jest.fn(),
  exportOverdueDevicesCsv: jest.fn(), exportInventoryCsv: jest.fn(),
};
jest.mock("@/api/services/report.service", () => ({ reportService }));

import { useReports } from "../useReports";
import { useToastStore } from "@/stores/toastStore";

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  reportService.getSummary.mockResolvedValue({ devices: 3 });
  reportService.getCompliance.mockResolvedValue({ rate: 0.9 });
  reportService.getCalibrationWorkload.mockResolvedValue({ due: 1 });
  reportService.getOverdueDevices.mockResolvedValue({ rows: [] });
  reportService.getInventory.mockResolvedValue({ items: 2 });
  URL.createObjectURL = jest.fn(() => "blob:x");
  URL.revokeObjectURL = jest.fn();
});

describe("useReports", () => {
  it("loads the overview first, then each tab when it is opened", async () => {
    const { result } = renderHook(() => useReports());
    await waitFor(() => expect(result.current.summary).toEqual({ devices: 3 }));
    expect(result.current.isLoading).toBe(false);

    for (const [tab, key, method] of [
      ["workload", "workload", reportService.getCalibrationWorkload],
      ["overdue", "overdue", reportService.getOverdueDevices],
      ["inventory", "inventory", reportService.getInventory],
      ["compliance", "compliance", reportService.getCompliance],
    ] as const) {
      act(() => result.current.handleTabChange(tab));
      await waitFor(() => expect(method).toHaveBeenCalled());
      await waitFor(() => expect(result.current[key]).not.toBeNull());
    }
    expect(reportService.getCompliance).toHaveBeenLastCalledWith("", "");
  });

  it("applying a compliance range refetches the compliance report with it", async () => {
    const { result } = renderHook(() => useReports());
    act(() => result.current.handleTabChange("compliance"));
    await waitFor(() => expect(reportService.getCompliance).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.setComplianceFrom("2026-01-01");
      result.current.setComplianceTo("2026-06-30");
    });
    expect(reportService.getCompliance).toHaveBeenCalledTimes(1); // typing does not fetch
    act(() => result.current.handleApplyComplianceRange());
    await waitFor(() =>
      expect(reportService.getCompliance).toHaveBeenLastCalledWith("2026-01-01", "2026-06-30"),
    );
  });

  it("a failed load is the tab's error", async () => {
    reportService.getSummary.mockRejectedValue(new Error("Reports unavailable"));
    const { result } = renderHook(() => useReports());
    await waitFor(() => expect(result.current.error).toBe("Reports unavailable"));
    act(() => result.current.handleTabChange("workload"));
    expect(result.current.error).toBeNull();
  });

  it("exports download a CSV; a failed export says why", async () => {
    const { result } = renderHook(() => useReports());
    await waitFor(() => expect(result.current.summary).not.toBeNull());
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    reportService.exportOverdueDevicesCsv.mockResolvedValue("a,b\n1,2");
    await act(async () => result.current.handleExportOverdue());
    expect(click).toHaveBeenCalled();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ type: "success" });

    reportService.exportInventoryCsv.mockRejectedValue(new Error("Too many rows"));
    await act(async () => result.current.handleExportInventory());
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ type: "error", title: "Too many rows" });

    reportService.exportComplianceCsv.mockResolvedValue("x");
    await act(async () => result.current.handleExportCompliance());
    expect(reportService.exportComplianceCsv).toHaveBeenCalledWith("", "");
    expect(result.current.isExporting).toBe(false);
    click.mockRestore();
  });
});
