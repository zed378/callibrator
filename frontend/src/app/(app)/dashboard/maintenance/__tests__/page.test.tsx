/** @jest-environment jsdom */
/**
 * The maintenance work-orders screen, against the backend contract
 * (maintenance.controller.js list → success(res, rows, meta): rows in `data`,
 * pagination in a top-level `meta`; PATCH /maintenance/:id; DELETE /maintenance/:id).
 *
 * Real: the page, useMaintenance, the maintenance / device / vendor services,
 * the toast store. Mocked: the HTTP client and the dashboard chrome.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import MaintenancePage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

const envelope = (data: unknown, meta?: Record<string, number>) => ({
  success: true,
  status: 200,
  message: "ok",
  data,
  ...(meta ? { meta } : {}),
});

const httpError = (status: number, message: string) =>
  new AxiosError(message, "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    data: { success: false, status, message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const order = (patch: Record<string, unknown> = {}) => ({
  id: "wo-1",
  deviceId: "dev-1",
  title: "Quarterly PM",
  description: "Replace filters",
  type: "Preventative",
  status: "InProgress",
  priority: "Critical",
  vendorId: "v-1",
  device: { id: "dev-1", name: "Ventilator", serialNumber: "VN-1" },
  vendor: { id: "v-1", name: "MedServ" },
  assignee: { id: "u-3", firstName: "Grace", lastName: "Hopper" },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...patch,
});

let orders: unknown[] = [];

const backend = () => {
  get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/maintenance")
      return envelope(orders, { total: orders.length, page: 1, limit: 10, totalPages: 1 });
    if (url === "/api/v1/calibration-devices")
      return envelope([{ id: "dev-1", name: "Ventilator", serialNumber: "VN-1" }, { id: "dev-2", name: "Monitor" }], {
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      });
    if (url === "/api/v1/vendors") return envelope([{ id: "v-1", name: "MedServ" }], { total: 1, page: 1, limit: 100, totalPages: 1 });
    throw new Error(`unexpected GET ${url}`);
  });
};

/**
 * ADR-102: write controls follow the EFFECTIVE permissions (loaded with the
 * menu), not the role name. The seeded admin roles hold `equipment` write,
 * which `maintenance` inherits; every other seeded role holds read.
 */
const MAINTENANCE_WRITERS = ["SUPERADMIN", "HEALTHCARE ADMIN", "CALIBRATOR ADMIN"];
const as = (roleName: string) => {
  useAuthStore.setState({
    user: { id: "u-1", username: "ada", email: "a@x.test", role: { id: "r", name: roleName } } as User,
  });
  useMenuStore.setState({
    effectivePermissions: {
      superAdmin: false,
      permissions: { maintenance: MAINTENANCE_WRITERS.includes(roleName) ? "write" : "read" },
    },
  });
};

type Grants = Record<string, "read" | "write">;
const grant = (permissions: Grants | null, superAdmin = false) =>
  useMenuStore.setState({ effectivePermissions: permissions === null ? null : { superAdmin, permissions } });

const listCalls = () => get.mock.calls.filter(([url]) => url === "/api/v1/maintenance");
const toasts = () => useToastStore.getState().toasts;

beforeEach(() => {
  jest.clearAllMocks();
  orders = [
    order(),
    order({ id: "wo-2", title: "Broken hose", type: "Repair", status: "Open", priority: "Low", vendor: null, vendorId: null, assignee: null, device: null, description: null }),
  ];
  useToastStore.setState({ toasts: [] });
  as("CALIBRATOR ADMIN");
  backend();
});

const renderPage = async () => {
  const view = render(<MaintenancePage />);
  await screen.findByText("Quarterly PM");
  return view;
};

