/** @jest-environment jsdom */
/**
 * The users screen, against the backend contract:
 *  - GET  /api/v1/users/all        → rows in `data`, pagination in a top-level `meta`;
 *  - GET  /api/v1/menu-groups/roles → the assignable roles;
 *  - POST /api/v1/tenants/detail   → a tenant admin's own tenant (A-76);
 *  - POST /api/v1/users/create, PATCH /api/v1/users/edit, DELETE /api/v1/users/delete,
 *    POST /api/v1/users/username-check.
 *
 * Real: the page, useUsers, the user / tenant / auth / toast stores and the
 * services. Mocked: the HTTP client, the dashboard chrome, next/navigation.
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

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

import { api } from "@/api/client";
import UsersPage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useUserStore } from "@/stores/userStore";
import { useTenantStore } from "@/stores/tenantStore";
import { useToastStore } from "@/stores/toastStore";
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

/** A row as GET /users/all sends it (user.controller.js getAllUsers). */
const backendUser = (patch: Record<string, unknown> = {}) => ({
  id: "u-2",
  tenantId: "t-1",
  username: "grace",
  firstName: "Grace",
  lastName: "Hopper",
  email: "grace@hospital.test",
  picture: "",
  isEmailVerified: true,
  status: "ACTIVE",
  lastLoginAt: "2026-09-01T00:00:00.000Z",
  createdAt: "2026-01-15T00:00:00.000Z",
  role: { id: "r-tech", name: "TECHNICIAN", description: "", nameToShow: "Technician" },
  mfaEnabled: false,
  ...patch,
});

const roles = [
  { id: "r-super", name: "SUPERADMIN", nameToShow: "Super Admin" },
  { id: "r-tech", name: "TECHNICIAN", nameToShow: "Technician" },
];

let userRows: unknown[] = [];
let userMeta = { total: 1, page: 1, limit: 10, totalPages: 1 };

const backend = () => {
  get.mockImplementation(async (url: string) => {
    if (url === "/api/v1/users/all") return envelope(userRows, userMeta);
    if (url === "/api/v1/menu-groups/roles") return envelope(roles);
    if (url === "/api/v1/tenants/all")
      return envelope([{ id: "t-1", name: "RS Harapan", code: "RSH" }, { id: "t-2", name: "RS Sehat", code: "RSS" }], {
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      });
    throw new Error(`unexpected GET ${url}`);
  });
  post.mockImplementation(async (url: string, body: { username?: string }) => {
    if (url === "/api/v1/tenants/detail") return envelope({ id: "t-1", name: "RS Harapan", code: "RSH" });
    if (url === "/api/v1/users/username-check")
      return envelope({ username: body.username, available: body.username !== "taken" });
    if (url === "/api/v1/users/create") return envelope(backendUser({ id: "u-9" }));
    throw new Error(`unexpected POST ${url}`);
  });
};

// ADR-102: the write controls follow the effective permissions, granted as
// seeded — the super admin passes every gate; the admins hold `users` write.
const as = (roleName: string, id = "u-1") => {
  useAuthStore.setState({
    user: { id, username: "ada", email: "a@x.test", tenantId: "t-1", role: { id: "r", name: roleName } } as User,
  });
  if (roleName === "SUPERADMIN" || roleName === "SUPER_ADMIN") grantSuperAdmin();
  else grantPermissions({ users: "write" });
};

const usersListCalls = () => get.mock.calls.filter(([url]) => url === "/api/v1/users/all");

/** An element's whole text, however many spans it is split across. */
const fullText = (text: string) => (_: string, el: Element | null) =>
  el?.textContent?.replace(/\s+/g, " ").trim() === text &&
  Array.from(el.children).every((c) => c.textContent?.replace(/\s+/g, " ").trim() !== text);

beforeAll(() => {
  const style = document.createElement("style");
  style.textContent = ".hidden { display: none; }";
  document.head.appendChild(style);
});

