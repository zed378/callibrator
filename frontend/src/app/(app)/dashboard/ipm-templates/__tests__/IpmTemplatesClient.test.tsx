/** @jest-environment jsdom */
/**
 * P22-01 — the catalogue page by audience (ADR-102: the effective permissions, never a role name):
 *  - the operator (super admin) gets the checklists, library, types, queue and published tabs;
 *  - a tenant reader (`ipm`, `calibration` or `ipm-templates` read) gets the published catalogue,
 *    read-only, and the base checklist for a type with none of its own (resolveTemplateVersion);
 *  - `ipm-templates` read adds the tenant's proposals; write adds propose and withdraw;
 *  - G-P8: a facility-bound account never gets the proposals (its routes answer it 403);
 *  - no catalogue read: a restriction notice, nothing loaded;
 *  - a failed catalogue read is an error state, never an empty catalogue;
 *  - Indonesian and English; keyboard tabs; axe-clean.
 */
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { clearPermissions, grantPermissions, grantSuperAdmin } from "@/tests/support/permissions";
import { IDS, catalogue, meta, ok, proposal, routeGets } from "@/tests/support/ipmCatalogueFixtures";

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
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { id as idMessages } from "@/i18n/messages/id";
import { IpmTemplatesClient, tabsFor } from "../IpmTemplatesClient";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;

const renderPage = (locale: "en" | "id" = "en") =>
  render(
    <MessagesProvider locale={locale} messages={locale === "en" ? en : idMessages}>
      <IpmTemplatesClient languageForm={<div>language</div>} />
    </MessagesProvider>,
  );

const tenantRoutes = (proposals = [proposal()]) =>
  routeGets({
    "/api/v1/ipm/templates/published": ok(catalogue()),
    "/api/v1/ipm/template-proposals": ok(proposals, meta(proposals.length)),
  });

