/** @jest-environment jsdom */
/**
 * P22-03 — the IPM capture (/dashboard/ipm/capture/<id>). Real: the stepper, the item fields, the
 * capture rules (`normaliseResult`, `missingRequiredItems` from the contracts), the services and the
 * typed client. Mocked: the HTTP client and the dashboard chrome. The autosave pause is shortened.
 *
 * Pins: the draft and its pinned checklist loaded (a failure said; a submitted IPM sent to the
 * history); one section a step, with counts; answers saved after the pause as ONE `PUT …/results`
 * at the revision read, the next write at the revision it answered; the header as a PATCH of what
 * changed; a value the server would refuse said on the field and NOT sent; a refused save kept until
 * the next change (no retry loop); a stale revision stops the autosave and offers a reload; ad-hoc
 * rows; a room picked; the review lists what is missing and keeps Submit off; submit saves what is
 * pending, then submits and shows the visit and the server's notices; discard; restricted; axe.
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
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { CaptureClient, headerChanges, type Header } from "../capture/[sessionId]/CaptureClient";

jest.setTimeout(30000);

const get = api.get as jest.Mock;
const post = api.post as jest.Mock;
const put = api.put as jest.Mock;
const patch = api.patch as jest.Mock;
const ok = <T,>(data: T) => ({ success: true, status: 200, message: "ok", data });

const S = "5a000000-0000-4000-8000-000000000001";
const V = "5d000000-0000-4000-8000-000000000001";
const DEVICE = "5b000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const item = (n: number, over: Record<string, unknown>) => ({
  id: id(n),
  itemDefinitionId: id(100 + n),
  origin: "base",
  section: "function",
  label: `Item ${String(n)}`,
  inputKind: "tri_state",
  unit: null,
  symbol: null,
  settingText: null,
  settingValue: null,
  limitOp: null,
  limitValue: null,
  limitLow: null,
  limitHigh: null,
  limitNominal: null,
  limitTolerance: null,
  limitText: null,
  validMin: null,
  validMax: null,
  warnMin: null,
  warnMax: null,
  allowedOutcomes: [],
  required: true,
  sortOrder: n,
  ...over,
});

const ITEMS = [
  item(1, { section: "environment", inputKind: "measured", label: "Room temperature", unit: "°C", validMin: "-10", validMax: "60", warnMin: "10", warnMax: "45" }),
  item(2, { section: "electrical_safety", inputKind: "measured_with_limit", label: "Chassis leakage", unit: "µA", limitOp: "lte", limitValue: "100", limitText: "≤ 100 µA" }),
  item(3, { section: "physical", inputKind: "condition_clean", label: "Main unit" }),
  item(4, { section: "performance", inputKind: "setting_measured_reference", label: "Flow", settingText: "10 mL/h", limitOp: "plus_minus", limitNominal: "10", limitTolerance: "1", required: false }),
  item(5, { section: "function", label: "Alarm" }),
  item(6, { section: "maintenance_task", inputKind: "check", label: "Clean the unit", required: false }),
  item(7, { section: "maintenance_task", inputKind: "text", label: "Part replaced", required: false }),
  item(8, { section: "electrical_supply", inputKind: "measured", label: "UPS voltage", unit: "V", allowedOutcomes: ["not_applicable"], required: false }),
];

const session = (over: Record<string, unknown> = {}) => ({
  id: S,
  deviceId: DEVICE,
  clientFacilityId: "f",
  templateVersionId: V,
  status: "draft",
  effective: false,
  revision: 2,
  supersedesId: null,
  correctionReason: null,
  supersededById: null,
  supersededAt: null,
  performedAt: "2026-10-10T02:00:00.000Z",
  receivedAt: "2026-10-10T02:00:00.000Z",
  capturedOffline: false,
  clientCapturedAt: null,
  clientRef: null,
  createdBy: "u1",
  performedBy: "u1",
  submittedAt: null,
  visitNumber: null,
  legacyVisitNumber: null,
  inspectionOutcome: null,
  maintenanceOutcome: null,
  recommendation: null,
  notes: null,
  locationId: null,
  performerSnapshot: null,
  roomSnapshot: null,
  floorSnapshot: null,
  deviceSnapshot: null,
  facilitySnapshot: null,
  sideEffects: null,
  workOrderId: null,
  followUpWorkOrderId: null,
  reportNumber: null,
  voidReason: null,
  voidedAt: null,
  discardedAt: null,
  createdAt: "2026-10-10T02:00:00.000Z",
  updatedAt: "2026-10-10T02:00:00.000Z",
  performerDisplay: null,
  templateVersionNumber: 3,
  templateContentHash: null,
  device: { id: DEVICE, name: "Synthetic pump", manufacturer: null, model: null, serialNumber: null, qrCode: "QR-000123", deviceTypeId: null, locationId: "w", status: "active" },
  results: [
    {
      id: "r1",
      section: "function",
      inputKind: "tri_state",
      templateItemId: id(5),
      itemDefinitionId: null,
      isAdHoc: false,
      label: "Alarm",
      unit: null,
      symbol: null,
      settingText: null,
      referenceText: null,
      outcome: "pass",
      cleanliness: null,
      measuredValue: null,
      measuredValue1: null,
      measuredValue2: null,
      textValue: null,
      computedOutcome: null,
      outcomeSource: "technician",
      warnFlag: false,
      disagreementFlag: false,
      sortOrder: 0,
    },
  ],
  notices: [],
  ...over,
});

let current: ReturnType<typeof session>;
const routes = (path: string) => {
  if (path === `/api/v1/ipm/sessions/${S}`) return Promise.resolve(ok(current));
  if (path === `/api/v1/ipm/template-versions/${V}`) return Promise.resolve(ok({ id: V, items: ITEMS }));
  if (path === `/api/v1/calibration-devices/${DEVICE}`) return Promise.resolve(ok({ id: DEVICE, name: "Synthetic pump", warehouse: { id: "w", name: "ICU", code: "I", floor: "2" } }));
  if (path === "/api/v1/warehouses") return Promise.resolve(ok([{ id: "w2", name: "Ward B", code: "WB", floor: "3" }]));
  return Promise.reject(new Error(`unexpected GET ${path}`));
};

const renderPage = () =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <CaptureClient sessionId={S} languageForm={<div>language</div>} autosaveMs={20} />
    </MessagesProvider>,
  );

const ready = () => screen.findByRole("navigation", { name: "Checklist steps" });
const goTo = (name: RegExp | string) => fireEvent.click(within(screen.getByRole("navigation", { name: "Checklist steps" })).getByRole("button", { name }));

beforeEach(() => {
  jest.clearAllMocks();
  clearPermissions();
  current = session();
  get.mockImplementation(routes);
  let revision = 2;
  put.mockImplementation(async () => {
    revision += 1;
    return ok({ ...current, revision });
  });
  patch.mockImplementation(async () => {
    revision += 1;
    return ok({ ...current, revision });
  });
});

describe("P22-03 — capture: loading and access", () => {
  it("restricted without ipm write; loading; a failed load said; a submitted IPM sent to the history", async () => {
    grantPermissions({ ipm: "read" });
    const first = renderPage();
    expect(screen.getByText("Only a technician who records IPM visits can start or fill one in.")).toBeInTheDocument();
    first.unmount();
    grantPermissions({ ipm: "write" });
    current = session({ status: "submitted" });
    const second = renderPage();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("This IPM is no longer a draft: it can be read in the history.")).toBeInTheDocument();
    second.unmount();
    current = session({ templateVersionId: null });
    const third = renderPage();
    expect(await screen.findByText("This draft has no checklist.")).toBeInTheDocument();
    third.unmount();
    get.mockImplementation((path: string) => (path.startsWith("/api/v1/ipm/sessions/") ? Promise.reject(httpError(404, "IPM session not found")) : routes(path)));
    renderPage();
    expect(await screen.findByText("IPM session not found")).toBeInTheDocument();
  });
});

describe("P22-03 — capture: the stepper and the autosave", () => {
  it("one section a step with counts; answers saved as one PUT at the revision read, then the next at the one answered; axe-clean", async () => {
    grantPermissions({ ipm: "write" });
    const { container } = renderPage();
    await ready();
    expect(screen.getByRole("heading", { level: 1, name: "IPM capture" })).toBeInTheDocument();
    expect(screen.getByText("Synthetic pump · QR-000123 · Version 3")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Checklist steps" });
    expect(within(nav).getByRole("button", { name: /Environment/ })).toHaveAttribute("aria-current", "step");
    expect(within(nav).getByRole("button", { name: "Function checks 1/1" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "50" } });
    expect(screen.getByText("Outside the warning range")).toBeInTheDocument();
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put.mock.calls[0]?.[0]).toBe(`/api/v1/ipm/sessions/${S}/results`);
    expect(put.mock.calls[0]?.[1]).toEqual({
      revision: 2,
      results: [
        { inputKind: "measured", templateItemId: id(1), value: "50" },
        { inputKind: "tri_state", templateItemId: id(5), outcome: "pass" },
      ],
    });
    expect(await screen.findByText(/^Saved at /)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { level: 2, name: "Electrical supply" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Not applicable"));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect((put.mock.calls[1]?.[1] as { revision: number }).revision).toBe(3);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByRole("heading", { level: 2, name: "Environment" })).toBeInTheDocument();
  });

  it("a value the server would refuse is said on the field and not sent; fixing it saves", async () => {
    grantPermissions({ ipm: "write" });
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "99" } });
    expect(screen.getByText(/is outside the possible range/)).toBeInTheDocument();
    expect(screen.getAllByText("A value needs checking before it can be saved.").length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 80));
    expect(put).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "22,5" } });
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  });

  it("the limit decides a reading's result; condition, cleanliness, performance readings and choices; a check and a text", async () => {
    grantPermissions({ ipm: "write" });
    renderPage();
    await ready();
    goTo(/Electrical safety/);
    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "45" } });
    expect(screen.getByText("Result from the limit: Good")).toBeInTheDocument();
    expect(screen.getByText("Limit: ≤ 100 µA")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Result of Chassis leakage" })).getByRole("button", { name: "Not good" }));
    expect(within(screen.getByRole("group", { name: "Result of Chassis leakage" })).getByRole("button", { name: "Not good" })).toHaveAttribute("aria-pressed", "true");

    goTo(/Physical inspection/);
    fireEvent.click(within(screen.getByRole("group", { name: "Main unit" })).getByRole("button", { name: "Minor damage" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Cleanliness of Main unit" })).getByRole("button", { name: "Clean" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Cleanliness of Main unit" })).getByRole("button", { name: "Clean" }));

    goTo(/Performance checks/);
    expect(screen.getByText("Setting: 10 mL/h")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reading 1"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("Reading 2"), { target: { value: "10" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Result of Flow" })).getByRole("button", { name: "Good" }));
    expect(screen.getByText("The readings give Not good: check before submitting.")).toBeInTheDocument();

    goTo(/Maintenance tasks/);
    fireEvent.click(within(screen.getByRole("group", { name: "Clean the unit" })).getByRole("button", { name: "Done" }));
    fireEvent.change(screen.getByLabelText("Part replaced"), { target: { value: "Fuse" } });
    await waitFor(() => {
      const body = put.mock.calls.at(-1)?.[1] as { results: { templateItemId?: string }[] };
      expect(body.results.map((r) => r.templateItemId)).toEqual([id(3), id(2), id(5), id(4), id(6), id(7)]); // print order: physical, electrical safety, function, performance, maintenance
    });
  });

  it("ad-hoc rows: added to a section, named, answered, removed", async () => {
    grantPermissions({ ipm: "write" });
    renderPage();
    await ready();
    goTo(/Tools used/);
    expect(screen.getByText("Nothing to fill in here.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a row to Tools used" }));
    fireEvent.change(screen.getByLabelText("Name of the row"), { target: { value: "Safety analyser" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Safety analyser" })).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect((put.mock.calls.at(-1)?.[1] as { results: unknown[] }).results).toContainEqual({ inputKind: "check", adHoc: { section: "tools_used", label: "Safety analyser" }, outcome: "done" }),
    );
    goTo(/Electrical safety/);
    fireEvent.click(screen.getByRole("button", { name: "Add a row to Electrical safety" }));
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "µA" } });
    goTo(/Performance checks/);
    fireEvent.click(screen.getByRole("button", { name: "Add a row to Performance checks" }));
    const rows = screen.getAllByLabelText("Name of the row");
    fireEvent.change(rows[rows.length - 1] as HTMLElement, { target: { value: "Pressure" } });
    fireEvent.change(screen.getByLabelText("Setting"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("Reference value"), { target: { value: "120 ± 5" } });
    expect(screen.getByText("Reference: 120 ± 5")).toBeInTheDocument();
    goTo(/Tools used/);
    fireEvent.click(screen.getByRole("button", { name: "Remove Safety analyser" }));
    expect(screen.queryByLabelText("Name of the row")).not.toBeInTheDocument();
  });

  it("a refused save is kept until the next change; a stale revision stops the autosave and offers a reload", async () => {
    grantPermissions({ ipm: "write" });
    put.mockRejectedValueOnce(httpError(400, "\"Room temperature\" cannot be answered that way."));
    renderPage();
    await ready();
    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "21" } });
    expect(await screen.findByText("\"Room temperature\" cannot be answered that way.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 80));
    expect(put).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));

    put.mockRejectedValueOnce(httpError(409, "This draft was saved at 10:02 (revision 6); reload it before saving.", "IPM_REVISION_CONFLICT"));
    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "22" } });
    expect(await screen.findByText("This draft was saved at 10:02 (revision 6); reload it before saving.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "23" } });
    await new Promise((r) => setTimeout(r, 80));
    expect(put).toHaveBeenCalledTimes(3);
    const reads = get.mock.calls.filter((c) => c[0] === `/api/v1/ipm/sessions/${S}`).length;
    fireEvent.click(screen.getByRole("button", { name: "Reload the draft" }));
    await waitFor(() => expect(get.mock.calls.filter((c) => c[0] === `/api/v1/ipm/sessions/${S}`).length).toBe(reads + 1));
    expect(await screen.findByRole("heading", { level: 2, name: "Environment" })).toBeInTheDocument();
  });
});

describe("P22-03 — capture: the header, the review and the submit", () => {
  it("headerChanges: only what differs (a cleared field as null)", () => {
    const base: Header = { performedAt: "2026-10-10T09:00", locationId: null, roomLabel: "", inspectionOutcome: "", maintenanceOutcome: "pass", recommendation: "", notes: "x" };
    expect(headerChanges(base, base)).toEqual({});
    expect(headerChanges({ ...base, performedAt: "2026-10-09T08:00", locationId: "w2", inspectionOutcome: "fail", maintenanceOutcome: "", recommendation: "needs_repair", notes: " " }, base)).toEqual({
      performedAt: new Date("2026-10-09T08:00").toISOString(),
      locationId: "w2",
      inspectionOutcome: "fail",
      maintenanceOutcome: null,
      recommendation: "needs_repair",
      notes: null,
    });
    expect(headerChanges({ ...base, performedAt: "" }, base)).toEqual({});
  });

  it("the header: outcomes, recommendation, notes and a room picked, PATCHed as what changed; the device's room shown kept", async () => {
    grantPermissions({ ipm: "write" });
    renderPage();
    await ready();
    goTo("Outcome and recommendation");
    expect(screen.getByText("The device's room is kept: ICU · 2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Inspection outcome"), { target: { value: "pass" } });
    fireEvent.change(screen.getByLabelText("Maintenance outcome"), { target: { value: "fail" } });
    fireEvent.change(screen.getByLabelText("Recommendation"), { target: { value: "needs_repair" } });
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Fan noisy" } });
    fireEvent.change(screen.getByLabelText("Performed at"), { target: { value: "2026-10-10T08:30" } });
    fireEvent.change(screen.getByLabelText("Another room: type its name"), { target: { value: "Wa" } });
    fireEvent.click(await screen.findByRole("button", { name: "Choose Ward B · 3" }));
    expect(screen.getByText("The device moves to Ward B · 3 when the IPM is submitted.")).toBeInTheDocument();
    // Each pause saves what changed since the last save: together, the PATCHes carry every field.
    await waitFor(() =>
      expect(Object.assign({}, ...patch.mock.calls.map((c) => c[1] as Record<string, unknown>))).toMatchObject({
        locationId: "w2",
        inspectionOutcome: "pass",
        maintenanceOutcome: "fail",
        recommendation: "needs_repair",
        notes: "Fan noisy",
        performedAt: new Date("2026-10-10T08:30").toISOString(),
      }),
    );
    expect(patch.mock.calls.at(-1)?.[0]).toBe(`/api/v1/ipm/sessions/${S}`);
  });

  it("rooms: none found, or a failed read, are said", async () => {
    grantPermissions({ ipm: "write" });
    get.mockImplementation((path: string) => (path === "/api/v1/warehouses" ? Promise.resolve(ok([])) : routes(path)));
    const { unmount } = renderPage();
    await ready();
    goTo("Outcome and recommendation");
    fireEvent.change(screen.getByLabelText("Another room: type its name"), { target: { value: "Zz" } });
    expect(await screen.findByText("No room matches.")).toBeInTheDocument();
    unmount();
    get.mockImplementation((path: string) => (path === "/api/v1/warehouses" ? Promise.reject(new Error("x")) : path === `/api/v1/calibration-devices/${DEVICE}` ? Promise.reject(new Error("y")) : routes(path)));
    renderPage();
    await ready();
    goTo("Outcome and recommendation");
    expect(screen.getByText("The device's room is kept: —")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Another room: type its name"), { target: { value: "Zz" } });
    expect(await screen.findByText("The rooms could not be read.")).toBeInTheDocument();
  });

  it("the review lists what is missing (a link to its step) and keeps Submit off; when complete, submit saves what is pending, then shows the visit and the notices", async () => {
    grantPermissions({ ipm: "write" });
    post.mockResolvedValueOnce(ok({ ...current, status: "submitted", visitNumber: 8, notices: ["Repair work order opened"], sideEffects: { notices: ["Device set to maintenance"] } }));
    renderPage();
    await ready();
    goTo("Check and submit");
    expect(screen.getByText("Still missing (3):")).toBeInTheDocument();
    expect(screen.getByText("No recommendation is chosen yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Environment: Room temperature" }));
    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "22" } });
    goTo(/Electrical safety/);
    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "45" } });
    goTo(/Physical inspection/);
    fireEvent.click(within(screen.getByRole("group", { name: "Main unit" })).getByRole("button", { name: "Good" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Cleanliness of Main unit" })).getByRole("button", { name: "Clean" }));
    goTo("Check and submit");
    expect(screen.getByText("Every required item is filled in.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByRole("heading", { level: 1, name: "IPM visit 008 submitted" })).toBeInTheDocument();
    const submitCall = post.mock.calls.find((c) => String(c[0]).endsWith("/submit"));
    const lastPut = put.mock.results.at(-1);
    expect(lastPut).toBeDefined();
    expect(submitCall?.[1]).toEqual({ revision: expect.any(Number) });
    const status = screen.getByRole("status");
    expect(within(status).getByText("Repair work order opened")).toBeInTheDocument();
    expect(within(status).getByText("Device set to maintenance")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start another IPM" })).toHaveAttribute("href", "/dashboard/ipm/new");
  });

  it("a refused submit is the server's explanation; a failed pending save stops the submit; discard", async () => {
    grantPermissions({ ipm: "write" });
    current = session({ results: [] });
    const complete = [
      ["Environment", () => fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "22" } })],
    ] as const;
    renderPage();
    await ready();
    complete[0][1]();
    goTo(/Electrical safety/);
    fireEvent.change(screen.getByLabelText("Reading"), { target: { value: "45" } });
    goTo(/Physical inspection/);
    fireEvent.click(within(screen.getByRole("group", { name: "Main unit" })).getByRole("button", { name: "Good" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Cleanliness of Main unit" })).getByRole("button", { name: "Clean" }));
    goTo(/Function checks/);
    fireEvent.click(within(screen.getByRole("group", { name: "Alarm" })).getByRole("button", { name: "Good" }));
    goTo("Outcome and recommendation");
    fireEvent.change(screen.getByLabelText("Recommendation"), { target: { value: "fit_for_use" } });
    goTo("Check and submit");
    put.mockRejectedValueOnce(httpError(400, "Results refused"));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Results refused")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText(/^Saved at /)).toBeInTheDocument());
    post.mockRejectedValueOnce(httpError(400, "Missing required items: Function checks — Alarm"));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Missing required items: Function checks — Alarm")).toBeInTheDocument();
    post.mockRejectedValueOnce(httpError(409, "Only a draft can be discarded.", "IPM_NOT_DRAFT"));
    fireEvent.click(screen.getByRole("button", { name: "Discard the draft" }));
    expect(await screen.findByText("Only a draft can be discarded.")).toBeInTheDocument();
    post.mockResolvedValueOnce(ok({ ...current, status: "discarded" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard the draft" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Draft discarded" })).toBeInTheDocument();
  });
});
