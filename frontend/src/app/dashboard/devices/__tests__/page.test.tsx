/** @jest-environment jsdom */
/**
 * The calibration-devices screen, against the backend contract
 * (calibrationDevices.controller.js getAll → success(res, rows, meta)):
 * rows in `data`, pagination in a TOP-LEVEL `meta`.
 *
 * Real: the page, useDevices, the device and warehouse stores and services.
 * Mocked: the HTTP client (`@/api/client`) and the dashboard chrome.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import DevicesPage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useWarehouseStore } from "@/stores/warehouseStore";
import { useMenuStore } from "@/stores/menuStore";
import type { User } from "@/types";

// Whole-page renders with the real stores; findBy* waits up to 5 s (jest.setup.ts).
jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;
const del = api.delete as jest.Mock;

const envelope = (rows: unknown[], meta = { total: rows.length, page: 1, limit: 10, totalPages: 1 }) => ({
  success: true,
  status: 200,
  message: "ok",
  data: rows,
  meta,
});

/** What the client interceptor rejects with: an AxiosError carrying the backend's message. */
const httpError = (status: number, message: string) =>
  new AxiosError(message, "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    data: { success: false, status, message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const device = (patch: Record<string, unknown> = {}) => ({
  id: "dev-1",
  name: "Fluke 714B",
  serialNumber: "SN-1",
  manufacturer: "Fluke",
  model: "714B",
  category: "Temperature",
  status: "active",
  locationId: "wh-1",
  warehouse: { id: "wh-1", name: "Main", code: "WH1" },
  installationDate: "2026-01-02T00:00:00.000Z",
  nextCalibrationDate: "2026-12-01T00:00:00.000Z",
  calibrationIntervalDays: 90,
  remarks: "Lab bench",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

const warehouse = { id: "wh-1", name: "Main", code: "WH1" };

let deviceRows: unknown[] = [device()];

const backend = () => {
  get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/warehouses") return envelope([warehouse]);
    if (url === "/api/v1/calibration-devices") return envelope(deviceRows);
    throw new Error(`unexpected GET ${url}`);
  });
};

const as = (roleName: string) =>
  useAuthStore.setState({
    user: { id: "u-1", username: "ada", email: "a@x.test", role: { id: "r", name: roleName } } as User,
  });

type Grants = Record<string, "read" | "write">;
const grant = (permissions: Grants | null, superAdmin = false) =>
  useMenuStore.setState({ effectivePermissions: permissions === null ? null : { superAdmin, permissions } });

const deviceListCalls = () => get.mock.calls.filter(([url]) => url === "/api/v1/calibration-devices");

// Tailwind's `hidden` is display:none in the browser; jsdom loads no CSS, so
// without this rule axe would inspect the picker's display:none file input.
beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = ".hidden { display: none; }";
  document.head.appendChild(style);
});

/** An element's whole text, however many spans it is split across. */
const fullText = (text: string) => (_: string, el: Element | null) =>
  el?.textContent?.replace(/\s+/g, " ").trim() === text &&
  Array.from(el.children).every((c) => c.textContent?.replace(/\s+/g, " ").trim() !== text);

beforeEach(() => {
  jest.clearAllMocks();
  deviceRows = [device()];
  useDeviceStore.setState({ devices: null, isLoading: false, error: null, currentDevice: null });
  useWarehouseStore.setState({ warehouses: null, isLoading: false, error: null });
  as("HEALTHCARE ADMIN");
  // ADR-102: write actions come from the caller's effective permissions
  // (GET /menu-groups/my-permissions, held by the menu store); the device
  // routes are gated on the `calibration` menu.
  grant({ calibration: "write" });
  backend();
});

const renderPage = async () => {
  const view = render(<DevicesPage />);
  await screen.findByText("Fluke 714B");
  return view;
};

