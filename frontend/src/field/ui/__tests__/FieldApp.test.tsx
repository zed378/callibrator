/**
 * P22-10c2 — the `/field` app's screens, rendered over the REAL store and runtime (encrypted
 * `fake-indexeddb`, node WebCrypto, the engine) with the engine's fake server and a fake field API
 * (P19-08 § 3, § 9.6, § 11, § 12):
 *  - setup: Settings is the screen; choose the facility, sizes BEFORE the download, download;
 *  - every screen: one `<main>`, one `<h1>` focused on arrival, the outbox count in the header, no
 *    axe violation (contrast is the browser suite's);
 *  - scan → device → start IPM → the stepper (answer, header, review with what is missing) →
 *    submit → the outbox → synced to the fake server;
 *  - the outbox: a server refusal explained by its code, its action, a discard that needs DISCARD;
 *  - register a device (queued), then start its IPM (it waits for the registration);
 *  - sign: online links to the report page; offline it says it needs a connection;
 *  - settings when ready: turning off refused with an outbox; an administrator sees the wipe;
 *    a browser below the floor is told what it lacks; offline with no data.
 */
import "./structuredClone";
import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { axeViolations } from "@/tests/a11y/axe";
import { FieldApp, warmUp } from "../FieldApp";
import { go } from "../nav";
import { F1, F2, user } from "../../app/__tests__/fieldHelpers";
import { catalogueDoc, rig, type Rig } from "./rig";

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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

const withChecklist = (r: Rig): Rig => {
  r.api.catalogueDoc = { ...catalogueDoc, versions: [{ ...catalogueDoc.versions[0], items: [item(1, { label: "Alarm test" })] }] };
  return r;
};

const mount = (r: Rig) =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <FieldApp deps={() => r.deps} />
    </MessagesProvider>,
  );

const heading = async (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });

const oneMainOneH1 = () => {
  expect(document.querySelectorAll("main")).toHaveLength(1);
  expect(document.querySelectorAll("h1")).toHaveLength(1);
};

/** Settings → choose → size → download. */
const prepare = async (r: Rig, facilityName = "RS Satu") => {
  void r;
  fireEvent.click(await screen.findByRole("button", { name: en["field.settings.chooseFacilities"] }));
  fireEvent.click(await screen.findByRole("checkbox", { name: new RegExp(facilityName) }));
  fireEvent.click(screen.getByRole("button", { name: en["field.settings.checkSize"] }));
  await screen.findByText(/2 devices|1 devices/);
  fireEvent.click(screen.getByRole("button", { name: en["field.settings.download"] }));
  // Ready: the app leaves Settings for Home (the route had no view of its own).
  await screen.findByRole("heading", { level: 1, name: en["field.home.title"] });
};

beforeEach(() => {
  window.history.replaceState(null, "", "/field");
});

describe("setup and the shell", () => {
  it("opens on Settings, sizes before the download, then is ready; every screen keeps one main and one focused h1", async () => {
    const r = rig();
    const { container } = mount(r);
    expect(await heading(en["field.settings.title"])).toHaveFocus();
    oneMainOneH1();
    expect(await axeViolations(container)).toEqual([]);
    await prepare(r);
    expect(r.api.pageReads).toBe(1);
    expect(await axeViolations(container)).toEqual([]);

    for (const [view, title] of [
      ["home", en["field.home.title"]],
      ["scan", en["field.scan.title"]],
      ["outbox", en["field.outbox.title"]],
      ["sign", en["field.sign.title"]],
      ["register", en["field.register.title"]],
    ] as const) {
      act(() => go(view));
      expect(await heading(title)).toHaveFocus();
      oneMainOneH1();
      expect(await axeViolations(container)).toEqual([]);
    }
    expect(screen.getByRole("link", { name: /Outbox: 0/ })).toBeInTheDocument();
    expect(screen.getByText(en["field.online"])).toBeInTheDocument();
  });

  it("the nav moves by pushState and back works without a request; an error can be dismissed", async () => {
    const r = rig();
    mount(r);
    await prepare(r);
    const nav = screen.getByRole("navigation", { name: en["field.nav.label"] });
    fireEvent.click(within(nav).getByRole("link", { name: en["field.nav.scan"] }));
    await heading(en["field.scan.title"]);
    expect(window.location.search).toBe("?view=scan");
    fireEvent.click(screen.getByRole("link", { name: /Outbox: 0/ }));
    await heading(en["field.outbox.title"]);
    act(() => {
      window.history.back();
    });
    await waitFor(() => expect(window.location.search).toBe("?view=scan"));
    await heading(en["field.scan.title"]);

    r.api.submitted = async () => {
      throw new Error("down");
    };
    act(() => go("home"));
    fireEvent.click(await screen.findByRole("button", { name: en["field.home.syncNow"] }));
    expect(await screen.findByText(en["field.error.sync"])).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en["field.error.dismiss"] }));
    expect(screen.queryByText(en["field.error.sync"])).not.toBeInTheDocument();
  });

  it("offline with no data, and a browser below the floor, say so", async () => {
    const r = rig();
    r.globals.online = false;
    mount(r);
    await heading(en["field.offlineEmpty.title"]);
    oneMainOneH1();

    const r2 = rig({ serviceWorker: undefined, caches: undefined });
    const { unmount } = render(
      <MessagesProvider locale="en" messages={en}>
        <FieldApp deps={() => r2.deps} />
      </MessagesProvider>,
    );
    expect(await screen.findByText(/Missing: Service Worker, Cache Storage/)).toBeInTheDocument();
    unmount();
  });

  it("the window's online/offline events and visibility move the badge and trigger a sync", async () => {
    const r = rig();
    mount(r);
    await prepare(r);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText(en["field.offline"])).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(await screen.findByText(en["field.online"])).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(screen.queryByText(en["field.home.syncing"])).not.toBeInTheDocument());
  });
});