describe("maintenance page — list states", () => {
  it("shows a skeleton while loading, not the empty state", async () => {
    get.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(<MaintenancePage />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("No work orders found")).not.toBeInTheDocument();
  });

  it("renders the work orders with their badges, vendor and assignee, and passes an accessibility check", async () => {
    const { container } = await renderPage();

    const first = screen.getByText("Quarterly PM").closest("tr") as HTMLElement;
    expect(within(first).getByText("Ventilator (VN-1)")).toBeInTheDocument();
    expect(within(first).getByText("Critical")).toBeInTheDocument();
    expect(within(first).getByText("In Progress")).toBeInTheDocument();
    expect(within(first).getByText("MedServ")).toBeInTheDocument();
    expect(within(first).getByText("Grace Hopper")).toBeInTheDocument();

    const second = screen.getByText("Broken hose").closest("tr") as HTMLElement;
    expect(within(second).getByText("Unknown device")).toBeInTheDocument();
    expect(within(second).getByText("Open")).toBeInTheDocument();
    // Vendor, assignee, and (Q-55) schedule and cost: none set.
    expect(within(second).getAllByText("-")).toHaveLength(4);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names an assignee by username, then email, when they have no name", async () => {
    orders = [
      order({ id: "a", title: "By username", assignee: { id: "x", username: "gh" } }),
      order({ id: "b", title: "By email", assignee: { id: "y", email: "g@x.test" } }),
    ];
    render(<MaintenancePage />);

    expect(await screen.findByText("gh")).toBeInTheDocument();
    expect(screen.getByText("g@x.test")).toBeInTheDocument();
  });

  it("renders the empty state when there are no work orders", async () => {
    orders = [];
    const { container } = render(<MaintenancePage />);

    expect(await screen.findByText("No work orders found")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a FAILED load shows the backend's error, never the empty state", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/maintenance") throw httpError(500, "Work orders unavailable");
      return envelope([]);
    });
    const { container } = render(<MaintenancePage />);

    expect(await screen.findByText("Work orders unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No work orders found")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("each filter re-queries from page 1", async () => {
    await renderPage();

    fireEvent.change(screen.getByPlaceholderText("Search title or description..."), { target: { value: "pm" } });
    await waitFor(() => expect(listCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ find: "pm", page: 1 }) }));

    fireEvent.click(screen.getByRole("button", { name: "All Statuses" }));
    fireEvent.click(screen.getByRole("option", { name: "Completed" }));
    await waitFor(() => expect(listCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ status: "Completed" }) }));

    fireEvent.click(screen.getByRole("button", { name: "All Priorities" }));
    fireEvent.click(screen.getByRole("option", { name: "High" }));
    await waitFor(() => expect(listCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ priority: "High" }) }));

    fireEvent.click(screen.getByRole("button", { name: "All Types" }));
    fireEvent.click(screen.getByRole("option", { name: "Breakdown" }));
    await waitFor(() =>
      expect(listCalls().at(-1)?.[1]).toEqual({
        params: { page: 1, limit: 10, find: "pm", status: "Completed", priority: "High", type: "Breakdown" },
      }),
    );
  });
});

describe("maintenance page — permissions (ADR-102)", () => {
  const writeControlsAbsent = () => {
    expect(screen.queryByRole("button", { name: /New Work Order/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Quarterly PM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Quarterly PM" })).not.toBeInTheDocument();
  };

  it("read access on `maintenance` gets no create, edit or delete control", async () => {
    grant({ maintenance: "read" });
    await renderPage();
    writeControlsAbsent();
  });

  it("permissions not loaded (or failed to load) offer no write control", async () => {
    grant(null);
    await renderPage();
    writeControlsAbsent();
  });

  it("write on another menu only does not unlock work-order writes", async () => {
    grant({ calibration: "write" });
    await renderPage();
    writeControlsAbsent();
  });

  it("write access on `maintenance` gets create, edit and delete", async () => {
    await renderPage();
    expect(screen.getByRole("button", { name: /New Work Order/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Quarterly PM" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Quarterly PM" })).toBeInTheDocument();
  });

  it("the platform super admin gets the write controls whatever the grants", async () => {
    grant({}, true);
    await renderPage();
    expect(screen.getByRole("button", { name: /New Work Order/ })).toBeInTheDocument();
  });
});

describe("maintenance page — create, edit, delete", () => {
  it("refuses to save without a device, and says so", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New Work Order/ }));
    const dialog = screen.getByRole("dialog", { name: "New Work Order" });
    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "Check" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Work Order" }));

    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "error", title: "Please select a device" }));
    expect(post).not.toHaveBeenCalled();
  });

  it("creates a work order with the trimmed fields, confirms it, and reloads", async () => {
    post.mockResolvedValue(envelope(order({ id: "wo-3" })));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New Work Order/ }));
    const dialog = screen.getByRole("dialog", { name: "New Work Order" });
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: /Device/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Monitor" }));
    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "  Annual check  " } });
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "   " } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Type/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Breakdown" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Priority/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "High" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Vendor/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "MedServ" }));
    const before = listCalls().length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Work Order" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/v1/maintenance", {
        deviceId: "dev-2",
        title: "Annual check",
        type: "Breakdown",
        description: undefined,
        priority: "High",
        status: "Open",
        vendorId: "v-1",
      }),
    );
    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "success", title: "Work order created" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
  });

  it("edits a work order with PATCH on its id", async () => {
    patch.mockResolvedValue(envelope(order({ status: "Completed" })));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit Quarterly PM" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Work Order" });
    expect(within(dialog).getByLabelText(/Title/)).toHaveValue("Quarterly PM");
    fireEvent.click(within(dialog).getByRole("button", { name: /Status/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Completed" }));
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Done" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/api/v1/maintenance/wo-1", {
        deviceId: "dev-1",
        title: "Quarterly PM",
        type: "Preventative",
        description: "Done",
        priority: "Critical",
        status: "Completed",
        vendorId: "v-1",
        // Q-55: blank on the form, so sent as null (an edit clears what is blank).
        scheduledDate: null,
        estimatedCost: null,
        completedDate: null,
        actualCost: null,
        resolutionNotes: null,
      }),
    );
    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "success", title: "Work order updated" }));
  });

  it("a refused transition (409) is reported with the backend's explanation and the dialog stays", async () => {
    patch.mockRejectedValue(httpError(409, "A completed work order cannot be reopened"));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit Broken hose" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Work Order" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(toasts()[0]).toMatchObject({ type: "error", title: "A completed work order cannot be reopened" }),
    );
    expect(screen.getByRole("dialog", { name: "Edit Work Order" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes after confirmation, confirms it, and reloads", async () => {
    del.mockResolvedValue(envelope(null));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete Quarterly PM" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Work Order" });
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/v1/maintenance/wo-1"));
    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "success", title: "Work order deleted" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a failed delete (404) says so and keeps the dialog open", async () => {
    del.mockRejectedValue(httpError(404, "Work order not found"));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete Quarterly PM" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete Work Order" })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "error", title: "Work order not found" }));
    expect(screen.getByRole("dialog", { name: "Delete Work Order" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("an unreachable device/vendor list leaves the selects empty but the page usable", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/maintenance") return envelope(orders, { total: 2, page: 1, limit: 10, totalPages: 1 });
      throw httpError(503, "down");
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /New Work Order/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Device/ }));
    expect(screen.getByText("No options available")).toBeInTheDocument();
  });
});

