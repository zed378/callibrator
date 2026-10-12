/**
 * P22-10c2 — each field screen in its states, over a REAL store (its state set where a state is
 * hard to reach through a sync): Home's counts, notes and expiry; Settings' storage, update, wipe and
 * refusals; the capture's ad-hoc rows, photos, read-only and missing-checklist states; Register's
 * photo refusals; Scan with a camera; the outbox's labels; Sign when empty.
 */
import "./structuredClone";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MessagesProvider } from "@/i18n/MessagesProvider";
import { en } from "@/i18n/messages/en";
import { createFieldStore, type FieldState } from "../fieldStore";
import { FieldStoreProvider } from "../context";
import { HomeScreen } from "../screens/HomeScreen";
import { SettingsScreen } from "../screens/SettingsScreen";
import { CaptureScreen } from "../screens/CaptureScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { ScanScreen } from "../screens/ScanScreen";
import { OutboxScreen } from "../screens/OutboxScreen";
import { SignScreen } from "../screens/SignScreen";
import { DeviceScreen } from "../screens/DeviceScreen";
import { NOTHING_CONFIRMED, type Capture } from "../../engine/model";
import { F1, user } from "../../app/__tests__/fieldHelpers";
import { catalogueDoc, rig, sized, type Rig } from "./rig";

const codec = {
  decode: async () => ({ image: {} as CanvasImageSource, width: 10, height: 10, close: () => undefined }),
  encode: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
};

const readyStore = async (r: Rig) => {
  r.deps = { ...r.deps, photoCodec: codec };
  const s = createFieldStore(r.deps);
  await s.getState().boot();
  await s.getState().prepare(await sized(s, [F1]));
  return s;
};

const show = (store: ReturnType<typeof createFieldStore>, node: React.ReactNode) =>
  render(
    <MessagesProvider locale="en" messages={en}>
      <FieldStoreProvider store={store}>{node}</FieldStoreProvider>
    </MessagesProvider>,
  );

const capture = (over: Partial<Capture>): Capture => ({
  localId: "l1",
  kind: "ipm",
  state: "editing",
  clientRef: "c",
  dependsOn: null,
  deviceId: "d2",
  templateVersionId: "v1",
  capturedOffline: false,
  clientCapturedAt: "2026-10-12T02:00:00.000Z",
  header: {},
  results: [],
  device: null,
  photos: [],
  confirmed: NOTHING_CONFIRMED,
  attention: null,
  keyReplanned: false,
  updatedAt: 1,
  ...over,
});

