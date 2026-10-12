/** @jest-environment node */
/**
 * P22-10c1 — the working-set download (P19-08 § 7.2; `06` § 6) over the REAL encrypted store
 * (`fake-indexeddb` + node WebCrypto) and a fake API built on the contract's key list:
 *  - the facility rule (bound: its own only; unbound: at most three);
 *  - sizes are read before anything is downloaded; a facility above the cap is refused with the
 *    server's message and nothing is written;
 *  - pages of 200 until the total, the rooms, the catalogue with its ETag, the facilities list and
 *    the meta (fingerprint, both clocks);
 *  - all or nothing: a failure part-way leaves no working set and the outbox untouched;
 *  - the catalogue's `If-None-Match` (304 keeps the copy);
 *  - offline QR matching without the tenant's settings; the in-memory index.
 */
import { IDBFactory } from "fake-indexeddb";
import { NOTHING_CONFIRMED, type Capture } from "../../engine/model";
import { openFieldStore, type FieldStore } from "../../platform/idbStore";
import { checkChoice, downloadWorkingSet, indexWorkingSet, MAX_UNBOUND_FACILITIES, PAGE_SIZE, qrMatches, refreshCatalogue, sizeUp, type SizedFacility } from "../workingSet";
import { crypto, device, F1, F2, FakeFieldApi, TENANT, user } from "./fieldHelpers";

const capture: Capture = {
  localId: "l1",
  kind: "ipm",
  state: "submitted_local",
  clientRef: "ref",
  dependsOn: null,
  deviceId: "d1",
  templateVersionId: "v1",
  capturedOffline: true,
  clientCapturedAt: "2026-10-12T00:00:00.000Z",
  header: {},
  results: [],
  device: null,
  photos: [],
  confirmed: NOTHING_CONFIRMED,
  attention: null,
  keyReplanned: false,
  updatedAt: 1,
};

let store: FieldStore;
let api: FakeFieldApi;
const now = () => Date.UTC(2026, 9, 12, 3);

beforeEach(async () => {
  store = await openFieldStore(new IDBFactory(), crypto, TENANT, "u1");
  api = new FakeFieldApi();
  api.devices.set(F1, Array.from({ length: 450 }, (_, i) => device(`a${String(i)}`, F1, `RS${String(i).padStart(6, "0")}`)));
  api.devices.set(F2, [device("b1", F2, "RS000999")]);
});
afterEach(() => store.close());

describe("checkChoice — who may take which facilities offline (§ 3.2)", () => {
  it("a bound user takes its own facility only; an unbound user one to three; never none", () => {
    const bound = user({ clientFacilityId: F1 });
    expect(checkChoice(bound, [F1])).toBeNull();
    expect(checkChoice(bound, [F2])).toBe("not_own_facility");
    expect(checkChoice(bound, [F1, F2])).toBe("not_own_facility");
    expect(checkChoice(user(), [])).toBe("none_chosen");
    expect(checkChoice(user(), [F1, F2])).toBeNull();
    expect(checkChoice(user(), ["a", "b", "c", "d"].slice(0, MAX_UNBOUND_FACILITIES + 1))).toBe("too_many");
  });
});