describe("scan → device → capture → outbox", () => {
  it("finds by QR, starts an IPM, answers, reviews, submits; the outbox syncs it to the server", async () => {
    const r = withChecklist(rig());
    mount(r);
    await prepare(r);
    act(() => go("scan"));
    await heading(en["field.scan.title"]);
    fireEvent.change(screen.getByLabelText(en["field.scan.codeLabel"]), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: en["field.scan.find"] }));
    fireEvent.click(await screen.findByRole("link", { name: /Pump d2/ }));
    await heading("Pump d2");
    fireEvent.click(screen.getByRole("button", { name: en["field.device.start"] }));
    await heading(/IPM: Pump d2/);

    // The review says what is missing; the submit waits for it.
    fireEvent.click(screen.getByRole("button", { name: /\d+\. Check and submit/ }));
    expect(await screen.findByText(/Alarm test/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en["field.capture.submit"] })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: new RegExp(`\\d+\\. ${en["ipmCatalogue.section.function"]}`) }));
    fireEvent.click(await screen.findByRole("button", { name: en["ipmCatalogue.outcome.pass"] }));
    fireEvent.click(screen.getByRole("button", { name: /\d+\. Outcome and recommendation/ }));
    fireEvent.change(await screen.findByLabelText(en["field.capture.notes"]), { target: { value: "ok" } });
    fireEvent.change(screen.getByLabelText(en["field.capture.recommendation"]), { target: { value: "fit_for_use" } });
    // The server refuses a submit without the two results (assertComplete): the review says so first.
    fireEvent.click(screen.getByRole("button", { name: /\d+\. Check and submit/ }));
    expect(await screen.findByText(en["field.capture.headerMissing"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en["field.capture.submit"] })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /\d+\. Outcome and recommendation/ }));
    fireEvent.change(await screen.findByLabelText(en["field.capture.inspectionOutcome"]), { target: { value: "pass" } });
    fireEvent.change(screen.getByLabelText(en["field.capture.maintenanceOutcome"]), { target: { value: "pass" } });
    fireEvent.click(screen.getByRole("button", { name: en["field.capture.next"] }));
    await waitFor(() => expect(screen.getByRole("button", { name: en["field.capture.submit"] })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: en["field.capture.submit"] }));

    await heading(en["field.outbox.title"]);
    await waitFor(() => expect([...r.server.sessions.values()].map((x) => x.status)).toEqual(["submitted"]));
    const session = [...r.server.sessions.values()][0];
    expect(session?.header).toMatchObject({ notes: "ok", recommendation: "fit_for_use", inspectionOutcome: "pass", maintenanceOutcome: "pass" });
    expect(session?.results).toEqual([{ inputKind: "tri_state", templateItemId: id(1), outcome: "pass" }]);
  });

  it("a device without a checklist says so; a device not in the set says so; resume opens the open capture", async () => {
    const r = withChecklist(rig());
    mount(r);
    await prepare(r);
    act(() => go("device", { id: "d1" }));
    await heading("Pump d1");
    expect(screen.getByText(en["field.device.noChecklist"])).toBeInTheDocument();
    act(() => go("device", { id: "nope" }));
    await heading(en["field.device.missingTitle"]);
    act(() => go("device", { id: "d2" }));
    fireEvent.click(await screen.findByRole("button", { name: en["field.device.start"] }));
    await heading(/IPM: Pump d2/);
    act(() => go("device", { id: "d2" }));
    fireEvent.click(await screen.findByRole("link", { name: en["field.device.resume"] }));
    await heading(/IPM: Pump d2/);
    act(() => go("capture", { ref: "nope" }));
    await heading(en["field.capture.missingTitle"]);
  });

  it("search by name; an unknown code offline offers registration", async () => {
    const r = rig();
    mount(r);
    await prepare(r);
    act(() => go("scan"));
    fireEvent.change(await screen.findByLabelText(en["field.scan.searchLabel"]), { target: { value: "pump d1" } });
    expect(await screen.findByRole("link", { name: /Pump d1/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(en["field.scan.searchLabel"]), { target: { value: "" } });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    fireEvent.change(screen.getByLabelText(en["field.scan.codeLabel"]), { target: { value: "ZZZ" } });
    fireEvent.click(screen.getByRole("button", { name: en["field.scan.find"] }));
    expect(await screen.findByText(en["field.scan.notOffline"])).toBeInTheDocument();
    expect(screen.getByText(en["field.scan.noCamera"])).toBeInTheDocument();
  });

  it("a refusal is explained by its code with its action; a discard needs DISCARD typed", async () => {
    const r = withChecklist(rig());
    mount(r);
    await prepare(r);
    r.server.existingDraftFor = "ses-99";
    r.server.sessions.set("ses-99", { id: "ses-99", deviceId: "d2", clientRef: "x", revision: 0, status: "draft", header: {}, results: [], photos: [] });
    act(() => go("device", { id: "d2" }));
    fireEvent.click(await screen.findByRole("button", { name: en["field.device.start"] }));
    await heading(/IPM: Pump d2/);
    act(() => go("home"));
    fireEvent.click(await screen.findByRole("button", { name: en["field.home.syncNow"] }));
    act(() => go("outbox"));
    expect(await screen.findByText(en["field.conflict.IPM_DRAFT_EXISTS"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en["field.action.use_server_draft"] })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en["field.outbox.discard"] }));
    const confirm = screen.getByRole("button", { name: en["field.outbox.discardNow"] });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(en["field.outbox.discardConfirm"]), { target: { value: "DISCARD" } });
    fireEvent.click(confirm);
    expect(await screen.findByText(en["field.outbox.empty"])).toBeInTheDocument();
  });
});

