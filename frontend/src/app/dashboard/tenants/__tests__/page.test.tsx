/** @jest-environment jsdom */
/**
 * The tenants screen, against the backend contract:
 *  - a super admin lists every tenant: GET /api/v1/tenants/all (rows in `data`,
 *    top-level `meta`);
 *  - anyone else sees their own tenant only: POST /api/v1/tenants/detail (A-76);
 *  - create POST /api/v1/tenants/create and edit PATCH /api/v1/tenants/edit are
 *    multipart; delete is DELETE /api/v1/tenants/delete?tenantId=.
 *
 * Real: the page, useTenants, the tenant store and service, the modals and the
 * SSO / MFA panels. Mocked: the HTTP client, the dashboard chrome, next/navigation.
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

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import { api } from "@/api/client";
import TenantsPage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useTenantStore } from "@/stores/tenantStore";
import type { User } from "@/types";
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

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

const tenant = (patch: Record<string, unknown> = {}) => ({
  id: "t-1",
  name: "RS Harapan",
  code: "RSH",
  description: "General hospital",
  primaryColor: "#4f46e5",
  status: "ACTIVE",
  limitSeats: 50,
  email: "it@rsh.test",
  phone: "+62 1",
  address: "Jl. Sehat 1",
  city: "Bandung",
  state: "Jawa Barat",
  zipCode: "40111",
  country: "Indonesia",
  website: "https://rsh.test",
  logoBaseUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

let tenantRows: unknown[] = [];

const backend = () => {
  get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/tenants/all")
      return envelope(tenantRows, { total: tenantRows.length, page: 1, limit: 10, totalPages: 1 });
    throw new Error(`unexpected GET ${url}`);
  });
  post.mockImplementation(async (url: string, body: { tenantId?: string }) => {
    if (url === "/api/v1/tenants/detail") return envelope(tenantRows.find((t) => (t as { id: string }).id === body.tenantId));
    if (url === "/api/v1/tenants/settings") return envelope({ tenantId: body.tenantId, settings: {} });
    if (url === "/api/v1/tenants/create") return envelope(tenant({ id: "t-9" }));
    throw new Error(`unexpected POST ${url}`);
  });
};

/**
 * ADR-102: the write controls follow the effective permissions, granted here
 * as the seed gives them — the super admin passes every gate, the level-8
 * admins hold `management` write, everyone else read.
 */
const as = (roleName: string, tenantId: string | null = "t-1") => {
  useAuthStore.setState({
    user: { id: "u-1", username: "ada", email: "a@x.test", tenantId, role: { id: "r", name: roleName } } as User,
  });
  if (roleName === "SUPERADMIN") grantSuperAdmin();
  else grantPermissions({ management: ["HEALTHCARE ADMIN", "CALIBRATOR ADMIN"].includes(roleName) ? "write" : "read" });
};

const listCalls = () => get.mock.calls.filter(([url]) => url === "/api/v1/tenants/all");
const formEntries = (body: unknown) => Object.fromEntries((body as FormData).entries());

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = ".hidden { display: none; }";
  document.head.appendChild(style);
});

beforeEach(() => {
  jest.clearAllMocks();
  tenantRows = [tenant(), tenant({ id: "t-2", name: "RS Sehat", code: "RSS", status: "SUSPENDED", description: undefined })];
  useTenantStore.setState({ tenants: null, isLoading: false, error: null, listTenantId: null, settings: null, currentTenant: null });
  as("SUPERADMIN", null);
  backend();
});

const renderPage = async () => {
  const view = render(<TenantsPage />);
  await screen.findByText("RS Harapan");
  return view;
};