beforeEach(() => {
  jest.clearAllMocks();
  userRows = [backendUser()];
  userMeta = { total: 1, page: 1, limit: 10, totalPages: 1 };
  useUserStore.setState({ users: null, isLoading: false, error: null });
  useTenantStore.setState({ tenants: null, isLoading: false, error: null, listTenantId: null });
  useToastStore.setState({ toasts: [] });
  as("HEALTHCARE ADMIN");
  backend();
});

const renderPage = async () => {
  const view = render(<UsersPage />);
  await screen.findByText("Grace Hopper");
  return view;
};

describe("users page — list states", () => {
  it("shows a skeleton while the list is in flight, not the empty state", async () => {
    get.mockImplementation(async (url: string) =>
      url === "/api/v1/users/all" ? new Promise(() => undefined) : envelope([]),
    );
    const { container } = render(<UsersPage />);
    await waitFor(() => expect(usersListCalls()).toHaveLength(1));

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("No users found")).not.toBeInTheDocument();
  });

  it("renders the rows, counts them by status, and passes an accessibility check", async () => {
    userRows = [
      backendUser(),
      backendUser({ id: "u-3", username: "linus", firstName: "", lastName: "", status: "SUSPENDED", role: undefined, createdAt: undefined }),
      backendUser({ id: "u-4", username: "ken", firstName: "Ken", lastName: "", status: undefined, isEmailVerified: false }),
    ];
    userMeta = { total: 3, page: 1, limit: 10, totalPages: 1 };
    const { container } = await renderPage();

    const grace = screen.getByText("Grace Hopper").closest("tr") as HTMLElement;
    expect(within(grace).getByText("grace")).toBeInTheDocument();
    expect(within(grace).getByText("Technician")).toBeInTheDocument();
    expect(within(grace).getByText("ACTIVE")).toBeInTheDocument();

    const linus = screen.getByText("linus").closest("tr") as HTMLElement;
    expect(within(linus).getByText("SUSPENDED")).toBeInTheDocument();
    // No derived status from the backend: an unverified email reads PENDING.
    expect(within(screen.getByText("ken").closest("tr") as HTMLElement).getByText("PENDING")).toBeInTheDocument();

    expect(screen.getByText("Total Users").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Suspended").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Pending").nextSibling).toHaveTextContent("1");
    expect(screen.getByText(fullText("Showing 1 to 3 of 3 results"))).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("renders the empty state when there are no users", async () => {
    userRows = [];
    userMeta = { total: 0, page: 1, limit: 10, totalPages: 1 };
    const { container } = render(<UsersPage />);

    expect(await screen.findByText("No users found")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a FAILED load (403) shows the backend's refusal, never the empty state", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/api/v1/users/all") throw httpError(403, "You do not have access to users");
      return envelope(roles);
    });
    const { container } = render(<UsersPage />);

    expect((await screen.findAllByText("You do not have access to users")).length).toBeGreaterThan(0);
    expect(screen.queryByText("No users found")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("search and page size re-query the list", async () => {
    userMeta = { total: 30, page: 1, limit: 10, totalPages: 3 };
    await renderPage();

    fireEvent.change(screen.getByPlaceholderText("Search users..."), { target: { value: "gra" } });
    await waitFor(() =>
      expect(usersListCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ find: "gra" }) }),
    );
    await screen.findByText("Grace Hopper");

    fireEvent.change(screen.getByRole("combobox", { name: "Rows per page" }), { target: { value: "25" } });
    await waitFor(() =>
      expect(usersListCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ limit: 25, page: 1 }) }),
    );
    await screen.findByText("Grace Hopper");

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(usersListCalls().at(-1)?.[1]).toEqual({ params: expect.objectContaining({ page: 2 }) }),
    );
  });
});