beforeAll(() => {
  (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => "blob:photo";
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
});

describe("Home", () => {
  it("shows the attention count, the retry wait, another user's captures, and the offline note", async () => {
    const r = rig();
    const s = await readyStore(r);
    act(() =>
      s.setState({
        status: { outbox: 3, attention: 1, lastSyncServerAt: Date.UTC(2026, 9, 12), running: false, purged: null },
        lastReport: { sent: 1, succeeded: 0, waiting: 2, attention: 0, purged: null, sessionEnded: false, offline: false },
        othersPending: 4,
        online: false,
      } as Partial<FieldState>),
    );
    show(s, <HomeScreen />);
    expect(screen.getByText(/1 need attention/)).toBeInTheDocument();
    expect(screen.getByText("2 waiting to retry")).toBeInTheDocument();
    expect(screen.getByText(/Another user's unsynced captures remain on this phone \(4\)/)).toBeInTheDocument();
    expect(screen.getByText(en["field.home.openOnline"])).toBeInTheDocument();
    // navigator.onLine is a hint, not a fact (an emulated or captive network): "Sync now" stays
    // available and the cycle itself says whether the server answered.
    expect(screen.getByRole("button", { name: en["field.home.syncNow"] })).toBeEnabled();
    act(() => s.setState({ syncing: true }));
    expect(screen.getByRole("button", { name: /Syncing|Sync now/ })).toBeDisabled();
    act(() => s.setState({ syncing: false }));
    expect(screen.getByText(/purged in 72 h unless synced/)).toBeInTheDocument();
    act(() => s.setState({ facilities: [], lastSyncDeviceAt: null, status: null }));
    expect(screen.getByText(en["field.home.noSet"])).toBeInTheDocument();
  });
});

describe("Settings", () => {
  it("ready: the storage grant and quota, an update offered and applied, the eviction warning", async () => {
    const r = rig();
    const s = await readyStore(r);
    let applied = 0;
    act(() =>
      s.setState({
        storage: { persisted: false, usage: 5 * 1024 * 1024, quota: 100 * 1024 * 1024 },
        updateReady: true,
        status: { outbox: 1, attention: 0, lastSyncServerAt: null, running: false, purged: null },
        applyUpdate: () => ((applied += 1), true),
      } as Partial<FieldState>),
    );
    show(s, <SettingsScreen />);
    expect(screen.getByText(en["field.settings.notPersisted"])).toBeInTheDocument();
    expect(screen.getByText("5 MB used of 100 MB.")).toBeInTheDocument();
    expect(screen.getByText(en["field.settings.evictionWarning"])).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en["field.settings.updateNow"] }));
    expect(applied).toBe(1);
    act(() => s.setState({ storage: { persisted: true, usage: null, quota: null } }));
    expect(screen.getByText(en["field.settings.persisted"])).toBeInTheDocument();
    expect(screen.queryByText(/MB used/)).not.toBeInTheDocument();
  });

  it("setup: no facility to choose, a refused facility, a refused download; no user; offline", async () => {
    const r = rig();
    r.api.facilityList = [];
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    show(s, <SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: en["field.settings.chooseFacilities"] }));
    expect(await screen.findByText(en["field.settings.noFacilities"])).toBeInTheDocument();

    const r2 = rig();
    r2.api.tooLarge.add(F1);
    const s2 = createFieldStore(r2.deps);
    await s2.getState().boot();
    const { unmount } = show(s2, <SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: en["field.settings.chooseFacilities"] }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /RS Satu/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /RS Dua/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /RS Dua/ }));
    fireEvent.click(screen.getByRole("button", { name: en["field.settings.checkSize"] }));
    expect(await screen.findByText(/This selection has 2,500 devices/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en["field.settings.download"] })).toBeDisabled();
    act(() => s2.setState({ prepare: async () => "too_many" } as Partial<FieldState>));
    act(() => s2.setState({ download: { done: 3, total: 9 } }));
    expect(screen.getByText("Downloading 3 of 9 devices…")).toBeInTheDocument();
    unmount();

    const r3 = rig();
    const s3 = createFieldStore(r3.deps);
    act(() => s3.setState({ user: null, online: false, phase: "setup" }));
    const third = show(s3, <SettingsScreen />);
    expect(screen.getAllByText(en["field.settings.needsConnection"]).length).toBeGreaterThan(0);
    third.unmount();
    act(() => s3.setState({ online: true }));
    show(s3, <SettingsScreen />);
    expect(screen.getByText(en["field.settings.noUser"])).toBeInTheDocument();
  });

  it("a download that fails shows the reason", async () => {
    const r = rig();
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    r.api.failPage = 1;
    show(s, <SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: en["field.settings.chooseFacilities"] }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /RS Satu/ }));
    fireEvent.click(screen.getByRole("button", { name: en["field.settings.checkSize"] }));
    fireEvent.click(await screen.findByRole("button", { name: en["field.settings.download"] }));
    expect(await screen.findByText(en["field.settings.problem.failed"])).toBeInTheDocument();
  });

  it("the wipe: refused offline, or by the server, with the reason", async () => {
    const r = rig();
    r.api.me = user({ roleLevel: 8 });
    const { openRegistry } = await import("../../platform/registryStore");
    const reg = await openRegistry(r.idb, r.flags);
    await reg.put({ key: `${user().tenantId}:other`, outboxCount: 0, workingSetPresent: false, lastSyncServerAt: null });
    reg.close();
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    show(s, <SettingsScreen />);
    fireEvent.click(screen.getByRole("button", { name: en["field.wipe.show"] }));
    fireEvent.click(await screen.findByRole("button", { name: "Wipe the data of other user 1" }));
    act(() => s.setState({ online: false }));
    expect(screen.getAllByText(en["field.wipe.refused.offline"]).length).toBeGreaterThan(0);
    act(() => s.setState({ online: true }));
    r.api.wipeFails = true;
    fireEvent.change(screen.getByLabelText(en["field.wipe.confirmLabel"]), { target: { value: "WIPE" } });
    fireEvent.click(screen.getByRole("button", { name: en["field.wipe.confirm"] }));
    expect(await screen.findByText(en["field.wipe.refused.not_recorded"])).toBeInTheDocument();
  });
});

