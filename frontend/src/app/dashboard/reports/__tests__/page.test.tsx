/** @jest-environment jsdom */
/**
 * Reports, against the backend contract (reporting.controller.js):
 *  - GET /api/v1/reports/{summary,compliance,calibration-workload,overdue-devices,inventory}
 *    → `data`: the report object (JSON);
 *  - the same with `?format=csv` → the CSV text itself (Content-Type text/csv).
 *
 * A failed report shows the error and never a section's "no data" message —
 * for Overdue Devices that message is "All devices are within their
 * calibration schedule", a compliance claim the page cannot make without the
 * data. Fail-before: every tab rendered the error AND its empty state.
 *
 * Real: the page, useReports, the report service. Mocked: the transport,
 * the layout, and the object-URL API jsdom lacks.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () =>
  function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  },
);
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn() },
}));

import { api } from "@/api/client";
import ReportsPage from "../page";
import { useToastStore } from "@/stores/toastStore";
import { httpError } from "@/tests/support/httpErrors";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const ok = (data: unknown) => ({ success: true, status: 200, message: "Report generated", data });

const summary = {
  devices: { byStatus: { active: 40, in_repair: 2 }, overdue: 3 },
  certificates: { byStatus: {} },
  workOrders: { byStatus: { openOrders: 5 } },
  compliance: { total: 43, compliant: 38, nonCompliant: 3, unknown: 2, complianceRate: 88 },
  inventory: { totalItems: 12, totalQuantity: 1500, lowStockCount: 0 },
};
const compliance = { summary: { total: 43, compliant: 42, nonCompliant: 0, unknown: 1, complianceRate: 97 } };
const workload = {
  workOrders: { byStatus: { open: 2 }, byType: {}, byPriority: { high: 1 } },
  upcomingDue: { in30Days: 4, in60Days: 0, in90Days: 9 },
};
const overdue = {
  total: 1,
  rows: [{ id: "d1", name: "Infusion Pump A", serialNumber: "SN-1", category: "Pumps", nextCalibrationDate: "2026-08-01T00:00:00.000Z", daysOverdue: 59 }],
};
const inventory = {
  summary: { totalItems: 2, totalQuantity: 45, lowStockCount: 1 },
  lowStock: [],
  rows: [
    { itemName: "Syringe 10ml", sku: "SYR-10", quantity: 40, minQuantity: 10, lowStock: false },
    { itemName: "Probe cover", sku: "PC-1", quantity: 5, minQuantity: 20, lowStock: true },
  ],
};

type Answers = Record<string, unknown>;
let answers: Answers;
const backend = () =>
  mockedGet.mockImplementation(async (url: string, cfg?: { params?: Record<string, unknown> }) => {
    const key = url.replace("/api/v1/reports/", "") + (cfg?.params?.format === "csv" ? ".csv" : "");
    const a = answers[key];
    if (a instanceof Error) throw a;
    if (a === undefined) throw new Error(`unexpected GET ${url}`);
    return a;
  });

const tab = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const toasts = () => useToastStore.getState().toasts;

let createObjectURL: jest.Mock;
beforeAll(() => {
  createObjectURL = jest.fn(() => "blob:report");
  Object.assign(URL, { createObjectURL, revokeObjectURL: jest.fn() });
});

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  answers = {
    summary: ok(summary),
    compliance: ok(compliance),
    "calibration-workload": ok(workload),
    "overdue-devices": ok(overdue),
    inventory: ok(inventory),
    "compliance.csv": "device,compliant\nA,yes\n",
    "overdue-devices.csv": "device,daysOverdue\nA,59\n",
    "inventory.csv": "item,quantity\nSyringe,40\n",
  };
  backend();
});

describe("Reports page", () => {
  it("the overview shows the headline metrics and breakdowns", async () => {
    const { container } = render(<ReportsPage />);

    expect(await screen.findByText("88%")).toBeInTheDocument();
    expect(screen.getByText("38 of 43 devices compliant")).toBeInTheDocument();
    expect(screen.getByText("In Repair")).toBeInTheDocument();
    expect(screen.getByText("Open Orders")).toBeInTheDocument();
    expect(screen.getByText("No certificates issued.")).toBeInTheDocument();
    expect(screen.getByText("1,500 total units")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it.each([
    ["Overview", "summary", /No report data available yet/],
    ["Workload", "calibration-workload", /No workload data available yet/],
    ["Overdue Devices", "overdue-devices", /No Overdue Devices/],
    ["Inventory", "inventory", /No Inventory Items/],
    ["Compliance", "compliance", /No compliance data available/],
  ])("%s: a failed report shows the error, and no empty state", async (name, key, empty) => {
    answers[key] = httpError(403, "You do not have permission to read reports");
    const { container } = render(<ReportsPage />);
    if (name !== "Overview") {
      await screen.findByText(/88%|You do not have permission/);
      tab(name);
    }

    expect(await screen.findByText("You do not have permission to read reports")).toBeInTheDocument();
    expect(screen.queryByText(empty)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("the compliance range is applied only on Apply", async () => {
    render(<ReportsPage />);
    await screen.findByText("88%");
    tab("Compliance");
    expect(await screen.findByText("97%")).toBeInTheDocument();

    const calls = mockedGet.mock.calls.length;
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-30" } });
    // Typing a date requests nothing.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockedGet.mock.calls.length).toBe(calls);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith("/api/v1/reports/compliance", {
        params: { from: "2026-01-01", to: "2026-06-30" },
      }),
    );
  });

  it("exports the compliance CSV for the applied range", async () => {
    render(<ReportsPage />);
    await screen.findByText("88%");
    tab("Compliance");
    await screen.findByText("97%");

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "success", title: "Export downloaded" })]));
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/reports/compliance", {
      params: { format: "csv", from: undefined, to: undefined },
      responseType: "text",
    });
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8;");
  });

  it("workload shows the upcoming calibrations and work-order breakdowns", async () => {
    render(<ReportsPage />);
    await screen.findByText("88%");
    tab("Workload");

    expect(await screen.findByText("Due in 30 Days")).toBeInTheDocument();
    expect(screen.getByText("9")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getAllByText("No work orders.")).toHaveLength(1);
  });

  it("overdue devices lists each device with its days overdue, and exports", async () => {
    render(<ReportsPage />);
    await screen.findByText("88%");
    tab("Overdue Devices");

    const row = (await screen.findByText("Infusion Pump A")).closest("tr") as HTMLElement;
    expect(within(row).getByText("59 days")).toBeInTheDocument();
    expect(within(row).getByText("SN-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ title: "Export downloaded" })]));
  });

  it("no overdue devices: says so", async () => {
    answers["overdue-devices"] = ok({ total: 0, rows: [] });
    render(<ReportsPage />);
    await screen.findByText("88%");
    tab("Overdue Devices");

    expect(await screen.findByText("No Overdue Devices")).toBeInTheDocument();
  });

  it("inventory marks low stock, and a failed export is reported", async () => {
    answers["inventory.csv"] = httpError(500, "Export failed on the server");
    render(<ReportsPage />);
    await screen.findByText("88%");
    tab("Inventory");

    const low = (await screen.findByText("Probe cover")).closest("tr") as HTMLElement;
    expect(within(low).getByText("Low Stock")).toBeInTheDocument();
    expect(within(screen.getByText("Syringe 10ml").closest("tr") as HTMLElement).getByText("OK")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: "Export failed on the server" })]));
  });

  it("no inventory: says so", async () => {
    answers.inventory = ok({ summary: { totalItems: 0, totalQuantity: 0, lowStockCount: 0 }, lowStock: [], rows: [] });
    render(<ReportsPage />);
    await screen.findByText("88%");
    tab("Inventory");

    expect(await screen.findByText("No Inventory Items")).toBeInTheDocument();
  });
});
