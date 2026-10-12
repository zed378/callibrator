/** @jest-environment node */
/**
 * P22-10c2 — the field app's store over the REAL runtime (encrypted IndexedDB via `fake-indexeddb`,
 * node WebCrypto, the engine) with the engine's fake server and a fake field API built on the
 * contract's key list (P19-08 § 3.3, § 7.2, § 9, § 10, § 11):
 *  - boot: online and not enabled → setup; enabled → ready, profile stored, a first sync; offline →
 *    the registry's user opened from its stored profile, nothing asked of the server; offline with
 *    nothing → offline_empty; a browser without IndexedDB or Web Crypto → setup / offline_empty; a
 *    verify refused → setup with the error; a verify without an answer → the offline path;
 *  - prepare: the facility rule, another user's data blocks, the download fills the index, the
 *    rooms, the catalogue, the facilities; a failed download keeps nothing;
 *  - capture lifecycle through the store: create, edit, photo (refused when too large), submit →
 *    synced on the fake server; discard; attention resolved;
 *  - sync: a changed fingerprint purges and re-downloads the stored choice; the catalogue refreshed
 *    with If-None-Match; the "to sign" list read; an offline cycle marks offline;
 *  - turning off refused with an outbox, allowed without (worker unregistered); the wipe; QR lookup
 *    local first, then online.
 */
import { openRegistry } from "../../platform/registryStore";
import { openFieldStore } from "../../platform/idbStore";
import { createFieldStore } from "../fieldStore";
import { crypto, device, F1, F2, TENANT, user } from "../../app/__tests__/fieldHelpers";
import { idle, rig, sized, type Rig } from "./rig";

describe("boot", () => {
  it("online, offline mode not on → setup; a browser without IndexedDB → setup (online) / offline_empty (offline)", async () => {
    const r = rig();
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    expect(s.getState()).toMatchObject({ phase: "setup", online: true, user: { id: user().id } });

    const r2 = rig({ indexedDB: undefined });
    const s2 = createFieldStore(r2.deps);
    await s2.getState().boot();
    expect(s2.getState()).toMatchObject({ phase: "setup", missing: ["IndexedDB"] });
    r2.globals.online = false;
    const s3 = createFieldStore(r2.deps);
    await s3.getState().boot();
    expect(s3.getState().phase).toBe("offline_empty");
  });

  it("a refused verify → setup with the error; no answer at all → the offline path", async () => {
    const r = rig();
    r.api.whoAmI = async () => {
      throw new Error("refused");
    };
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    expect(s.getState()).toMatchObject({ phase: "setup", error: { key: "verify", detail: "refused" } });

    const { AxiosError } = await import("axios");
    r.api.whoAmI = async () => {
      throw new AxiosError("Network Error", "ERR_NETWORK");
    };
    const s2 = createFieldStore(r.deps);
    await s2.getState().boot();
    expect(s2.getState()).toMatchObject({ phase: "offline_empty", online: false });
  });

  it("prepare, then boot again online (ready + first sync) and offline (the stored profile, nothing sent)", async () => {
    const r = rig();
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    expect(await s.getState().prepare(await sized(s, [F1]))).toBeNull();
    expect(r.worker.registered).toBe(1);
    expect(s.getState()).toMatchObject({ phase: "ready", download: null });
    expect(s.getState().index.devices).toHaveLength(2);
    expect(s.getState().catalogue?.deviceTypes).toHaveLength(1);
    expect(s.getState().rooms).toEqual(r.api.roomList);
    expect(s.getState().facilities.map((f) => f.id)).toEqual([F1]);
    expect(s.getState().lastSyncDeviceAt).toBe(r.globals.now());
    s.getState().close();

    const again = createFieldStore(r.deps);
    await again.getState().boot();
    await idle(again);
    expect(again.getState()).toMatchObject({ phase: "ready", syncing: false });
    expect(again.getState().lastReport?.offline).toBe(false);
    expect(r.api.submittedFor).toEqual([user().id]);
    again.getState().close();

    r.globals.online = false;
    const offline = createFieldStore(r.deps);
    await offline.getState().boot();
    expect(offline.getState()).toMatchObject({ phase: "ready", online: false, user: { id: user().id, tenantId: TENANT, roleLevel: 3, clientFacilityId: null } });
    expect(offline.getState().index.devices).toHaveLength(2);
    offline.getState().close();
  });

  it("offline with a registry row but no stored profile opens with an empty profile", async () => {
    const r = rig();
    const reg = await openRegistry(r.idb, r.flags);
    await reg.put({ key: `${TENANT}:u9`, outboxCount: 0, workingSetPresent: false, lastSyncServerAt: null });
    reg.close();
    r.globals.online = false;
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    expect(s.getState().user).toMatchObject({ id: "u9", roleLevel: 0, clientFacilityId: null, scopeFingerprint: "" });
    s.getState().close();
  });
});

