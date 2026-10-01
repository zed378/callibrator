/**
 * Warehouse Management through the REAL useWarehouse hook, warehouse store
 * and service — `@/api/client` mocked with the backend's envelopes
 * (backend/src/controllers/warehouse.controller.js: the list's rows in
 * `data` with a top-level `meta`; locations as a plain array in `data`).
 * Location writes use the FLAT `/warehouses/locations` path, the warehouse
 * being in the body.
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
import { useWarehouseStore } from "@/stores/warehouseStore";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError, networkError } from "@/tests/support/httpErrors";
import WarehousePage from "../page";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

const list = (rows: unknown[]) => ({
  success: true,
  status: 200,
  message: "Warehouses retrieved",
  data: rows,
  meta: { total: rows.length, page: 1, limit: 10, totalPages: 1 },
});
const one = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data });

const wh = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Depot ${id}`,
  code: `D-${id}`,
  address: null,
  description: null,
  status: "active",
  ...over,
});
const loc = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  warehouseId: "wh-1",
  name: `Shelf ${id}`,
  code: `S-${id}`,
  description: null,
  isActive: true,
  ...over,
});

let warehouses: unknown = list([]);
let locations: unknown = one([]);

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
  useWarehouseStore.setState({ warehouses: null, locations: [], isLoading: false, error: null });
  mockAuth.user = { id: "u-1", role: { name: "HEALTHCARE ADMIN" } };
  grant(WRITE);
  warehouses = list([
    wh("wh-1", { name: "Central Depot", code: "CD", address: "Block B" }),
    wh("wh-2", { name: "Old Annex", code: "OA", status: "suspended" }),
  ]);
  locations = one([loc("l1", { name: "Fridge", code: "F1", description: "2-8 °C" }), loc("l2", { name: "Old shelf", isActive: false })]);
  get.mockImplementation(async (url: string) => {
    const r = url === "/api/v1/warehouses" ? warehouses : url.endsWith("/locations") ? locations : undefined;
    if (r === undefined) throw new Error(`unexpected GET ${url}`);
    if (r instanceof Error) throw r;
    return r;
  });
});

const renderPage = async () => {
  const view = render(<WarehousePage />);
  await waitFor(() => expect(useWarehouseStore.getState().warehouses).not.toBeNull());
  return view;
};

describe("Warehouse page — list", () => {
  it("lists depots with status and address; asks for page 1 of 10", async () => {
    const { container } = await renderPage();
    expect(await screen.findByText("Central Depot")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/v1/warehouses", { params: { page: 1, limit: 10, find: "" } });
    expect(screen.getByText("Block B")).toBeInTheDocument();
    expect(screen.getByText("SUSPENDED")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("while loading, shows a skeleton — not 'No Depots Configured'", async () => {
    get.mockImplementation(() => new Promise(() => undefined));
    render(<WarehousePage />);
    await waitFor(() => expect(useWarehouseStore.getState().isLoading).toBe(true));
    expect(screen.queryByText("No Depots Configured")).not.toBeInTheDocument();
  });

  it("with no depots: the empty state, with a create button for a writer", async () => {
    warehouses = list([]);
    const { container } = await renderPage();
    expect(await screen.findByText("No Depots Configured")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create First Warehouse" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed load shows the error, never the empty state", async () => {
    warehouses = networkError();
    const { container } = render(<WarehousePage />);
    expect(await screen.findByText("Network Error")).toBeInTheDocument();
    expect(screen.queryByText("No Depots Configured")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("search reaches the request and resets to page 1", async () => {
    await renderPage();
    fireEvent.change(screen.getByPlaceholderText("Search warehouses by name or code..."), { target: { value: "annex" } });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith("/api/v1/warehouses", { params: { page: 1, limit: 10, find: "annex" } }),
    );
  });

  it("no permissions loaded (null): no Add/Edit/Delete in the DOM", async () => {
    grant(null);
    await renderPage();
    await screen.findByText("Central Depot");
    expect(screen.queryByRole("button", { name: "Add Warehouse" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("the super admin gets Add/Edit/Delete without a warehouse grant", async () => {
    grant(SUPER);
    await renderPage();
    await screen.findByText("Central Depot");
    expect(screen.getByRole("button", { name: "Add Warehouse" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });

  it("a warehouse:read grant: no Add/Edit/Delete; View opens the details read-only", async () => {
    grant(READ);
    await renderPage();
    await screen.findByText("Central Depot");
    expect(screen.queryByRole("button", { name: "Add Warehouse" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "View" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Warehouse Details" });
    expect(within(dialog).getByLabelText(/Warehouse Name/)).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Save Changes" })).not.toBeInTheDocument();
  });
});

describe("Warehouse page — warehouse writes", () => {
  it("Add Warehouse POSTs the form and reloads", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Warehouse" }));
    const dialog = await screen.findByRole("dialog", { name: "Add New Warehouse" });
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText(/Warehouse Name/), { target: { value: "ICU Store" } });
    fireEvent.change(within(dialog).getByLabelText(/Code \/ Identifier/), { target: { value: "ICU" } });
    fireEvent.change(within(dialog).getByLabelText(/Depot Address/), { target: { value: "Fl 3" } });
    post.mockResolvedValue(one(wh("wh-3"), "Warehouse created"));
    get.mockClear();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Warehouse" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/warehouses", {
      name: "ICU Store",
      code: "ICU",
      address: "Fl 3",
      description: "",
      status: "active",
    });
    expect(screen.queryByRole("dialog", { name: "Add New Warehouse" })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/v1/warehouses", expect.anything());
  });

  it("Edit PATCHes the warehouse, including a status change", async () => {
    await renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: "Edit" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Edit Warehouse" });
    expect(within(dialog).getByLabelText(/Warehouse Name/)).toHaveValue("Central Depot");
    fireEvent.click(within(dialog).getByRole("button", { name: /Operational Status/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Inactive" }));
    patch.mockResolvedValue(one(wh("wh-1"), "Warehouse updated"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/warehouses/wh-1", {
      name: "Central Depot",
      code: "CD",
      address: "Block B",
      description: "",
      status: "inactive",
    });
  });

  // F-19: the refusal renders INSIDE the open dialog. It used to land in the
  // page Alert, behind the modal, where the user could not see it.
  it("a refused create keeps the dialog open and shows the refusal inside it", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Warehouse" }));
    const dialog = await screen.findByRole("dialog", { name: "Add New Warehouse" });
    fireEvent.change(within(dialog).getByLabelText(/Warehouse Name/), { target: { value: "Dup" } });
    fireEvent.change(within(dialog).getByLabelText(/Code \/ Identifier/), { target: { value: "CD" } });
    post.mockRejectedValue(httpError(409, "Warehouse code CD already exists"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Warehouse" }));
    });
    const open = screen.getByRole("dialog", { name: "Add New Warehouse" });
    expect(await within(open).findByRole("alert")).toHaveTextContent("Warehouse code CD already exists");
    expect(screen.getAllByText("Warehouse code CD already exists")).toHaveLength(1);
  });

  it("F-19: a refused delete is explained in the confirm dialog, which stays open", async () => {
    await renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: "Delete" }))[1]);
    const dialog = await screen.findByRole("dialog", { name: "Delete Warehouse" });
    del.mockRejectedValue(httpError(409, "Warehouse still holds stock"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    const open = screen.getByRole("dialog", { name: "Delete Warehouse" });
    expect(within(open).getByRole("alert")).toHaveTextContent("Warehouse still holds stock");
  });

  it("Delete asks first; confirming DELETEs the depot", async () => {
    await renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: "Delete" }))[1]);
    const dialog = await screen.findByRole("dialog", { name: "Delete Warehouse" });
    expect(await axeViolations(dialog)).toEqual([]);
    del.mockResolvedValue(one({ id: "wh-2" }, "Warehouse deleted"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    expect(del).toHaveBeenCalledWith("/api/v1/warehouses/wh-2");
    expect(screen.queryByRole("dialog", { name: "Delete Warehouse" })).not.toBeInTheDocument();
  });

  it("Cancel on the delete confirmation sends nothing", async () => {
    await renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: "Delete" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Delete Warehouse" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();
  });
});

describe("Warehouse page — sub-locations", () => {
  const openLocations = async () => {
    await renderPage();
    await act(async () => {
      fireEvent.click((await screen.findAllByRole("button", { name: "Locations" }))[0]);
    });
    return screen.findByRole("dialog", { name: "Sub-locations: Central Depot" });
  };

  it("lists the depot's shelves, active and inactive", async () => {
    const dialog = await openLocations();
    expect(get).toHaveBeenCalledWith("/api/v1/warehouses/wh-1/locations");
    expect(within(dialog).getByText("Fridge")).toBeInTheDocument();
    expect(within(dialog).getByText("2-8 °C")).toBeInTheDocument();
    expect(within(dialog).getByText("INACTIVE")).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it("a depot with no shelves says so", async () => {
    locations = one([]);
    const dialog = await openLocations();
    expect(within(dialog).getByText("No storage shelves defined under this warehouse.")).toBeInTheDocument();
  });

  it("adding a shelf POSTs to the FLAT /warehouses/locations with the warehouse in the body", async () => {
    const dialog = await openLocations();
    fireEvent.change(within(dialog).getByLabelText(/Location Name/), { target: { value: "Cabinet 2" } });
    fireEvent.change(within(dialog).getByLabelText(/Location Code/), { target: { value: "C2" } });
    fireEvent.click(within(dialog).getByLabelText("Is Location Active"));
    post.mockResolvedValue(one(loc("l3"), "Location created"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Location" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/warehouses/locations", {
      name: "Cabinet 2",
      code: "C2",
      description: "",
      isActive: false,
      warehouseId: "wh-1",
    });
  });

  it("editing a shelf PATCHes /warehouses/locations/:id; Cancel returns to Add", async () => {
    const dialog = await openLocations();
    fireEvent.click(within(dialog).getByRole("button", { name: "Edit Fridge" }));
    expect(within(dialog).getByRole("heading", { name: "Edit Sub-location" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(dialog).getByRole("heading", { name: "Add Sub-location" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Edit Fridge" }));
    fireEvent.change(within(dialog).getByLabelText(/Location Name/), { target: { value: "Fridge A" } });
    patch.mockResolvedValue(one(loc("l1"), "Location updated"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Location" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/warehouses/locations/l1", {
      name: "Fridge A",
      code: "F1",
      description: "2-8 °C",
      isActive: true,
    });
  });

  it("deleting a shelf asks, then DELETEs /warehouses/locations/:id", async () => {
    const dialog = await openLocations();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Old shelf" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete Sub-location" });
    del.mockResolvedValue(one({ id: "l2" }, "Location deleted"));
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    });
    expect(del).toHaveBeenCalledWith("/api/v1/warehouses/locations/l2");
    expect(screen.queryByRole("dialog", { name: "Delete Sub-location" })).not.toBeInTheDocument();
  });

  it("F-19: a refused shelf save is explained inside the sub-locations dialog", async () => {
    const dialog = await openLocations();
    fireEvent.change(within(dialog).getByLabelText(/Location Name/), { target: { value: "Fridge" } });
    fireEvent.change(within(dialog).getByLabelText(/Location Code/), { target: { value: "F1" } });
    post.mockRejectedValue(httpError(409, "Location code F1 already exists in this warehouse"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Add Location" }));
    });
    const open = screen.getByRole("dialog", { name: "Sub-locations: Central Depot" });
    expect(within(open).getByRole("alert")).toHaveTextContent("Location code F1 already exists in this warehouse");
  });

  it("F-19: a refused shelf delete shows in the confirm on top, not in the dialog beneath", async () => {
    const dialog = await openLocations();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete Old shelf" }));
    const confirm = await screen.findByRole("dialog", { name: "Delete Sub-location" });
    del.mockRejectedValue(httpError(409, "Shelf still holds stock"));
    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    });
    const stillOpen = screen.getByRole("dialog", { name: "Delete Sub-location" });
    expect(within(stillOpen).getByRole("alert")).toHaveTextContent("Shelf still holds stock");
    expect(screen.getAllByText("Shelf still holds stock")).toHaveLength(1);
  });

  it("a warehouse:read grant sees the shelves but no form and no edit/delete", async () => {
    grant(READ);
    const dialog = await openLocations();
    expect(within(dialog).getByText("Fridge")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Add Location" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Edit Fridge" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: /Sub-locations/ })).not.toBeInTheDocument();
  });
});