describe("register, sign, settings", () => {
  it("registers a device on the phone and starts its IPM, which waits for the registration", async () => {
    const r = withChecklist(rig());
    mount(r);
    await prepare(r);
    act(() => go("register"));
    await heading(en["field.register.title"]);
    expect(screen.getByRole("button", { name: en["field.register.save"] })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Device name/), { target: { value: "Syringe pump" } });
    fireEvent.change(screen.getByLabelText(/QR code on the sticker/), { target: { value: "RS000900" } });
    fireEvent.change(screen.getByLabelText(/Facility/), { target: { value: F1 } });
    fireEvent.change(screen.getByLabelText(en["field.register.type"]), { target: { value: "type-1" } });
    fireEvent.change(screen.getByLabelText(en["field.device.condition"]), { target: { value: "good" } });
    fireEvent.click(screen.getByRole("button", { name: en["field.register.save"] }));
    await heading(en["field.register.savedTitle"]);
    fireEvent.click(screen.getByRole("button", { name: en["field.register.startIpm"] }));
    await heading(en["field.capture.title"]);
    act(() => go("outbox"));
    await heading(en["field.outbox.title"]);
    await waitFor(() => expect(r.server.devices.size).toBe(1));
    const created = [...r.server.devices.values()][0];
    expect(created?.body).toMatchObject({ name: "Syringe pump", qrCode: "RS000900", clientFacilityId: F1, deviceTypeId: "type-1", condition: "good" });
  });

  it("a bound user has no QR field and no facility choice", async () => {
    const r = rig();
    r.api.me = user({ clientFacilityId: F1 });
    mount(r);
    fireEvent.click(await screen.findByRole("button", { name: en["field.settings.chooseFacilities"] }));
    expect(await screen.findByRole("checkbox", { name: /RS Satu/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: en["field.settings.checkSize"] }));
    fireEvent.click(await screen.findByRole("button", { name: en["field.settings.download"] }));
    await heading(en["field.home.title"]);
    act(() => go("register"));
    await heading(en["field.register.title"]);
    expect(screen.queryByLabelText(/QR code on the sticker/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Facility/)).not.toBeInTheDocument();
  });

  it("sign: online, each visit links to its report page; offline, it needs a connection", async () => {
    const r = rig();
    r.api.submittedVisits = [{ id: "ses-7", deviceId: "d1", performedAt: "2026-10-12T02:00:00.000Z", visitNumber: 3 }];
    mount(r);
    await prepare(r);
    act(() => go("home"));
    fireEvent.click(await screen.findByRole("button", { name: en["field.home.syncNow"] }));
    act(() => go("sign"));
    const link = await screen.findByRole("link", { name: /Open the report of Pump d1 — visit 3/ });
    expect(link).toHaveAttribute("href", "/dashboard/ipm/sessions/ses-7/report");
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(await screen.findByText(en["field.sign.needsConnection"])).toBeInTheDocument();
  });

  it("settings when ready: turning off is refused with an outbox; an administrator sees the wipe; another user's data blocks setup", async () => {
    const r = withChecklist(rig());
    r.api.me = user({ roleLevel: 8, roleName: "TENANT_ADMIN" });
    mount(r);
    await prepare(r);
    act(() => go("device", { id: "d2" }));
    fireEvent.click(await screen.findByRole("button", { name: en["field.device.start"] }));
    await heading(/IPM: Pump d2/);
    act(() => go("settings"));
    fireEvent.click(await screen.findByRole("button", { name: en["field.settings.turnOff"] }));
    expect(await screen.findByText(/1 items are not synced/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en["field.wipe.show"] }));
    expect(await screen.findByText(en["field.wipe.none"])).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: en["field.install.title"] })).toBeInTheDocument();
  });

  it("another user's unsynced data blocks enabling, and the administrator wipes it after typing WIPE", async () => {
    const r = rig();
    const { openRegistry } = await import("../../platform/registryStore");
    const reg = await openRegistry(r.idb, r.flags);
    await reg.put({ key: `${user().tenantId}:other`, outboxCount: 2, workingSetPresent: false, lastSyncServerAt: null });
    reg.close();
    r.api.me = user({ roleLevel: 8, roleName: "TENANT_ADMIN" });
    mount(r);
    expect(await screen.findByText(en["field.settings.blocked"])).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en["field.wipe.show"] }));
    fireEvent.click(await screen.findByRole("button", { name: "Wipe the data of other user 1" }));
    const confirm = screen.getByRole("button", { name: en["field.wipe.confirm"] });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(en["field.wipe.confirmLabel"]), { target: { value: "WIPE" } });
    fireEvent.click(confirm);
    expect(await screen.findByText("Wiped and recorded: 0 captures, 0 photos.")).toBeInTheDocument();
    expect(r.api.wipes).toEqual([{ wipedUserId: "other", captures: 0, photos: 0 }]);
    expect(await screen.findByRole("button", { name: en["field.settings.chooseFacilities"] })).toBeInTheDocument();
    void F2;
  });
});

describe("the warm-up (P19-08 § 4.3)", () => {
  it("does nothing until the worker controls the page; then loads every lazy screen and fetches the static files through it", async () => {
    expect(await warmUp()).toBe(0);
    const fetchMock = jest.fn(async () => new Response(""));
    const originalFetch = globalThis.fetch;
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { controller: {} } });
    (globalThis as { fetch: unknown }).fetch = fetchMock;
    try {
      // jsdom has no resource timing: no entry to warm.
      expect(await warmUp()).toBe(0);
      (performance as { getEntriesByType?: unknown }).getEntriesByType = () => [{ name: "http://localhost/_next/static/chunks/x.js" }];
      expect(await warmUp()).toBe(1);
      expect(fetchMock).toHaveBeenCalledWith("http://localhost/_next/static/chunks/x.js", { credentials: "same-origin" });
    } finally {
      delete (performance as { getEntriesByType?: unknown }).getEntriesByType;
      (globalThis as { fetch: unknown }).fetch = originalFetch;
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });
});
