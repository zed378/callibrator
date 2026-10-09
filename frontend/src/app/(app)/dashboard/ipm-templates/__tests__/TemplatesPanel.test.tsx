/** @jest-environment jsdom */
/**
 * P22-01 — the operator's checklists and the draft editor (P19-01 spec § 7.2, § 7.3; P21-01):
 *  - the list: the base checklist and the type checklists, each with its published version and
 *    open draft; a type's checklist is created from the device-type picker;
 *  - the draft: items added from the library (the server copies them), reordered inside their
 *    section, marked required, removed; "Save items" PUTs them at the revision read, an item
 *    already in the draft carrying its own copy;
 *  - a 409 (another save came first) is shown as the backend wrote it, with "Reload the draft";
 *  - publish needs a change note and no unsaved edits, is confirmed, and says what the base
 *    publish rebases; discard and retire are confirmed;
 *  - the version history, and a past version opened read-only.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import {
  IDS,
  baseItem,
  baseTemplate,
  definition,
  leakItem,
  meta,
  ok,
  routeGets,
  summary,
  template,
  templateItem,
  version,
} from "@/tests/support/ipmCatalogueFixtures";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { TemplatesPanel } from "../components/TemplatesPanel";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPut = api.put as jest.Mock;
const mockedPatch = api.patch as jest.Mock;

const leakDefinition = definition({ ...leakItem, id: IDS.defLeak });

const routes = (over: Record<string, unknown> = {}) =>
  routeGets({
    "/api/v1/ipm/templates": ok([baseTemplate(), template()], meta(2)),
    [`/api/v1/ipm/template-versions/${IDS.draft}`]: ok(version()),
    [`/api/v1/ipm/template-versions/${IDS.typeV2}`]: ok(version({ id: IDS.typeV2, status: "published", versionNumber: 2, contentHash: "c".repeat(64), publishedAt: "2026-10-02T08:00:00.000Z", items: [templateItem(), baseItem] })),
    "/api/v1/ipm/template-versions": ok([summary(), summary({ id: "8a4c4a51-0000-4000-8000-000000000001", status: "retired", versionNumber: 1, rebasedFromVersionId: IDS.typeV2 })], meta(2)),
    "/api/v1/ipm/item-definitions": ok([definition(), leakDefinition], meta(2)),
    "/api/v1/device-types": ok([{ id: IDS.typeB, name: "Synthetic scale", status: "active" }], meta(1)),
    ...over,
  });

const renderPanel = () =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <main>
        <h1>IPM checklists</h1>
        <TemplatesPanel />
      </main>
    </MessagesProvider>,
  );

const openTypeChecklist = async () => {
  renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: "Open Test Pump A" }));
  return screen.findByRole("region", { name: "Function checks" });
};

describe("P22-01 — the operator's checklists", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    mockedGet.mockImplementation(routes());
  });

  it("lists the base and the type checklists with their published version and open draft", async () => {
    const { container } = renderPanel();
    expect(await screen.findByRole("cell", { name: "Base checklist" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Test Pump A" })).toBeInTheDocument();
    expect(screen.getByText(/Revision 2 · since/)).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/ipm/templates", { params: { page: 1, limit: 25, status: "active" } });
    fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "yes" } });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/v1/ipm/templates", { params: { page: 1, limit: 25, status: "active", hasDraft: true } }));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "" } });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/v1/ipm/templates", { params: { page: 1, limit: 25, hasDraft: true } }));
    await screen.findByRole("cell", { name: "Base checklist" });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("creates a device type's checklist from the picker and opens it", async () => {
    renderPanel();
    await screen.findByRole("cell", { name: "Base checklist" });
    const select = screen.getByLabelText("Device type for a new checklist");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Synthetic scale" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: IDS.typeB } });
    mockedPost.mockResolvedValueOnce(ok(template({ id: "9b4c4a51-0000-4000-8000-000000000001", deviceTypeId: IDS.typeB, deviceTypeName: "Synthetic scale", publishedVersion: null, openDraft: null })));
    fireEvent.click(screen.getByRole("button", { name: "Create checklist" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Synthetic scale" })).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith("/api/v1/ipm/templates", { deviceTypeId: IDS.typeB });
    expect(screen.getByText("No published version yet.")).toBeInTheDocument();
    // No published version: only the empty draft is offered.
    expect(screen.queryByRole("button", { name: "Open a draft from the published version" })).not.toBeInTheDocument();
    mockedPost.mockResolvedValueOnce(ok(version({ id: IDS.draft, items: [] })));
    fireEvent.click(screen.getByRole("button", { name: "Open an empty draft" }));
    expect(await screen.findByText("No items yet.")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenLastCalledWith("/api/v1/ipm/templates/9b4c4a51-0000-4000-8000-000000000001/versions", { copyFrom: "empty" });
  });

  it("a 409 creating a checklist is shown in the panel as the backend wrote it", async () => {
    renderPanel();
    await screen.findByRole("cell", { name: "Base checklist" });
    const select = screen.getByLabelText("Device type for a new checklist");
    await waitFor(() => expect(within(select).getByRole("option", { name: "Synthetic scale" })).toBeInTheDocument());
    fireEvent.change(select, { target: { value: IDS.typeB } });
    mockedPost.mockRejectedValueOnce(httpError(409, "Synthetic scale already has a checklist."));
    fireEvent.click(screen.getByRole("button", { name: "Create checklist" }));
    expect(await screen.findByText("Synthetic scale already has a checklist.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Synthetic scale already has a checklist.")).not.toBeInTheDocument();
  });

  it("edits the open draft: adds from the library, orders, marks required, removes, then saves at the revision read", async () => {
    await openTypeChecklist();
    expect(screen.getByText(/Revision 2 · saved .* · 1 items/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save items" })).toBeDisabled();

    const add = await screen.findByRole("button", { name: "Add Earth leakage" });
    expect(screen.getByRole("button", { name: "Add Alarm sounds" })).toBeDisabled(); // already in the draft
    fireEvent.click(add);
    expect(screen.getByRole("region", { name: "Electrical safety" })).toBeInTheDocument();
    expect(screen.getByText("There are unsaved changes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Required: Alarm sounds" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Earth leakage up" })); // alone in its section: no move

    mockedPut.mockResolvedValueOnce(ok(version({ revision: 3, items: [templateItem({ required: false }), leakItem] })));
    fireEvent.click(screen.getByRole("button", { name: "Save items" }));
    await waitFor(() => expect(mockedPut).toHaveBeenCalled());
    expect(mockedPut).toHaveBeenCalledWith(`/api/v1/ipm/template-versions/${IDS.draft}/items`, {
      revision: 2,
      // Section order: electrical safety (6) before function (7); the new item is copied by the server.
      items: [
        { itemDefinitionId: IDS.defLeak, required: true },
        {
          itemDefinitionId: IDS.defAlarm,
          required: false,
          content: { section: "function", label: "Alarm sounds", symbol: null, inputKind: "tri_state", allowedOutcomes: ["pass", "fail", "not_applicable"] },
        },
      ],
    });
    expect(await screen.findByText(/Revision 3 · saved .* · 2 items/)).toBeInTheDocument();
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Draft items saved");

    fireEvent.click(screen.getByRole("button", { name: "Remove Earth leakage from the draft" }));
    expect(screen.queryByRole("region", { name: "Electrical safety" })).not.toBeInTheDocument();
  });

  it("reorders two items of one section", async () => {
    mockedGet.mockImplementation(routes({ [`/api/v1/ipm/template-versions/${IDS.draft}`]: ok(version({ items: [templateItem(), templateItem({ id: "x2", itemDefinitionId: "y2", label: "Display lights", sortOrder: 2 })] })) }));
    await openTypeChecklist();
    const before = within(screen.getByRole("region", { name: "Function checks" })).getAllByRole("row").map((r) => r.textContent);
    expect(before[1]).toMatch(/^Alarm sounds/);
    fireEvent.click(screen.getByRole("button", { name: "Move Display lights up" }));
    const after = within(screen.getByRole("region", { name: "Function checks" })).getAllByRole("row").map((r) => r.textContent);
    expect(after[1]).toMatch(/^Display lights/);
    fireEvent.click(screen.getByRole("button", { name: "Move Display lights down" }));
    expect(within(screen.getByRole("region", { name: "Function checks" })).getAllByRole("row")[1]?.textContent).toMatch(/^Alarm sounds/);
  });

  it("a stale save is a 409 shown as written, with a reload that re-reads the draft", async () => {
    await openTypeChecklist();
    fireEvent.click(await screen.findByRole("button", { name: "Add Earth leakage" }));
    mockedPut.mockRejectedValueOnce(httpError(409, "This draft was saved by another operator (revision 3); reload it before saving."));
    fireEvent.click(screen.getByRole("button", { name: "Save items" }));
    expect(await screen.findByText("This draft was saved by another operator (revision 3); reload it before saving.")).toBeInTheDocument();
    mockedGet.mockImplementation(routes({ [`/api/v1/ipm/template-versions/${IDS.draft}`]: ok(version({ revision: 3 })) }));
    fireEvent.click(screen.getByRole("button", { name: "Reload the draft" }));
    expect(await screen.findByText(/Revision 3 · saved/)).toBeInTheDocument();
    expect(screen.queryByText("There are unsaved changes.")).not.toBeInTheDocument();
  });

  it("publishes with a change note after a confirmation, then shows no draft", async () => {
    await openTypeChecklist();
    const publish = screen.getByRole("button", { name: "Publish" });
    expect(publish).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Change note"), { target: { value: "Adds the occlusion check" } });
    mockedPatch.mockResolvedValueOnce(ok(version({ revision: 3, changeNote: "Adds the occlusion check" })));
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(mockedPatch).toHaveBeenCalledWith(`/api/v1/ipm/template-versions/${IDS.draft}`, { revision: 2, changeNote: "Adds the occlusion check" }));
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Change note saved"));

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const confirm = await screen.findByRole("dialog");
    expect(confirm).toHaveTextContent("Earlier inspections and reports keep the version they used.");
    mockedPost.mockResolvedValueOnce(ok({ version: version({ status: "published", versionNumber: 3 }), retiredVersionId: IDS.typeV2, rebasedVersionIds: [] }));
    fireEvent.click(within(confirm).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(`/api/v1/ipm/template-versions/${IDS.draft}/publish`, { revision: 3, changeNote: "Adds the occlusion check" }));
    expect(await screen.findByText("No open draft.")).toBeInTheDocument();
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ title: "Version 3 published" });
  });

  it("a publish refused with the problems shows them as written and keeps the draft", async () => {
    await openTypeChecklist();
    fireEvent.change(screen.getByLabelText("Change note"), { target: { value: "Try" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    mockedPost.mockRejectedValueOnce(httpError(400, '"Earth leakage": the limit is in mA but the item records µA.'));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));
    expect(await screen.findByText('"Earth leakage": the limit is in mA but the item records µA.')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload the draft" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Function checks" })).toBeInTheDocument();
  });

  it("the base checklist's publish says it rebases every type checklist, and the toast counts them", async () => {
    mockedGet.mockImplementation(
      routes({
        "/api/v1/ipm/templates": ok([{ ...baseTemplate(), openDraft: { id: IDS.draft, revision: 0, createdAt: "2026-10-05T08:00:00.000Z" } }], meta(1)),
        [`/api/v1/ipm/template-versions/${IDS.draft}`]: ok(version({ templateId: IDS.baseTemplate, deviceTypeId: null, revision: 0, changeNote: "New base", items: [baseItem] })),
      }),
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Open Base checklist" }));
    expect(await screen.findByText(/This is the base checklist/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retire checklist" })).not.toBeInTheDocument();
    await screen.findByRole("region", { name: "Environment" });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    const confirm = await screen.findByRole("dialog");
    expect(confirm).toHaveTextContent("Publishing the base also publishes a new version of every published device-type checklist.");
    mockedPost.mockResolvedValueOnce(ok({ version: version({ status: "published", versionNumber: 4 }), retiredVersionId: IDS.baseV3, rebasedVersionIds: ["r1", "r2"] }));
    fireEvent.click(within(confirm).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ title: "Version 4 published", description: "2 device-type checklists republished on the new base." }));
  });

  it("discards the draft after a confirmation", async () => {
    await openTypeChecklist();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    mockedPost.mockResolvedValueOnce(ok(version({ status: "discarded" })));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(`/api/v1/ipm/template-versions/${IDS.draft}/discard`));
    expect(await screen.findByText("No open draft.")).toBeInTheDocument();
    // With a published version, both ways to open a new draft are offered.
    mockedPost.mockResolvedValueOnce(ok(version({ revision: 0 })));
    fireEvent.click(screen.getByRole("button", { name: "Open a draft from the published version" }));
    await waitFor(() => expect(mockedPost).toHaveBeenLastCalledWith(`/api/v1/ipm/templates/${IDS.typeTemplate}/versions`, { copyFrom: "published" }));
    expect(await screen.findByRole("region", { name: "Function checks" })).toBeInTheDocument();
  });

  it("retires the checklist after a confirmation, then offers to reactivate it", async () => {
    await openTypeChecklist();
    fireEvent.click(screen.getByRole("button", { name: "Retire checklist" }));
    const confirm = await screen.findByRole("dialog");
    expect(confirm).toHaveTextContent("new inspections of this type use the base checklist");
    mockedPost.mockResolvedValueOnce(ok({ id: IDS.typeTemplate, status: "retired", retiredVersionId: IDS.typeV2 }));
    fireEvent.click(within(confirm).getByRole("button", { name: "Retire" }));
    expect(await screen.findByRole("button", { name: "Reactivate" })).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith(`/api/v1/ipm/templates/${IDS.typeTemplate}/retire`);
    mockedPost.mockResolvedValueOnce(ok({ id: IDS.typeTemplate, status: "active", retiredVersionId: null }));
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    await waitFor(() => expect(mockedPost).toHaveBeenLastCalledWith(`/api/v1/ipm/templates/${IDS.typeTemplate}/reactivate`));
    expect(await screen.findByRole("button", { name: "Retire checklist" })).toBeInTheDocument();
  });

  it("lists the version history and opens a past version read-only", async () => {
    await openTypeChecklist();
    expect(await screen.findAllByRole("cell", { name: "Adds leakage" })).toHaveLength(2);
    expect(screen.getByText("republished")).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/ipm/template-versions", { params: { templateId: IDS.typeTemplate, page: 1, limit: 10 } });
    fireEvent.click(screen.getByRole("button", { name: "View Version 2" }));
    const dialog = await screen.findByRole("dialog", { name: "Test Pump A · Version 2" });
    expect(within(dialog).getByRole("region", { name: "Environment" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /Close/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a draft that cannot be read is an error state; back returns to the list", async () => {
    mockedGet.mockImplementation(routes({ [`/api/v1/ipm/template-versions/${IDS.draft}`]: () => Promise.reject(httpError(500, "Boom")) }));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Open Test Pump A" }));
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← Back to checklists" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Checklists" })).toBeInTheDocument();
  });

  it("filters the library list it adds from, and says when the library cannot be read", async () => {
    jest.useFakeTimers();
    try {
      await openTypeChecklist();
      fireEvent.change(screen.getByLabelText("Section", { selector: "#add-section" }), { target: { value: "electrical_safety" } });
      fireEvent.change(screen.getByLabelText("Search", { selector: "#add-search" }), { target: { value: "leak" } });
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      expect(mockedGet).toHaveBeenLastCalledWith("/api/v1/ipm/item-definitions", { params: { status: "active", limit: 50, section: "electrical_safety", search: "leak" } });
      mockedGet.mockImplementation(routes({ "/api/v1/ipm/item-definitions": () => Promise.reject(httpError(500, "Boom")) }));
      fireEvent.change(screen.getByLabelText("Search", { selector: "#add-search" }), { target: { value: "leaka" } });
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      expect(await screen.findByText("The library could not be loaded.")).toBeInTheDocument();
    } finally {
      jest.useRealTimers();
    }
  });
});
