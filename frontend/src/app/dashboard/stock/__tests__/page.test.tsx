/**
 * Inventory & Stocks page through the REAL useStock hook, stock/warehouse
 * stores and services — `@/api/client` mocked with the backend's envelopes
 * (backend/src/controllers/stock.controller.js: rows in `data`, pagination in
 * a top-level `meta`). Stock edits are a PATCH; adjustments, transfers and
 * audits have their own endpoints; write access is the caller's effective
 * `warehouse` permission (ADR-102).
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

jest.mock("@/api/client", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

const mockAuth: { user: { id: string; role: { name: string } } | null } = { user: null };
jest.mock("@/stores/authStore", () => ({
  useAuthStore: (selector?: (s: typeof mockAuth) => unknown) => (selector ? selector(mockAuth) : mockAuth),
}));

import { api } from "@/api/client";
import { useMenuStore } from "@/stores/menuStore";
import { useStockStore } from "@/stores/stockStore";
import { useWarehouseStore } from "@/stores/warehouseStore";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError, networkError } from "@/tests/support/httpErrors";
import StockPage from "../page";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;

const list = (rows: unknown[], message = "ok") => ({
  success: true,
  status: 200,
  message,
  data: rows,
  meta: { total: rows.length, page: 1, limit: 10, totalPages: 1 },
});
const one = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data });

const WH = [
  { id: "wh-1", name: "Central Depot", code: "CD", status: "active" },
  { id: "wh-2", name: "Ward 3 Store", code: "W3", status: "active" },
];
const stock = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  warehouseId: "wh-1",
  locationId: null,
  itemName: `Item ${id}`,
  sku: null,
  serialNumber: null,
  quantity: 10,
  minQuantity: 2,
  description: null,
  warehouse: { id: "wh-1", name: "Central Depot", code: "CD" },
  location: null,
  ...over,
});
const user = (firstName: string, lastName: string) => ({ id: `u-${firstName}`, username: firstName, firstName, lastName });

type Route = unknown | Error | (() => unknown);
let routes: Record<string, Route> = {};

const backend = () => {
  get.mockImplementation(async (url: string) => {
    const r = routes[url];
    if (r === undefined) throw new Error(`unexpected GET ${url}`);
    if (r instanceof Error) throw r;
    return typeof r === "function" ? (r as () => unknown)() : r;
  });
};

const as = (role: string | null) => {
  mockAuth.user = role ? { id: "u-1", role: { name: role } } : null;
};

const renderPage = async () => {
  const view = render(<StockPage />);
  await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/stocks", expect.anything()));
  await waitFor(() => expect(useStockStore.getState().isLoading).toBe(false));
  return view;
};

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

// ADR-102: write actions come from the caller's EFFECTIVE permissions (menuStore,
// GET /menu-groups/my-permissions), never from role names.
type Effective = { superAdmin: boolean; permissions: Record<string, "read" | "write"> } | null;
const grant = (effective: Effective) => useMenuStore.setState({ effectivePermissions: effective });
const WRITE: Effective = { superAdmin: false, permissions: { warehouse: "write" } };
const READ: Effective = { superAdmin: false, permissions: { warehouse: "read" } };
const SUPER: Effective = { superAdmin: true, permissions: {} };

beforeEach(() => {
  jest.clearAllMocks();
  useStockStore.setState({ stocks: null, transfers: null, adjustments: null, opnames: null, reportSummary: null, isLoading: false, error: null });
  useWarehouseStore.setState({ warehouses: null, locations: [], isLoading: false, error: null });
  as("WAREHOUSE STAFF");
  grant(WRITE);
  routes = {
    "/api/v1/warehouses": list(WH),
    "/api/v1/stocks": list([
      stock("s1", { itemName: "Infusion pump tester", sku: "SKU-1", serialNumber: "SN-1", location: { id: "loc-1", name: "Shelf A", code: "A1" } }),
      stock("s2", { itemName: "Pressure gauge", quantity: 2, minQuantity: 5 }),
      stock("s3", { itemName: "Thermometer probe", quantity: 0 }),
    ]),
  };
  backend();
});

describe("Stock page — inventory list", () => {
  it("lists stock with its depot, shelf and low/out-of-stock warnings", async () => {
    const { container } = await renderPage();
    expect(await screen.findByText("Infusion pump tester")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/v1/stocks", {
      params: { page: 1, limit: 10, find: "", warehouseId: undefined, locationId: undefined },
    });
    expect(screen.getByText("SKU: SKU-1")).toBeInTheDocument();
    expect(screen.getByText("Shelf: Shelf A (A1)")).toBeInTheDocument();
    expect(screen.getByText("Low stock threshold reached")).toBeInTheDocument();
    expect(screen.getByText("Out of stock")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no stock: the empty state", async () => {
    routes["/api/v1/stocks"] = list([]);
    const { container } = await renderPage();
    expect(await screen.findByText("No Records Registered")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed load shows the error, never the empty state", async () => {
    routes["/api/v1/stocks"] = networkError();
    const { container } = await renderPage();
    expect(await screen.findByText("Network Error")).toBeInTheDocument();
    expect(screen.queryByText("No Records Registered")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a 403 (no warehouse read grant) shows the backend's refusal", async () => {
    routes["/api/v1/stocks"] = httpError(403, "You do not have read access to warehouse");
    await renderPage();
    expect(await screen.findByText("You do not have read access to warehouse")).toBeInTheDocument();
  });

  it.each([
    ["a warehouse:read grant", READ],
    ["no permissions loaded (null)", null],
  ])("%s: no write controls in the DOM — only View Details", async (_label, effective) => {
    grant(effective);
    await renderPage();
    await screen.findByText("Infusion pump tester");
    for (const name of ["New Transfer", "Audit Stock", "Add Inventory", "Adjust", "Transfer", "Edit"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: "View Details" })).toHaveLength(3);
  });

  it("search and depot filter reach the request; a depot also loads its shelves", async () => {
    routes["/api/v1/warehouses/wh-2/locations"] = one([
      { id: "loc-9", warehouseId: "wh-2", name: "Fridge", code: "F1", isActive: true },
      { id: "loc-8", warehouseId: "wh-2", name: "Old shelf", code: "OS", isActive: false },
    ]);
    await renderPage();
    fireEvent.change(screen.getByPlaceholderText("Search description, SKU..."), { target: { value: "gauge" } });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith("/api/v1/stocks", { params: expect.objectContaining({ find: "gauge", page: 1 }) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "All Depots" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Ward 3 Store (W3)" }));
    });
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith("/api/v1/stocks", { params: expect.objectContaining({ warehouseId: "wh-2" }) }),
    );
    expect(get).toHaveBeenCalledWith("/api/v1/warehouses/wh-2/locations");

    // Only active shelves are offered.
    fireEvent.click(await screen.findByRole("button", { name: "All Storage Shelves" }));
    expect(await screen.findByRole("option", { name: "Fridge (F1)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Old shelf (OS)" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Fridge (F1)" }));
    });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith("/api/v1/stocks", { params: expect.objectContaining({ locationId: "loc-9" }) }),
    );
  });
});

describe("Stock page — stock writes", () => {
  it("Add Inventory POSTs the new item with blanks as null, then reloads", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Inventory" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Inventory Item" });
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText(/Item Name/), { target: { value: "Defib analyser" } });
    fireEvent.change(within(dialog).getByLabelText(/Starting Quantity/), { target: { value: "4" } });
    fireEvent.change(within(dialog).getByLabelText(/Min safety Threshold/), { target: { value: "1" } });
    post.mockResolvedValue(one(stock("s9"), "Stock created"));
    get.mockClear();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Stock" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/stocks", {
      warehouseId: "wh-1",
      locationId: null,
      itemName: "Defib analyser",
      sku: null,
      serialNumber: null,
      quantity: 4,
      minQuantity: 1,
      description: null,
    });
    expect(screen.queryByRole("dialog", { name: "Add Inventory Item" })).not.toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/stocks", expect.anything()));
  });

  it("choosing a depot in Add Inventory loads its shelves; the chosen shelf and details are sent", async () => {
    routes["/api/v1/warehouses/wh-2/locations"] = one([
      { id: "loc-9", warehouseId: "wh-2", name: "Fridge", code: "F1", isActive: true },
    ]);
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Inventory" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Inventory Item" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Warehouse Depot/ }));
    await act(async () => {
      fireEvent.click(await within(dialog).findByRole("option", { name: "Ward 3 Store (W3)" }));
    });
    expect(get).toHaveBeenCalledWith("/api/v1/warehouses/wh-2/locations");
    fireEvent.click(within(dialog).getByRole("button", { name: /Storage Shelf/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Fridge (F1)" }));
    fireEvent.change(within(dialog).getByLabelText(/Item Name/), { target: { value: "Vaccine probe" } });
    fireEvent.change(within(dialog).getByLabelText(/SKU/), { target: { value: "SKU-9" } });
    fireEvent.change(within(dialog).getByLabelText(/Serial Number/), { target: { value: "SN-9" } });
    fireEvent.change(within(dialog).getByLabelText(/Additional Description/), { target: { value: "Cold chain" } });
    post.mockResolvedValue(one(stock("s9"), "Stock created"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Stock" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/stocks", {
      warehouseId: "wh-2",
      locationId: "loc-9",
      itemName: "Vaccine probe",
      sku: "SKU-9",
      serialNumber: "SN-9",
      quantity: 0,
      minQuantity: 0,
      description: "Cold chain",
    });
  });

  it("Cancel closes each stock dialog without sending anything", async () => {
    await renderPage();
    await screen.findByText("Infusion pump tester");
    const cancel = async (open: () => void, name: string) => {
      open();
      const dialog = await screen.findByRole("dialog", { name });
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name })).not.toBeInTheDocument();
    };
    await cancel(() => fireEvent.click(screen.getByRole("button", { name: "Add Inventory" })), "Add Inventory Item");
    await cancel(() => fireEvent.click(screen.getAllByRole("button", { name: "Adjust" })[0]), "Manual Stock Adjustment");
    await cancel(() => fireEvent.click(screen.getByRole("button", { name: "New Transfer" })), "Dispatch Inter-depot Transfer");
    await cancel(() => fireEvent.click(screen.getByRole("button", { name: "Audit Stock" })), "Schedule Physical Count Audit");
    expect(post).not.toHaveBeenCalled();
  });

  it("the super admin gets the write controls without a warehouse grant", async () => {
    grant(SUPER);
    await renderPage();
    await screen.findByText("Infusion pump tester");
    expect(screen.getByRole("button", { name: "Add Inventory" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Adjust" })).toHaveLength(3);
  });

  it("a warehouse:read grant opens stock details read-only, with no save", async () => {
    grant(READ);
    await renderPage();
    await screen.findByText("Infusion pump tester");
    fireEvent.click(screen.getAllByRole("button", { name: "View Details" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Inventory Details" });
    expect(within(dialog).getByLabelText(/Min safety Threshold/)).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
  });

  it("Edit PATCHes the stock without a quantity (quantity changes go through an adjustment)", async () => {
    await renderPage();
    await screen.findByText("Infusion pump tester");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Edit Inventory Details" });
    expect(within(dialog).getByLabelText(/Item Name/)).toBeDisabled();
    expect(within(dialog).getByLabelText(/Starting Quantity/)).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Min safety Threshold/), { target: { value: "3" } });
    patch.mockResolvedValue(one(stock("s1"), "Stock updated"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/stocks/s1", {
      itemName: "Infusion pump tester",
      sku: "SKU-1",
      serialNumber: "SN-1",
      minQuantity: 3,
      description: null,
    });
  });

  // F-19: the refusal renders INSIDE the open dialog. It used to land in the
  // page Alert, behind the modal, where the user could not see it.
  it("a refused create keeps the dialog open and shows the refusal inside it", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Inventory" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Inventory Item" });
    fireEvent.change(within(dialog).getByLabelText(/Item Name/), { target: { value: "Dup" } });
    post.mockRejectedValue(httpError(409, "An item with this SKU already exists in the depot"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Stock" }));
    });
    const open = screen.getByRole("dialog", { name: "Add Inventory Item" });
    expect(await within(open).findByRole("alert")).toHaveTextContent("An item with this SKU already exists in the depot");
    // Once, in the dialog — not duplicated in the page alert behind it.
    expect(screen.getAllByText("An item with this SKU already exists in the depot")).toHaveLength(1);
  });

  it("F-19: a refused audit schedule is explained inside its dialog, which stays open", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Audit Stock" }));
    const dialog = await screen.findByRole("dialog", { name: "Schedule Physical Count Audit" });
    post.mockRejectedValue(httpError(409, "An opname is already open for this warehouse"));
    await act(async () => {
      fireEvent.submit(within(dialog).getByLabelText(/Audit Schedule Date/).closest("form") as HTMLFormElement);
    });
    const open = screen.getByRole("dialog", { name: "Schedule Physical Count Audit" });
    expect(within(open).getByRole("alert")).toHaveTextContent("An opname is already open for this warehouse");
  });

  it("Adjust POSTs an adjustment for that stock with its reason", async () => {
    await renderPage();
    await screen.findByText("Pressure gauge");
    fireEvent.click(screen.getAllByRole("button", { name: "Adjust" })[1]);
    const dialog = await screen.findByRole("dialog", { name: "Manual Stock Adjustment" });
    expect(within(dialog).getByText("Pressure gauge")).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: /Adjustment Type/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Write-off (Damaged / Missing stock)" }));
    fireEvent.change(within(dialog).getByLabelText(/Quantity Delta/), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason for Adjustment/), { target: { value: "Dropped" } });
    post.mockResolvedValue(one({ id: "adj-1" }, "Adjustment logged"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Submit Adjustment" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/stocks/adjustment", {
      stockId: "s2",
      type: "write_off",
      quantity: 2,
      reason: "Dropped",
    });
  });

  it("Transfer from a row pre-fills the item and source depot and POSTs the transfer", async () => {
    await renderPage();
    await screen.findByText("Infusion pump tester");
    fireEvent.click(screen.getAllByRole("button", { name: "Transfer" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Dispatch Inter-depot Transfer" });
    expect(await axeViolations(dialog)).toEqual([]);
    expect(within(dialog).getByLabelText(/Item Name/)).toHaveValue("Infusion pump tester");
    fireEvent.click(within(dialog).getByRole("button", { name: /Destination Depot/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Ward 3 Store (W3)" }));
    fireEvent.change(within(dialog).getByLabelText(/Transfer Volume/), { target: { value: "3" } });
    post.mockResolvedValue(one({ id: "tr-1" }, "Transfer created"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Dispatch|Submit|Create/ }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/stocks/transfer", {
      fromWarehouseId: "wh-1",
      toWarehouseId: "wh-2",
      itemName: "Infusion pump tester",
      quantity: 3,
      notes: "",
    });
  });

  // F-19: the field is a date input (DateField). It used to be given a
  // datetime-local default ("YYYY-MM-DDTHH:mm"), which a date input cannot
  // show, so it opened blank. The picked date is sent as ISO YYYY-MM-DD,
  // which createOpnameSchema's isoDate() accepts.
  it("Audit Stock opens on today's date and schedules a count, sending the picked ISO date", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Audit Stock" }));
    const dialog = await screen.findByRole("dialog", { name: "Schedule Physical Count Audit" });
    expect(await axeViolations(dialog)).toEqual([]);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(within(dialog).getByLabelText(/Audit Schedule Date/)).toHaveValue(today);
    fireEvent.change(within(dialog).getByLabelText(/Audit Schedule Date/), { target: { value: "2026-10-01" } });
    post.mockResolvedValue(one({ id: "op-1" }, "Opname created"));
    await act(async () => {
      fireEvent.submit(within(dialog).getByLabelText(/Audit Schedule Date/).closest("form") as HTMLFormElement);
    });
    expect(post).toHaveBeenCalledWith("/api/v1/stocks/opname", {
      warehouseId: "wh-1",
      scheduledAt: "2026-10-01",
      notes: "",
    });
  });
});

describe("Stock page — history tabs", () => {
  const transfer = (id: string, status: string) => ({
    id,
    fromWarehouseId: "wh-1",
    toWarehouseId: "wh-2",
    status,
    itemName: `Transfer ${id}`,
    quantity: 2,
    fromWarehouse: { id: "wh-1", name: "Central Depot", code: "CD" },
    toWarehouse: { id: "wh-2", name: "Ward 3 Store", code: "W3" },
    requester: user("Ana", "Req"),
    approver: status === "completed" ? user("Budi", "App") : null,
    createdAt: "2026-09-20T08:00:00.000Z",
  });

  it("transfers: listed by status; Ship a pending one PATCHes in_transit, Complete an in-transit one", async () => {
    routes["/api/v1/stocks/transfer/history"] = list([
      transfer("t1", "pending"),
      transfer("t2", "in_transit"),
      transfer("t3", "completed"),
    ]);
    const { container } = await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Inter-depot Transfers" }));
    });
    expect(await screen.findByText("Transfer t1")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/v1/stocks/transfer/history", {
      params: { page: 1, limit: 10, fromWarehouseId: undefined },
    });
    expect(screen.getByText("IN TRANSIT")).toBeInTheDocument();
    expect(screen.getByText("App: Budi App")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    patch.mockResolvedValue(one(transfer("t1", "in_transit")));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ship" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/stocks/transfer/t1", { status: "in_transit" });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Complete" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/stocks/transfer/t2", { status: "completed" });
  });

  it("a refused status change (409) is shown as the backend's explanation", async () => {
    routes["/api/v1/stocks/transfer/history"] = list([transfer("t1", "pending")]);
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Inter-depot Transfers" }));
    });
    patch.mockRejectedValue(httpError(409, "Insufficient stock at Central Depot to ship this transfer"));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Ship" }));
    });
    expect(await screen.findByText("Insufficient stock at Central Depot to ship this transfer")).toBeInTheDocument();
  });

  it("adjustments: type, quantity, reason and who", async () => {
    routes["/api/v1/stocks/adjustment/history"] = list([
      { id: "a1", stockId: "s1", warehouseId: "wh-1", type: "write_off", quantity: 2, reason: "Dropped", warehouse: { id: "wh-1", name: "Central Depot", code: "CD" }, adjuster: user("Ana", "Adj"), createdAt: "2026-09-20T08:00:00.000Z" },
    ]);
    const { container } = await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Manual Adjustments" }));
    });
    expect(await screen.findByText("WRITE_OFF")).toBeInTheDocument();
    expect(screen.getByText("Dropped")).toBeInTheDocument();
    expect(screen.getByText("Ana Adj")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("audits: Start a draft, Complete one in progress", async () => {
    const opname = (id: string, status: string) => ({
      id,
      warehouseId: "wh-1",
      status,
      scheduledAt: "2026-10-01T09:00:00.000Z",
      completedAt: null,
      notes: null,
      warehouse: { id: "wh-1", name: `Depot ${id}`, code: "CD" },
      performer: status === "in_progress" ? user("Budi", "Counter") : null,
    });
    routes["/api/v1/stocks/opname/history"] = list([opname("o1", "draft"), opname("o2", "in_progress")]);
    const { container } = await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Physical Counts (Audits)" }));
    });
    expect(await screen.findByText("Depot o1")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    patch.mockResolvedValue(one(opname("o1", "in_progress")));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/stocks/opname/o1", { status: "in_progress" });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Complete" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/stocks/opname/o2", { status: "completed" });
  });

  it("an empty history tab says there is nothing logged", async () => {
    routes["/api/v1/stocks/opname/history"] = list([]);
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Physical Counts (Audits)" }));
    });
    expect(await screen.findByText("There is no logged history of opnames in this system.")).toBeInTheDocument();
  });
});

describe("Stock page — reports", () => {
  it("shows the summary and distribution; exports download CSV", async () => {
    routes["/api/v1/stocks/reports/summary"] = one({
      totalItems: 3,
      totalUnits: 12,
      lowStockCount: 1,
      warehouseDistribution: [{ id: "wh-1", name: "Central Depot", code: "CD", itemCount: 3, unitCount: 12 }],
    });
    routes["/api/v1/stocks/reports/export"] = "Item,Qty\nGauge,2\n";
    routes["/api/v1/stocks/transfer/history"] = list([]);
    const createObjectURL = jest.fn(() => "blob:stock");
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    const { container } = await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reports" }));
    });
    expect(await screen.findByText("12 units (3 items)")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export Stock Levels" }));
    });
    expect(get).toHaveBeenCalledWith("/api/v1/stocks/reports/export", { responseType: "text" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export Inter-depot Transfers" }));
    });
    expect(get).toHaveBeenCalledWith("/api/v1/stocks/transfer/history", { params: { limit: 1000 } });
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it("a failed export says so", async () => {
    routes["/api/v1/stocks/reports/summary"] = one({ totalItems: 0, totalUnits: 0, lowStockCount: 0, warehouseDistribution: [] });
    routes["/api/v1/stocks/opname/history"] = httpError(403, "Forbidden");
    await renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reports" }));
    });
    expect(await screen.findByText("No stock distribution data available.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Export Audit Counts (Opname)" }));
    });
    expect(await screen.findByText("Failed to export stock audits")).toBeInTheDocument();
  });
});