describe("prepare", () => {
  it("applies the facility rule, refuses with another user's data, and keeps nothing after a failed download", async () => {
    const r = rig();
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    expect(await s.getState().prepare([])).toBe("none_chosen");

    const other = await openRegistry(r.idb, r.flags);
    await other.put({ key: `${TENANT}:other`, outboxCount: 2, workingSetPresent: false, lastSyncServerAt: null });
    other.close();
    expect(await s.getState().prepare(await sized(s, [F1]))).toBe("blocked");
    expect(s.getState().blockedByOther).toBe(true);

    const r2 = rig();
    const s2 = createFieldStore(r2.deps);
    await s2.getState().boot();
    r2.api.failPage = 1;
    expect(await s2.getState().prepare(await sized(s2, [F1]))).toBe("failed");
    expect(s2.getState()).toMatchObject({ error: { key: "download" }, download: null });
    expect(s2.getState().index.devices).toHaveLength(0);
    s2.getState().close();
  });

  it("no user → failed; facility and size reads that fail are reported", async () => {
    const r = rig();
    const s = createFieldStore(r.deps);
    expect(await s.getState().prepare([])).toBe("failed");
    expect(await s.getState().listFacilities()).toEqual([]);
    await s.getState().boot();
    r.api.facilities = async () => {
      throw new Error("down");
    };
    expect(await s.getState().listFacilities()).toEqual([]);
    expect(s.getState().error?.key).toBe("facilities");
    r.api.facilitySize = async () => {
      throw new Error("down");
    };
    expect(await s.getState().size([{ id: F1, name: "x", code: "x", status: "active" }])).toEqual([]);
    expect(s.getState().error?.key).toBe("size");
  });
});