// Q-55 (migration 0107): the schedule, costs and resolution are stored, so the screen shows and edits them.
describe("maintenance page — schedule, costs and resolution (Q-55)", () => {
  it("the list shows the planned and done dates and the estimated and actual cost", async () => {
    orders = [
      order({ scheduledDate: "2026-11-02T00:00:00.000Z", completedDate: "2026-11-03T10:00:00.000Z", estimatedCost: "1250.50", actualCost: "980.00" }),
    ];
    await renderPage();
    const row = screen.getByText("Quarterly PM").closest("tr") as HTMLElement;
    expect(within(row).getByText("Planned 2026-11-02")).toBeInTheDocument();
    expect(within(row).getByText("Done 2026-11-03")).toBeInTheDocument();
    expect(within(row).getByText(/^Est\. 1,?250\.50$/)).toBeInTheDocument();
    expect(within(row).getByText(/^Actual 980\.00$/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Cost" })).toBeInTheDocument();
  });

  it("create offers the scheduled date and estimate (not the outcome) and sends them", async () => {
    post.mockResolvedValue(envelope(order({ id: "wo-3" })));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /New Work Order/ }));
    const dialog = screen.getByRole("dialog", { name: "New Work Order" });
    expect(within(dialog).queryByLabelText("Completed date")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Resolution notes")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Device/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Monitor" }));
    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: "Annual PM" } });
    fireEvent.change(within(dialog).getByLabelText("Scheduled date"), { target: { value: "2026-11-02" } });
    fireEvent.change(within(dialog).getByLabelText("Estimated cost"), { target: { value: "1250.5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Work Order" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/v1/maintenance", expect.objectContaining({ scheduledDate: "2026-11-02", estimatedCost: "1250.5" })),
    );
  });

  it("edit pre-fills the five fields, bounds the completed date by the schedule, and sends the outcome", async () => {
    orders = [order({ scheduledDate: "2026-11-02T00:00:00.000Z", estimatedCost: "1250.50", resolutionNotes: null })];
    patch.mockResolvedValue(envelope(order()));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Quarterly PM" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Work Order" });
    expect(within(dialog).getByLabelText("Scheduled date")).toHaveValue("2026-11-02");
    expect(within(dialog).getByLabelText("Estimated cost")).toHaveValue(1250.5);
    expect(within(dialog).getByLabelText("Completed date")).toHaveAttribute("min", "2026-11-02");
    expect(within(dialog).getByLabelText("Resolution notes")).toHaveAttribute("maxLength", "5000");
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText("Completed date"), { target: { value: "2026-11-03" } });
    fireEvent.change(within(dialog).getByLabelText("Actual cost"), { target: { value: "980" } });
    fireEvent.change(within(dialog).getByLabelText("Resolution notes"), { target: { value: " Battery replaced. " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(
        "/api/v1/maintenance/wo-1",
        expect.objectContaining({
          scheduledDate: "2026-11-02", estimatedCost: "1250.50", completedDate: "2026-11-03", actualCost: "980",
          resolutionNotes: "Battery replaced.",
        }),
      ),
    );
  });
});
