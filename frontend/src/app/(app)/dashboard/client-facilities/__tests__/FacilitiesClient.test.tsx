/** @jest-environment jsdom */
/**
 * P22-09 — /dashboard/client-facilities by audience and through its flows. Real: the island, the
 * dialogs, the contracts' checks, the service and the typed client. Mocked: the HTTP client and the
 * dashboard chrome.
 *
 * Pins: a facility-bound account is told it does not administer facilities and nothing is read; a
 * reader sees the list (rows from `data`, paging from `meta`, filters into the query; the tenant's
 * own facility marked and never edited) with no write control; a writer creates (the contract's
 * problems before the POST, a 409 duplicate kept in the form), edits only what changed, changes the
 * status with a reason (sessions signed out said), deletes (a refusal kept in the dialog); the
 * facility's accounts: bind (search, reason) and unbind (the role across every facility, reason),
 * the binding switch's 409 shown as written; `users` write needed to bind; one h1; Indonesian; axe.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { clearPermissions, grantPermissions } from "@/tests/support/permissions";

jest.mock("@/components/layouts/DashboardLayout", () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});
jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

import { api } from "@/api/client";
import { useMenuStore } from "@/stores/menuStore";
import { useToastStore } from "@/stores/toastStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id } from "@/i18n/messages/id";
import { FacilitiesClient } from "../FacilitiesClient";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;
const patch = api.patch as jest.Mock;
const del = api.delete as jest.Mock;
const ok = <T,>(data: T, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });

const F1 = "5c000000-0000-4000-8000-000000000001";
const SELF = "5c000000-0000-4000-8000-000000000000";
const U1 = "5e000000-0000-4000-8000-000000000001";
const ROLE = "5f000000-0000-4000-8000-000000000001";

const facility = (over: Record<string, unknown> = {}) => ({
  id: F1,
  name: "Synthetic Clinic",
  code: "SC",
  kind: "clinic",
  isSelf: false,
  status: "active",
  statusReason: null,
  statusChangedAt: null,
  address: null,
  city: "Jakarta",
  province: null,
  postalCode: null,
  phone: null,
  contactName: "Synthetic Contact",
  contactEmail: null,
  contactPhone: "021",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

let rows: ReturnType<typeof facility>[];
const routes = (path: string, config?: { params?: Record<string, unknown> }) => {
  if (path === "/api/v1/client-facilities") return Promise.resolve(ok(rows, { total: rows.length === 0 ? 0 : 30, page: Number(config?.params?.page ?? 1), limit: 25, totalPages: rows.length === 0 ? 1 : 2 }));
  if (path === `/api/v1/client-facilities/${F1}/users`) return Promise.resolve(ok([{ id: U1, username: "tech1", firstName: "Synthetic", lastName: "Tech", roleId: ROLE, status: "active" }]));
  if (path === "/api/v1/users/all") return Promise.resolve(ok([{ id: "u2", username: "tech2", firstName: null, lastName: null, email: "t2@x.example" }]));
  if (path === "/api/v1/roles") return Promise.resolve(ok([{ id: ROLE, name: "TECHNICIAN", nameToShow: "Technician" }]));
  return Promise.reject(new Error(`unexpected GET ${path}`));
};

const renderPage = (locale: "en" | "id" = "en") =>
  render(
    <MessagesProvider locale={locale} messages={locale === "en" ? en : id}>
      <FacilitiesClient languageForm={<div>language</div>} />
    </MessagesProvider>,
  );

const lastQuery = () => (get.mock.calls.filter((c) => c[0] === "/api/v1/client-facilities").at(-1)?.[1] as { params: Record<string, unknown> }).params;

beforeEach(() => {
  jest.clearAllMocks();
  clearPermissions();
  useToastStore.setState({ toasts: [] });
  rows = [facility(), facility({ id: SELF, name: "Own Lab", code: "SELF", kind: "laboratory", isSelf: true })];
  get.mockImplementation(routes);
});

describe("P22-09 — access and the list", () => {
  it("loading; restricted; a bound account is told and reads nothing", () => {
    const a = renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    a.unmount();
    grantPermissions({ calibration: "read" });
    const b = renderPage();
    expect(screen.getByText("You do not have access to the client facilities.")).toBeInTheDocument();
    b.unmount();
    useMenuStore.setState({ effectivePermissions: { superAdmin: false, facilityBound: true, permissions: { "client-facilities": "read" } } });
    renderPage();
    expect(screen.getByText("A facility account does not administer facilities. Ask your calibration provider's administrator.")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("a reader: the list, the own facility marked, no write control, the accounts viewable; filters and paging into the query; axe-clean", async () => {
    grantPermissions({ "client-facilities": "read" });
    const { container } = renderPage();
    const table = await screen.findByRole("table", { name: "Client facilities" });
    expect(within(table).getByText("Synthetic Clinic")).toBeInTheDocument();
    expect(within(table).getByText("Your own organisation")).toBeInTheDocument();
    expect(within(table).getAllByText("Synthetic Contact · 021")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Add a facility|^Edit |^Delete |Change the status/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastQuery()["page"]).toBe(2));
    fireEvent.change(screen.getByLabelText("Name or code"), { target: { value: "syn" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "ended" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "clinic" } });
    await waitFor(() => expect(lastQuery()).toEqual({ page: 1, limit: 25, sort: "name", q: "syn", status: "ended", kind: "clinic" }));
    fireEvent.click(screen.getByRole("button", { name: "Users of Synthetic Clinic" }));
    const dialog = await screen.findByRole("dialog", { name: "Accounts of Synthetic Clinic" });
    expect(await within(dialog).findByText("Synthetic Tech")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Unbind/ })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Bind an account/)).not.toBeInTheDocument();
  });

  it("empty and failed are two states", async () => {
    grantPermissions({ "client-facilities": "read" });
    rows = [];
    const a = renderPage();
    expect(await screen.findByText("No facility matches.")).toBeInTheDocument();
    a.unmount();
    get.mockImplementation((path: string) => (path === "/api/v1/client-facilities" ? Promise.reject(httpError(500, "Server down")) : routes(path)));
    renderPage("id");
    expect(await screen.findByText("Server down")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Fasilitas klien" })).toBeInTheDocument();
  });
});

describe("P22-09 — a writer", () => {
  it("create: the contract's problems before the POST; a 409 kept; then saved", async () => {
    grantPermissions({ "client-facilities": "write" });
    post.mockRejectedValueOnce(httpError(409, "A facility with this code exists."));
    post.mockResolvedValueOnce(ok(facility({ id: "new", name: "New Clinic" })));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Add a facility" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a facility" });
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "self" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add facility" }));
    expect(within(dialog).getByText("SELF is reserved for the tenant's own facility")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "New Clinic" } });
    fireEvent.change(within(dialog).getByLabelText("Code"), { target: { value: "nc" } });
    fireEvent.change(within(dialog).getByLabelText("Kind"), { target: { value: "clinic" } });
    fireEvent.change(within(dialog).getByLabelText("City"), { target: { value: "Bandung" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add facility" }));
    expect(await within(dialog).findByText("A facility with this code exists.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("New Clinic");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add facility" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(post).toHaveBeenLastCalledWith("/api/v1/client-facilities", { name: "New Clinic", code: "nc", kind: "clinic", city: "Bandung" });
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("New Clinic saved");
  });

  it("edit sends only what changed; nothing changed is said; the own facility is never offered", async () => {
    grantPermissions({ "client-facilities": "write" });
    patch.mockResolvedValueOnce(ok(facility({ city: null })));
    renderPage();
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Edit Own Lab" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Synthetic Clinic" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Synthetic Clinic" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(within(dialog).getByText("Nothing has changed.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("City"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/api/v1/client-facilities/${F1}`, { city: null }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Synthetic Clinic" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("status: a reason first, the sign-out warned and counted; a 403 explained", async () => {
    grantPermissions({ "client-facilities": "write" });
    post.mockRejectedValueOnce(httpError(403, "Only a tenant administrator can reactivate an ended facility."));
    post.mockResolvedValueOnce(ok({ facility: facility({ status: "inactive" }), sessionsRevoked: 2 }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Change the status of Synthetic Clinic" }));
    const dialog = await screen.findByRole("dialog", { name: "Change the status of Synthetic Clinic" });
    expect(within(dialog).getByText("Leaving Active signs every account of this facility out.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText("Ended"));
    expect(within(dialog).getByText(/An ended facility takes no new records/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText("Inactive"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Change the status" }));
    expect(within(dialog).getByText("Give a reason of at least 3 characters.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Contract paused" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Change the status" }));
    expect(await within(dialog).findByText("Only a tenant administrator can reactivate an ended facility.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Change the status" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(post).toHaveBeenLastCalledWith(`/api/v1/client-facilities/${F1}/status`, { status: "inactive", reason: "Contract paused" });
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Synthetic Clinic: status changed (2 sessions signed out)");
    fireEvent.click(screen.getByRole("button", { name: "Change the status of Synthetic Clinic" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
  });

  it("delete: a refusal kept in the dialog; then deleted", async () => {
    grantPermissions({ "client-facilities": "write" });
    del.mockRejectedValueOnce(httpError(409, "The facility still holds devices; end it instead."));
    del.mockResolvedValueOnce(ok(null));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Delete Synthetic Clinic" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete facility" }));
    expect(await screen.findByText("The facility still holds devices; end it instead.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete facility" }));
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Synthetic Clinic deleted"));
    expect(del).toHaveBeenLastCalledWith(`/api/v1/client-facilities/${F1}`);
    fireEvent.click(screen.getByRole("button", { name: "Delete Synthetic Clinic" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  });
});

describe("P22-09 — binding accounts", () => {
  it("bind: search, a reason, the binding switch's 409 as written, then done; unbind: the role and a reason", async () => {
    grantPermissions({ "client-facilities": "write", users: "write" });
    put.mockRejectedValueOnce(httpError(409, "Facility binding is not enabled yet."));
    put.mockResolvedValueOnce(ok({ userId: "u2", clientFacilityId: F1, roleId: ROLE, operation: "BIND_FACILITY", sessionsRevoked: 1 }));
    put.mockResolvedValueOnce(ok({ userId: U1, clientFacilityId: null, roleId: ROLE, operation: "UNBIND_FACILITY", sessionsRevoked: 3 }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Users of Synthetic Clinic" }));
    const dialog = await screen.findByRole("dialog", { name: "Accounts of Synthetic Clinic" });
    fireEvent.change(within(dialog).getByLabelText("Bind an account: type a name, username or e-mail"), { target: { value: "te" } });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Bind tech2 (tech2)" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Bind the account" }));
    expect(within(dialog).getByText("Give a reason of at least 3 characters.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "New technician" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Bind the account" }));
    expect(await within(dialog).findByText("Facility binding is not enabled yet.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Bind the account" }));
    expect(await within(dialog).findByText("Done: 1 sessions signed out.")).toBeInTheDocument();
    expect(put).toHaveBeenNthCalledWith(2, "/api/v1/users/u2/client-facility", { clientFacilityId: F1, reason: "New technician" });

    fireEvent.click(within(dialog).getByRole("button", { name: "Unbind Synthetic Tech" }));
    expect(await within(dialog).findByRole("option", { name: "Technician" })).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Moved to provider" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unbind the account" }));
    expect(within(dialog).getByText("Choose the role the account keeps.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Role across every facility"), { target: { value: ROLE } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unbind the account" }));
    expect(await within(dialog).findByText("Done: 3 sessions signed out.")).toBeInTheDocument();
    expect(put).toHaveBeenLastCalledWith(`/api/v1/users/${U1}/client-facility`, { clientFacilityId: null, roleId: ROLE, reason: "Moved to provider" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Unbind Synthetic Tech" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("no account matches; the accounts failing to load; roles failing to load", async () => {
    grantPermissions({ "client-facilities": "write", users: "write" });
    get.mockImplementation((path: string) => {
      if (path === "/api/v1/users/all") return Promise.reject(new Error("x"));
      if (path === `/api/v1/client-facilities/${F1}/users`) return Promise.resolve(ok([]));
      if (path === "/api/v1/roles") return Promise.reject(new Error("y"));
      return routes(path);
    });
    const a = renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Users of Synthetic Clinic" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("No account is bound to this facility.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Bind an account/), { target: { value: "zz" } });
    expect(await within(dialog).findByText("No account matches.")).toBeInTheDocument();
    a.unmount();
    get.mockImplementation((path: string) => (path === `/api/v1/client-facilities/${F1}/users` ? Promise.reject(httpError(500, "Users down")) : routes(path)));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Users of Synthetic Clinic" }));
    expect(await screen.findByText("Users down")).toBeInTheDocument();
  });
});
