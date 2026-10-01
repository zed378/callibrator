/** @jest-environment jsdom */
/**
 * Asset finance page against the backend contract
 * (backend/src/routes/api/finance.route.js, mounted /api/v1/finance;
 * controllers/finance.controller.js; services/finance.service.js):
 *  - GET  /?page&limit&method → AssetFinance rows (with `device`) in `data`,
 *    pagination in a top-level `meta`;
 *  - GET  /reports/depreciation?asOf → data { asOf, totals, count, rows };
 *    with format=csv the body is the CSV text itself;
 *  - POST / { deviceId, purchasePrice, purchaseDate, salvageValue,
 *    usefulLifeYears, depreciationMethod, invoiceNumber?, notes? } · DELETE /:id.
 *  - the device picker reads GET /api/v1/calibration-devices.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import FinancePage from "../page";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const ok = (data: unknown, message = "ok", meta?: unknown) => ({
  success: true,
  status: 200,
  message,
  data,
  ...(meta ? { meta } : {}),
});

const record = (id: string, deviceName: string, method: "straight_line" | "declining_balance", extra: Record<string, unknown> = {}) => ({
  id,
  tenantId: "t-1",
  deviceId: `dev-${id}`,
  purchasePrice: 12500,
  purchaseDate: "2024-01-15",
  salvageValue: 500,
  usefulLifeYears: 5,
  depreciationMethod: method,
  vendorId: null,
  invoiceNumber: null,
  notes: null,
  device: { id: `dev-${id}`, name: deviceName, serialNumber: "SN-1", category: "ECG", status: "active" },
  vendor: null,
  depreciation: { accumulatedDepreciation: 4000, bookValue: 8500 },
  createdAt: "2024-01-15T00:00:00.000Z",
  updatedAt: "2024-01-15T00:00:00.000Z",
  ...extra,
});

let records: ReturnType<typeof record>[];
let total: number;

const report = {
  asOf: "2026-09-29T00:00:00.000Z",
  totals: { totalPurchase: 25000, totalAccumulatedDepreciation: 8000, totalBookValue: 17000, fullyDepreciatedCount: 1 },
  count: 2,
  rows: [],
};

const backend = () => {
  mockedGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === "/api/v1/calibration-devices") {
      return ok(
        [
          { id: "dev-new", name: "Infusion Pump IP-7" },
          { id: "dev-2", name: "Defibrillator" },
        ],
        "ok",
        { total: 2, page: 1, limit: 100, totalPages: 1 },
      );
    }
    if (url === "/api/v1/finance/reports/depreciation") {
      if (config?.params?.format === "csv") return "device,bookValue\nECG,8500\n";
      return ok(report, "Depreciation report");
    }
    if (url === "/api/v1/finance") {
      const method = config?.params?.method;
      const rows = method ? records.filter((r) => r.depreciationMethod === method) : records;
      return ok(rows, "Fetch asset finance records successful", {
        total,
        page: config?.params?.page,
        limit: 10,
        totalPages: Math.ceil(total / 10),
      });
    }
    throw httpError(404, "Not found");
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ finance: "write" });
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  records = [
    record("f-1", "ECG Monitor", "straight_line", { invoiceNumber: "INV-2024-001" }),
    record("f-2", "Ventilator", "declining_balance", { purchasePrice: 12500.5 }),
  ];
  total = 2;
  backend();
});

const renderLoaded = async () => {
  const view = render(<FinancePage />);
  await screen.findByText("ECG Monitor");
  return view;
};

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("asset finance — reading", () => {
  it("lists records with the device name, cost, life and method, and the depreciation totals", async () => {
    const { container } = await renderLoaded();

    const ecg = rowOf("ECG Monitor");
    expect(within(ecg).getByText("INV-2024-001")).toBeInTheDocument();
    expect(within(ecg).getByText(money(12500))).toBeInTheDocument();
    expect(within(ecg).getByText("5 yrs")).toBeInTheDocument();
    expect(within(ecg).getByText(`salvage ${money(500)}`)).toBeInTheDocument();
    expect(within(ecg).getByText("straight line")).toBeInTheDocument();
    expect(within(rowOf("Ventilator")).getByText("declining balance")).toBeInTheDocument();

    expect(screen.getByText(money(25000))).toBeInTheDocument();
    expect(screen.getByText(money(17000))).toBeInTheDocument();
    expect(screen.getByText(/2 assets/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no records is the empty state; a missing report shows dashes", async () => {
    records = [];
    total = 0;
    mockedGet.mockImplementation(async (url: string) => {
      if (url === "/api/v1/finance/reports/depreciation") throw httpError(500, "report failed");
      if (url === "/api/v1/finance") return ok([], "ok", { total: 0, page: 1, limit: 10, totalPages: 0 });
      return ok([]);
    });
    render(<FinancePage />);

    expect(await screen.findByText("No assets recorded yet.")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(3);
    expect(screen.queryByText(/Valued as at/)).not.toBeInTheDocument();
  });

  it("a failed list read shows the error, not the empty state", async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url === "/api/v1/finance") throw httpError(403, "You do not have permission to read finance");
      return ok([]);
    });
    const { container } = render(<FinancePage />);

    expect(await screen.findByText("You do not have permission to read finance")).toBeInTheDocument();
    expect(screen.getByText("Asset records could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No assets recorded yet.")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("filters by method from page 1, and clears it", async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: /^Filter by method/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "declining balance" }));
    });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith("/api/v1/finance", {
        params: { page: 1, limit: 10, method: "declining_balance" },
      }),
    );
    await waitFor(() => expect(screen.queryByText("ECG Monitor")).not.toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    });
    expect(await screen.findByText("ECG Monitor")).toBeInTheDocument();
  });

  it("a valuation date re-reads the report as at that date", async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Valuation date"), { target: { value: "2025-12-31" } });
    });

    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith("/api/v1/finance/reports/depreciation", { params: { asOf: "2025-12-31" } }),
    );
  });

  it("pages with the top-level meta", async () => {
    total = 25;
    await renderLoaded();
    expect(screen.getByText("Page 1 of 3 · 25 total")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    });
    expect(await screen.findByText("Page 2 of 3 · 25 total")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    });
    expect(await screen.findByText("Page 1 of 3 · 25 total")).toBeInTheDocument();
  });
});

describe("asset finance — CSV export", () => {
  const createObjectURL = jest.fn(() => "blob:csv");
  const revokeObjectURL = jest.fn();
  let click: jest.SpyInstance;

  beforeEach(() => {
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });
  afterEach(() => click.mockRestore());

  it("asks for format=csv as text and downloads it", async () => {
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    });

    expect(mockedGet).toHaveBeenCalledWith("/api/v1/finance/reports/depreciation", {
      params: { format: "csv" },
      responseType: "text",
    });
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe("depreciation-report.csv");
    expect(toasts()).toContainEqual({ type: "success", title: "Report downloaded", description: undefined });
  });

  it("a bad valuation date (400) fails the export with the reason", async () => {
    await renderLoaded();
    mockedGet.mockRejectedValueOnce(httpError(400, "Invalid asOf date"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    });

    expect(click).not.toHaveBeenCalled();
    expect(toasts()).toContainEqual({ type: "error", title: "Export failed", description: "Invalid asOf date" });
  });
});

describe("asset finance — recording and deleting", () => {
  const openRecord = () => {
    fireEvent.click(screen.getByRole("button", { name: "Record Asset" }));
    return screen.getByRole("dialog", { name: "Record Asset" });
  };

  it("validates device, date, price and life before sending", async () => {
    await renderLoaded();
    const dialog = openRecord();
    const submit = within(dialog).getByRole("button", { name: "Record Asset" });

    fireEvent.click(submit);
    expect(toasts()).toContainEqual({ type: "error", title: "Device and purchase date are required", description: undefined });

    fireEvent.click(within(dialog).getByRole("button", { name: /^Device/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Infusion Pump IP-7" }));
    fireEvent.change(within(dialog).getByLabelText(/Purchase date/), { target: { value: "2026-02-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Purchase price/), { target: { value: "-1" } });
    fireEvent.click(submit);
    expect(toasts()).toContainEqual({ type: "error", title: "Purchase price must be a number", description: undefined });

    fireEvent.change(within(dialog).getByLabelText(/Purchase price/), { target: { value: "8000" } });
    fireEvent.change(within(dialog).getByLabelText(/Useful life/), { target: { value: "60" } });
    fireEvent.click(submit);
    expect(toasts()).toContainEqual({ type: "error", title: "Useful life must be 1–50 years", description: undefined });

    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("POSTs the record with numbers as numbers and blank optionals omitted", async () => {
    mockedPost.mockResolvedValue(ok(record("f-3", "Infusion Pump IP-7", "declining_balance"), "Asset finance record created"));
    const { container } = await renderLoaded();
    const dialog = openRecord();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(within(dialog).getByRole("button", { name: /^Device/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Infusion Pump IP-7" }));
    fireEvent.change(within(dialog).getByLabelText(/Purchase price/), { target: { value: "8000.50" } });
    fireEvent.change(within(dialog).getByLabelText(/Purchase date/), { target: { value: "2026-02-01" } });
    fireEvent.change(within(dialog).getByLabelText(/Salvage value/), { target: { value: "250" } });
    fireEvent.change(within(dialog).getByLabelText(/Useful life/), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Depreciation method/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "declining balance" }));
    fireEvent.change(within(dialog).getByLabelText("Invoice number"), { target: { value: " INV-9 " } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Record Asset" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/finance", {
      deviceId: "dev-new",
      purchasePrice: 8000.5,
      purchaseDate: "2026-02-01",
      salvageValue: 250,
      usefulLifeYears: 7,
      depreciationMethod: "declining_balance",
      invoiceNumber: "INV-9",
      notes: undefined,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Asset recorded", description: undefined });
  });

  it("a device from another tenant (404) is refused with the reason, keeping the form", async () => {
    mockedPost.mockRejectedValue(httpError(404, "Calibration device not found"));
    await renderLoaded();
    const dialog = openRecord();

    fireEvent.click(within(dialog).getByRole("button", { name: /^Device/ }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Defibrillator" }));
    fireEvent.change(within(dialog).getByLabelText(/Purchase price/), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText(/Purchase date/), { target: { value: "2026-02-01" } });
    fireEvent.change(within(dialog).getByLabelText("Notes"), { target: { value: "  leased  " } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Record Asset" }));
    });

    expect(mockedPost).toHaveBeenCalledWith("/api/v1/finance", expect.objectContaining({ deviceId: "dev-2", notes: "leased" }));
    expect(toasts()).toContainEqual({ type: "error", title: "Could not record asset", description: "Calibration device not found" });
    expect(screen.getByRole("dialog", { name: "Record Asset" })).toBeInTheDocument();
  });

  it("deleting asks first, then DELETEs and reloads; Cancel sends nothing", async () => {
    mockedDelete.mockImplementation(async () => {
      records = records.slice(1);
      total = 1;
      return ok(null, "Asset finance record deleted");
    });
    await renderLoaded();

    fireEvent.click(within(rowOf("ECG Monitor")).getByRole("button", { name: "Delete asset record" }));
    let dialog = screen.getByRole("dialog", { name: "Delete Asset Record" });
    expect(within(dialog).getByText(/The device itself is not affected/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mockedDelete).not.toHaveBeenCalled();

    fireEvent.click(within(rowOf("ECG Monitor")).getByRole("button", { name: "Delete asset record" }));
    dialog = screen.getByRole("dialog", { name: "Delete Asset Record" });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });

    expect(mockedDelete).toHaveBeenCalledWith("/api/v1/finance/f-1");
    await waitFor(() => expect(screen.queryByText("ECG Monitor")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a refused delete keeps the confirmation open", async () => {
    mockedDelete.mockRejectedValue(httpError(404, "Asset finance record not found"));
    await renderLoaded();

    fireEvent.click(within(rowOf("ECG Monitor")).getByRole("button", { name: "Delete asset record" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    });

    expect(toasts()).toContainEqual({ type: "error", title: "Delete failed", description: "Asset finance record not found" });
    expect(screen.getByRole("dialog", { name: "Delete Asset Record" })).toBeInTheDocument();
  });
});

/**
 * ADR-102 — asset finance writes are gated on `finance` write. The seeded admins and ENGINEERING MANAGER hold `finance` read (audit 01 §4.7: "Record Asset shown to HA/CA/EM, all read-only").
 * Before the permissions load nothing is writable; the super admin writes.
 * Fail-before: Record Asset and Delete rendered for every role.
 */
describe("ADR-102 — asset finance write controls follow the effective permission", () => {
  const writeControls = [
      /Record Asset/,
      "Delete asset record",
  ];

  it("a reader gets none of the write controls", async () => {
    grantPermissions({ "finance": "read" });
    render(<FinancePage />);
    await screen.findByText("ECG Monitor");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    render(<FinancePage />);
    await screen.findByText("ECG Monitor");
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("the super admin gets them", async () => {
    grantSuperAdmin();
    render(<FinancePage />);
    await screen.findByText("ECG Monitor");
    expect(screen.getAllByRole("button", { name: /Record Asset/ }).length).toBeGreaterThan(0);
  });
});
