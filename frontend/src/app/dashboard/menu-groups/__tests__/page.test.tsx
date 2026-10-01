/** @jest-environment jsdom */
/**
 * Menu-group assignment, against the backend contract (menuGroup.controller.js,
 * menuGroup.service.js):
 *  - GET  /api/v1/menu-groups/roles                    → rows in `data`
 *  - GET  /api/v1/menu-groups/menu-groups?roleId=      → `data: [{ id, label, path, isAssigned, items[] }]`
 *  - GET  /api/v1/menu-groups/menu-groups/admin        → the raw groups (super admin)
 *  - POST /api/v1/menu-groups/{assign,revoke,assign-item,revoke-item,bulk-assign,bulk-revoke,create,update,delete}
 *
 * RBAC: only the super admin may create, edit or delete a menu group; for
 * anyone else those controls are absent from the DOM.
 *
 * Fail-before (axe button-name): the group and item "checkboxes" were
 * icon-only buttons with no name and no checked state. They are now
 * role="checkbox" with aria-checked (mixed for a partly assigned group) and
 * a name.
 *
 * Real: the page, both hooks, the service. Mocked: the transport, the layout.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";

jest.mock("@/components/layouts/DashboardLayout", () =>
  function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  },
);
jest.mock("@/api/client", () => ({
  ...jest.requireActual("@/api/client"),
  api: { get: jest.fn(), post: jest.fn() },
}));

import { api } from "@/api/client";
import MenuGroupsPage from "../page";
import { useAuthStore } from "@/stores/authStore";
import { useMenuStore } from "@/stores/menuStore";
import { httpError } from "@/tests/support/httpErrors";
import type { User } from "@/types";

// Whole-page renders with axe: allow for a loaded machine (as calibration/devices page tests do).
jest.setTimeout(20000);

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

const ok = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data, meta: null });

const roles = [
  { id: "r-tech", name: "TECHNICIAN", nameToShow: "Technician", roleLevel: 3 },
  { id: "r-user", name: "USER", roleLevel: 5 },
];
const groupsFor = (): unknown[] => [
  {
    id: "g-devices",
    label: "Devices",
    path: "/dashboard/devices",
    isAssigned: true,
    items: [{ id: "i-list", label: "Device List", path: "/dashboard/devices", isAssigned: true }],
  },
  {
    id: "g-stock",
    label: "Stock",
    path: "/dashboard/stock",
    isAssigned: false,
    items: [
      { id: "i-wh", label: "Warehouses", path: "/dashboard/warehouses", isAssigned: true },
      { id: "i-mv", label: "Movements", path: "/dashboard/stock/movements", isAssigned: false },
    ],
  },
  { id: "g-empty", label: "Reports", path: "", isAssigned: false, items: [] },
];
let groups: () => unknown[];

// A-301 (ADR-102): the page reads the super-admin flag from the effective
// permissions; the role name is set too, as the signed-in user carries it.
const as = (roleName: string) => {
  useAuthStore.setState({ user: { id: "u1", username: "ada", role: { name: roleName } } as unknown as User });
  useMenuStore.setState({ effectivePermissions: { superAdmin: roleName === "SUPERADMIN", permissions: {} } });
};

beforeEach(() => {
  jest.clearAllMocks();
  groups = groupsFor;
  mockedGet.mockImplementation(async (url: string) => {
    if (url === "/api/v1/menu-groups/roles") return ok(roles, "Roles fetched successfully");
    if (url === "/api/v1/menu-groups/menu-groups") return ok(groups(), "Menu groups fetched successfully");
    if (url === "/api/v1/menu-groups/menu-groups/admin") {
      return ok([{ id: "g-devices", name: "Devices", slug: "equipment", icon: "Cpu", sortOrder: 2, isActive: true }]);
    }
    throw new Error(`unexpected GET ${url}`);
  });
  mockedPost.mockResolvedValue(ok(null));
  as("SUPERADMIN");
});

const chooseRole = async (label = "Technician") => {
  fireEvent.click(await screen.findByRole("button", { name: /Select a role to manage/ }));
  fireEvent.click(screen.getByRole("option", { name: label }));
  // Choosing a role reloads the page's data; wait for that load to finish.
  await waitFor(() =>
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/menu-groups/menu-groups", expect.anything()),
  );
  await waitFor(() => expect(screen.queryByText("Loading menu groups...")).not.toBeInTheDocument());
  return screen.findByText("Menu Group Assignments");
};

const card = (label: string) =>
  screen.getByRole("checkbox", { name: `Assign menu group ${label}` }).parentElement?.parentElement as HTMLElement;

describe("Menu groups page", () => {
  it("lists roles; choosing one shows its groups, their items and a summary", async () => {
    const { container } = render(<MenuGroupsPage />);

    await chooseRole();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/menu-groups/menu-groups", { params: { roleId: "r-tech" } });
    expect(screen.getByRole("checkbox", { name: "Assign menu group Devices" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Assign menu group Stock" })).toHaveAttribute("aria-checked", "mixed");
    expect(screen.getByRole("checkbox", { name: "Assign menu group Reports" })).toHaveAttribute("aria-checked", "false");
    expect(within(card("Stock")).getByText("Partially Assigned")).toBeInTheDocument();
    expect(within(card("Devices")).getByText("Via Group")).toBeInTheDocument();
    expect(screen.getByText("Summary of menu groups assigned to Technician")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("a role with no display name is listed with its level", async () => {
    render(<MenuGroupsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /Select a role to manage/ }));
    expect(screen.getByRole("option", { name: "USER (Level 5)" })).toBeInTheDocument();
  });

  it("no roles: says so and points to the roles page", async () => {
    mockedGet.mockImplementation(async (url: string) =>
      url === "/api/v1/menu-groups/roles" ? ok([]) : ok([]),
    );
    render(<MenuGroupsPage />);

    expect(await screen.findByText(/No roles available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Roles" })).toBeInTheDocument();
  });

  it("a failed load shows the error", async () => {
    mockedGet.mockRejectedValue(httpError(403, "Forbidden: menu management"));
    render(<MenuGroupsPage />);

    expect(await screen.findByText("Forbidden: menu management")).toBeInTheDocument();
  });

  it("assigning a group posts the role, the group and the note, then reloads", async () => {
    render(<MenuGroupsPage />);
    await chooseRole();

    fireEvent.change(screen.getByLabelText(/Assignment Notes/), { target: { value: "audit Q3" } });
    fireEvent.click(within(card("Stock")).getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/assign", {
        menuGroupId: "g-stock",
        roleId: "r-tech",
        notes: "audit Q3",
      }),
    );
    expect(await screen.findByText("Menu Group Assigned")).toBeInTheDocument();
  });

  it("revoking a fully assigned group", async () => {
    render(<MenuGroupsPage />);
    await chooseRole();

    fireEvent.click(within(card("Devices")).getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/revoke", { menuGroupId: "g-devices", roleId: "r-tech" }),
    );
    expect(await screen.findByText("Menu Group Revoked")).toBeInTheDocument();
  });

  it("a refused assignment is reported", async () => {
    mockedPost.mockRejectedValue(httpError(403, "You may not grant menus above your level"));
    render(<MenuGroupsPage />);
    await chooseRole();

    fireEvent.click(within(card("Stock")).getByRole("button", { name: "Assign" }));

    expect(await screen.findByText("Assignment Failed")).toBeInTheDocument();
    expect(screen.getByText("You may not grant menus above your level")).toBeInTheDocument();
  });

  it("the group checkbox assigns at once, and rolls back when refused", async () => {
    render(<MenuGroupsPage />);
    await chooseRole();

    fireEvent.click(screen.getByRole("checkbox", { name: "Assign menu group Reports" }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/assign", { menuGroupId: "g-empty", roleId: "r-tech", notes: undefined }),
    );
    expect(screen.getByRole("checkbox", { name: "Assign menu group Reports" })).toHaveAttribute("aria-checked", "true");

    mockedPost.mockRejectedValueOnce(httpError(500, "boom"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Assign menu group Devices" }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/revoke", { menuGroupId: "g-devices", roleId: "r-tech" }),
    );
    expect(await screen.findByText("Toggle Failed")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Assign menu group Devices" })).toHaveAttribute("aria-checked", "true");
  });

  it("item checkboxes assign and revoke single items", async () => {
    render(<MenuGroupsPage />);
    await chooseRole();

    fireEvent.click(screen.getByRole("checkbox", { name: "Assign menu item Movements" }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/assign-item", { menuItemId: "i-mv", roleId: "r-tech", notes: undefined }),
    );
    expect(await screen.findByText("Item Assigned")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Assign menu item Warehouses" }));
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/revoke-item", { menuItemId: "i-wh", roleId: "r-tech" }),
    );
    expect(await screen.findByText("Item Revoked")).toBeInTheDocument();
  });

  // A-300 fail-before: "Select All" was a no-op (`() => {}`), there was no
  // selection at all, and both bulk actions sent every ASSIGNED group — here
  // "Revoke Selected" would have revoked Devices with nothing selected, and
  // without asking.
  it("Select All selects every group (not the assigned ones) and Deselect All clears it (A-300)", async () => {
    render(<MenuGroupsPage />);
    await chooseRole();

    const boxes = () => ["Devices", "Stock", "Reports"].map((l) => screen.getByRole("checkbox", { name: `Select menu group ${l}` }));
    expect(boxes().every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: /Revoke Selected/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    expect(boxes().every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: "Assign Selected (3)" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(boxes().every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    // Selecting changes no assignment.
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it("bulk assign sends only the selected groups and reports what was assigned, already there and failed", async () => {
    mockedPost.mockImplementation(async (url: string) =>
      url === "/api/v1/menu-groups/bulk-assign"
        ? ok({ assigned: ["g-stock"], alreadyAssigned: ["x"], failed: [{ menuGroupId: "y", error: "nope" }] })
        : ok(null),
    );
    render(<MenuGroupsPage />);
    await chooseRole();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select menu group Stock" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select menu group Reports" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select menu group Reports" }));
    fireEvent.click(screen.getByRole("button", { name: "Assign Selected (1)" }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/bulk-assign", {
        roleId: "r-tech",
        menuGroupIds: ["g-stock"],
        notes: undefined,
      }),
    );
    expect(
      await screen.findByText("Successfully assigned 1 menu group(s). 1 already assigned. 1 failed."),
    ).toBeInTheDocument();
    // The selection is cleared once the action has run.
    await waitFor(() => expect(screen.getByRole("button", { name: "Assign Selected" })).toBeDisabled());
  });

  it("bulk revoke asks first, naming the count and the role, then revokes only the selection", async () => {
    mockedPost.mockImplementation(async (url: string) =>
      url === "/api/v1/menu-groups/bulk-revoke" ? ok({ revoked: ["g-stock"], notFound: [] }) : ok(null),
    );
    render(<MenuGroupsPage />);
    await chooseRole();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select menu group Stock" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke Selected (1)" }));
    let dialog = await screen.findByRole("dialog", { name: "Revoke selected menu groups" });
    expect(within(dialog).getByText(/Revoke 1 selected menu group\(s\) from Technician\?/)).toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Revoke Selected (1)" }));
    dialog = await screen.findByRole("dialog", { name: "Revoke selected menu groups" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/bulk-revoke", { roleId: "r-tech", menuGroupIds: ["g-stock"] }),
    );
    expect(await screen.findByText("Successfully revoked 1 menu group(s).")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a failed bulk action is reported", async () => {
    mockedPost.mockRejectedValue(httpError(500, "bulk failed"));
    render(<MenuGroupsPage />);
    await chooseRole();

    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke Selected (3)" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("Bulk Revocation Failed")).toBeInTheDocument();
  });

  it("changing the role clears the selection", async () => {
    render(<MenuGroupsPage />);
    await chooseRole();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select menu group Stock" }));
    expect(screen.getByRole("button", { name: "Assign Selected (1)" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /Technician/ }));
    fireEvent.click(screen.getByRole("option", { name: "USER (Level 5)" }));
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith("/api/v1/menu-groups/menu-groups", { params: { roleId: "r-user" } }),
    );
    expect(await screen.findByRole("button", { name: "Assign Selected" })).toBeDisabled();
  });

  it("with nothing selected the bulk actions are disabled, and an empty role says so", async () => {
    groups = () => [];
    render(<MenuGroupsPage />);
    await chooseRole();

    expect(screen.getByText("No menu groups available for this role.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select All" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Assign Selected/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Revoke Selected/ })).toBeDisabled();
  });

  it("the notice disappears after a few seconds", async () => {
    render(<MenuGroupsPage />);
    await chooseRole();
    jest.useFakeTimers();
    try {
      fireEvent.click(within(card("Stock")).getByRole("button", { name: "Assign" }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("Menu Group Assigned")).toBeInTheDocument();
      act(() => {
        jest.advanceTimersByTime(4100);
      });
      expect(screen.queryByText("Menu Group Assigned")).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("Menu groups page — super admin controls", () => {
  it("a non-super-admin gets no create, edit or delete controls", async () => {
    as("HEALTHCARE ADMIN");
    render(<MenuGroupsPage />);
    await chooseRole();

    expect(screen.queryByRole("button", { name: /New Menu Group/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit menu group" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete menu group" })).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/menu-groups/menu-groups/admin");
  });

  it("creates a menu group; a blank name is refused before sending", async () => {
    render(<MenuGroupsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /New Menu Group/ }));
    const dialog = await screen.findByRole("dialog", { name: "New Menu Group" });
    expect(await axeViolations(dialog)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "   " } });
    fireEvent.submit(within(dialog).getByRole("button", { name: "Create Menu Group" }).closest("form") as HTMLFormElement);
    expect(await screen.findByText("Name Required")).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: " Inventory " } });
    fireEvent.change(within(dialog).getByLabelText(/Slug/), { target: { value: "inventory" } });
    fireEvent.change(within(dialog).getByLabelText(/Icon/), { target: { value: "Warehouse" } });
    fireEvent.change(within(dialog).getByLabelText(/Sort Order/), { target: { value: "4" } });
    fireEvent.click(within(dialog).getByLabelText("Active"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Menu Group" }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/create", {
        name: "Inventory",
        slug: "inventory",
        icon: "Warehouse",
        sortOrder: 4,
        isActive: false,
      }),
    );
    expect(await screen.findByText("Menu Group Created")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edits a group with its stored slug and icon", async () => {
    render(<MenuGroupsPage />);
    await chooseRole();

    fireEvent.click(within(card("Devices")).getByRole("button", { name: "Edit menu group" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Menu Group" });
    expect(within(dialog).getByLabelText(/Slug/)).toHaveValue("equipment");
    fireEvent.change(within(dialog).getByLabelText(/Name/), { target: { value: "Equipment" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/update", {
        id: "g-devices",
        name: "Equipment",
        slug: "equipment",
        icon: "Cpu",
        sortOrder: 2,
        isActive: true,
      }),
    );
    expect(await screen.findByText("Menu Group Updated")).toBeInTheDocument();
  });

  it("a refused edit is reported and the dialog stays", async () => {
    render(<MenuGroupsPage />);
    await chooseRole();
    mockedPost.mockRejectedValue(httpError(409, "A menu group with that slug already exists"));

    fireEvent.click(within(card("Stock")).getByRole("button", { name: "Edit menu group" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Menu Group" });
    expect(within(dialog).getByLabelText(/Name/)).toHaveValue("Stock");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Update Failed")).toBeInTheDocument();
    expect(screen.getByText("A menu group with that slug already exists")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Edit Menu Group" })).toBeInTheDocument();
  });

  it("deletes a group after confirmation; a refusal is reported", async () => {
    render(<MenuGroupsPage />);
    await chooseRole();

    fireEvent.click(within(card("Reports")).getByRole("button", { name: "Delete menu group" }));
    let dialog = await screen.findByRole("dialog", { name: "Delete Menu Group" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(within(card("Reports")).getByRole("button", { name: "Delete menu group" }));
    dialog = await screen.findByRole("dialog", { name: "Delete Menu Group" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith("/api/v1/menu-groups/delete", { menuGroupId: "g-empty" }));
    expect(await screen.findByText("Menu Group Deleted")).toBeInTheDocument();

    mockedPost.mockRejectedValueOnce(httpError(409, "A group that still has child menus cannot be deleted"));
    fireEvent.click(within(card("Devices")).getByRole("button", { name: "Delete menu group" }));
    dialog = await screen.findByRole("dialog", { name: "Delete Menu Group" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Deletion Failed")).toBeInTheDocument();
    expect(screen.getByText("A group that still has child menus cannot be deleted")).toBeInTheDocument();
  });
});
