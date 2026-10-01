/** @jest-environment jsdom */
/**
 * SCIM provisioning page against the backend contract
 * (backend/src/routes/api/scim.route.js, mounted /api/v1/scim/v2;
 * controllers/scim.controller.js; services/scim.service.js):
 *  - GET /Users?startIndex&count&filter and GET /Groups → the SCIM
 *    ListResponse ({ totalResults, startIndex, itemsPerPage, Resources }) in
 *    `data` — the documented exception to "rows in data";
 *  - PATCH /Users/:id { Operations: [{ op: "replace", path: "active", value }] };
 *  - DELETE /Users/:id and /Groups/:id → 204.
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
import ScimPage from "../page";

const mockedGet = api.get as jest.Mock;
const mockedPatch = api.patch as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const ok = (data: unknown, message = "ok") => ({ success: true, status: 200, message, data });
const listResponse = (resources: unknown[], totalResults = resources.length, startIndex = 1) => ({
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  totalResults,
  startIndex,
  itemsPerPage: resources.length,
  Resources: resources,
});

/** scim.service formatScimUser. */
const scimUser = (id: string, email: string, active: boolean) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  id,
  userName: email,
  name: { givenName: "Siti", familyName: "Rahma" },
  emails: [{ primary: true, value: email, type: "work" }],
  active,
  meta: { resourceType: "User", created: "2026-09-01T00:00:00.000Z", lastModified: "2026-09-02T00:00:00.000Z" },
});

const scimGroup = (id: string, displayName: string, members: number) => ({
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  id,
  displayName,
  members: Array.from({ length: members }, (_, i) => ({ value: `u-${i}`, display: `u${i}@h.example` })),
  meta: { resourceType: "Group", created: "2026-09-03T00:00:00.000Z" },
});

let users: ReturnType<typeof scimUser>[];
let usersTotal: number | undefined;
let groups: ReturnType<typeof scimGroup>[];

const backend = () => {
  mockedGet.mockImplementation(async (url: string, { params }: { params: { startIndex: number } }) => {
    if (url === "/api/v1/scim/v2/Users") return ok(listResponse(users, usersTotal ?? users.length, params.startIndex), "SCIM users fetched");
    if (url === "/api/v1/scim/v2/Groups") return ok(listResponse(groups), "SCIM groups fetched");
    throw httpError(404, "Not found");
  });
};

const toasts = () => useToastStore.getState().toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));
const lastParams = () => (mockedGet.mock.calls.at(-1)?.[1] as { params: Record<string, unknown> }).params;

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  users = [scimUser("u-1", "siti@h.example", true), scimUser("u-2", "budi@h.example", false)];
  usersTotal = undefined;
  groups = [scimGroup("g-1", "Technicians", 3)];
  backend();
});

const renderLoaded = async () => {
  const view = render(<ScimPage />);
  await screen.findByText("siti@h.example");
  return view;
};

/** A click whose handler starts a read one microtask later (deferEffect). */
const clickAndSettle = async (element: HTMLElement) => {
  await act(async () => {
    fireEvent.click(element);
  });
};