describe("users page — creating a user", () => {
  const openCreate = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Add User/ }));
    return screen.getByRole("dialog", { name: "Create New User" });
  };

  it("a tenant admin is offered only their own tenant and no super-admin role", async () => {
    await renderPage();
    const dialog = await openCreate();
    expect(await axeViolations(dialog)).toEqual([]);

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/v1/tenants/detail", { tenantId: "t-1" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Select a role" }));
    expect(within(dialog).getByRole("option", { name: "Technician" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: "Super Admin" })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Technician" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Select a tenant" }));
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual(["RS Harapan"]);
    expect(get).not.toHaveBeenCalledWith("/api/v1/tenants/all", expect.anything());
  });

  it("a super admin lists every tenant and may assign the super-admin role", async () => {
    as("SUPERADMIN");
    await renderPage();
    const dialog = await openCreate();

    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/v1/tenants/all", expect.anything()));
    fireEvent.click(within(dialog).getByRole("button", { name: "Select a role" }));
    expect(within(dialog).getByRole("option", { name: "Super Admin" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Super Admin" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Select a tenant" }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "RS Sehat" }));
    expect(within(dialog).getByRole("button", { name: "RS Sehat" })).toBeInTheDocument();
  });

  it("a weak password is refused in the dialog without a request, and the checklist tracks each rule", async () => {
    await renderPage();
    const dialog = await openCreate();

    fireEvent.change(within(dialog).getByLabelText("First Name"), { target: { value: "Alan" } });
    fireEvent.change(within(dialog).getByLabelText("Last Name"), { target: { value: "Turing" } });
    fireEvent.change(within(dialog).getByLabelText("Username"), { target: { value: "alan" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "alan@x.test" } });
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "weakpass" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create User" }));

    expect(await within(dialog).findAllByText(/Password must be at least 8 characters/)).not.toHaveLength(0);
    expect(post).not.toHaveBeenCalledWith("/api/v1/users/create", expect.anything());
  });

  it("creates a user with a strong password, closes, and reloads the list", async () => {
    await renderPage();
    const dialog = await openCreate();

    fireEvent.change(within(dialog).getByLabelText("First Name"), { target: { value: "Alan" } });
    fireEvent.change(within(dialog).getByLabelText("Last Name"), { target: { value: "Turing" } });
    fireEvent.change(within(dialog).getByLabelText("Username"), { target: { value: "alan" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "alan@x.test" } });
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "Str0ng!Pass" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select a role" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Technician" }));
    const before = usersListCalls().length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Create User" }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/v1/users/create", {
        firstName: "Alan",
        lastName: "Turing",
        username: "alan",
        email: "alan@x.test",
        password: "Str0ng!Pass",
        roleId: "r-tech",
        tenantId: undefined,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(usersListCalls().length).toBeGreaterThan(before);
  });

  it("a refused create (409) keeps the dialog open with the backend's message", async () => {
    await renderPage();
    post.mockImplementation(async (url: string) => {
      if (url === "/api/v1/users/create") throw httpError(409, "Email already registered");
      if (url === "/api/v1/tenants/detail") return envelope({ id: "t-1", name: "RS Harapan", code: "RSH" });
      return envelope({ available: true });
    });
    const dialog = await openCreate();

    fireEvent.change(within(dialog).getByLabelText("First Name"), { target: { value: "Alan" } });
    fireEvent.change(within(dialog).getByLabelText("Last Name"), { target: { value: "Turing" } });
    fireEvent.change(within(dialog).getByLabelText("Username"), { target: { value: "alan" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "alan@x.test" } });
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "Str0ng!Pass" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create User" }));

    expect((await within(dialog).findAllByText("Email already registered")).length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog", { name: "Create New User" })).toBeInTheDocument();

    // Cancelling clears the dialog: reopened, it is blank with no error.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    const again = await openCreate();
    expect(within(again).getByLabelText("First Name")).toHaveValue("");
    expect(within(again).queryByText("Email already registered")).not.toBeInTheDocument();
  });

  it("checks the username as it is typed: too short, then available, then taken", async () => {
    await renderPage();
    const dialog = await openCreate();
    const username = within(dialog).getByLabelText("Username");

    fireEvent.change(username, { target: { value: "ab" } });
    expect(within(dialog).getByText("Username must be at least 3 characters")).toBeInTheDocument();

    fireEvent.change(username, { target: { value: "alan" } });
    expect(within(dialog).getByText("Checking availability...")).toBeInTheDocument();
    expect(await within(dialog).findByText("Username is available")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/v1/users/username-check", { username: "alan" });

    fireEvent.change(username, { target: { value: "taken" } });
    expect(await within(dialog).findByText("Username is already taken")).toBeInTheDocument();
  });

  it("a failed username check shows no verdict rather than a false one", async () => {
    await renderPage();
    post.mockImplementation(async (url: string) => {
      if (url === "/api/v1/users/username-check") throw httpError(429, "Too many requests");
      return envelope({ id: "t-1", name: "RS Harapan", code: "RSH" });
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const dialog = await openCreate();

    fireEvent.change(within(dialog).getByLabelText("Username"), { target: { value: "alan" } });
    await waitFor(() => expect(within(dialog).queryByText("Checking availability...")).not.toBeInTheDocument());

    expect(within(dialog).queryByText("Username is available")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Username is already taken")).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("a chosen photo is previewed and can be removed", async () => {
    await renderPage();
    const dialog = await openCreate();
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File(["x"], "me.png", { type: "image/png" })] } });

    expect(await within(dialog).findByAltText("User preview")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove photo" }));
    expect(within(dialog).queryByAltText("User preview")).not.toBeInTheDocument();
  });
});

