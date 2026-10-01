/**
 * Vendors page — VendorsTable and VendorModal — through the REAL useVendors
 * hook and vendor service: `@/api/client` mocked with the backend's envelope
 * (backend/src/controllers/vendor.controller.js: rows in `data`, top-level
 * `meta`). Create sends no `rating` (the create contract has none; Q-37); edit does.
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
import type { Vendor } from "@/api/services/vendor.service";
import { useToastStore } from "@/stores/toastStore";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError, networkError } from "@/tests/support/httpErrors";
import VendorsPage from "../page";
import { VENDOR_NOTES_MAX } from "@callibrator/contracts/vendor";

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

const vendor = (id: string, over: Partial<Vendor> = {}): Vendor => ({
  id,
  tenantId: "t-1",
  name: `Vendor ${id}`,
  type: "CalibrationLab",
  contactPerson: null,
  email: null,
  phone: null,
  address: null,
  rating: null,
  status: "Active",
  approvalStatus: "pending",
  lastAuditDate: null,
  nextAuditDate: null,
  createdAt: "2026-09-20T08:00:00.000Z",
  updatedAt: "2026-09-20T08:00:00.000Z",
  ...over,
});

const list = (rows: Vendor[]) => ({
  success: true,
  status: 200,
  message: "Vendors retrieved",
  data: rows,
  meta: { total: rows.length, page: 1, limit: 10, totalPages: 1 },
});
const ok = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data });

let answer: () => unknown;
const lastToast = () => useToastStore.getState().toasts.at(-1);

// Multi-step page flows with an axe pass each; under --coverage on a loaded
// machine one can exceed Jest's 5 s default (see jest.setup.ts).
jest.setTimeout(20000);

// ADR-102: write actions come from the caller's EFFECTIVE permissions (menuStore,
// GET /menu-groups/my-permissions), never from role names.
type Effective = { superAdmin: boolean; permissions: Record<string, "read" | "write"> } | null;
const grant = (effective: Effective) => useMenuStore.setState({ effectivePermissions: effective });
const WRITE: Effective = { superAdmin: false, permissions: { vendors: "write" } };
const READ: Effective = { superAdmin: false, permissions: { vendors: "read" } };
const SUPER: Effective = { superAdmin: true, permissions: {} };

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  mockAuth.user = { id: "u-1", role: { name: "CALIBRATOR ADMIN" } };
  grant(WRITE);
  answer = () =>
    list([
      vendor("v1", { name: "Precision Labs", contactPerson: "Dewi", email: "dewi@lab.test", phone: "0812", rating: 4.5, approvalStatus: "approved" }),
      vendor("v2", { name: "Parts R Us", type: "PartsSupplier", status: "Inactive", approvalStatus: "rejected" }),
      vendor("v3", { name: "Misc Co", type: "Other", approvalStatus: null }),
    ]);
  get.mockImplementation(async () => {
    const r = answer();
    if (r instanceof Error) throw r;
    return r;
  });
});

const renderPage = async () => {
  const view = render(<VendorsPage />);
  await screen.findByText("Precision Labs");
  return view;
};

describe("Vendors — table", () => {
  it("lists vendors with type, contact, rating, status and approval", async () => {
    const { container } = await renderPage();
    expect(get).toHaveBeenCalledWith("/api/v1/vendors", {
      params: { page: 1, limit: 10, find: undefined, status: undefined, type: undefined },
    });
    const row = screen.getByText("Precision Labs").closest("tr") as HTMLElement;
    expect(within(row).getByText("Calibration Lab")).toBeInTheDocument();
    expect(within(row).getByText("dewi@lab.test")).toBeInTheDocument();
    expect(within(row).getByText("4.5 / 5")).toBeInTheDocument();
    expect(within(row).getByText("Approved")).toBeInTheDocument();
    const parts = screen.getByText("Parts R Us").closest("tr") as HTMLElement;
    expect(within(parts).getByText("Inactive")).toBeInTheDocument();
    expect(within(parts).getByText("Rejected")).toBeInTheDocument();
    expect(within(screen.getByText("Misc Co").closest("tr") as HTMLElement).getByText("Pending")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an approved vendor offers Reject only; a rejected one Approve only; a pending one both", async () => {
    await renderPage();
    const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;
    expect(within(row("Precision Labs")).queryByRole("button", { name: "Approve vendor" })).not.toBeInTheDocument();
    expect(within(row("Precision Labs")).getByRole("button", { name: "Reject vendor" })).toBeInTheDocument();
    expect(within(row("Parts R Us")).getByRole("button", { name: "Approve vendor" })).toBeInTheDocument();
    expect(within(row("Parts R Us")).queryByRole("button", { name: "Reject vendor" })).not.toBeInTheDocument();
    expect(within(row("Misc Co")).getByRole("button", { name: "Approve vendor" })).toBeInTheDocument();
  });

  it("no vendors: 'No vendors found'", async () => {
    answer = () => list([]);
    const { container } = render(<VendorsPage />);
    expect(await screen.findByText("No vendors found")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed load shows the error, never 'No vendors found'", async () => {
    answer = () => networkError();
    const { container } = render(<VendorsPage />);
    expect(await screen.findByText("Network Error")).toBeInTheDocument();
    expect(screen.getByText("The vendor list could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByText("No vendors found")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("the super admin gets the write controls without a vendors grant", async () => {
    grant(SUPER);
    await renderPage();
    expect(screen.getByRole("button", { name: "Add Vendor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Precision Labs" })).toBeInTheDocument();
  });

  it.each([
    ["a vendors:read grant", READ],
    ["no permissions loaded (null)", null],
  ])("%s: no write controls in the DOM", async (_label, effective) => {
    grant(effective);
    await renderPage();
    expect(screen.queryByRole("button", { name: "Add Vendor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Precision Labs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve vendor" })).not.toBeInTheDocument();
  });

  it("filters reach the request", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "All Types" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Parts Supplier" }));
    });
    fireEvent.click(screen.getByRole("button", { name: "All Statuses" }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("option", { name: "Inactive" }));
    });
    fireEvent.change(screen.getByPlaceholderText("Search name, contact person, email..."), { target: { value: "parts" } });
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith("/api/v1/vendors", {
        params: { page: 1, limit: 10, find: "parts", status: "Inactive", type: "PartsSupplier" },
      }),
    );
  });
});

describe("Vendors — actions", () => {
  it("approving PATCHes /qualify and toasts", async () => {
    await renderPage();
    patch.mockResolvedValue(ok(vendor("v2", { approvalStatus: "approved" })));
    await act(async () => {
      fireEvent.click(within(screen.getByText("Parts R Us").closest("tr") as HTMLElement).getByRole("button", { name: "Approve vendor" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/vendors/v2/qualify", { approvalStatus: "approved" });
    expect(lastToast()).toMatchObject({ type: "success", title: "Vendor approved" });
  });

  it("a refused qualification (403) is toasted with the backend's message", async () => {
    await renderPage();
    patch.mockRejectedValue(httpError(403, "You do not have write access to vendor"));
    await act(async () => {
      fireEvent.click(within(screen.getByText("Precision Labs").closest("tr") as HTMLElement).getByRole("button", { name: "Reject vendor" }));
    });
    expect(lastToast()).toMatchObject({ type: "error", title: "You do not have write access to vendor" });
  });

  // Q-37 (decided): a rating comes from evaluation, not registration — the
  // create form offers none and the create contract takes none.
  it("Add Vendor POSTs the trimmed form", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Vendor" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Vendor" });
    expect(within(dialog).queryByLabelText("Rating (1-5)")).not.toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText("Vendor Name *"), { target: { value: " Kalibra Lab " } });
    fireEvent.change(within(dialog).getByLabelText("Contact Person"), { target: { value: "Rudi" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "rudi@k.test" } });
    fireEvent.change(within(dialog).getByLabelText("Address"), { target: { value: "Jl. Merdeka 1" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Type/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Other" }));
    post.mockResolvedValue(ok(vendor("v9"), "Vendor created"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Vendor" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/vendors", {
      name: "Kalibra Lab",
      type: "Other",
      contactPerson: "Rudi",
      email: "rudi@k.test",
      phone: undefined,
      address: "Jl. Merdeka 1",
      status: "Active",
    });
    expect(lastToast()).toMatchObject({ type: "success", title: "Vendor created" });
    expect(screen.queryByRole("dialog", { name: "Add Vendor" })).not.toBeInTheDocument();
  });

  it("Edit pre-fills the vendor and PATCHes it with the rating", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit Precision Labs" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Vendor" });
    expect(within(dialog).getByLabelText("Vendor Name *")).toHaveValue("Precision Labs");
    fireEvent.change(within(dialog).getByLabelText("Rating (1-5)"), { target: { value: "3.5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Status/ }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Inactive" }));
    patch.mockResolvedValue(ok(vendor("v1"), "Vendor updated"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/vendors/v1", {
      name: "Precision Labs",
      type: "CalibrationLab",
      contactPerson: "Dewi",
      email: "dewi@lab.test",
      phone: "0812",
      address: undefined,
      notes: null, // Q-52: an empty Notes on edit clears the stored value
      status: "Inactive",
      rating: 3.5,
    });
    expect(lastToast()).toMatchObject({ type: "success", title: "Vendor updated" });
  });

  // Q-52: the API stores `notes` since migration 0106; the form now offers it.
  it("Add Vendor sends the trimmed Notes, bounded by the contract's maximum", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Vendor" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Vendor" });
    const notes = within(dialog).getByLabelText("Notes");
    expect(notes).toHaveAttribute("maxLength", String(VENDOR_NOTES_MAX));
    expect(VENDOR_NOTES_MAX).toBe(2000);
    fireEvent.change(within(dialog).getByLabelText("Vendor Name *"), { target: { value: "Kalibra Lab" } });
    fireEvent.change(notes, { target: { value: "  ISO 17025 scope: temperature  " } });
    expect(within(dialog).getByText(`32 / ${String(VENDOR_NOTES_MAX)}`)).toBeInTheDocument();
    post.mockResolvedValue(ok(vendor("v9"), "Vendor created"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Vendor" }));
    });
    expect(post).toHaveBeenCalledWith("/api/v1/vendors", expect.objectContaining({ notes: "ISO 17025 scope: temperature" }));
  });

  it("Edit pre-fills Notes and PATCHes the change; the list shows the notes", async () => {
    answer = () => list([vendor("v1", { name: "Precision Labs", notes: "Contract renewed 2026" })]);
    await renderPage();
    const row = screen.getByText("Precision Labs").closest("tr") as HTMLElement;
    expect(within(row).getByText("Contract renewed 2026")).toHaveAttribute("title", "Contract renewed 2026");
    fireEvent.click(screen.getByRole("button", { name: "Edit Precision Labs" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Vendor" });
    expect(within(dialog).getByLabelText("Notes")).toHaveValue("Contract renewed 2026");
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText("Notes"), { target: { value: "Contract renewed 2027" } });
    patch.mockResolvedValue(ok(vendor("v1"), "Vendor updated"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    });
    expect(patch).toHaveBeenCalledWith("/api/v1/vendors/v1", expect.objectContaining({ notes: "Contract renewed 2027" }));
  });

  it("a refused save (409, duplicate name) keeps the dialog open and toasts why", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add Vendor" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Vendor" });
    fireEvent.change(within(dialog).getByLabelText("Vendor Name *"), { target: { value: "Precision Labs" } });
    post.mockRejectedValue(httpError(409, "A vendor with this name already exists"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Create Vendor" }));
    });
    expect(screen.getByRole("dialog", { name: "Add Vendor" })).toBeInTheDocument();
    expect(lastToast()).toMatchObject({ type: "error", title: "A vendor with this name already exists" });
  });

  it("Delete asks, then DELETEs; Cancel closes", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Delete Misc Co" }));
    let dialog = await screen.findByRole("dialog", { name: "Delete Vendor" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Delete Vendor" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Misc Co" }));
    dialog = await screen.findByRole("dialog", { name: "Delete Vendor" });
    expect(await axeViolations(dialog)).toEqual([]);
    del.mockResolvedValue(ok(null, "Vendor deleted"));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Delete/ }));
    });
    expect(del).toHaveBeenCalledWith("/api/v1/vendors/v3");
    expect(lastToast()).toMatchObject({ type: "success", title: "Vendor deleted" });
  });
});