describe("tenants page — list states and scope", () => {
  it("a super admin sees every tenant, with create and delete, and the page passes an accessibility check", async () => {
    const { container } = await renderPage();

    expect(listCalls()).toHaveLength(1);
    expect(screen.getByText("RS Sehat")).toBeInTheDocument();
    expect(screen.getByText("SUSPENDED")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Tenant/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete RS Sehat" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a tenant admin reads only their own tenant, and gets no create or delete control", async () => {
    as("HEALTHCARE ADMIN", "t-1");
    await renderPage();

    expect(post).toHaveBeenCalledWith("/api/v1/tenants/detail", { tenantId: "t-1" });
    expect(listCalls()).toHaveLength(0);
    expect(screen.queryByText("RS Sehat")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create Tenant/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete RS Harapan/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit RS Harapan" })).toBeInTheDocument();
  });

  it("nothing is requested before the signed-in user is known", async () => {
    useAuthStore.setState({ user: null });
    render(<TenantsPage />);
    await new Promise((r) => setTimeout(r, 20));

    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("shows skeletons while the list is in flight, not the empty state", async () => {
    get.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(<TenantsPage />);
    await waitFor(() => expect(listCalls()).toHaveLength(1));

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("No tenants found")).not.toBeInTheDocument();
  });

  it("the empty state invites a super admin to create the first tenant", async () => {
    tenantRows = [];
    const { container } = render(<TenantsPage />);

    expect(await screen.findByText("No tenants found")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Create Tenant/ }).at(-1) as HTMLElement);
    expect(screen.getByRole("dialog", { name: "Create New Tenant" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a FAILED load shows the backend's error, never the empty state", async () => {
    get.mockRejectedValue(httpError(503, "Tenant service unavailable"));
    const { container } = render(<TenantsPage />);

    expect(await screen.findByText("Tenant service unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No tenants found")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("the search box narrows the cards by name or code", async () => {
    await renderPage();

    fireEvent.change(screen.getByPlaceholderText("Search tenants..."), { target: { value: "rss" } });

    await waitFor(() => expect(screen.queryByText("RS Harapan")).not.toBeInTheDocument());
    expect(await screen.findByText("RS Sehat")).toBeInTheDocument();
  });

  it("the backups button opens that tenant's backup page", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Manage backups for RS Harapan" }));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/tenants/t-1/backup");
  });
});

describe("tenants page — create", () => {
  it("sends the form as multipart with the logo, closes, and reloads", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Create Tenant/ }));
    const dialog = screen.getByRole("dialog", { name: "Create New Tenant" });
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "RS Baru" } });
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "RSB" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "New wing" } });
    fireEvent.change(within(dialog).getByLabelText("Seat limit"), { target: { value: "25" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "it@rsb.test" } });
    fireEvent.change(within(dialog).getByLabelText("Phone"), { target: { value: "+62 2" } });
    fireEvent.change(within(dialog).getByLabelText("Address"), { target: { value: "Jl. Baru" } });
    fireEvent.change(within(dialog).getByLabelText("City"), { target: { value: "Jakarta" } });
    fireEvent.change(within(dialog).getByLabelText("State"), { target: { value: "DKI" } });
    fireEvent.change(within(dialog).getByLabelText("Zip Code"), { target: { value: "10110" } });
    fireEvent.change(within(dialog).getByLabelText("Country"), { target: { value: "Indonesia" } });
    fireEvent.change(within(dialog).getByLabelText("Website"), { target: { value: "https://rsb.test" } });
    const logo = new File(["png"], "logo.png", { type: "image/png" });
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [logo] } });
    expect(await within(dialog).findByAltText("Logo preview")).toBeInTheDocument();

    const before = listCalls().length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Tenant" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/tenants/create", expect.any(FormData)));
    const sent = formEntries(post.mock.calls.find(([u]) => u === "/api/v1/tenants/create")?.[1]);
    expect(sent).toMatchObject({
      name: "RS Baru",
      code: "RSB",
      description: "New wing",
      // Seat limit: sent as limitSeats (the backend's single source), never maxUsers.
      limitSeats: "25",
      email: "it@rsb.test",
      phone: "+62 2",
      address: "Jl. Baru",
      city: "Jakarta",
      state: "DKI",
      zipCode: "10110",
      country: "Indonesia",
      website: "https://rsb.test",
      primaryColor: "#4f46e5",
    });
    expect((sent.file as File).name).toBe("logo.png");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(listCalls().length).toBeGreaterThan(before);
  });

  it("a chosen logo can be removed again before saving", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Create Tenant/ }));
    const dialog = screen.getByRole("dialog", { name: "Create New Tenant" });
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["png"], "logo.png", { type: "image/png" })] },
    });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Remove logo" }));

    expect(within(dialog).queryByAltText("Logo preview")).not.toBeInTheDocument();
  });

  it("a refused create (409 — the code is taken) keeps the dialog open with the reason", async () => {
    await renderPage();
    post.mockImplementation(async (url: string) => {
      if (url === "/api/v1/tenants/create") throw httpError(409, "Tenant code RSH already exists");
      throw new Error(`unexpected POST ${url}`);
    });
    fireEvent.click(screen.getByRole("button", { name: /Create Tenant/ }));
    const dialog = screen.getByRole("dialog", { name: "Create New Tenant" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Dup" } });
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "RSH" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Tenant" }));

    expect((await within(dialog).findAllByText("Tenant code RSH already exists")).length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog", { name: "Create New Tenant" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("tenants page — edit", () => {
  it("prefills the form, keeps the code read-only, and saves as multipart", async () => {
    patch.mockResolvedValue(envelope(tenant({ name: "RS Harapan Baru" })));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit RS Harapan" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Tenant" });
    expect(await axeViolations(dialog)).toEqual([]);
    expect(within(dialog).getByLabelText("Name")).toHaveValue("RS Harapan");
    expect(within(dialog).getByLabelText("Code")).toBeDisabled();
    expect(within(dialog).getByLabelText("City")).toHaveValue("Bandung");

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "RS Harapan Baru" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Renamed" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "new@rsh.test" } });
    fireEvent.change(within(dialog).getByLabelText("Website"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Active" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Inactive" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Tenant" }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith("/api/v1/tenants/edit", expect.any(FormData)));
    expect(formEntries(patch.mock.calls[0][1])).toMatchObject({
      tenantId: "t-1",
      name: "RS Harapan Baru",
      code: "RSH",
      description: "Renamed",
      status: "INACTIVE",
      email: "new@rsh.test",
      // A-303: the stored profile is sent back, and an emptied field is sent as "" (it clears).
      city: "Bandung",
      website: "",
    });
    // A-303: the seat limit is not an edit field.
    expect(formEntries(patch.mock.calls[0][1])).not.toHaveProperty("maxUsers");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a tenant admin sees status read-only (the platform owns it, A-63); the seat limit is not on the form (A-303)", async () => {
    as("HEALTHCARE ADMIN", "t-1");
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit RS Harapan" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Tenant" });

    expect(within(dialog).getByRole("button", { name: "Active" })).toBeDisabled();
    expect(within(dialog).queryByLabelText("Max Users")).not.toBeInTheDocument();
  });

  it("a stored logo is shown and kept unless replaced", async () => {
    tenantRows = [tenant({ logoBaseUrl: "/uploads/logo-t1.png" })];
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit RS Harapan" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Tenant" });

    expect(within(dialog).getByText("Current logo will be kept")).toBeInTheDocument();
    const keep = within(dialog).getByRole("checkbox", { name: "Keep current logo" });
    expect(keep).toBeChecked();
    fireEvent.click(keep);
    expect(within(dialog).getByText("New logo will replace the current one")).toBeInTheDocument();

    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["png"], "new.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(within(dialog).queryByRole("checkbox", { name: "Keep current logo" })).not.toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove logo" }));
    expect(within(dialog).getByText("Upload a logo (PNG, JPG, SVG)")).toBeInTheDocument();
  });

  it("a refused edit keeps the dialog open with the backend's reason", async () => {
    patch.mockRejectedValue(httpError(403, "Only a super admin may change the seat limit"));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit RS Harapan" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Tenant" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Tenant" }));

    expect((await within(dialog).findAllByText("Only a super admin may change the seat limit")).length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("tenants page — delete", () => {
  it("deletes after confirmation and reloads the list", async () => {
    del.mockResolvedValue(envelope(null));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete RS Sehat" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm Delete" });
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete RS Sehat" }));
    const before = listCalls().length;
    fireEvent.click(within(screen.getByRole("dialog", { name: "Confirm Delete" })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/v1/tenants/delete", { params: { tenantId: "t-2" } }));
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
  });

  it("a refused delete (409 — the tenant still has users) says why, and the tenant stays", async () => {
    del.mockRejectedValue(httpError(409, "Tenant still has active users"));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete RS Sehat" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Confirm Delete" })).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Tenant still has active users")).toBeInTheDocument();
    expect(screen.getByText("RS Sehat")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("tenants page — SSO and MFA panels", () => {
  it("opens the SAML panel for a tenant and closes it", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Configure SAML SSO for RS Harapan" }));
    const dialog = await screen.findByRole("dialog", { name: "SSO SAML Configuration" });
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/tenants/settings", { tenantId: "t-1" }));

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Close" })[0]);
    expect(screen.queryByRole("dialog", { name: "SSO SAML Configuration" })).not.toBeInTheDocument();
  });

  it("opens the MFA policy panel for a tenant", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "MFA policy for RS Harapan" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/tenants/settings", { tenantId: "t-1" }));
  });
});

/**
 * ADR-102 — Edit, SSO, MFA policy and backups need `management` write (and
 * backups the tenant-administrator level, the same seeded roles); create and
 * delete are the super admin's. ENGINEERING MANAGER holds `management` read.
 * Fail-before: Edit, SSO, MFA and backups rendered for every role.
 */
describe("ADR-102 — tenant controls follow the effective permission", () => {
  it("a `management` reader sees its tenant without Edit, SSO, MFA or backups", async () => {
    as("ENGINEERING MANAGER");
    render(<TenantsPage />);
    expect(await screen.findByText("RS Harapan")).toBeInTheDocument();
    for (const name of [/^Edit /, /^Configure SAML SSO/, /^MFA policy/, /^Manage backups/, /^Delete /]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    as("HEALTHCARE ADMIN");
    clearPermissions();
    render(<TenantsPage />);
    expect(await screen.findByText("RS Harapan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit / })).not.toBeInTheDocument();
  });
});