describe("Capture", () => {
  const withItems = (r: Rig): Rig => {
    r.api.catalogueDoc = {
      ...catalogueDoc,
      versions: [
        {
          ...catalogueDoc.versions[0],
          items: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              itemDefinitionId: "00000000-0000-4000-8000-000000000101",
              origin: "base",
              section: "environment",
              label: "Room temperature",
              inputKind: "measured",
              unit: "°C",
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
              validMin: "-10",
              validMax: "60",
              warnMin: null,
              warnMax: null,
              allowedOutcomes: [],
              required: false,
              sortOrder: 1,
            },
          ],
        },
      ],
    };
    return r;
  };

  it("adds, edits and removes an ad-hoc row; a value out of range holds the submit; photos are added, shown and removed", async () => {
    const r = withItems(rig());
    const s = await readyStore(r);
    const localId = await s.getState().createCapture({ kind: "ipm", deviceId: "d2", templateVersionId: "v1", header: { performedAt: "2026-10-12T02:00:00.000Z" } });
    show(s, <CaptureScreen localId={localId} />);
    fireEvent.change(screen.getByLabelText(/Reading/), { target: { value: "99" } });
    const toolsStep = screen.getByRole("button", { name: new RegExp(`\\d+\\. ${en["ipmCatalogue.section.tools_used"]}`) });
    fireEvent.click(toolsStep);
    fireEvent.click(screen.getByRole("button", { name: /Add a row to/ }));
    fireEvent.change(await screen.findByLabelText(en["ipm.capture.adHoc.label"]), { target: { value: "Analyser" } });
    fireEvent.click(screen.getByRole("button", { name: /Add a row to/ }));
    expect(screen.getAllByLabelText(en["ipm.capture.adHoc.label"])).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /Remove/ })[1] as HTMLElement);
    expect(screen.getAllByLabelText(en["ipm.capture.adHoc.label"])).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /\d+\. Check and submit/ }));
    expect(screen.getByText(en["ipm.capture.problemsHold"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en["field.capture.submit"] })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /\d+\. Outcome and recommendation/ }));
    fireEvent.change(screen.getByLabelText(en["field.capture.performedAt"]), { target: { value: "2026-10-12T09:30" } });
    fireEvent.change(screen.getByLabelText(en["field.device.room"]), { target: { value: "r1" } });
    fireEvent.change(screen.getByLabelText(en["field.capture.inspectionOutcome"]), { target: { value: "pass" } });
    const file = new File([new Uint8Array([1, 2])], "p.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText(en["field.photo.add"]), { target: { files: [file] } });
    expect(await screen.findByRole("img", { name: "Photo 1" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("img", { name: "Photo 1" }).tagName).toBe("IMG"));
    fireEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "Photo 1" })).not.toBeInTheDocument());

    const big = new File([new Uint8Array(1)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 30 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText(en["field.photo.add"]), { target: { files: [big] } });
    expect(await screen.findByText(en["field.photo.refused.too_large"])).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: en["field.capture.previous"] }));
    // Every change was written through, in order: the last write carries both header fields.
    await waitFor(() => expect(s.getState().captures.find((c) => c.localId === localId)?.header).toMatchObject({ locationId: "r1", inspectionOutcome: "pass" }));
  });

  it("a capture no longer editing is read-only; one whose checklist is not on the phone says so; a registration is not a capture", async () => {
    const r = withItems(rig());
    const s = await readyStore(r);
    act(() => s.setState({ captures: [capture({ state: "submitted_local", capturedOffline: true, header: { performedAt: "bad" } })] }));
    const first = show(s, <CaptureScreen localId="l1" />);
    expect(screen.getByText(en["field.capture.readOnly"])).toBeInTheDocument();
    expect(screen.getByText(en["field.capture.offlineClaim"])).toBeInTheDocument();
    first.unmount();
    act(() => s.setState({ captures: [capture({ templateVersionId: "v9", deviceId: null })] }));
    const second = show(s, <CaptureScreen localId="l1" />);
    expect(screen.getByText(en["field.capture.noCatalogue"])).toBeInTheDocument();
    second.unmount();
    act(() => s.setState({ captures: [capture({ kind: "device", device: { name: "X" } })] }));
    show(s, <CaptureScreen localId="l1" />);
    expect(screen.getByRole("heading", { level: 1, name: en["field.capture.missingTitle"] })).toBeInTheDocument();
  });
});

