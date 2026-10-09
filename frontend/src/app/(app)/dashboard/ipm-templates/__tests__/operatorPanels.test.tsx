/** @jest-environment jsdom */
/**
 * P22-01 — the operator's device types, item library and proposal queue (P21-01):
 *  - device types: search and status filter as query params; create; a 409 name clash shown as
 *    written; rename; retire behind a confirmation; reactivate;
 *  - the library: the item form offers the section's kinds and outcomes, previews how the server
 *    reads a limit, runs the shared content checks before saving, and POSTs / PATCHes the strict
 *    content union; a refusal keeps the form open with the reason; retire is confirmed;
 *  - the queue: a proposal read in full; accept (a new-type proposal needs the type the operator
 *    created) and reject (a note is required); a 409 shown as written.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { IDS, catalogue, definition, deviceType, leakItem, meta, ok, queueRow, routeGets } from "@/tests/support/ipmCatalogueFixtures";

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return { ...actual, api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() } };
});

import { api } from "@/api/client";
import { useToastStore } from "@/stores/toastStore";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { DeviceTypesPanel } from "../components/DeviceTypesPanel";
import { ItemLibraryPanel } from "../components/ItemLibraryPanel";
import { ProposalQueuePanel } from "../components/ProposalQueuePanel";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPatch = api.patch as jest.Mock;

const wrap = (node: React.ReactNode) =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <main>
        <h1>IPM checklists</h1>
        {node}
      </main>
    </MessagesProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe("P22-01 — device types", () => {
  beforeEach(() => {
    mockedGet.mockImplementation(
      routeGets({
        "/api/v1/device-types": (_p: string, config?: { params?: Record<string, unknown> }) =>
          config?.params?.status === "retired"
            ? ok([deviceType({ id: IDS.typeB, name: "Synthetic scale", status: "retired" })], meta(1))
            : ok([deviceType()], meta(30)),
      }),
    );
  });

  it("lists by status and search, pages, and is axe-clean", async () => {
    const { container } = wrap(<DeviceTypesPanel />);
    expect(await screen.findByRole("cell", { name: "Test Pump A" })).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/device-types", { params: { page: 1, limit: 25, status: "active" } });
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/v1/device-types", { params: { page: 2, limit: 25, status: "active" } }));
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "pump" } });
    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith("/api/v1/device-types", { params: { page: 1, limit: 25, status: "active", search: "pump" } }));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "retired" } });
    expect(await screen.findByRole("cell", { name: "Synthetic scale" })).toBeInTheDocument();
  });

  it("creates a type; a name clash is a 409 shown as the backend wrote it", async () => {
    wrap(<DeviceTypesPanel />);
    await screen.findByRole("cell", { name: "Test Pump A" });
    fireEvent.change(screen.getByLabelText("New device type name"), { target: { value: "Synthetic scale" } });
    mockedPost.mockRejectedValueOnce(httpError(409, 'A device type named "Synthetic scale" already exists (status: retired — reactivate it instead).'));
    fireEvent.click(screen.getByRole("button", { name: "Add device type" }));
    expect(await screen.findByText('A device type named "Synthetic scale" already exists (status: retired — reactivate it instead).')).toBeInTheDocument();
    mockedPost.mockResolvedValueOnce(ok(deviceType({ name: "Synthetic warmer" })));
    fireEvent.change(screen.getByLabelText("New device type name"), { target: { value: "Synthetic warmer" } });
    fireEvent.click(screen.getByRole("button", { name: "Add device type" }));
    await waitFor(() => expect(mockedPost).toHaveBeenLastCalledWith("/api/v1/device-types", { name: "Synthetic warmer" }));
    await waitFor(() => expect(screen.getByLabelText("New device type name")).toHaveValue(""));
  });

  it("renames, retires behind a confirmation, and reactivates", async () => {
    wrap(<DeviceTypesPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Rename Test Pump A" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename device type" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Test Pump B" } });
    mockedPatch.mockResolvedValueOnce(ok(deviceType({ name: "Test Pump B" })));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockedPatch).toHaveBeenCalledWith(`/api/v1/device-types/${IDS.typeA}`, { name: "Test Pump B" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Retire Test Pump A" }));
    const confirm = await screen.findByRole("dialog");
    expect(confirm).toHaveTextContent("Devices that have this type keep it");
    mockedPost.mockResolvedValueOnce(ok(deviceType({ status: "retired" })));
    fireEvent.click(within(confirm).getByRole("button", { name: "Retire" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(`/api/v1/device-types/${IDS.typeA}/retire`));

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "retired" } });
    mockedPost.mockResolvedValueOnce(ok(deviceType({ id: IDS.typeB, status: "active" })));
    fireEvent.click(await screen.findByRole("button", { name: "Reactivate Synthetic scale" }));
    await waitFor(() => expect(mockedPost).toHaveBeenLastCalledWith(`/api/v1/device-types/${IDS.typeB}/reactivate`));
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Synthetic scale reactivated");
  });

  it("a list that cannot be read is an error state, not an empty list", async () => {
    mockedGet.mockRejectedValue(httpError(500, "Boom"));
    wrap(<DeviceTypesPanel />);
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("No device type matches.")).not.toBeInTheDocument();
  });
});

describe("P22-01 — the item library", () => {
  beforeEach(() => {
    mockedGet.mockImplementation(routeGets({ "/api/v1/ipm/item-definitions": ok([definition(), definition({ ...leakItem, id: IDS.defLeak })], meta(2)) }));
  });

  it("lists with filters as query params, and is axe-clean", async () => {
    const { container } = wrap(<ItemLibraryPanel />);
    expect(await screen.findByRole("cell", { name: "Earth leakage" })).toBeInTheDocument();
    expect(screen.getByText("≤ 100 µA")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.change(screen.getByLabelText("Section"), { target: { value: "electrical_safety" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "leak" } });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith("/api/v1/ipm/item-definitions", { params: { page: 1, limit: 25, status: "all", section: "electrical_safety", search: "leak" } }),
    );
  });

  it("adds an item: the section's kind, a limit preview, the shared checks, then the strict union", async () => {
    wrap(<ItemLibraryPanel />);
    await screen.findByRole("cell", { name: "Earth leakage" });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const dialog = await screen.findByRole("dialog", { name: "New library item" });
    fireEvent.change(within(dialog).getByLabelText("Section"), { target: { value: "electrical_safety" } });
    expect(within(dialog).getByLabelText("Input kind")).toHaveValue("measured_with_limit");
    expect(within(dialog).getByLabelText("Input kind")).toBeDisabled(); // one kind in this section
    fireEvent.change(within(dialog).getByLabelText(/^Item/), { target: { value: "Enclosure leakage" } });
    fireEvent.change(within(dialog).getByLabelText(/^Unit/), { target: { value: "µA" } });
    fireEvent.change(within(dialog).getByLabelText("Limit / reference value"), { target: { value: "≤ 0,5 mA" } });
    expect(within(dialog).getByText("Read as: ≤ 0.5 mA")).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("the limit is in mA but the item records µA");
    const save = within(dialog).getByRole("button", { name: "Add item" });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Limit / reference value"), { target: { value: "see manual" } });
    expect(within(dialog).getByText(/Not read as a limit/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Limit / reference value"), { target: { value: "≤ 500 µA" } });
    expect(within(dialog).queryByRole("status")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "N/A" }));
    fireEvent.change(within(dialog).getByLabelText("Valid maximum"), { target: { value: "5000" } });
    fireEvent.change(within(dialog).getByLabelText("Operator notes"), { target: { value: "  IEC limit " } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Required when added to a checklist" }));

    mockedPost.mockRejectedValueOnce(httpError(400, "A unit mismatch"));
    fireEvent.click(save);
    expect(await within(screen.getByRole("dialog")).findByText("A unit mismatch")).toBeInTheDocument();
    mockedPost.mockResolvedValueOnce(ok(definition()));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add item" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockedPost).toHaveBeenLastCalledWith("/api/v1/ipm/item-definitions", {
      content: {
        section: "electrical_safety",
        label: "Enclosure leakage",
        symbol: null,
        inputKind: "measured_with_limit",
        unit: "µA",
        limitText: "≤ 500 µA",
        validMin: null,
        validMax: "5000",
        warnMin: null,
        warnMax: null,
        allowedOutcomes: ["pass", "fail"],
      },
      defaultRequired: false,
      notes: "IEC limit",
    });
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Item added to the library");
  });

  it("a setting/measured/reference item shows its setting fields", async () => {
    wrap(<ItemLibraryPanel />);
    await screen.findByRole("cell", { name: "Earth leakage" });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Section"), { target: { value: "performance" } });
    fireEvent.change(within(dialog).getByLabelText("Setting"), { target: { value: "100 mL/h" } });
    fireEvent.change(within(dialog).getByLabelText("Setting value"), { target: { value: "100" } });
    fireEvent.change(within(dialog).getByLabelText("Symbol"), { target: { value: "Q" } });
    expect(within(dialog).getByLabelText("Setting")).toHaveValue("100 mL/h");
    fireEvent.change(within(dialog).getByLabelText("Section"), { target: { value: "other_safety" } });
    expect(within(dialog).queryByLabelText("Setting")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("edits an item with its section and kind locked, and retires one behind a confirmation", async () => {
    wrap(<ItemLibraryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Alarm sounds" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit library item" });
    expect(within(dialog).getByLabelText("Section")).toBeDisabled();
    expect(within(dialog).getByLabelText("Input kind")).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^Item/), { target: { value: "Alarm audible" } });
    mockedPatch.mockResolvedValueOnce(ok(definition({ label: "Alarm audible" })));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith(`/api/v1/ipm/item-definitions/${IDS.defAlarm}`, {
        content: { section: "function", label: "Alarm audible", symbol: null, inputKind: "tri_state", allowedOutcomes: ["pass", "fail", "not_applicable"] },
        defaultRequired: true,
        notes: null,
      }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Retire Earth leakage" }));
    const confirm = await screen.findByRole("dialog");
    mockedPost.mockRejectedValueOnce(httpError(409, "The definition is already retired."));
    fireEvent.click(within(confirm).getByRole("button", { name: "Retire" }));
    expect(await screen.findByText("The definition is already retired.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retire Earth leakage" }));
    mockedPost.mockResolvedValueOnce(ok(definition({ status: "retired" })));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Retire" }));
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Item retired"));
    expect(mockedPost).toHaveBeenLastCalledWith(`/api/v1/ipm/item-definitions/${IDS.defLeak}/retire`);
  });

  it("unticking an outcome and ticking it back keeps the section's order", async () => {
    wrap(<ItemLibraryPanel />);
    await screen.findByRole("cell", { name: "Earth leakage" });
    fireEvent.click(screen.getByRole("button", { name: "Add item" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Item/), { target: { value: "Display" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Good" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Good" }));
    mockedPost.mockResolvedValueOnce(ok(definition()));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add item" }));
    await waitFor(() => expect(mockedPost).toHaveBeenCalled());
    expect(mockedPost.mock.calls[0]?.[1]).toMatchObject({ content: { inputKind: "tri_state", allowedOutcomes: ["pass", "fail", "not_applicable"] } });
  });
});

describe("P22-01 — the proposal queue", () => {
  const newType = queueRow({ id: "4f4c4a51-0000-4000-8000-000000000002", kind: "new_device_type", deviceTypeId: null, proposedDeviceTypeName: "Synthetic warmer", proposedItems: [] });

  beforeEach(() => {
    mockedGet.mockImplementation(
      routeGets({
        "/api/v1/admin/ipm/template-proposals": ok([queueRow(), newType], meta(2)),
        "/api/v1/ipm/templates/published": ok(catalogue()),
        "/api/v1/device-types": ok([deviceType({ id: IDS.typeB, name: "Synthetic warmer" })], meta(1)),
      }),
    );
  });

  it("lists the submitted proposals by default and reads one in full; axe-clean", async () => {
    const { container } = wrap(<ProposalQueuePanel />);
    expect(await screen.findByRole("cell", { name: "Synthetic warmer" })).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith("/api/v1/admin/ipm/template-proposals", { params: { page: 1, limit: 25, status: "submitted" } });
    expect(await screen.findByRole("cell", { name: "Test Pump A" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Review the proposal for Test Pump A" }));
    const dialog = await screen.findByRole("dialog", { name: "Add items · Test Pump A" });
    expect(within(dialog).getByText("Occlusion alarm")).toBeInTheDocument();
    expect(within(dialog).getByText("Seen on site")).toBeInTheDocument();
    expect(within(dialog).getByText(IDS.tenant)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "" } });
  });

  it("rejecting needs a note; a 409 is shown as written", async () => {
    wrap(<ProposalQueuePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Review the proposal for Test Pump A" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    const reject = within(dialog).getAllByRole("button", { name: "Reject" }).at(-1) as HTMLElement;
    expect(reject).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Decision note \(required\)/), { target: { value: "Already covered by the base" } });
    mockedPost.mockRejectedValueOnce(httpError(409, "This proposal was already withdrawn on 8 Oct 2026."));
    fireEvent.click(reject);
    expect(await within(dialog).findByText("This proposal was already withdrawn on 8 Oct 2026.")).toBeInTheDocument();
    expect(mockedPost).toHaveBeenCalledWith(`/api/v1/admin/ipm/template-proposals/${IDS.proposal}/reject`, { decisionNote: "Already covered by the base" });
    mockedPost.mockResolvedValueOnce(ok(queueRow({ status: "rejected" })));
    fireEvent.click(reject);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Proposal rejected");
  });

  it("accepting a new-type proposal names the type the operator created", async () => {
    jest.useFakeTimers();
    try {
      wrap(<ProposalQueuePanel />);
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.click(await screen.findByRole("button", { name: "Review the proposal for Synthetic warmer" }));
      const dialog = await screen.findByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
      const accept = within(dialog).getAllByRole("button", { name: "Accept" }).at(-1) as HTMLElement;
      expect(accept).toBeDisabled();
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      const picker = within(dialog).getByLabelText("The device type you created for this proposal");
      await waitFor(() => expect(within(picker).getByRole("option", { name: "Synthetic warmer" })).toBeInTheDocument());
      fireEvent.change(picker, { target: { value: IDS.typeB } });
      fireEvent.change(within(dialog).getByLabelText(/Decision note \(optional\)/), { target: { value: "Created the type" } });
      mockedPost.mockResolvedValueOnce(ok(queueRow({ status: "accepted" })));
      fireEvent.click(accept);
      await waitFor(() =>
        expect(mockedPost).toHaveBeenCalledWith("/api/v1/admin/ipm/template-proposals/4f4c4a51-0000-4000-8000-000000000002/accept", {
          decisionNote: "Created the type",
          deviceTypeId: IDS.typeB,
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("accepts an items proposal with no note, and a cancelled decision goes back to the choice", async () => {
    wrap(<ProposalQueuePanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Review the proposal for Test Pump A" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Accept" }));
    mockedPost.mockResolvedValueOnce(ok(queueRow({ status: "accepted" })));
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Accept" }).at(-1) as HTMLElement);
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith(`/api/v1/admin/ipm/template-proposals/${IDS.proposal}/accept`, {}));
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Proposal accepted; the draft is ready in the editor");
  });
});
