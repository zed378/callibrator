/** @jest-environment jsdom */
/**
 * P22-04 — /dashboard/ipm, the IPM history, by audience (ADR-102: the effective permissions, never
 * a role name) and through its flows. Real: the island, the visit dialog, the service and the typed
 * client. Mocked: the HTTP client (`@/api/client`) and the dashboard chrome.
 *
 * Pins: loading / restricted / the list's three states (a failed read is never an empty history);
 * rows from `data`, paging from the top-level `meta`; each filter's query; `?deviceId=` narrows the
 * list and names the device; a bound reader has no facility column or filter and is never offered a
 * void; the operator is never offered a correction; a visit's header, results by section and
 * lineage; correct (reason checked before the POST, the draft read back), void, a draft's header
 * (only the changes, at its revision), submit (blocked while unsaved) with the server's notices,
 * discard; every refusal shown as the server explained it; one h1; Indonesian; axe.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axeViolations } from "@/tests/a11y/axe";
import { httpError } from "@/tests/support/httpError";
import { clearPermissions, grantPermissions, grantSuperAdmin } from "@/tests/support/permissions";

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
import { id as idMessages } from "@/i18n/messages/id";
import { IpmClient } from "../IpmClient";
import type { IpmSession } from "@/api/services/ipmHistory.service";

jest.setTimeout(20000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const patch = api.patch as jest.Mock;

const S1 = "5a000000-0000-4000-8000-000000000001";
const S0 = "5a000000-0000-4000-8000-000000000000";
const DRAFT = "5a000000-0000-4000-8000-000000000002";
const DEVICE = "5b000000-0000-4000-8000-000000000001";
const FACILITY = "5c000000-0000-4000-8000-000000000001";

const ok = <T,>(data: T, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });
const meta = (total: number, page = 1) => ({ total, page, limit: 20, totalPages: Math.max(1, Math.ceil(total / 20)) });

const session = (over: Partial<IpmSession> = {}): IpmSession => ({
  id: S1,
  deviceId: DEVICE,
  clientFacilityId: FACILITY,
  templateVersionId: null,
  status: "submitted",
  effective: true,
  revision: 4,
  supersedesId: null,
  correctionReason: null,
  supersededById: null,
  supersededAt: null,
  performedAt: "2026-10-03T02:00:00.000Z",
  receivedAt: "2026-10-03T02:05:00.000Z",
  capturedOffline: false,
  clientCapturedAt: null,
  clientRef: null,
  createdBy: "u1",
  performedBy: "u1",
  submittedAt: "2026-10-03T02:05:00.000Z",
  visitNumber: 7,
  legacyVisitNumber: null,
  inspectionOutcome: "pass",
  maintenanceOutcome: "pass",
  recommendation: "needs_repair",
  notes: "Synthetic note",
  locationId: null,
  performerSnapshot: { name: "Synthetic Tech", role: null, organisation: null },
  roomSnapshot: "ICU",
  floorSnapshot: "2",
  deviceSnapshot: { name: "Synthetic pump", qrCode: "QR-000123", serialNumber: "SN-1" },
  facilitySnapshot: { name: "Synthetic clinic" },
  sideEffects: null,
  workOrderId: null,
  followUpWorkOrderId: null,
  reportNumber: "SC/IPM/2026/10/0007",
  voidReason: null,
  voidedAt: null,
  discardedAt: null,
  createdAt: "2026-10-03T02:00:00.000Z",
  updatedAt: "2026-10-03T02:05:00.000Z",
  performerDisplay: { name: "Synthetic Tech", role: null, organisation: null, redacted: false },
  templateVersionNumber: 3,
  templateContentHash: null,
  device: null,
  results: [
    {
      id: "r1",
      section: "electrical_safety",
      inputKind: "measured_with_limit",
      templateItemId: null,
      itemDefinitionId: null,
      isAdHoc: false,
      label: "Leakage current",
      unit: "µA",
      symbol: null,
      settingText: null,
      referenceText: null,
      outcome: "pass",
      cleanliness: null,
      measuredValue: "45",
      measuredValue1: null,
      measuredValue2: null,
      textValue: null,
      computedOutcome: "pass",
      outcomeSource: "computed",
      warnFlag: true,
      disagreementFlag: false,
      sortOrder: 1,
    },
    {
      id: "r2",
      section: "physical",
      inputKind: "condition_clean",
      templateItemId: null,
      itemDefinitionId: null,
      isAdHoc: true,
      label: "Housing",
      unit: null,
      symbol: null,
      settingText: null,
      referenceText: null,
      outcome: "minor_damage",
      cleanliness: "dirty",
      measuredValue: null,
      measuredValue1: null,
      measuredValue2: null,
      textValue: null,
      computedOutcome: null,
      outcomeSource: "technician",
      warnFlag: false,
      disagreementFlag: true,
      sortOrder: 2,
    },
  ],
  notices: [],
  ...over,
});

let rows: IpmSession[];
let sessions: Record<string, IpmSession>;
const routes = (path: string, config?: { params?: Record<string, unknown> }) => {
  if (path === "/api/v1/ipm/sessions") return Promise.resolve(ok(rows, meta(rows.length === 0 ? 0 : 21, Number(config?.params?.page ?? 1))));
  if (path.startsWith("/api/v1/ipm/sessions/")) {
    const found = sessions[path.split("/")[5] ?? ""];
    return found ? Promise.resolve(ok(found)) : Promise.reject(httpError(404, "IPM session not found"));
  }
  if (path === "/api/v1/client-facilities/options")
    return Promise.resolve(ok([{ id: FACILITY, name: "Synthetic clinic", code: "SC", status: "active", isSelf: false }]));
  if (path === `/api/v1/calibration-devices/${DEVICE}`) return Promise.resolve(ok({ id: DEVICE, name: "Synthetic pump" }));
  return Promise.reject(new Error(`unexpected GET ${path}`));
};

const renderPage = (deviceId: string | null = null, locale: "en" | "id" = "en") =>
  render(
    <MessagesProvider locale={locale} messages={locale === "en" ? en : idMessages}>
      <IpmClient deviceId={deviceId} languageForm={<div>language</div>} />
    </MessagesProvider>,
  );

const lastListQuery = (): Record<string, unknown> => {
  const calls = get.mock.calls.filter((c) => c[0] === "/api/v1/ipm/sessions");
  return (calls[calls.length - 1]?.[1] as { params: Record<string, unknown> }).params;
};

const bind = (permissions: Record<string, "read" | "write">) =>
  useMenuStore.setState({ effectivePermissions: { superAdmin: false, facilityBound: true, permissions } });

const openVisit = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Open the visit to Synthetic pump/ }));
  return screen.findByRole("dialog", { name: "IPM visit 007 — Synthetic pump" });
};

beforeEach(() => {
  jest.clearAllMocks();
  clearPermissions();
  useToastStore.setState({ toasts: [] });
  rows = [session()];
  sessions = { [S1]: session() };
  get.mockImplementation(routes);
});

describe("P22-04 — access and the list", () => {
  it("loading, then restricted: one h1 each, nothing loaded", () => {
    const { unmount } = renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    unmount();
    grantPermissions({ calibration: "read" });
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "IPM history" })).toBeInTheDocument();
    expect(screen.getByText("You do not have access to the IPM history.")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("a reader sees the recorded visit: device, QR, facility, room, performer, recommendation, record; axe-clean", async () => {
    grantPermissions({ ipm: "read" });
    const { container } = renderPage();
    const table = await screen.findByRole("table", { name: "IPM visits" });
    const row = within(table).getAllByRole("row")[1] as HTMLElement;
    for (const text of ["007", "Synthetic pump", "QR-000123", "Synthetic clinic", "ICU · 2", "Synthetic Tech", "Needs repair", "Current"]) {
      expect(within(row).getByText(text)).toBeInTheDocument();
    }
    expect(lastListQuery()).toEqual({ page: 1, limit: 20, sort: "performedAt" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await screen.findByRole("option", { name: "Synthetic clinic" });
    expect(screen.getByRole("navigation", { name: "IPM visits" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("each filter goes into the query and the list restarts at page 1; the pager pages", async () => {
    grantPermissions({ ipm: "read" });
    renderPage();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(lastListQuery()["page"]).toBe(2));
    fireEvent.change(screen.getByLabelText("Device name or QR sticker"), { target: { value: "pump" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "voided" } });
    fireEvent.change(screen.getByLabelText("Recommendation"), { target: { value: "fit_for_use" } });
    fireEvent.change(await screen.findByLabelText("Facility"), { target: { value: FACILITY } });
    fireEvent.change(screen.getByLabelText("Performed from"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Performed until"), { target: { value: "2026-10-31" } });
    fireEvent.click(screen.getByLabelText("Current records only (hide superseded versions)"));
    await waitFor(() =>
      expect(lastListQuery()).toMatchObject({ page: 1, q: "pump", status: "voided", recommendation: "fit_for_use", clientFacilityId: FACILITY, effective: true }),
    );
    expect(lastListQuery()["from"]).toEqual(expect.any(String));
    expect(lastListQuery()["to"]).toEqual(expect.any(String));
  });

  it("empty and failed are two different states; a retry reads again", async () => {
    grantPermissions({ ipm: "read" });
    rows = [];
    const { unmount } = renderPage();
    expect(await screen.findByText("No IPM visit matches.")).toBeInTheDocument();
    unmount();
    get.mockImplementation((path: string) => (path === "/api/v1/ipm/sessions" ? Promise.reject(httpError(500, "Server down")) : routes(path)));
    renderPage();
    expect(await screen.findByText("Server down")).toBeInTheDocument();
    expect(screen.queryByText("No IPM visit matches.")).not.toBeInTheDocument();
    get.mockImplementation(routes);
    rows = [session()];
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("a bound reader: its facility's lead, no facility column or filter, no facility options read", async () => {
    bind({ ipm: "read" });
    renderPage();
    const table = await screen.findByRole("table");
    expect(screen.getByText("The inspection and preventive maintenance visits of your facility's devices.")).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Facility" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Facility")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith("/api/v1/client-facilities/options", expect.anything());
  });

  it("?deviceId= narrows the list, names the device and offers every device back; a draft row says so", async () => {
    grantPermissions({ ipm: "read", calibration: "read" });
    rows = [session({ id: DRAFT, status: "draft", effective: false, deviceSnapshot: null, visitNumber: null, performerDisplay: null, recommendation: null, capturedOffline: true })];
    renderPage(DEVICE);
    expect(await screen.findByText("Device: Synthetic pump")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show every device" })).toHaveAttribute("href", "/dashboard/ipm");
    expect(screen.queryByLabelText("Device name or QR sticker")).not.toBeInTheDocument();
    expect(lastListQuery()).toMatchObject({ deviceId: DEVICE });
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Draft")).toBeInTheDocument();
    expect(within(table).getByText("Captured offline")).toBeInTheDocument();
    expect(within(table).getAllByText("Synthetic pump").length).toBeGreaterThan(0);
  });

  it("?deviceId= without calibration read (or a failed read) names it neutrally", async () => {
    grantPermissions({ ipm: "read" });
    renderPage(DEVICE);
    expect(await screen.findByText("Device: the selected device")).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(`/api/v1/calibration-devices/${DEVICE}`);
  });

  it("Indonesian", async () => {
    grantPermissions({ ipm: "read" });
    renderPage(null, "id");
    expect(await screen.findByRole("heading", { level: 1, name: "Riwayat IPM" })).toBeInTheDocument();
    expect(within(await screen.findByRole("table", { name: "Kunjungan IPM" })).getByText("Perlu perbaikan")).toBeInTheDocument();
  });
});

describe("P22-04 — one visit", () => {
  it("header, results by section (computed, warning, ad hoc, cleanliness, disagreement) and no write control for a reader; axe-clean", async () => {
    grantPermissions({ ipm: "read" });
    renderPage();
    const dialog = await openVisit();
    for (const text of ["Synthetic Tech", "SC/IPM/2026/10/0007", "Version 3", "Synthetic note", "S/N SN-1", "Synthetic clinic"]) {
      expect(within(dialog).getByText(text)).toBeInTheDocument();
    }
    const safety = within(dialog).getByRole("table", { name: "Electrical safety" });
    expect(within(safety).getByText("Leakage current")).toBeInTheDocument();
    expect(within(safety).getByText("45 µA")).toBeInTheDocument();
    expect(within(safety).getByText("Computed from the measurement")).toBeInTheDocument();
    expect(within(safety).getByText("Outside the warning range")).toBeInTheDocument();
    const physical = within(dialog).getByRole("table", { name: "Physical inspection" });
    expect(within(physical).getByText("Minor damage")).toBeInTheDocument();
    expect(within(physical).getByText("Dirty")).toBeInTheDocument();
    expect(within(physical).getByText("Added on site")).toBeInTheDocument();
    expect(within(physical).getByText("The technician's outcome differs from the computed one")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Correct|Void/ })).not.toBeInTheDocument();
    expect(await axeViolations(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("lineage: a correction opens the version it corrects, which opens the correction back", async () => {
    grantPermissions({ ipm: "read" });
    sessions[S1] = session({ supersedesId: S0, correctionReason: "Wrong date" });
    sessions[S0] = session({ id: S0, effective: false, supersededById: S1, supersededAt: "2026-10-04T00:00:00.000Z", visitNumber: 7 });
    renderPage();
    const dialog = await openVisit();
    expect(within(dialog).getByText("This version corrects an earlier one. Reason: Wrong date")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Open the version it corrects" }));
    expect(await within(dialog).findByText(/^Corrected on /)).toBeInTheDocument();
    expect(within(dialog).getByText("Superseded")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Open the correction" }));
    expect(await within(dialog).findByText("This version corrects an earlier one. Reason: Wrong date")).toBeInTheDocument();
  });

  it("a visit that cannot be read is said, not shown empty", async () => {
    grantPermissions({ ipm: "read" });
    sessions = {};
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Open the visit to Synthetic pump/ }));
    const dialog = await screen.findByRole("dialog", { name: "IPM visit" });
    expect(await within(dialog).findByText("The visit could not be loaded.")).toBeInTheDocument();
    expect(within(dialog).getByText("IPM session not found")).toBeInTheDocument();
  });

  it("voided and discarded visits say when and why; a redacted performer is said", async () => {
    grantPermissions({ ipm: "write" });
    sessions[S1] = session({ status: "voided", effective: false, voidedAt: "2026-10-05T00:00:00.000Z", voidReason: "Duplicate visit", performerDisplay: { name: null, role: null, organisation: null, redacted: true } });
    renderPage();
    let dialog = await openVisit();
    expect(within(dialog).getByText(/Reason: Duplicate visit/)).toBeInTheDocument();
    expect(within(dialog).getByText("Redacted")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Correct|Void/ })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    sessions[S1] = session({ status: "discarded", effective: false, discardedAt: "2026-10-05T00:00:00.000Z", visitNumber: null, results: [] });
    dialog = await (async () => {
      fireEvent.click(await screen.findByRole("button", { name: /Open the visit to Synthetic pump/ }));
      return screen.findByRole("dialog", { name: "IPM draft — Synthetic pump" });
    })();
    expect(within(dialog).getByText(/^Discarded on /)).toBeInTheDocument();
    expect(within(dialog).getByText("No result recorded.")).toBeInTheDocument();
  });
});

describe("P22-04 — corrections, voids and drafts", () => {
  it("correct: the reason is checked before the POST; then the correction draft is read back and the list reloads on close", async () => {
    grantPermissions({ ipm: "write" });
    const draft = session({ id: DRAFT, status: "draft", effective: false, supersedesId: S1, correctionReason: "Wrong date", visitNumber: null, revision: 0, reportNumber: null });
    sessions[DRAFT] = draft;
    post.mockResolvedValueOnce(ok(draft));
    renderPage();
    const dialog = await openVisit();
    fireEvent.click(within(dialog).getByRole("button", { name: "Correct this visit" }));
    fireEvent.change(within(dialog).getByLabelText("Why is it corrected?"), { target: { value: "ab" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start the correction" }));
    expect(within(dialog).getByText("Give a reason of at least 3 characters.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Why is it corrected?"), { target: { value: "Wrong date" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start the correction" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/v1/ipm/sessions/${S1}/corrections`, { reason: "Wrong date" }));
    const draftDialog = await screen.findByRole("dialog", { name: "IPM draft — Synthetic pump" });
    expect(await within(draftDialog).findByRole("heading", { name: "The draft's header" })).toBeInTheDocument();
    const listReads = get.mock.calls.filter((c) => c[0] === "/api/v1/ipm/sessions").length;
    fireEvent.click(within(draftDialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(get.mock.calls.filter((c) => c[0] === "/api/v1/ipm/sessions").length).toBe(listReads + 1));
  });

  it("a refused correction (409) is the server's explanation, the reason kept; cancel leaves the form", async () => {
    grantPermissions({ ipm: "write" });
    post.mockRejectedValueOnce(httpError(409, "A correction of this IPM is already open (started by Synthetic Tech on 4 Oct 2026).", "IPM_CORRECTION_OPEN"));
    renderPage();
    const dialog = await openVisit();
    fireEvent.click(within(dialog).getByRole("button", { name: "Correct this visit" }));
    fireEvent.change(within(dialog).getByLabelText("Why is it corrected?"), { target: { value: "Wrong date" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Start the correction" }));
    expect(await within(dialog).findByText("A correction of this IPM is already open (started by Synthetic Tech on 4 Oct 2026).")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Why is it corrected?")).toHaveValue("Wrong date");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(dialog).queryByLabelText("Why is it corrected?")).not.toBeInTheDocument();
  });

  it("void (unbound writer): reason checked, POSTed, the voided visit shown; a 403 is the server's words", async () => {
    grantPermissions({ ipm: "write" });
    post.mockRejectedValueOnce(httpError(403, "Only a tenant administrator can void an IPM."));
    post.mockResolvedValueOnce(ok(session({ status: "voided", effective: false, voidReason: "Duplicate visit", voidedAt: "2026-10-05T00:00:00.000Z" })));
    renderPage();
    const dialog = await openVisit();
    fireEvent.click(within(dialog).getByRole("button", { name: "Void this visit" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Void the visit" }));
    expect(within(dialog).getByText("Give a reason of at least 3 characters.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Why is it voided?"), { target: { value: "Duplicate visit" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void the visit" }));
    expect(await within(dialog).findByText("Only a tenant administrator can void an IPM.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Void the visit" }));
    expect(await within(dialog).findByText(/Reason: Duplicate visit/)).toBeInTheDocument();
    expect(post).toHaveBeenLastCalledWith(`/api/v1/ipm/sessions/${S1}/void`, { reason: "Duplicate visit" });
    expect(useToastStore.getState().toasts.map((t) => t.title)).toContain("Visit voided");
  });

  it("a bound writer may correct but is never offered a void; the operator is offered neither", async () => {
    bind({ ipm: "write" });
    const { unmount } = renderPage();
    let dialog = await openVisit();
    expect(within(dialog).getByRole("button", { name: "Correct this visit" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Void this visit" })).not.toBeInTheDocument();
    unmount();
    grantSuperAdmin();
    renderPage();
    dialog = await openVisit();
    expect(within(dialog).queryByRole("button", { name: /Correct this visit|Void this visit/ })).not.toBeInTheDocument();
  });

  it("a draft: the header sends only the changes at its revision; submit waits for the save, then shows the server's notices", async () => {
    grantPermissions({ ipm: "write" });
    const draft = session({ id: DRAFT, status: "draft", effective: false, visitNumber: null, revision: 2, recommendation: null, inspectionOutcome: null, notes: null, reportNumber: null });
    rows = [draft];
    sessions[DRAFT] = draft;
    patch.mockResolvedValueOnce(ok({ ...draft, revision: 3, recommendation: "needs_repair", notes: "Fan noisy" }));
    post.mockResolvedValueOnce(ok({ ...draft, status: "submitted", effective: true, visitNumber: 8, revision: 3, notices: ["Repair work order opened"], sideEffects: { notices: ["Repair work order opened", "Device set to maintenance"] } }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Open the visit to Synthetic pump/ }));
    const dialog = await screen.findByRole("dialog", { name: "IPM draft — Synthetic pump" });
    const submit = within(dialog).getByRole("button", { name: "Submit" });
    expect(within(dialog).getByRole("button", { name: "Save the header" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Recommendation"), { target: { value: "needs_repair" } });
    fireEvent.change(within(dialog).getByLabelText("Notes"), { target: { value: " Fan noisy " } });
    fireEvent.change(within(dialog).getByLabelText("Inspection outcome"), { target: { value: "fail" } });
    fireEvent.change(within(dialog).getByLabelText("Inspection outcome"), { target: { value: "" } });
    expect(within(dialog).getByText("Save the header before submitting.")).toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save the header" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/api/v1/ipm/sessions/${DRAFT}`, { revision: 2, recommendation: "needs_repair", notes: "Fan noisy" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Submit" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/v1/ipm/sessions/${DRAFT}/submit`, { revision: 3 }));
    const notices = await within(screen.getByRole("dialog")).findByRole("status");
    expect(within(notices).getByText("Repair work order opened")).toBeInTheDocument();
    expect(within(notices).getByText("Device set to maintenance")).toBeInTheDocument();
  });

  it("a draft's date and outcomes are sent as changed (a cleared one as null); a stale revision is the server's explanation", async () => {
    grantPermissions({ ipm: "write" });
    const draft = session({ id: DRAFT, status: "draft", effective: false, visitNumber: null, revision: 5 });
    rows = [draft];
    sessions[DRAFT] = draft;
    patch.mockRejectedValueOnce(httpError(409, "This draft was saved at 10:02 (revision 6); reload it before saving.", "IPM_REVISION_CONFLICT"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Open the visit to Synthetic pump/ }));
    const dialog = await screen.findByRole("dialog", { name: "IPM draft — Synthetic pump" });
    fireEvent.change(within(dialog).getByLabelText("Performed at"), { target: { value: "2026-10-02T08:30" } });
    fireEvent.change(within(dialog).getByLabelText("Maintenance outcome"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Notes"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save the header" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(`/api/v1/ipm/sessions/${DRAFT}`, {
        revision: 5,
        performedAt: new Date("2026-10-02T08:30").toISOString(),
        maintenanceOutcome: null,
        notes: null,
      }),
    );
    expect(await within(dialog).findByText("This draft was saved at 10:02 (revision 6); reload it before saving.")).toBeInTheDocument();
  });

  it("a draft can be discarded, with or without a reason", async () => {
    grantPermissions({ ipm: "write" });
    const draft = session({ id: DRAFT, status: "draft", effective: false, visitNumber: null });
    rows = [draft];
    sessions[DRAFT] = draft;
    post.mockResolvedValue(ok({ ...draft, status: "discarded", discardedAt: "2026-10-05T00:00:00.000Z" }));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Open the visit to Synthetic pump/ }));
    let dialog = await screen.findByRole("dialog", { name: "IPM draft — Synthetic pump" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard the draft" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard the draft" }));
    fireEvent.change(within(dialog).getByLabelText("Reason (optional)"), { target: { value: "Started by mistake" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/api/v1/ipm/sessions/${DRAFT}/discard`, { reason: "Started by mistake" }));
    expect(await within(dialog).findByText(/^Discarded on /)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(await screen.findByRole("button", { name: /Open the visit to Synthetic pump/ }));
    dialog = await screen.findByRole("dialog", { name: "IPM draft — Synthetic pump" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard the draft" }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
    });
    await waitFor(() => expect(post).toHaveBeenLastCalledWith(`/api/v1/ipm/sessions/${DRAFT}/discard`, {}));
  });
});