describe("users page — editing a user", () => {
  const openEdit = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Edit grace" }));
    return screen.getByRole("dialog", { name: "Edit User" });
  };

  it("sends the edited first and last name with the rest (they were silently dropped)", async () => {
    patch.mockResolvedValue(envelope(backendUser({ firstName: "Amazing" })));
    await renderPage();
    const dialog = await openEdit();
    expect(await axeViolations(dialog)).toEqual([]);

    expect(within(dialog).getByLabelText("First Name")).toHaveValue("Grace");
    expect(within(dialog).getByLabelText("Email")).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("First Name"), { target: { value: "Amazing" } });
    fireEvent.change(within(dialog).getByLabelText("Last Name"), { target: { value: "Grace" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ACTIVE" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "SUSPENDED" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Update User" }));

    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/api/v1/users/edit", {
        userId: "u-2",
        username: "grace",
        firstName: "Amazing",
        lastName: "Grace",
        email: "grace@hospital.test",
        status: "SUSPENDED",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("does not re-check the user's own username, but checks a changed one", async () => {
    await renderPage();
    const dialog = await openEdit();
    const username = within(dialog).getByLabelText("Username");
    // Opening schedules a check of the current username 100 ms later; it asks nothing.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(post).not.toHaveBeenCalledWith("/api/v1/users/username-check", expect.anything());

    fireEvent.change(username, { target: { value: "gracie" } });
    expect(await within(dialog).findByText("Username is available")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/v1/users/username-check", { username: "gracie" });
  });

  it("a refused edit (403) keeps the dialog open with the backend's message", async () => {
    patch.mockRejectedValue(httpError(403, "Only a super admin may change status"));
    await renderPage();
    const dialog = await openEdit();

    fireEvent.click(within(dialog).getByRole("button", { name: "Update User" }));

    expect((await within(dialog).findAllByText("Only a super admin may change status")).length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog", { name: "Edit User" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a photo chosen while editing is previewed in the EDIT dialog (it used to land in the create dialog)", async () => {
    await renderPage();
    const dialog = await openEdit();
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [new File(["x"], "me.png", { type: "image/png" })] } });

    expect(await within(dialog).findByAltText("grace")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove photo" }));
    expect(within(dialog).queryByAltText("grace")).not.toBeInTheDocument();
  });
});

describe("users page — the photo is saved with the user (F-19)", () => {
  const png = () => new File(["x"], "me.png", { type: "image/png" });
  const openCreate = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Add User/ }));
    return screen.getByRole("dialog", { name: "Create New User" });
  };

  const fillCreate = (dialog: HTMLElement) => {
    fireEvent.change(within(dialog).getByLabelText("First Name"), { target: { value: "Alan" } });
    fireEvent.change(within(dialog).getByLabelText("Last Name"), { target: { value: "Turing" } });
    fireEvent.change(within(dialog).getByLabelText("Username"), { target: { value: "alan" } });
    fireEvent.change(within(dialog).getByLabelText("Email"), { target: { value: "alan@x.test" } });
    fireEvent.change(within(dialog).getByLabelText("Password"), { target: { value: "Str0ng!Pass" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Select a role" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Technician" }));
  };

  const avatarPosts = () => post.mock.calls.filter(([url]) => String(url).endsWith("/avatar"));

  it("F-19: a photo picked in Create is uploaded for the NEW user once it exists", async () => {
    await renderPage();
    const base = post.getMockImplementation() as (url: string, body: unknown) => Promise<unknown>;
    post.mockImplementation(async (url: string, body: unknown) =>
      url === "/api/v1/users/u-9/avatar" ? envelope(null) : base(url, body),
    );
    const dialog = await openCreate();
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [png()] } });
    await within(dialog).findByAltText("User preview");
    fillCreate(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create User" }));

    await waitFor(() => expect(avatarPosts()).toHaveLength(1));
    const [url, form] = avatarPosts()[0] as [string, FormData];
    expect(url).toBe("/api/v1/users/u-9/avatar");
    expect((form.get("file") as File).name).toBe("me.png");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("F-19: a removed Create photo is not uploaded", async () => {
    await renderPage();
    const dialog = await openCreate();
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [png()] } });
    await within(dialog).findByAltText("User preview");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove photo" }));
    fillCreate(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create User" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(avatarPosts()).toHaveLength(0);
  });

  it("F-19: a refused Create photo is said on the page; the user is created and the dialog closes", async () => {
    await renderPage();
    const base = post.getMockImplementation() as (url: string, body: unknown) => Promise<unknown>;
    post.mockImplementation(async (url: string, body: unknown) => {
      if (url === "/api/v1/users/u-9/avatar") throw httpError(413, "File too large");
      return base(url, body);
    });
    const dialog = await openCreate();
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [png()] } });
    await within(dialog).findByAltText("User preview");
    fillCreate(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create User" }));

    expect(await screen.findByText(/The user was created, but the photo was not saved: File too large/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("F-19: a photo picked in Edit is uploaded after the save; a refusal keeps the dialog open", async () => {
    patch.mockResolvedValue(envelope(backendUser()));
    await renderPage();
    const base = post.getMockImplementation() as (url: string, body: unknown) => Promise<unknown>;
    post.mockImplementation(async (url: string, body: unknown) => {
      if (url === "/api/v1/users/u-2/avatar") throw httpError(413, "File too large");
      return base(url, body);
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit grace" }));
    const dialog = screen.getByRole("dialog", { name: "Edit User" });
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [png()] } });
    await within(dialog).findByAltText("grace");
    fireEvent.click(within(dialog).getByRole("button", { name: "Update User" }));

    expect((await within(dialog).findAllByText(/The details were saved, but the photo was not: File too large/)).length).toBeGreaterThan(0);
    expect(avatarPosts()[0][0]).toBe("/api/v1/users/u-2/avatar");

    post.mockImplementation(async (url: string, body: unknown) =>
      url === "/api/v1/users/u-2/avatar" ? envelope(null) : base(url, body),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Update User" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("F-19: removing a stored photo in Edit deletes it on save", async () => {
    userRows = [backendUser({ picture: "/uploads/public/profile/grace.png" })];
    patch.mockResolvedValue(envelope(backendUser()));
    del.mockResolvedValue(envelope(null));
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Edit grace" }));
    const dialog = screen.getByRole("dialog", { name: "Edit User" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove photo" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Update User" }));

    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/v1/users/u-2/avatar"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("users page — deleting a user", () => {
  it("asks for confirmation, deletes by userId, and reloads the list", async () => {
    del.mockResolvedValue(envelope(null));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete grace" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete grace" }));
    const before = usersListCalls().length;
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(del).toHaveBeenCalledWith("/api/v1/users/delete", { params: { userId: "u-2" } }));
    await waitFor(() => expect(usersListCalls().length).toBeGreaterThan(before));
  });

  it("a failed delete (404 — gone, or another tenant's) shows the message and the user stays listed", async () => {
    del.mockRejectedValue(httpError(404, "User not found"));
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete grace" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect((await screen.findAllByText("User not found")).length).toBeGreaterThan(0);
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
  });
});