describe("devices page — the list's three states", () => {
  it("shows a loading skeleton, not the empty state, while the list is in flight", async () => {
    get.mockImplementation(async (url: string) =>
      url === "/api/v1/warehouses" ? envelope([]) : new Promise(() => undefined),
    );
    const { container } = render(<DevicesPage />);
    await waitFor(() => expect(deviceListCalls()).toHaveLength(1));

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("No devices found")).not.toBeInTheDocument();
  });

  it("renders the rows from `data` and the pagination from the top-level `meta`", async () => {
    deviceRows = [device()];
    get.mockImplementation(async (url: string) =>
      url === "/api/v1/warehouses"
        ? envelope([warehouse])
        : envelope(deviceRows, { total: 23, page: 1, limit: 10, totalPages: 3 }),
    );
    const { container } = await renderPage();

    const row = screen.getByText("Fluke 714B").closest("tr") as HTMLElement;
    expect(within(row).getByText("SN-1")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
    expect(within(row).getByText("Main (WH1)")).toBeInTheDocument();
    expect(screen.getByText(fullText("Showing 1 to 10 of 23 results"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
    expect(deviceListCalls()[0][1]).toEqual({
      params: { page: 1, limit: 10, find: undefined, status: undefined, category: undefined },
    });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("renders the empty state when the list is genuinely empty", async () => {
    deviceRows = [];
    const { container } = render(<DevicesPage />);

    expect(await screen.findByText("No devices found")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a FAILED load shows the backend's error, never the empty state", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/warehouses") return envelope([]);
      throw httpError(500, "Database unavailable");
    });
    const { container } = render(<DevicesPage />);

    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No devices found")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("devices page — permission-dependent controls (ADR-102)", () => {
  const writeControlsAbsent = () => {
    expect(screen.queryByRole("button", { name: /Add Device/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Import CSV/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Fluke 714B" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Fluke 714B" })).not.toBeInTheDocument();
  };

  it("read access on `calibration` gets no add, import, edit or delete control — only the IoT view", async () => {
    grant({ calibration: "read" });
    await renderPage();

    writeControlsAbsent();
    expect(screen.getByRole("button", { name: "IoT ingest for Fluke 714B" })).toBeInTheDocument();
  });

  it("permissions not loaded (or failed to load) offer no write control", async () => {
    grant(null);
    await renderPage();

    writeControlsAbsent();
  });

  it("write on another menu only does not unlock device writes", async () => {
    grant({ maintenance: "write" });
    await renderPage();

    writeControlsAbsent();
  });

  it("write access on `calibration` gets the write controls", async () => {
    await renderPage();

    expect(screen.getByRole("button", { name: /Add Device/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import CSV/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Fluke 714B" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Fluke 714B" })).toBeInTheDocument();
  });

  it("the platform super admin gets the write controls whatever the grants", async () => {
    grant({}, true);
    await renderPage();

    expect(screen.getByRole("button", { name: /Add Device/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Fluke 714B" })).toBeInTheDocument();
  });
});

describe("devices page — IoT ingest", () => {
  it("the IoT button opens that device's ingest dialog, and Close dismisses it", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/warehouses") return envelope([warehouse]);
      if (url === "/api/v1/calibration-devices") return envelope(deviceRows);
      return {
        success: true,
        status: 200,
        message: "ok",
        data: { deviceId: "dev-1", name: "Fluke 714B", iotEnabled: false, readingTolerance: null, hasToken: false, tokenIssuedAt: null },
      };
    });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "IoT ingest for Fluke 714B" }));
    const dialog = await screen.findByRole("dialog", { name: "IoT ingest — Fluke 714B" });
    await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining("dev-1")));

    fireEvent.click(within(dialog).getAllByRole("button", { name: /Close/ }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("devices page — filters", () => {
  it("search, category and status each re-query from page 1 with the filter", async () => {
    await renderPage();

    fireEvent.change(screen.getByPlaceholderText(/Search name, serial number/), { target: { value: "fluke" } });
    await waitFor(() =>
      expect(deviceListCalls().at(-1)?.[1]).toEqual({
        params: expect.objectContaining({ find: "fluke", page: 1 }),
      }),
    );

    fireEvent.change(screen.getByPlaceholderText(/Filter by category/), { target: { value: "Pressure" } });
    await waitFor(() =>
      expect(deviceListCalls().at(-1)?.[1]).toEqual({
        params: expect.objectContaining({ find: "fluke", category: "Pressure" }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "All Statuses" }));
    fireEvent.click(screen.getByRole("option", { name: "Retired" }));
    await waitFor(() =>
      expect(deviceListCalls().at(-1)?.[1]).toEqual({
        params: expect.objectContaining({ status: "retired", category: "Pressure" }),
      }),
    );
  });
});

describe("devices page — create, edit, delete", () => {
  it("creates a device: empty optional fields are omitted, the dialog closes and the list reloads", async () => {
    post.mockResolvedValue({ success: true, status: 201, message: "created", data: device({ id: "dev-2" }) });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Add Device/ }));
    const dialog = screen.getByRole("dialog", { name: "Add Calibration Device" });
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText(/Device Name/), { target: { value: "Druck DPI 620" } });
    fireEvent.change(within(dialog).getByLabelText("Serial Number"), { target: { value: "SN-9" } });
    fireEvent.change(within(dialog).getByLabelText("Manufacturer"), { target: { value: "Druck" } });
    fireEvent.change(within(dialog).getByLabelText("Model"), { target: { value: "DPI 620" } });
    fireEvent.change(within(dialog).getByLabelText("Category"), { target: { value: "Pressure" } });
    fireEvent.change(within(dialog).getByLabelText("Next Calibration Date"), { target: { value: "2027-01-31" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Warehouse Assignment/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Main (WH1)" }));
    const before = deviceListCalls().length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Device" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("/api/v1/calibration-devices", {
      name: "Druck DPI 620",
      serialNumber: "SN-9",
      manufacturer: "Druck",
      model: "DPI 620",
      category: "Pressure",
      status: "active",
      locationId: "wh-1",
      installationDate: undefined,
      nextCalibrationDate: "2027-01-31",
      calibrationIntervalDays: 180,
      remarks: "",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(deviceListCalls().length).toBeGreaterThan(before));
  });

  it("a refused create (409) keeps the dialog open and shows the backend's explanation", async () => {
    post.mockRejectedValue(httpError(409, "A device with serial number SN-1 already exists"));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Add Device/ }));
    const dialog = screen.getByRole("dialog", { name: "Add Calibration Device" });
    fireEvent.change(within(dialog).getByLabelText(/Device Name/), { target: { value: "Dup" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Device" }));

    expect(await screen.findByText("A device with serial number SN-1 already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add Calibration Device" })).toBeInTheDocument();
  });

  it("edits a device: the form is prefilled (dates cut to YYYY-MM-DD) and saved with PUT on its id", async () => {
    put.mockResolvedValue({ success: true, status: 200, message: "ok", data: device({ name: "Renamed" }) });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit Fluke 714B" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Calibration Device" });
    expect(within(dialog).getByLabelText(/Device Name/)).toHaveValue("Fluke 714B");
    expect(within(dialog).getByLabelText("Installation Date")).toHaveValue("2026-01-02");
    expect(within(dialog).getByLabelText("Interval Days")).toHaveValue(90);

    fireEvent.change(within(dialog).getByLabelText(/Device Name/), { target: { value: "Renamed" } });
    fireEvent.change(within(dialog).getByLabelText("Interval Days"), { target: { value: "30" } });
    fireEvent.change(within(dialog).getByLabelText("Installation Date"), { target: { value: "2026-02-03" } });
    fireEvent.change(within(dialog).getByLabelText("Remarks"), { target: { value: "moved" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Status/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Maintenance" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith(
      "/api/v1/calibration-devices/dev-1",
      expect.objectContaining({
        name: "Renamed",
        calibrationIntervalDays: 30,
        remarks: "moved",
        status: "maintenance",
        installationDate: "2026-02-03",
        nextCalibrationDate: "2026-12-01",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("Cancel closes the device dialog without saving", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Add Device/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("deletes a device after confirmation and reloads the list", async () => {
    del.mockResolvedValue({ success: true, status: 200, message: "deleted", data: null });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete Fluke 714B" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Device" });
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/v1/calibration-devices/dev-1"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a failed delete (404 — gone, or another tenant's) keeps the dialog open with the message (F-64)", async () => {
    del.mockRejectedValue(httpError(404, "Calibration device not found"));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete Fluke 714B" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete Device" })).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Calibration device not found")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Delete Device" })).toBeInTheDocument();
  });
});

describe("devices page — CSV import", () => {
  const importFile = (container: HTMLElement) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["name\nA"], "devices.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });
    return file;
  };

  it("uploads the file as multipart, reports the outcome with at most five row errors, and can be dismissed", async () => {
    const errors = Array.from({ length: 7 }, (_, i) => ({ row: i + 2, errors: `bad row ${i + 2}` }));
    post.mockResolvedValue({
      success: true,
      status: 200,
      message: "ok",
      data: { successCount: 3, failedCount: 7, totalCount: 10, errors },
    });
    const { container } = await renderPage();

    importFile(container);

    expect(await screen.findByText(/CSV import finished: 3 of\s*10 device\(s\) imported, 7 failed/)).toBeInTheDocument();
    expect(post.mock.calls[0][0]).toBe("/api/v1/calibration-devices/bulk-import");
    expect(post.mock.calls[0][1]).toBeInstanceOf(FormData);
    expect(screen.getByText("Row 2: bad row 2")).toBeInTheDocument();
    expect(screen.getByText("Row 6: bad row 6")).toBeInTheDocument();
    expect(screen.queryByText("Row 7: bad row 7")).not.toBeInTheDocument();
    expect(screen.getByText("…and 2 more")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/CSV import finished/)).not.toBeInTheDocument();
  });

  it("A-358: a row rejected with field errors lists them as text instead of crashing", async () => {
    // calibrationDevices.service#bulkImportCalibrationDevices: a duplicate or a
    // validation failure answers a list of { field, message }; an empty CSV a string.
    post.mockResolvedValue({
      success: true,
      status: 200,
      message: "ok",
      data: {
        successCount: 0,
        failedCount: 2,
        totalCount: 2,
        errors: [
          { row: 2, errors: [{ field: "serialNumber", message: "Duplicate serial number: SN-1" }] },
          {
            row: 3,
            errors: [
              { field: "name", message: "Required" },
              { field: "status", message: "Invalid option" },
            ],
          },
        ],
      },
    });
    const { container } = await renderPage();
    importFile(container);

    expect(await screen.findByText("Row 2: serialNumber: Duplicate serial number: SN-1")).toBeInTheDocument();
    expect(screen.getByText("Row 3: name: Required; status: Invalid option")).toBeInTheDocument();
  });

  it("a clean import reports success with no error list", async () => {
    post.mockResolvedValue({
      success: true,
      status: 200,
      message: "ok",
      data: { successCount: 2, failedCount: 0, totalCount: 2, errors: [] },
    });
    const { container } = await renderPage();
    importFile(container);

    expect(await screen.findByText(/CSV import finished: 2 of\s*2 device\(s\) imported\s*\./)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("a refused import shows the backend's message", async () => {
    post.mockRejectedValue(httpError(400, "The file must be a CSV"));
    const { container } = await renderPage();
    importFile(container);

    expect(await screen.findByText("The file must be a CSV")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Import CSV/ })).not.toBeDisabled();
  });

  it("the Import CSV button opens the file picker", async () => {
    const { container } = await renderPage();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = jest.spyOn(input, "click").mockImplementation(() => undefined);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Import CSV/ }));
    });
    expect(click).toHaveBeenCalled();
  });
});