describe("captures, sync and turning off", () => {
  const ready = async (r: Rig) => {
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    await s.getState().prepare(await sized(s, [F1]));
    return s;
  };

  it("an IPM captured, photographed and submitted reaches the server once synced; turning off then works", async () => {
    const r = rig();
    const s = await ready(r);
    const localId = await s.getState().createCapture({ kind: "ipm", deviceId: "d2", templateVersionId: "v1", header: { performedAt: "2026-10-12T02:00:00.000Z" } });
    await s.getState().editCapture(localId, { results: [{ inputKind: "text", templateItemId: "i1", text: "ok" }] });
    const big = new File([new Uint8Array(1)], "a.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });
    expect(await s.getState().addPhoto(localId, big, "ipm_evidence")).toBe("too_large");
    expect(await s.getState().turnOff()).toEqual({ refused: true, pending: 1 });
    await s.getState().submit(localId);
    await idle(s);
    await s.getState().syncNow("test");
    expect([...r.server.sessions.values()].map((x) => x.status)).toEqual(["submitted"]);
    // Synced, re-read, removed: the visit is now in the "to sign" list.
    expect(s.getState().captures).toEqual([]);
    expect(await s.getState().turnOff()).toEqual({ refused: false, pending: 0 });
    expect(r.worker.unregistered).toBe(1);
    expect(s.getState().phase).toBe("setup");
    expect(await s.getState().syncNow("after")).toBeNull();
  });

  it("an attention is resolved through the store; a discard removes a capture the server never saw", async () => {
    const r = rig();
    const s = await ready(r);
    r.server.existingDraftFor = "ses-99";
    r.server.sessions.set("ses-99", { id: "ses-99", deviceId: "d2", clientRef: "x", revision: 0, status: "draft", header: {}, results: [], photos: [] });
    const localId = await s.getState().createCapture({ kind: "ipm", deviceId: "d2", templateVersionId: "v1" });
    await s.getState().submit(localId);
    await idle(s);
    await s.getState().syncNow("x");
    expect(s.getState().captures[0]?.attention?.code).toBe("IPM_DRAFT_EXISTS");
    await s.getState().resolve(localId, "use_server_draft");
    await idle(s);
    await s.getState().syncNow("y");
    expect(r.server.sessions.get("ses-99")?.status).toBe("submitted");

    const other = await s.getState().createCapture({ kind: "ipm", deviceId: "d1", templateVersionId: "v1" });
    r.globals.online = false;
    r.server.up = false;
    await s.getState().discard(other);
    expect(s.getState().captures).toEqual([]);
    s.getState().close();
  });

  it("a changed scope fingerprint purges and re-downloads the stored choice; the catalogue keeps its ETag", async () => {
    const r = rig();
    const s = await ready(r);
    r.server.fingerprint = "fp-2";
    r.api.me = user({ scopeFingerprint: "fp-2" });
    await s.getState().syncNow("x");
    await s.getState().syncNow("y");
    expect(s.getState().index.devices).toHaveLength(2);
    expect(r.api.catalogueCalls.slice(-1)).toEqual(['"cat-1"']);
    s.getState().close();
  });

  it("a bound user moved to another facility re-downloads its NEW facility", async () => {
    const r = rig();
    r.api.me = user({ clientFacilityId: F1 });
    const s = await ready(r);
    expect(s.getState().facilities.map((f) => f.id)).toEqual([F1]);
    r.api.me = user({ clientFacilityId: F2, scopeFingerprint: "fp-2" });
    r.server.fingerprint = "fp-2";
    await s.getState().syncNow("moved");
    expect(s.getState().index.devices.map((d) => d.id)).toEqual(["e1"]);
    s.getState().close();
  });

  it("an offline cycle marks the app offline; a cycle that throws is reported; one cycle at a time", async () => {
    const r = rig();
    const s = await ready(r);
    r.server.up = false;
    const report = await s.getState().syncNow("x");
    expect(report?.offline).toBe(true);
    expect(s.getState().online).toBe(false);
    s.setState({ syncing: true });
    expect(await s.getState().syncNow("busy")).toBeNull();
    s.setState({ syncing: false });
    r.server.up = true;
    r.api.submitted = async () => {
      throw new Error("boom");
    };
    expect(await s.getState().syncNow("z")).toBeNull();
    expect(s.getState().error?.key).toBe("sync");
    s.getState().setOnline(true);
    s.getState().setOnline(false);
    s.getState().close();
  });

  it("looks a QR up locally first, then online; an unanswered online lookup marks offline", async () => {
    const r = rig();
    const s = await ready(r);
    expect((await s.getState().lookupQr("1")).map((d) => d.id)).toEqual(["d1"]);
    r.api.qrHits.set("RS000777", device("x7", F1, "RS000777"));
    expect((await s.getState().lookupQr("rs000777")).map((d) => d.id)).toEqual(["x7"]);
    expect(await s.getState().lookupQr("NOPE")).toEqual([]);
    const { AxiosError } = await import("axios");
    r.api.byQr = async () => {
      throw new AxiosError("Network Error", "ERR_NETWORK");
    };
    expect(await s.getState().lookupQr("NOPE")).toEqual([]);
    expect(s.getState().online).toBe(false);
    expect(await s.getState().lookupQr("NOPE")).toEqual([]);
    r.api.byQr = async () => {
      throw new Error("500");
    };
    s.getState().setOnline(true);
    expect(await s.getState().lookupQr("NOPE")).toEqual([]);
    s.getState().close();
  });

  it("photos: admitted through the codec, read back, removed; two captures listed newest first", async () => {
    const r = rig();
    const codec = {
      decode: async () => ({ image: {} as CanvasImageSource, width: 10, height: 10, close: () => undefined }),
      encode: async () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }),
    };
    r.deps = { ...r.deps, photoCodec: codec };
    const s = await ready(r);
    const first = await s.getState().createCapture({ kind: "device", device: { name: "Old" } });
    r.globals.t += 1000;
    const localId = await s.getState().createCapture({ kind: "device", device: { name: "New" } });
    expect(s.getState().captures.map((c) => c.localId)).toEqual([localId, first]);
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "a.jpg", { type: "image/jpeg" });
    expect(await s.getState().addPhoto(localId, jpeg, "device_front")).toBeNull();
    const photo = s.getState().captures.find((c) => c.localId === localId)?.photos[0];
    expect(photo?.purpose).toBe("device_front");
    expect((await s.getState().photo(photo?.photoId ?? ""))?.size).toBe(4);
    await s.getState().removePhoto(localId, photo?.photoId ?? "");
    expect(s.getState().captures.find((c) => c.localId === localId)?.photos).toEqual([]);
    s.getState().close();

    const noStorage = { ...r.deps, capabilities: { ...r.deps.capabilities, storage: undefined } };
    const s2 = createFieldStore(noStorage);
    await s2.getState().boot();
    expect(await s2.getState().addPhoto(localId, jpeg, "device_front")).toBeNull();
    s2.getState().close();
  });

  it("re-preparing while ready, a refused facility, an expired set skips the catalogue, a wipe offline, a close before boot", async () => {
    const r = rig();
    const s = await ready(r);
    expect(await s.getState().prepare(await sized(s, [F1, F2]))).toBeNull();
    expect(s.getState().facilities.map((f) => f.id)).toEqual([F1, F2]);
    expect(await s.getState().prepare([{ id: F1, name: "x", code: "x", status: "active", total: null, refusal: "too big" }])).toBe("failed");

    await s.getState().prepare(await sized(s, [F1]));
    const calls = r.api.catalogueCalls.length;
    r.globals.t += 73 * 3600 * 1000;
    const report = await s.getState().syncNow("late");
    expect(report?.purged).toBe("device_clock_expired");
    expect(r.api.catalogueCalls.length).toBe(calls);
    s.getState().close();

    createFieldStore(r.deps).getState().close();
  });
});