describe("users page — impersonation (super admin only)", () => {
  it("is absent for a tenant admin", async () => {
    await renderPage();
    expect(screen.queryByTitle("Impersonate grace")).not.toBeInTheDocument();
  });

  it("is absent on the super admin's own row", async () => {
    as("SUPERADMIN", "u-2");
    await renderPage();
    expect(screen.queryByTitle("Impersonate grace")).not.toBeInTheDocument();
  });

  it("a super admin impersonates another user, is told so, and lands on the dashboard", async () => {
    as("SUPER_ADMIN");
    const impersonate = jest.fn(async () => undefined);
    useAuthStore.setState({ impersonate });
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Impersonate grace"));
    });

    expect(impersonate).toHaveBeenCalledWith("t-1", "u-2");
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: "success", title: "Now impersonating grace" });
    expect(mockPush).toHaveBeenCalledWith("/dashboard");
  });

  it("a refused impersonation says why and stays put", async () => {
    as("SUPERADMIN");
    useAuthStore.setState({ impersonate: jest.fn(async () => Promise.reject(new Error("Target is a super admin"))) });
    await renderPage();

    await act(async () => {
      fireEvent.click(screen.getByTitle("Impersonate grace"));
    });

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: "error",
      title: "Impersonation failed",
      description: "Target is a super admin",
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("a user with no tenant and a caller with none cannot be impersonated", async () => {
    userRows = [backendUser({ tenantId: null })];
    useAuthStore.setState({
      user: { id: "u-1", username: "root", email: "r@x.test", tenantId: null, role: { id: "r", name: "SUPERADMIN" } } as User,
    });
    grantSuperAdmin();
    const impersonate = jest.fn();
    useAuthStore.setState({ impersonate });
    await renderPage();

    fireEvent.click(screen.getByTitle("Impersonate grace"));

    expect(impersonate).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts[0]).toMatchObject({ type: "error", title: "Cannot determine user's tenant" });
  });
});

/**
 * ADR-102 — creating, editing, deleting and resetting users need `users`
 * write (user.route.js); impersonation is the super admin's. A role granted
 * `users` read (a per-user override) lists the users without any write control.
 * Fail-before: Add User, Edit and Delete rendered for any role that could list.
 */
describe("ADR-102 — user controls follow the effective permission", () => {
  it("a `users` reader lists users without Add, Edit or Delete", async () => {
    as("ENGINEERING MANAGER");
    grantPermissions({ users: "read" });
    render(<UsersPage />);
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(1);
    for (const name of [/Add User/, /^Edit /, /^Delete /]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    as("HEALTHCARE ADMIN");
    clearPermissions();
    render(<UsersPage />);
    expect((await screen.findAllByRole("row")).length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: /Add User/ })).not.toBeInTheDocument();
  });
});