describe("P22-01 — /dashboard/ipm-templates by audience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearPermissions();
  });

  it("tabsFor: the operator's five; a reader's published; proposals only unbound with ipm-templates", () => {
    const can = (slugs: string[]) => (slug: string) => slugs.includes(slug);
    expect(tabsFor({ superAdmin: true, facilityBound: false, canRead: can([]) })).toEqual(["checklists", "library", "types", "queue", "published"]);
    expect(tabsFor({ superAdmin: false, facilityBound: false, canRead: can(["calibration"]) })).toEqual(["published"]);
    expect(tabsFor({ superAdmin: false, facilityBound: false, canRead: can(["ipm-templates"]) })).toEqual(["published", "proposals"]);
    expect(tabsFor({ superAdmin: false, facilityBound: true, canRead: can(["ipm-templates"]) })).toEqual(["published"]);
    expect(tabsFor({ superAdmin: false, facilityBound: false, canRead: can([]) })).toEqual([]);
  });

  it("says it is loading until the permissions arrive, and loads nothing", () => {
    renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("shows a restriction notice to a caller with no catalogue read", () => {
    grantPermissions({ sop: "write" });
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "IPM checklists" })).toBeInTheDocument();
    expect(screen.getByText("Your role has no access to the checklist catalogue.")).toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("a tenant reader sees the published catalogue, read-only, the base for a type with none of its own", async () => {
    grantPermissions({ ipm: "read" });
    mockedGet.mockImplementation(tenantRoutes());
    renderPage();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 3, name: /Base checklist · Version 3/ })).toBeInTheDocument();
    expect(screen.getByText("2 active device types · 2 published checklists")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Device type"), { target: { value: IDS.typeA } });
    expect(screen.getByRole("heading", { level: 3, name: /Test Pump A · Version 2/ })).toBeInTheDocument();
    const leakage = screen.getByRole("region", { name: "Electrical safety" });
    expect(within(leakage).getByText("Earth leakage")).toBeInTheDocument();
    expect(within(leakage).getByText("≤ 100 µA")).toBeInTheDocument();
    expect(screen.getByText("from the base")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Device type"), { target: { value: IDS.typeB } });
    expect(screen.getByText("Synthetic scale has no checklist of its own; its inspections use the base checklist.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter device types"), { target: { value: "pump" } });
    expect(within(screen.getByLabelText("Device type")).queryByRole("option", { name: "Synthetic scale" })).not.toBeInTheDocument();
    // No write control anywhere for a reader.
    expect(screen.queryByRole("button", { name: /Publish|Propose|New proposal/ })).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/ipm/template-proposals", expect.anything());
  });

  it("a failed catalogue read is an error state with a retry, not an empty catalogue", async () => {
    grantPermissions({ calibration: "read" });
    mockedGet.mockRejectedValueOnce(httpError(500, "Boom"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong");
    mockedGet.mockImplementation(tenantRoutes());
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByRole("heading", { level: 3, name: /Base checklist/ })).toBeInTheDocument();
  });

  it("says so when nothing is published yet", async () => {
    grantPermissions({ ipm: "read" });
    mockedGet.mockResolvedValue(ok({ schema: "inspection-catalogue-v1", deviceTypes: [], versions: [] }));
    renderPage();
    expect(await screen.findByText("No checklist has been published yet.")).toBeInTheDocument();
  });

  it("G-P8: a facility-bound account with ipm-templates never gets the proposals", async () => {
    useMenuStore.setState({ effectivePermissions: { superAdmin: false, facilityBound: true, permissions: { "ipm-templates": "write" } } });
    mockedGet.mockImplementation(tenantRoutes());
    renderPage();
    expect(await screen.findByRole("heading", { level: 3, name: /Base checklist/ })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Proposals" })).not.toBeInTheDocument();
    expect(mockedGet).not.toHaveBeenCalledWith("/api/v1/ipm/template-proposals", expect.anything());
  });

  it("a tenant with ipm-templates read lists its proposals but cannot propose or withdraw", async () => {
    grantPermissions({ "ipm-templates": "read" });
    mockedGet.mockImplementation(tenantRoutes([proposal({ status: "rejected", decidedAt: "2026-10-08T08:00:00.000Z", decisionNote: "Already covered" })]));
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Proposals" }));
    expect(await screen.findByText(/Already covered/)).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Rejected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New proposal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Withdraw/ })).not.toBeInTheDocument();
  });

  it("a tenant with ipm-templates write proposes a new device type and withdraws a submitted proposal", async () => {
    grantPermissions({ "ipm-templates": "write" });
    mockedGet.mockImplementation(tenantRoutes());
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Proposals" }));
    expect(await screen.findByRole("cell", { name: "Test Pump A" })).toBeInTheDocument();

    // Withdraw: a confirmation, then the POST; a 409 explanation is shown as written.
    fireEvent.click(screen.getByRole("button", { name: "Withdraw the proposal for Test Pump A" }));
    mockedPost.mockRejectedValueOnce(httpError(409, "This proposal was accepted on 8 Oct 2026; it can no longer be withdrawn."));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Withdraw" }));
    expect(await screen.findByText("This proposal was accepted on 8 Oct 2026; it can no longer be withdrawn.")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith(`/api/v1/ipm/template-proposals/${IDS.proposal}/withdraw`);

    // Propose a new device type.
    fireEvent.click(screen.getByRole("button", { name: "New proposal" }));
    const dialog = await screen.findByRole("dialog", { name: "Catalogue change proposal" });
    fireEvent.change(within(dialog).getByLabelText("Proposal kind"), { target: { value: "new_device_type" } });
    const submit = within(dialog).getByRole("button", { name: "Submit proposal" });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Proposed device type name/), { target: { value: "Synthetic warmer" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "We service these" } });
    mockedPost.mockResolvedValueOnce(ok(proposal({ kind: "new_device_type" })));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mockedPost).toHaveBeenLastCalledWith("/api/v1/ipm/template-proposals", {
        kind: "new_device_type",
        proposedDeviceTypeName: "Synthetic warmer",
        proposedItems: [],
        reason: "We service these",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("proposes a change to an item of the type's current checklist, naming it and the version", async () => {
    grantPermissions({ "ipm-templates": "write" });
    mockedGet.mockImplementation(tenantRoutes([]));
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Proposals" }));
    expect(await screen.findByText("No proposals yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New proposal" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Proposal kind"), { target: { value: "change_items" } });
    fireEvent.change(within(dialog).getByLabelText("Device type"), { target: { value: IDS.typeA } });
    fireEvent.change(within(dialog).getByLabelText("The item it is about"), { target: { value: IDS.defLeak } });
    expect(within(dialog).getByLabelText(/^Item\s*\*?$/)).toHaveValue("Earth leakage");
    fireEvent.change(within(dialog).getByLabelText("Limit / reference value"), { target: { value: "≤ 50 µA" } });
    fireEvent.change(within(dialog).getByLabelText("Item note"), { target: { value: "Stricter limit" } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Manufacturer manual" } });
    mockedPost.mockResolvedValueOnce(ok(proposal()));
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit proposal" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(mockedPost.mock.calls[0]?.[1]).toEqual({
      kind: "change_items",
      deviceTypeId: IDS.typeA,
      basedOnVersionId: IDS.typeV2,
      proposedItems: [
        { itemDefinitionId: IDS.defLeak, section: "electrical_safety", inputKind: "measured_with_limit", label: "Earth leakage", unit: "µA", limitText: "≤ 50 µA", note: "Stricter limit" },
      ],
      reason: "Manufacturer manual",
    });
  });

  it("builds an add-items proposal row by row, and a failed submit keeps the form with the reason", async () => {
    grantPermissions({ "ipm-templates": "write" });
    mockedGet.mockImplementation(tenantRoutes([]));
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Proposals" }));
    fireEvent.click(await screen.findByRole("button", { name: "New proposal" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Device type"), { target: { value: IDS.typeB } });
    fireEvent.change(within(dialog).getByLabelText("Section"), { target: { value: "battery" } });
    expect(within(dialog).getByLabelText("Input kind")).toHaveValue("setting_measured_reference");
    fireEvent.change(within(dialog).getByLabelText(/^Item\s*\*?$/), { target: { value: "Battery runtime" } });
    fireEvent.change(within(dialog).getByLabelText("Unit"), { target: { value: "min" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add item" }));
    expect(within(dialog).getByText("Item 2")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove item 2" }));
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Battery checks missing" } });
    mockedPost.mockRejectedValueOnce(httpError(400, "The section does not take that kind of item"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit proposal" }));
    expect(await within(screen.getByRole("dialog")).findByText("The section does not take that kind of item")).toBeInTheDocument();
    expect(mockedPost.mock.calls[0]?.[1]).toMatchObject({
      kind: "add_items",
      deviceTypeId: IDS.typeB,
      basedOnVersionId: IDS.baseV3,
      proposedItems: [{ section: "battery", inputKind: "setting_measured_reference", label: "Battery runtime", unit: "min", limitText: null, note: null }],
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("filters the proposals by status; without the catalogue a new proposal cannot be started", async () => {
    grantPermissions({ "ipm-templates": "write" });
    mockedGet.mockImplementation(
      routeGets({
        "/api/v1/ipm/templates/published": () => Promise.reject(httpError(500, "Boom")),
        "/api/v1/ipm/template-proposals": ok([proposal({ deviceTypeId: null, kind: "new_device_type", proposedDeviceTypeName: "Synthetic warmer" })], meta(1)),
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Proposals" }));
    expect(await screen.findByRole("cell", { name: "Synthetic warmer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New proposal" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "accepted" } });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/v1/ipm/template-proposals", { params: { page: 1, limit: 25, status: "accepted" } }));
  });

  it("the operator moves between tabs with the arrow keys, and the page is axe-clean", async () => {
    grantSuperAdmin();
    mockedGet.mockImplementation(
      routeGets({
        "/api/v1/ipm/templates": ok([], meta(0)),
        "/api/v1/ipm/item-definitions": ok([], meta(0)),
        "/api/v1/device-types": ok([], meta(0)),
      }),
    );
    const { container } = renderPage();
    const checklists = screen.getByRole("tab", { name: "Checklists" });
    expect(checklists).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("No checklist matches.")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.keyDown(checklists, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Item library" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Item library" }), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Checklists" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Published catalogue" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Published catalogue" }), { key: "Enter" });
    expect(screen.getByRole("tab", { name: "Published catalogue" })).toHaveAttribute("aria-selected", "true");
  });

  it("speaks Indonesian when the page's language is Indonesian", async () => {
    grantPermissions({ "ipm-templates": "read" });
    mockedGet.mockImplementation(tenantRoutes());
    const { container } = renderPage("id");
    expect(screen.getByRole("heading", { level: 1, name: "Daftar periksa IPM" })).toBeInTheDocument();
    expect(container.querySelector('[lang="id"]')).not.toBeNull();
    expect(await screen.findByRole("tab", { name: "Usulan" })).toBeInTheDocument();
    expect(await screen.findByText("Kondisi Lingkungan")).toBeInTheDocument();
  });
});
