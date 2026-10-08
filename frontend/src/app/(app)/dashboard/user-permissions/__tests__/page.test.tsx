/** @jest-environment jsdom */
/**
 * Per-user permission overrides, against the backend contract:
 *  - GET    /api/v1/users/all (rows in `data`, top-level `meta`);
 *  - GET    /api/v1/menu-groups/roles;
 *  - GET    /api/v1/user-permissions/:userId → { user, rolePermissions, overrides, effective };
 *  - POST   /api/v1/user-permissions/:userId { menuGroupId, permissionType, notes };
 *  - DELETE /api/v1/user-permissions/:userId/:menuGroupId;
 *  - POST   /api/v1/users/role-update { userId, roleId }.
 *
 * Real: the page, useUserPermissions, the services, the toast store.
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
import UserPermissionsPage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useToastStore } from "@/stores/toastStore";
import type { User } from "@/types";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
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

const users = [
  { id: "u-2", username: "grace", firstName: "Grace", lastName: "Hopper", email: "grace@x.test", isEmailVerified: true, createdAt: "", role: { id: "r-tech", name: "TECHNICIAN", nameToShow: "Technician", description: "" } },
  { id: "u-3", username: "linus", firstName: "", lastName: "", email: "linus@x.test", isEmailVerified: true, createdAt: "" },
];
const roles = [
  { id: "r-tech", name: "TECHNICIAN", nameToShow: "Technician" },
  { id: "r-aud", name: "AUDITOR" },
];

const permissions = (userId: string) => ({
  user: userId === "u-2"
    ? { id: "u-2", username: "grace", firstName: "Grace", lastName: "Hopper", email: "grace@x.test", role: { id: "r-tech", name: "TECHNICIAN", nameToShow: "Technician" } }
    : { id: "u-3", username: "linus", email: "linus@x.test", role: null },
  rolePermissions: [{ menuGroupId: "m-1", menu: { id: "m-1", name: "Devices" }, permissionType: "read" }],
  overrides: userId === "u-2" ? [{ menuGroupId: "m-1", menu: { id: "m-1", name: "Devices" }, permissionType: "write" }] : [],
  effective: userId === "u-2"
    ? [
        { menuGroupId: "m-1", menu: { id: "m-1", name: "Devices" }, permissionType: "write", source: "custom", rolePermission: "read", override: "write" },
        { menuGroupId: "m-2", menu: null, permissionType: null, source: null, rolePermission: null, override: null },
      ]
    : [],
});

const backend = () => {
  get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/users/all") return envelope(users, { total: 2, page: 1, limit: 50, totalPages: 1 });
    if (url === "/api/v1/menu-groups/roles") return envelope(roles);
    const m = url.match(/^\/api\/v1\/user-permissions\/(.+)$/);
    if (m) return envelope(permissions(m[1]));
    throw new Error(`unexpected GET ${url}`);
  });
};

const as = (roleName: string) =>
  useAuthStore.setState({
    user: { id: "u-1", username: "root", email: "r@x.test", role: { id: "r", name: roleName } } as User,
  });

const toasts = () => useToastStore.getState().toasts;
const rowOf = (text: string) => screen.getByText(text).closest("div.flex.flex-col") as HTMLElement;
const pressed = (text: string) =>
  within(rowOf(text))
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
  const view = render(<UserPermissionsPage />);
  await screen.findByText("grace@x.test");
  await waitFor(() => expect(pressed("Devices")).toEqual(["Write"]));
  return view;
};

describe("user permissions page", () => {
  it("anyone but a super admin gets an explanation and nothing is requested", async () => {
    as("TENANT_ADMIN");
    const { container } = render(<UserPermissionsPage />);

    expect(screen.getByText("You need the SUPERADMIN role to manage user permissions.")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("selects the first user and shows their effective access, and passes an accessibility check", async () => {
    const { container } = await renderPage();

    expect(get).toHaveBeenCalledWith("/api/v1/user-permissions/u-2");
    expect(screen.getByText("1 custom")).toBeInTheDocument();
    expect(within(rowOf("Devices")).getByText("write")).toBeInTheDocument();
    expect(within(rowOf("Devices")).getByText(/role grants read/)).toBeInTheDocument();
    // A menu the backend sent without its menu record is named by its id.
    expect(within(rowOf("m-2")).getByText("No access")).toBeInTheDocument();
    expect(pressed("m-2")).toEqual(["Inherit"]);
    expect(screen.getByText(/linus@x.test · no role/)).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("choosing another user loads theirs", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: /linus/ }));

    expect(await screen.findByText("No menu groups found")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/v1/user-permissions/u-3");
  });

  it("searching re-queries the users", async () => {
    await renderPage();

    fireEvent.change(screen.getByPlaceholderText("Search users..."), { target: { value: "gra" } });

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith("/api/v1/users/all", { params: expect.objectContaining({ find: "gra", limit: 50 }) }),
    );
  });

  it("Deny sets a 'none' override and the matrix is reloaded", async () => {
    post.mockResolvedValue(envelope(null));
    await renderPage();
    const before = get.mock.calls.filter(([u]) => u === "/api/v1/user-permissions/u-2").length;

    fireEvent.click(within(rowOf("m-2")).getByRole("button", { name: "Deny" }));

    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "success", title: "Access denied for this menu" }));
    expect(post).toHaveBeenCalledWith("/api/v1/user-permissions/u-2", {
      menuGroupId: "m-2",
      permissionType: "none",
      notes: undefined,
    });
    expect(get.mock.calls.filter(([u]) => u === "/api/v1/user-permissions/u-2").length).toBeGreaterThan(before);
  });

  it("Read grants a custom read override", async () => {
    post.mockResolvedValue(envelope(null));
    await renderPage();

    fireEvent.click(within(rowOf("m-2")).getByRole("button", { name: "Read" }));

    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "success", title: "Custom read access granted" }));
  });

  it("Inherit removes the override", async () => {
    del.mockResolvedValue(envelope(null));
    await renderPage();

    fireEvent.click(within(rowOf("Devices")).getByRole("button", { name: "Inherit" }));

    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/v1/user-permissions/u-2/m-1"));
    expect(toasts()[0]).toMatchObject({ type: "success", title: "Restored role inheritance" });
  });

  it("a refused override is reported", async () => {
    post.mockRejectedValue(httpError(404, "User not found"));
    await renderPage();

    fireEvent.click(within(rowOf("m-2")).getByRole("button", { name: "Write" }));

    expect(await screen.findByText("User not found")).toBeInTheDocument();
    expect(toasts()[0]).toMatchObject({ type: "error", title: "User not found" });
  });

  it("changing the role posts it and reloads the matrix", async () => {
    post.mockResolvedValue(envelope(null));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Technician" }));
    fireEvent.click(screen.getByRole("option", { name: "AUDITOR" }));

    await waitFor(() => expect(toasts()[0]).toMatchObject({ type: "success", title: "Role updated" }));
    expect(post).toHaveBeenCalledWith("/api/v1/users/role-update", { userId: "u-2", roleId: "r-aud" });
  });

  it("a refused role change is reported", async () => {
    post.mockRejectedValue(httpError(403, "Cannot demote the last super admin"));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Technician" }));
    fireEvent.click(screen.getByRole("option", { name: "AUDITOR" }));

    expect(await screen.findByText("Cannot demote the last super admin")).toBeInTheDocument();
    expect(toasts()[0]).toMatchObject({ type: "error", title: "Cannot demote the last super admin" });
  });

  it("a FAILED users load shows the backend's error, not 'No users found'", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/menu-groups/roles") return envelope(roles);
      throw httpError(503, "User directory unavailable");
    });
    const { container } = render(<UserPermissionsPage />);

    expect(await screen.findByText("User directory unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No users found")).not.toBeInTheDocument();
    expect(screen.getByText("Select a user to manage their permissions")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a failed roles load and a failed permissions load are each reported", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/menu-groups/roles") throw httpError(500, "Roles unavailable");
      if (url === "/api/v1/users/all") return envelope(users, { total: 2, page: 1, limit: 50, totalPages: 1 });
      throw httpError(404, "Permissions not found");
    });
    render(<UserPermissionsPage />);

    expect(await screen.findByText("Permissions not found")).toBeInTheDocument();
  });

  it("an empty directory reads as empty", async () => {
    get.mockImplementation(async (url: string) =>
      url === "/api/v1/users/all" ? envelope([], { total: 0, page: 1, limit: 50, totalPages: 1 }) : envelope(roles),
    );
    render(<UserPermissionsPage />);

    expect(await screen.findByText("No users found")).toBeInTheDocument();
  });
});