describe("SCIM page — users", () => {
  it("lists provisioned users with their status, from the first page", async () => {
    const { container } = await renderLoaded();

    expect(mockedGet).toHaveBeenCalledWith("/api/v1/scim/v2/Users", {
      params: { startIndex: 1, count: 25, filter: undefined },
    });
    const [, siti, budi] = screen.getAllByRole("row");
    expect(within(siti).getByText("Active")).toBeInTheDocument();
    expect(within(siti).getByText("Siti Rahma")).toBeInTheDocument();
    expect(within(siti).getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    expect(within(budi).getByText("Inactive")).toBeInTheDocument();
    expect(within(budi).getByRole("button", { name: "Activate" })).toBeInTheDocument();
    expect(screen.getByText("Showing 1–2 of 2")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("an empty directory is the empty state, with no pager", async () => {
    users = [];
    render(<ScimPage />);

    expect(await screen.findByText("No provisioned users found.")).toBeInTheDocument();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it("a refused read (403) shows the error", async () => {
    mockedGet.mockRejectedValue(httpError(403, "SCIM requires an API key or an administrator"));
    const { container } = render(<ScimPage />);

    expect(await screen.findByText("SCIM requires an API key or an administrator")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("searches by exact email with the backend's filter dialect, and clears it", async () => {
    await renderLoaded();
    // The label and the "exact match" hint belong to the text field itself.
    expect(screen.getByRole("textbox", { name: "Find by email" })).toHaveAccessibleDescription(
      "Exact match only — the server filters on a full email address.",
    );

    fireEvent.change(screen.getByLabelText("Find by email"), { target: { value: "  siti@h.example " } });
    await clickAndSettle(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(lastParams()).toEqual({ startIndex: 1, count: 25, filter: 'email eq "siti@h.example"' }),
    );

    await clickAndSettle(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(lastParams()).toEqual({ startIndex: 1, count: 25, filter: undefined }));
    expect(screen.getByLabelText("Find by email")).toHaveValue("");
  });

  it("Enter in the search field searches", async () => {
    await renderLoaded();
    const field = screen.getByLabelText("Find by email");

    fireEvent.change(field, { target: { value: "budi@h.example" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
    });

    await waitFor(() => expect(lastParams().filter).toBe('email eq "budi@h.example"'));
  });

  it("pages forward and back by 25", async () => {
    usersTotal = 30;
    await renderLoaded();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    await clickAndSettle(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastParams().startIndex).toBe(26));
    expect(await screen.findByText("Showing 26–30 of 30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await clickAndSettle(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(lastParams().startIndex).toBe(1));
  });

  it("deactivates an active user with a SCIM replace on `active`", async () => {
    mockedPatch.mockResolvedValue(ok({ ...users[0], active: false }, "SCIM user patched"));
    await renderLoaded();

    await clickAndSettle(within(screen.getAllByRole("row")[1]).getByRole("button", { name: "Deactivate" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({ type: "success", title: "siti@h.example deactivated", description: undefined }),
    );
    expect(mockedPatch).toHaveBeenCalledWith("/api/v1/scim/v2/Users/u-1", {
      Operations: [{ op: "replace", path: "active", value: "false" }],
    });
  });

  it("activates an inactive user; a refusal is reported", async () => {
    mockedPatch.mockRejectedValue(httpError(404, "User not found"));
    await renderLoaded();

    await clickAndSettle(within(screen.getAllByRole("row")[2]).getByRole("button", { name: "Activate" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({ type: "error", title: "Update failed", description: "User not found" }),
    );
    expect(mockedPatch).toHaveBeenCalledWith("/api/v1/scim/v2/Users/u-2", {
      Operations: [{ op: "replace", path: "active", value: "true" }],
    });
  });

  it("deleting a user is confirmed first, then DELETEs it and reloads", async () => {
    mockedDelete.mockImplementation(async () => {
      users = users.slice(1);
      return "";
    });
    const { container } = await renderLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Delete siti@h.example" }));
    const dialog = screen.getByRole("dialog", { name: "Delete User" });
    expect(within(dialog).getByText(/They will lose access immediately/)).toBeInTheDocument();
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);

    await clickAndSettle(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("siti@h.example")).not.toBeInTheDocument());
    expect(mockedDelete).toHaveBeenCalledWith("/api/v1/scim/v2/Users/u-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({ type: "success", title: "Deleted", description: undefined });
  });

  it("Cancel on the delete confirmation sends nothing", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Delete siti@h.example" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it("a refused delete keeps the confirmation open and says why", async () => {
    mockedDelete.mockRejectedValue(httpError(404, "User not found"));
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Delete siti@h.example" }));

    await clickAndSettle(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(toasts()).toContainEqual({ type: "error", title: "Delete failed", description: "User not found" }),
    );
    expect(screen.getByRole("dialog", { name: "Delete User" })).toBeInTheDocument();
  });
});

describe("SCIM page — groups", () => {
  const openGroups = async () => {
    await clickAndSettle(screen.getByRole("button", { name: "groups" }));
    return screen.findByText("Technicians");
  };

  it("switches to groups, with member counts and no email search", async () => {
    const { container } = await renderLoaded();
    await openGroups();

    expect(mockedGet).toHaveBeenLastCalledWith("/api/v1/scim/v2/Groups", { params: { startIndex: 1, count: 25 } });
    expect(within(screen.getAllByRole("row")[1]).getByText("3")).toBeInTheDocument();
    expect(screen.queryByLabelText("Find by email")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no groups is its own empty state", async () => {
    groups = [];
    await renderLoaded();
    await clickAndSettle(screen.getByRole("button", { name: "groups" }));

    expect(await screen.findByText("No provisioned groups found.")).toBeInTheDocument();
  });

  it("deleting a group is confirmed and warns about the permissions it granted", async () => {
    mockedDelete.mockImplementation(async () => {
      groups = [];
      return "";
    });
    await renderLoaded();
    await openGroups();

    fireEvent.click(screen.getByRole("button", { name: "Delete Technicians" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Group" });
    expect(within(dialog).getByText(/Members will lose the permissions/)).toBeInTheDocument();

    await clickAndSettle(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("No provisioned groups found.")).toBeInTheDocument();
    expect(mockedDelete).toHaveBeenCalledWith("/api/v1/scim/v2/Groups/g-1");
  });
});
