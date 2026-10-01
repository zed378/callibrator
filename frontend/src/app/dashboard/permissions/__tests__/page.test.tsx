/** @jest-environment jsdom */
/**
 * The role → menu-group permission matrix, against the backend contract:
 *  - GET  /api/v1/roles and GET /api/v1/roles/menus (rows in `data`,
 *    top-level `meta` — the house envelope since F-19);
 *  - GET  /api/v1/roles/:id → the role with its `permissions`;
 *  - POST /api/v1/roles/:roleId/permissions { menuGroupId, permissionType };
 *  - DELETE /api/v1/roles/:roleId/permissions/:menuGroupId.
 *
 * Real: the page, usePermissions, the role service, the toast store.
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
import PermissionsPage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const del = api.delete as jest.Mock;

const httpError = (status: number, message: string) =>
  new AxiosError(message, "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "",
    data: { success: false, status, message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

const list = (data: unknown[]) => ({ success: true, message: "ok", data, meta: { page: 1, limit: 100, total: data.length, totalPages: 1 } });

const roles = [
  { id: "r-1", name: "TECHNICIAN", nameToShow: "Technician", isActive: true },
  { id: "r-2", name: "AUDITOR", isActive: true },
];
const menus = [
  { id: "m-1", name: "Devices", slug: "devices" },
  { id: "m-2", name: "Audit", slug: "" },
];
const roleDetail: Record<string, unknown> = {
  "r-1": { ...roles[0], permissions: [{ menuGroupId: "m-1", permissionType: "write" }] },
  "r-2": { ...roles[1], permissions: [{ menuGroupId: "", menu: { id: "m-2", name: "Audit" } }] },
};

const backend = () => {
  get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/roles") return list(roles);
    if (url === "/api/v1/roles/menus") return list(menus);
    const id = url.replace("/api/v1/roles/", "");
    if (roleDetail[id]) return { success: true, data: roleDetail[id] };
    throw new Error(`unexpected GET ${url}`);
  });
};

const as = (roleName: string) =>
  useAuthStore.setState({
    user: { id: "u-1", username: "root", email: "r@x.test", role: { id: "r", name: roleName } } as User,
  });

const toasts = () => useToastStore.getState().toasts;
const rowOf = (menuName: string) => screen.getByText(menuName).closest("div.flex.items-center.justify-between") as HTMLElement;
const pressed = (menuName: string) =>
  within(rowOf(menuName))
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  as("SUPERADMIN");
  backend();
});

const renderPage = async () => {
  const view = render(<PermissionsPage />);
  await waitFor(() => expect(pressed("Devices")).toEqual(["Write"]));
  return view;
};

describe("permissions page", () => {
  it("anyone but a super admin gets an explanation and nothing is requested", async () => {
    as("HEALTHCARE ADMIN");
    const { container } = render(<PermissionsPage />);

    expect(screen.getByText("You need the SUPERADMIN role to manage role permissions.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Write/ })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows skeletons while roles and menus load", () => {
    get.mockImplementation(() => new Promise(() => undefined));
    const { container } = render(<PermissionsPage />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("No roles found")).not.toBeInTheDocument();
  });

  it("selects the first role and shows its grants per menu, and passes an accessibility check", async () => {
    const { container } = await renderPage();

    expect(get).toHaveBeenCalledWith("/api/v1/roles/r-1");
    expect(screen.getByText(/— Technician/)).toBeInTheDocument();
    expect(screen.getByText("1 of 2 granted")).toBeInTheDocument();
    expect(pressed("Audit")).toEqual(["None"]);
    expect(screen.getByText("devices")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("choosing another role loads its grants (a grant with no type reads as Read)", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "AUDITOR" }));

    await waitFor(() => expect(pressed("Audit")).toEqual(["Read"]));
    expect(get).toHaveBeenCalledWith("/api/v1/roles/r-2");
    expect(pressed("Devices")).toEqual(["None"]);
  });

  it("granting Read posts the permission, confirms it, and marks it current", async () => {
    post.mockResolvedValue({ success: true, data: { roleId: "r-1", menuGroupId: "m-2", permissionType: "read" } });
    await renderPage();

    fireEvent.click(within(rowOf("Audit")).getByRole("button", { name: "Read" }));

    await waitFor(() => expect(pressed("Audit")).toEqual(["Read"]));
    expect(post).toHaveBeenCalledWith("/api/v1/roles/r-1/permissions", { menuGroupId: "m-2", permissionType: "read" });
    expect(toasts()[0]).toMatchObject({ type: "success", title: "Permission set to read" });
    expect(screen.getByText("2 of 2 granted")).toBeInTheDocument();
  });

  it("choosing None removes the grant", async () => {
    del.mockResolvedValue({ success: true });
    await renderPage();

    fireEvent.click(within(rowOf("Devices")).getByRole("button", { name: "None" }));

    await waitFor(() => expect(pressed("Devices")).toEqual(["None"]));
    expect(del).toHaveBeenCalledWith("/api/v1/roles/r-1/permissions/m-1");
    expect(toasts()[0]).toMatchObject({ type: "success", title: "Permission removed" });
  });

  it("clicking the grant already in force sends nothing", async () => {
    await renderPage();

    fireEvent.click(within(rowOf("Devices")).getByRole("button", { name: "Write" }));

    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("a refused change is reported and the grant is left as it was", async () => {
    post.mockRejectedValue(httpError(403, "Only a super admin may grant permissions"));
    await renderPage();

    fireEvent.click(within(rowOf("Audit")).getByRole("button", { name: "Write" }));

    expect(await screen.findByText("Only a super admin may grant permissions")).toBeInTheDocument();
    expect(toasts()[0]).toMatchObject({ type: "error", title: "Only a super admin may grant permissions" });
    expect(pressed("Audit")).toEqual(["None"]);
  });

  it("a FAILED load shows the backend's error, not 'No roles found'", async () => {
    get.mockRejectedValue(httpError(503, "Role service unavailable"));
    const { container } = render(<PermissionsPage />);

    expect(await screen.findByText("Role service unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No roles found")).not.toBeInTheDocument();
    expect(screen.queryByText("No menu groups found")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed load of one role's grants is reported", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/roles") return list(roles);
      if (url === "/api/v1/roles/menus") return list(menus);
      throw httpError(404, "Role not found");
    });
    render(<PermissionsPage />);

    expect(await screen.findByText("Role not found")).toBeInTheDocument();
  });

  it("no roles and no menus read as empty", async () => {
    get.mockImplementation(async () => list([]));
    render(<PermissionsPage />);

    expect(await screen.findByText("No roles found")).toBeInTheDocument();
    expect(screen.getByText("No menu groups found")).toBeInTheDocument();
  });
});