describe("Register, Scan, Device, Outbox, Sign", () => {
  it("register: a photo refused is listed after saving; without a checklist the IPM cannot start", async () => {
    const r = rig();
    const s = await readyStore(r);
    show(s, <RegisterScreen />);
    fireEvent.change(screen.getByLabelText(/Device name/), { target: { value: "Pump" } });
    fireEvent.change(screen.getByLabelText(/Facility/), { target: { value: F1 } });
    fireEvent.change(screen.getByLabelText(en["field.register.room"]), { target: { value: "r1" } });
    const big = new File([new Uint8Array(1)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 30 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText(en["field.register.photoFront"]), { target: { files: [big] } });
    fireEvent.change(screen.getByLabelText(en["field.register.photoPlate"]), { target: { files: [] } });
    fireEvent.submit(screen.getByRole("button", { name: en["field.register.save"] }).closest("form") as HTMLFormElement);
    expect(await screen.findByText(en["field.photo.refused.too_large"])).toBeInTheDocument();
    expect(screen.getByText(en["field.device.noChecklist"])).toBeInTheDocument();
  });

  it("register: an empty form does not save", async () => {
    const r = rig();
    const s = await readyStore(r);
    show(s, <RegisterScreen />);
    fireEvent.submit(screen.getByRole("button", { name: en["field.register.save"] }).closest("form") as HTMLFormElement);
    expect(s.getState().captures).toEqual([]);
  });

  it("scan: with a camera the scanner opens and closes", async () => {
    const r = rig();
    const s = await readyStore(r);
    (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class {
      detect = async () => [];
    };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => new Promise(() => undefined) } });
    try {
      show(s, <ScanScreen />);
      fireEvent.click(screen.getByRole("button", { name: en["field.scan.camera"] }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: en["ipm.close"] }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(en["field.scan.codeLabel"]), { target: { value: "UNKNOWN" } });
      fireEvent.click(screen.getByRole("button", { name: en["field.scan.find"] }));
      expect(await screen.findByText(en["field.scan.notFound"])).toBeInTheDocument();
    } finally {
      delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector;
      delete (navigator as { mediaDevices?: unknown }).mediaDevices;
    }
  });

  it("device: a known device with a maker, a room, a condition and a last IPM", async () => {
    const r = rig();
    const s = await readyStore(r);
    const d = { ...s.getState().index.devices[0], manufacturer: "Acme", model: "M1", locationId: "r1", condition: "not_good", lastIpm: { performedAt: "2026-10-01T00:00:00.000Z", visitNumber: 4 } };
    const { indexWorkingSet } = await import("../../app/workingSet");
    act(() => s.setState({ index: indexWorkingSet([d as never]) }));
    show(s, <DeviceScreen id={d.id as string} />);
    expect(screen.getByText("Acme M1")).toBeInTheDocument();
    expect(screen.getByText("Radiologi")).toBeInTheDocument();
    expect(screen.getByText("Not good")).toBeInTheDocument();
    expect(screen.getByText(/Visit 4/)).toBeInTheDocument();
  });

  it("outbox: a registration, an IPM waiting for it, one in editing, one synced", async () => {
    const r = rig();
    const s = await readyStore(r);
    act(() =>
      s.setState({
        captures: [
          capture({ localId: "reg", kind: "device", device: { name: "Syringe pump" }, deviceId: null }),
          capture({ localId: "reg2", kind: "device", device: null, deviceId: null, state: "synced" }),
          capture({ localId: "ipm", dependsOn: "reg", deviceId: null, state: "submitted_local" }),
          capture({ localId: "edit", deviceId: "d1", attention: { status: 409, code: "IPM_REVISION_CONFLICT", message: "changed", draftId: null, opKind: "header", previousState: "editing" } }),
        ],
      }),
    );
    show(s, <OutboxScreen />);
    expect(screen.getByText(/Device registration: Syringe pump/)).toBeInTheDocument();
    expect(screen.getByText(/Device registration: New device/)).toBeInTheDocument();
    expect(screen.getByText(en["field.outbox.waitsForDevice"])).toBeInTheDocument();
    expect(screen.getByText(/IPM: Pump d1/)).toBeInTheDocument();
    expect(screen.getByText("Server: changed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en["field.outbox.continue"] })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en["field.action.keep_mine"] })).toBeInTheDocument();
  });

  it("sign: none yet", async () => {
    const r = rig();
    const s = await readyStore(r);
    show(s, <SignScreen />);
    expect(screen.getByText(en["field.sign.empty"])).toBeInTheDocument();
    act(() => s.setState({ submitted: [{ id: "x", deviceId: "unknown", performedAt: null, visitNumber: null }] }));
    expect(screen.getByText(/Device — visit —/)).toBeInTheDocument();
  });
});