describe("sizeUp + downloadWorkingSet", () => {
  it("reads every size first, then downloads pages of 200, the rooms, the catalogue and the meta", async () => {
    const sized = await sizeUp(api, api.facilityList);
    expect(sized.map((f) => f.total)).toEqual([450, 1]);
    expect(api.pageReads).toBe(0);
    const progress: number[] = [];
    const result = await downloadWorkingSet({ api, store, facilities: sized, scopeFingerprint: "fp-9", deviceNow: now, serverNow: 777, onProgress: (d) => progress.push(d) });
    expect(result.devices).toBe(451);
    expect(api.pageReads).toBe(4); // 200 + 200 + 50 for F1, 1 for F2
    expect(progress).toEqual([PAGE_SIZE, 400, 450, 451]);
    const all = (await store.readWorkingSet()) as { id: string }[];
    expect(all).toHaveLength(451);
    expect(await store.readRooms(F1)).toEqual(api.roomList);
    expect(api.roomsFor).toEqual([F1, F2]);
    expect(await store.readCatalogue()).toEqual({ etag: '"cat-1"', document: api.catalogueDoc });
    expect(await store.readFacilities()).toEqual([
      { id: F1, name: "RS Satu", code: "RS1", deviceCount: 450, downloadedAt: now() },
      { id: F2, name: "RS Dua", code: "RS2", deviceCount: 1, downloadedAt: now() },
    ]);
    expect(await store.getMeta()).toEqual({ lastSyncDeviceAt: now(), lastSyncServerAt: 777, scopeFingerprint: "fp-9", workingSetPresent: true });
  });

  it("keeps the previous server time when the answer carried none; stops at the total even on a full last page", async () => {
    api.devices.set(F1, Array.from({ length: PAGE_SIZE }, (_, i) => device(`c${String(i)}`, F1)));
    await store.putMeta({ lastSyncDeviceAt: 1, lastSyncServerAt: 55, scopeFingerprint: "fp-1", workingSetPresent: false });
    api.devices.set(F2, []);
    const sized = await sizeUp(api, api.facilityList);
    await downloadWorkingSet({ api, store, facilities: sized, scopeFingerprint: "fp-1", deviceNow: now, serverNow: null });
    expect(api.pageReads).toBe(2); // one full page for F1, one empty page for F2 (nothing written)
    expect(await store.readWorkingSet()).toHaveLength(PAGE_SIZE);
    expect((await store.getMeta()).lastSyncServerAt).toBe(55);
  });

  it("refuses a facility above the cap with the server's message, writing nothing", async () => {
    api.tooLarge.add(F2);
    const sized = await sizeUp(api, api.facilityList);
    expect(sized[1]).toMatchObject({ total: null, refusal: "This selection has 2,500 devices" });
    await expect(downloadWorkingSet({ api, store, facilities: sized, scopeFingerprint: "fp", deviceNow: now, serverNow: null })).rejects.toThrow("2,500");
    expect(api.pageReads).toBe(0);
    expect(await store.readWorkingSet()).toEqual([]);
  });

  it("refuses with a generic message when the refusal carried none", async () => {
    const bare: SizedFacility = { id: F1, name: "x", code: "x", status: "active", total: null, refusal: null };
    await expect(downloadWorkingSet({ api, store, facilities: [bare], scopeFingerprint: "fp", deviceNow: now, serverNow: null })).rejects.toThrow("above the working-set cap");
  });

  it("is all or nothing: a failure part-way drops the pages written, keeps the outbox, and leaves no set present", async () => {
    await store.putCapture(capture);
    await store.putWorkingSetPage(F2, 1, [device("old", F2)], 1);
    await store.putMeta({ lastSyncDeviceAt: 1, lastSyncServerAt: 1, scopeFingerprint: "fp", workingSetPresent: true });
    api.failPage = 2;
    const sized = await sizeUp(api, api.facilityList);
    await expect(downloadWorkingSet({ api, store, facilities: sized, scopeFingerprint: "fp", deviceNow: now, serverNow: null })).rejects.toThrow("network");
    expect(await store.readWorkingSet()).toEqual([]);
    expect(await store.readFacilities()).toEqual([]);
    expect((await store.getMeta()).workingSetPresent).toBe(false);
    expect(await store.listCaptures()).toEqual([capture]);
  });
});

describe("refreshCatalogue — If-None-Match (F-79)", () => {
  it("replaces without a copy, keeps on 304, replaces on a new ETag", async () => {
    expect(await refreshCatalogue(api, store, 1)).toBe("replaced");
    expect(await refreshCatalogue(api, store, 2)).toBe("kept");
    api.catalogueEtag = '"cat-2"';
    api.catalogueDoc = { versions: [] };
    expect(await refreshCatalogue(api, store, 3)).toBe("replaced");
    expect(api.catalogueCalls).toEqual([null, '"cat-1"', '"cat-1"']);
    expect(await store.readCatalogue()).toEqual({ etag: '"cat-2"', document: { versions: [] } });
  });

  it("a 304 with no local copy re-reads the whole document; a cache that always answers 304 is an error", async () => {
    let first = true;
    const flaky = Object.assign(Object.create(api) as FakeFieldApi, {
      catalogue: async (etag: string | null) => {
        if (first) {
          first = false;
          return { notModified: true } as const;
        }
        return api.catalogue(etag);
      },
    });
    expect(await refreshCatalogue(flaky, store, 1)).toBe("replaced");
    await store.dropWorkingSet();
    api.alwaysNotModified = true;
    await expect(refreshCatalogue(api, store, 2)).rejects.toThrow("304 without a local copy");
  });
});

describe("offline QR matching and the in-memory index", () => {
  it("matches the stored, normalised code exactly, or a bare number against letters + the same number", () => {
    expect(qrMatches("RS000123", " rs000123 ")).toBe(true);
    expect(qrMatches("RS000123", "123")).toBe(true);
    expect(qrMatches("RS000123", "000123")).toBe(true);
    expect(qrMatches("RS000123", "124")).toBe(false);
    expect(qrMatches("RS000000", "0")).toBe(true);
    expect(qrMatches("AB-12", "12")).toBe(false);
    expect(qrMatches("RS000123", "RS123")).toBe(false);
    expect(qrMatches(null, "123")).toBe(false);
    expect(qrMatches("RS000123", "   ")).toBe(false);
  });

  it("finds by id, by QR (an exact match first) and by name, serial, maker, model or code", () => {
    const rows = [device("d1", F1, "RS000001", "Infusion Pump"), { ...device("d2", F1, "XY-77", "Monitor"), manufacturer: "Acme", model: "M-2" }, device("d3", F1, "AB000001", "Defibrillator")];
    const index = indexWorkingSet(rows);
    expect(index.byId("d2")?.id).toBe("d2");
    expect(index.byId("nope")).toBeNull();
    expect(index.byQr("rs000001").map((d) => d.id)).toEqual(["d1"]);
    expect(index.byQr("1").map((d) => d.id)).toEqual(["d1", "d3"]);
    expect(index.search("pump").map((d) => d.id)).toEqual(["d1"]);
    expect(index.search("acme").map((d) => d.id)).toEqual(["d2"]);
    expect(index.search("sn-d3").map((d) => d.id)).toEqual(["d3"]);
    expect(index.search("  ")).toEqual([]);
    expect(index.devices).toBe(rows);
  });
});
