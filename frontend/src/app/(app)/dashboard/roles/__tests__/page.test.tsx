/** @jest-environment jsdom */
/**
 * The roles screen, against the backend contract (roles.controller.js, F-19 /
 * ADR-105): GET /api/v1/roles answers the house envelope (rows in `data`, a
 * top-level `meta`), and a row carries `status`, never `isActive`. POST /roles
 * and PATCH /roles/:id read { name, nameToShow, description, roleLevel (1-8),
 * status }; a system role's level is fixed (409).
 *
 * Real: the page, useRoles, the role store and service, the modals.
 * Mocked: the HTTP client and the dashboard chrome.
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
import RolesPage from "../page";
import { useRoleStore } from "@/stores/roleStore";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;

const httpError = (status: number, message: string) =>
  new AxiosError(message, "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    data: { success: false, status, message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const role = (patch: Record<string, unknown> = {}) => ({
  id: "r-1",
  name: "TECHNICIAN",
  nameToShow: "Technician",
  description: "Performs calibrations",
  roleLevel: 2,
  status: "active",
  isSystem: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

let rows: unknown[] = [];
let total = 0;

const backend = () => {
  get.mockImplementation(async (url: string, cfg: { params: { page: number; limit: number } }) => {
    if (url !== "/api/v1/roles") throw new Error(`unexpected GET ${url}`);
    return {
      success: true,
      message: "ok",
      data: rows,
      meta: { page: cfg.params.page, limit: cfg.params.limit, total, totalPages: Math.ceil(total / cfg.params.limit) },
    };
  });
};

const listCalls = () => get.mock.calls.filter(([url]) => url === "/api/v1/roles");

beforeEach(() => {
  jest.clearAllMocks();
  rows = [
    role(),
    role({ id: "r-2", name: "AUDITOR", nameToShow: undefined, description: undefined, roleLevel: undefined, status: "inactive", createdAt: undefined }),
  ];
  total = 2;
  useRoleStore.setState({ roles: null, isLoading: false, error: null });
  backend();
});

const renderPage = async () => {
  const view = render(<RolesPage />);
  await screen.findByText("TECHNICIAN");
  return view;
};

describe("roles page — list states", () => {
  it("shows a skeleton while loading, not the empty state", async () => {
    get.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(<RolesPage />);
    await waitFor(() => expect(listCalls()).toHaveLength(1));

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("No roles found")).not.toBeInTheDocument();
  });

  it("renders the roles and their counts, and passes an accessibility check", async () => {
    const { container } = await renderPage();

    const tech = screen.getByText("TECHNICIAN").closest("tr") as HTMLElement;
    expect(within(tech).getByText("Technician")).toBeInTheDocument();
    expect(within(tech).getByText("Level 2")).toBeInTheDocument();
    expect(within(tech).getByText("Active")).toBeInTheDocument();
    const auditor = screen.getByText("AUDITOR").closest("tr") as HTMLElement;
    expect(within(auditor).getByText("Inactive")).toBeInTheDocument();
    expect(within(auditor).getByText("Level -")).toBeInTheDocument();

    expect(screen.getByText("Total Roles").nextSibling).toHaveTextContent("2");
    expect(screen.getAllByText("Active")[0].nextSibling).toHaveTextContent("1");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("renders the empty state, which offers to create a role", async () => {
    rows = [];
    total = 0;
    const { container } = render(<RolesPage />);

    expect(await screen.findByText("No roles found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Create Role/ }));
    expect(screen.getByRole("dialog", { name: "Create New Role" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a FAILED load shows the backend's error, never the empty state", async () => {
    get.mockRejectedValue(httpError(403, "Forbidden"));
    const { container } = render(<RolesPage />);

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(screen.queryByText("No roles found")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("search and paging re-query with the top-level meta", async () => {
    total = 12;
    await renderPage();

    fireEvent.change(screen.getByPlaceholderText("Search roles..."), { target: { value: "tech" } });
    await waitFor(() => expect(listCalls().at(-1)?.[1]).toEqual({ params: { page: "1", limit: "10", search: "tech" } }));
    await screen.findByText("TECHNICIAN");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(listCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ page: "2" }) }));
    await screen.findByText("TECHNICIAN");

    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "25" } });
    await waitFor(() => expect(listCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ page: "1", limit: "25" }) }));
  });
});

describe("roles page — create and edit", () => {
  it("creates a role and reloads the list", async () => {
    post.mockResolvedValue({ success: true, data: role({ id: "r-3", name: "NURSE" }) });
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Add Role/ }));
    const dialog = screen.getByRole("dialog", { name: "Create New Role" });
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText("Role Name"), { target: { value: "NURSE" } });
    fireEvent.change(within(dialog).getByLabelText("Display Name"), { target: { value: "Nurse" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "Ward nurse" } });
    fireEvent.change(within(dialog).getByLabelText("Role Level"), { target: { value: "3" } });
    const before = listCalls().length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Role" }));

    // F-19: Display Name, Level and Active reach the API (they were dropped).
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/v1/roles", {
        name: "NURSE",
        nameToShow: "Nurse",
        description: "Ward nurse",
        roleLevel: 3,
        status: "active",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(listCalls().length).toBeGreaterThan(before);
  });

  it("a refused create (409) keeps the dialog open with the reason", async () => {
    post.mockRejectedValue(httpError(409, "Role TECHNICIAN already exists"));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /Add Role/ }));
    const dialog = screen.getByRole("dialog", { name: "Create New Role" });
    fireEvent.change(within(dialog).getByLabelText("Role Name"), { target: { value: "TECHNICIAN" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Role" }));

    expect(await within(dialog).findByText("Role TECHNICIAN already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Create New Role" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("edits a role: prefilled, and deactivating it is sent as status 'inactive'", async () => {
    patch.mockResolvedValue({ success: true, data: role({ status: "inactive" }) });
    await renderPage();

    fireEvent.click(within(screen.getByText("TECHNICIAN").closest("tr") as HTMLElement).getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit Role" });
    expect(within(dialog).getByLabelText("Role Name")).toHaveValue("TECHNICIAN");
    expect(within(dialog).getByLabelText("Role Level")).toHaveValue(2);
    const active = within(dialog).getByRole("checkbox", { name: "Active" });
    expect(active).toBeChecked();

    fireEvent.click(active);
    fireEvent.change(within(dialog).getByLabelText("Role Level"), { target: { value: "" } });
    expect(within(dialog).getByLabelText("Role Level")).toHaveValue(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Role" }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/api/v1/roles/r-1", {
        name: "TECHNICIAN",
        nameToShow: "Technician",
        description: "Performs calibrations",
        roleLevel: 1,
        status: "inactive",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("an edit of a role with no optional fields falls back to defaults", async () => {
    await renderPage();

    fireEvent.click(within(screen.getByText("AUDITOR").closest("tr") as HTMLElement).getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit Role" });

    expect(within(dialog).getByLabelText("Display Name")).toHaveValue("");
    expect(within(dialog).getByLabelText("Role Level")).toHaveValue(1);
    expect(within(dialog).getByRole("checkbox", { name: "Active" })).not.toBeChecked();
  });

  it("a refused edit keeps the dialog open with the reason", async () => {
    patch.mockRejectedValue(httpError(403, "System roles cannot be renamed"));
    await renderPage();

    fireEvent.click(within(screen.getByText("TECHNICIAN").closest("tr") as HTMLElement).getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit Role" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Role" }));

    expect(await within(dialog).findByText("System roles cannot be renamed")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("roles page — the fields the dialog offers (F-19, ADR-105)", () => {
  it("F-19: Active/Inactive comes from the row's status (the backend never sends isActive)", async () => {
    await renderPage();
    const tech = screen.getByText("TECHNICIAN").closest("tr") as HTMLElement;
    expect(within(tech).getByText("Active")).toBeInTheDocument();
    const auditor = screen.getByText("AUDITOR").closest("tr") as HTMLElement;
    expect(within(auditor).getByText("Inactive")).toBeInTheDocument();
  });

  it("F-19: saving an inactive role without touching Active keeps it inactive", async () => {
    patch.mockResolvedValue({ success: true, data: role({ id: "r-2", status: "inactive" }) });
    await renderPage();

    fireEvent.click(within(screen.getByText("AUDITOR").closest("tr") as HTMLElement).getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit Role" });
    expect(within(dialog).getByRole("checkbox", { name: "Active" })).not.toBeChecked();
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Role" }));

    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0][1]).toEqual(expect.objectContaining({ status: "inactive" }));
  });

  it("F-19: an edit sends the Display Name and a changed Level; an unchanged Level is not sent", async () => {
    patch.mockResolvedValue({ success: true, data: role() });
    await renderPage();

    fireEvent.click(within(screen.getByText("TECHNICIAN").closest("tr") as HTMLElement).getByRole("button", { name: /Edit/ }));
    let dialog = screen.getByRole("dialog", { name: "Edit Role" });
    fireEvent.change(within(dialog).getByLabelText("Display Name"), { target: { value: "Bench technician" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Role" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toEqual(expect.objectContaining({ nameToShow: "Bench technician" }));
    expect(patch.mock.calls[0][1]).not.toHaveProperty("roleLevel");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(within(screen.getByText("TECHNICIAN").closest("tr") as HTMLElement).getByRole("button", { name: /Edit/ }));
    dialog = screen.getByRole("dialog", { name: "Edit Role" });
    fireEvent.change(within(dialog).getByLabelText("Role Level"), { target: { value: "6" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Role" }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls[1][1]).toEqual(expect.objectContaining({ roleLevel: 6 }));
  });

  it("F-19: the level is bounded at 8 (the tenant-admin tier), and a system role's level is read-only", async () => {
    rows = [role(), role({ id: "r-9", name: "SUPERADMIN", isSystem: true, roleLevel: 10 })];
    await renderPage();

    fireEvent.click(within(screen.getByText("TECHNICIAN").closest("tr") as HTMLElement).getByRole("button", { name: /Edit/ }));
    let dialog = screen.getByRole("dialog", { name: "Edit Role" });
    expect(within(dialog).getByLabelText("Role Level")).toHaveAttribute("max", "8");
    expect(within(dialog).getByLabelText("Role Level")).not.toHaveAttribute("readonly");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(within(screen.getByText("SUPERADMIN").closest("tr") as HTMLElement).getByRole("button", { name: /Edit/ }));
    dialog = screen.getByRole("dialog", { name: "Edit Role" });
    expect(within(dialog).getByLabelText("Role Level")).toHaveAttribute("readonly");
    expect(within(dialog).getByText("A system role's level is fixed.")).toBeInTheDocument();
  });

  it("F-19: a refused level change (409) shows the backend's state explanation in the dialog", async () => {
    patch.mockRejectedValue(httpError(409, '"TECHNICIAN" is a system role; its level (2) is fixed and cannot be changed'));
    await renderPage();

    fireEvent.click(within(screen.getByText("TECHNICIAN").closest("tr") as HTMLElement).getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit Role" });
    fireEvent.change(within(dialog).getByLabelText("Role Level"), { target: { value: "5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Role" }));

    expect(await within(dialog).findByText(/its level \(2\) is fixed/)).toBeInTheDocument();
  });
});

describe("roles page — delete", () => {
  it("deletes after confirmation and reloads", async () => {
    del.mockResolvedValue({ success: true });
    await renderPage();

    fireEvent.click(within(screen.getByText("AUDITOR").closest("tr") as HTMLElement).getByRole("button", { name: /Delete/ }));
    const dialog = screen.getByRole("dialog", { name: "Delete Role" });
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getByText("AUDITOR").closest("tr") as HTMLElement).getByRole("button", { name: /Delete/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete Role" })).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/v1/roles/r-2"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a refused delete (409 — users still hold the role) says why, and the role stays", async () => {
    del.mockRejectedValue(httpError(409, "Role is assigned to 4 users"));
    await renderPage();

    fireEvent.click(within(screen.getByText("TECHNICIAN").closest("tr") as HTMLElement).getByRole("button", { name: /Delete/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete Role" })).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Role is assigned to 4 users")).toBeInTheDocument();
    expect(screen.getByText("TECHNICIAN")).toBeInTheDocument();
  });
});
