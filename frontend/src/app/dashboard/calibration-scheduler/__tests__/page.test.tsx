/** @jest-environment jsdom */
/**
 * The calibration scheduler, against calibrationScheduler.controller.js:
 *  - GET  /api/v1/calibration-scheduler/due?leadDays=&allTenants= → rows in `data`
 *  - POST /api/v1/calibration-scheduler/run → `data: { scanned, workOrdersCreated, notificationsCreated, skipped, overdue, errors, details }`
 *  - `allTenants` is honoured for the super admin only; the toggle is absent for anyone else.
 *
 * Fail-before: a failed load showed the error AND "No devices due within 30
 * days" — a calibration-compliance claim made without the data.
 *
 * Real: the page, useScheduler, the service. Mocked: the transport, the layout.
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
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import SchedulerPage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import { useToastStore } from "@/stores/toastStore";
import { httpError } from "@/tests/support/httpErrors";
import type { User } from "@/types";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const ok = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data });

const due = [
  { id: "d1", name: "Infusion Pump A", serialNumber: "SN-1", tenantId: "t1", nextCalibrationDate: "2026-09-01T00:00:00.000Z", calibrationIntervalDays: 365, overdue: true },
  { id: "d2", name: "ECG Monitor", serialNumber: null, tenantId: "t1", nextCalibrationDate: "2026-10-10T00:00:00.000Z", calibrationIntervalDays: null, overdue: false },
];
const summary = { scanned: 12, workOrdersCreated: 2, notificationsCreated: 3, skipped: 9, overdue: 1, errors: 0, details: [] };

// A-301 (ADR-102): the page reads the effective permissions (the run is
// gated on write to `maintenance`); the role name is set too.
const as = (roleName: string, permissions: Record<string, "read" | "write"> = { maintenance: "write" }) => {
  useAuthStore.setState({ user: { id: "u1", username: "ada", role: { name: roleName } } as unknown as User });
  useMenuStore.setState({ effectivePermissions: { superAdmin: roleName === "SUPERADMIN", permissions } });
};
const lastDueParams = () =>
  (mockedGet.mock.calls.at(-1)?.[1] as { params: Record<string, unknown> }).params;
const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  as("HEALTHCARE ADMIN");
  mockedGet.mockResolvedValue(ok(due, "Due calibration devices retrieved"));
});

describe("Calibration scheduler page", () => {
  it("lists due devices, overdue first-class, with interval and serial", async () => {
    const { container } = render(<SchedulerPage />);

    const overdue = (await screen.findByText("Infusion Pump A")).closest("tr") as HTMLElement;
    expect(within(overdue).getByText("Overdue")).toBeInTheDocument();
    expect(within(overdue).getByText("365")).toBeInTheDocument();
    const soon = screen.getByText("ECG Monitor").closest("tr") as HTMLElement;
    expect(within(soon).getByText("Due soon")).toBeInTheDocument();
    expect(within(soon).getByText("No serial number")).toBeInTheDocument();
    expect(within(soon).getByText("-")).toBeInTheDocument();
    expect(lastDueParams()).toEqual({ leadDays: 30, allTenants: undefined });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("nothing due: says so for the window", async () => {
    mockedGet.mockResolvedValue(ok([]));
    render(<SchedulerPage />);

    expect(await screen.findByText("No devices due within 30 days")).toBeInTheDocument();
  });

  it("a failed load shows the error, not 'no devices due'", async () => {
    mockedGet.mockRejectedValue(httpError(403, "You do not have permission to read calibration schedules"));
    const { container } = render(<SchedulerPage />);

    expect(await screen.findByText("You do not have permission to read calibration schedules")).toBeInTheDocument();
    expect(screen.queryByText(/No devices due/)).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("changing the look-ahead refetches; a negative or blank value is 0", async () => {
    render(<SchedulerPage />);
    await screen.findByText("Infusion Pump A");
    const input = screen.getByLabelText("Look-ahead (days)");

    fireEvent.change(input, { target: { value: "90" } });
    await waitFor(() => expect(lastDueParams()).toEqual({ leadDays: 90, allTenants: undefined }));
    fireEvent.change(input, { target: { value: "-5" } });
    await waitFor(() => expect(lastDueParams()).toEqual({ leadDays: 0, allTenants: undefined }));
  });

  // A-301 fail-before: the Run button was rendered for everyone who could
  // open the page, and a read-only caller's run answered 403.
  it("read-only on maintenance: the list shows, the Run button is absent", async () => {
    as("TECHNICIAN", { maintenance: "read" });
    render(<SchedulerPage />);
    await screen.findByText("Infusion Pump A");
    expect(screen.queryByRole("button", { name: /Run Scheduler/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh/ })).toBeInTheDocument();
  });

  it("a hospital admin gets no all-tenants toggle", async () => {
    render(<SchedulerPage />);
    await screen.findByText("Infusion Pump A");
    expect(screen.queryByLabelText("All tenants")).not.toBeInTheDocument();
  });

  it("the super admin can scan all tenants", async () => {
    as("SUPERADMIN");
    render(<SchedulerPage />);
    await screen.findByText("Infusion Pump A");

    fireEvent.click(screen.getByLabelText("All tenants"));
    await waitFor(() => expect(lastDueParams()).toEqual({ leadDays: 30, allTenants: "true" }));

    mockedPost.mockResolvedValue(ok(summary, "Calibration scan completed"));
    fireEvent.click(screen.getByRole("button", { name: /Run Scheduler/ }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/calibration-scheduler/run", {
        leadDays: 30,
        allTenants: true,
        tenantId: undefined,
      }),
    );
  });

  it("a run reports what it did, refreshes the list, and its summary can be dismissed", async () => {
    mockedPost.mockResolvedValue(ok({ ...summary, errors: 1 }, "Calibration scan completed"));
    render(<SchedulerPage />);
    await screen.findByText("Infusion Pump A");
    const reads = mockedGet.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /Run Scheduler/ }));

    expect(await screen.findByText("Scheduler run complete")).toBeInTheDocument();
    expect(screen.getByText(/2 work order\(s\) and 3 notification\(s\) created/)).toBeInTheDocument();
    expect(screen.getByText("Work Orders Created")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/calibration-scheduler/run", {
      leadDays: 30,
      allTenants: undefined,
      tenantId: undefined,
    });
    await waitFor(() => expect(mockedGet.mock.calls.length).toBe(reads + 1));
    expect(toasts()).toEqual([
      expect.objectContaining({ type: "success", title: "Scheduler complete: 2 work order(s), 3 notification(s) created" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: /close|dismiss/i }));
    expect(screen.queryByText("Scheduler run complete")).not.toBeInTheDocument();
  });

  it("a refused run is reported and nothing is summarised", async () => {
    mockedPost.mockRejectedValue(httpError(403, "Only the super admin may scan all tenants"));
    render(<SchedulerPage />);
    await screen.findByText("Infusion Pump A");

    fireEvent.click(screen.getByRole("button", { name: /Run Scheduler/ }));

    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ type: "error", title: "Only the super admin may scan all tenants" })]));
    expect(screen.queryByText("Scheduler run complete")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run Scheduler/ })).toBeEnabled();
  });

  it("refresh reloads the list", async () => {
    render(<SchedulerPage />);
    await screen.findByText("Infusion Pump A");
    const reads = mockedGet.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));

    await waitFor(() => expect(mockedGet.mock.calls.length).toBe(reads + 1));
  });
});