describe("the administrator wipe and the other users", () => {
  it("lists other users and wipes one (recorded first); a non-admin is refused", async () => {
    const r = rig();
    r.api.me = user({ roleLevel: 8, roleName: "TENANT_ADMIN" });
    const other = await openFieldStore(r.idb, crypto, TENANT, "other");
    other.close();
    const reg = await openRegistry(r.idb, r.flags);
    await reg.put({ key: `${TENANT}:other`, outboxCount: 1, workingSetPresent: false, lastSyncServerAt: null });
    await reg.put({ key: `${TENANT}:third`, outboxCount: 0, workingSetPresent: true, lastSyncServerAt: null });
    reg.close();
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    expect(s.getState().blockedByOther).toBe(true);
    // The guard dropped the third user's set at boot; the second's outbox stays.
    expect((await s.getState().otherUsers()).map((x) => x.key).sort()).toEqual([`${TENANT}:other`, `${TENANT}:third`]);
    r.globals.online = false;
    expect(await s.getState().wipe(`${TENANT}:other`)).toEqual({ done: false, reason: "offline" });
    r.globals.online = true;
    expect(await s.getState().wipe(`${TENANT}:other`)).toEqual({ done: true, captures: 0, photos: 0 });
    expect(s.getState()).toMatchObject({ blockedByOther: false, othersPending: 0 });
    expect(r.api.wipes).toHaveLength(1);

    const r2 = rig();
    const s2 = createFieldStore(r2.deps);
    expect(await s2.getState().otherUsers()).toEqual([]);
    expect(await s2.getState().wipe("x")).toEqual({ done: false, reason: "not_allowed" });
    expect(s2.getState().applyUpdate()).toBe(false);
    expect(await s2.getState().turnOff()).toEqual({ refused: false, pending: 0 });
  });
});

describe("updates (§ 13) and a browser without a worker", () => {
  const fakeWorker = () => {
    const regTarget = new EventTarget();
    const installTarget = new EventTarget();
    const containerTarget = new EventTarget();
    const posted: unknown[] = [];
    const installing = Object.assign(installTarget, { state: "installing" });
    const registration = Object.assign(regTarget, { waiting: null as null | { postMessage: (m: unknown) => void }, installing, scope: "https://x/field" });
    const container = Object.assign(containerTarget, {
      controller: {},
      register: async () => registration,
      getRegistration: async () => registration,
      getRegistrations: async () => [{ scope: "https://x/field", unregister: async () => true }],
    });
    return { registration, installing, container, posted };
  };

  it("an update waiting, or installed while a controller runs, is offered; applied only on the user's word; the new controller reloads", async () => {
    const r = rig();
    const w = fakeWorker();
    let reloads = 0;
    const deps = { ...r.deps, capabilities: { ...r.deps.capabilities, serviceWorker: w.container as unknown as ServiceWorkerContainer }, reload: () => (reloads += 1) };
    const s = createFieldStore(deps);
    await s.getState().boot();
    await s.getState().prepare(await sized(s, [F1]));
    s.getState().close();

    w.registration.waiting = { postMessage: (m) => w.posted.push(m) };
    const s2 = createFieldStore(deps);
    await s2.getState().boot();
    expect(s2.getState().updateReady).toBe(true);
    expect(s2.getState().applyUpdate()).toBe(true);
    expect(w.posted).toEqual([{ type: "SKIP_WAITING" }]);
    w.container.dispatchEvent(new Event("controllerchange"));
    expect(reloads).toBe(1);
    s2.getState().close();

    w.registration.waiting = null;
    const s3 = createFieldStore(deps);
    await s3.getState().boot();
    expect(s3.getState().updateReady).toBe(false);
    const kept = w.registration.installing;
    (w.registration as { installing: unknown }).installing = null;
    w.registration.dispatchEvent(new Event("updatefound"));
    (w.registration as { installing: unknown }).installing = kept;
    w.registration.dispatchEvent(new Event("updatefound"));
    w.installing.dispatchEvent(new Event("statechange"));
    expect(s3.getState().updateReady).toBe(false);
    w.installing.state = "installed";
    w.installing.dispatchEvent(new Event("statechange"));
    expect(s3.getState().updateReady).toBe(true);
    s3.getState().close();
  });

  it("no registration, a failing registration read, or no worker at all: the app still opens", async () => {
    const r = rig();
    const s = createFieldStore(r.deps);
    await s.getState().boot();
    await s.getState().prepare(await sized(s, [F1]));
    s.getState().close();

    const failing = { ...r.deps, capabilities: { ...r.deps.capabilities, serviceWorker: { ...r.worker.container, getRegistration: async () => { throw new Error("blocked"); } } as unknown as ServiceWorkerContainer } };
    const s2 = createFieldStore(failing);
    await s2.getState().boot();
    expect(s2.getState().phase).toBe("ready");
    s2.getState().close();

    const none = { ...r.deps, capabilities: { ...r.deps.capabilities, serviceWorker: undefined, storage: undefined } };
    const s3 = createFieldStore(none);
    await s3.getState().boot();
    expect(s3.getState()).toMatchObject({ phase: "ready", storage: { persisted: false, usage: null, quota: null } });
    expect(await s3.getState().turnOff()).toEqual({ refused: false, pending: 0 });

    const fresh = rig({ serviceWorker: undefined });
    const s4 = createFieldStore(fresh.deps);
    await s4.getState().boot();
    expect(await s4.getState().prepare(await sized(s4, [F1]))).toBeNull();
    s4.getState().close();
  });
});
