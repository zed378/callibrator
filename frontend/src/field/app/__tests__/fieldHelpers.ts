/**
 * P22-10c1 — test helpers for the field app's runtime: a fake `FieldApi` built on the contract's
 * key list (no invented row shape), browser globals with a manual timer, and node's WebCrypto.
 */
import { webcrypto } from "node:crypto";
import { FIELD_DEVICE_SUMMARY_KEYS } from "@callibrator/contracts/deviceValues";
import type { CryptoDeps } from "../../platform/crypto";
import type { BrowserGlobals } from "../../platform/browserPorts";
import type { FlagStorage } from "../../platform/registryStore";
import type { CatalogueRead, FacilitySize, FieldApi, FieldDevice, FieldFacility, FieldRoom, FieldUser } from "../fieldApi";

export const crypto = webcrypto as unknown as CryptoDeps;

export const TENANT = "11111111-1111-4111-8111-111111111111";
export const F1 = "f1f1f1f1-0000-4000-8000-000000000001";
export const F2 = "f2f2f2f2-0000-4000-8000-000000000002";

export const user = (over: Partial<FieldUser> = {}): FieldUser => ({
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  tenantId: TENANT,
  roleName: "TECHNICIAN",
  roleLevel: 3,
  clientFacilityId: null,
  scopeFingerprint: "fp-1",
  ...over,
});

/** A synthetic `fieldDeviceSummary` row with exactly the contract's keys. */
export const device = (id: string, facilityId: string, qr: string | null = null, name = `Pump ${id}`): FieldDevice => {
  const row: Record<string, unknown> = {};
  for (const k of FIELD_DEVICE_SUMMARY_KEYS) row[k] = null;
  return { ...(row as unknown as FieldDevice), id, clientFacilityId: facilityId, name, qrCode: qr, serialNumber: `SN-${id}` };
};

export class FakeFieldApi implements FieldApi {
  me: FieldUser = user();
  facilityList: FieldFacility[] = [
    { id: F1, name: "RS Satu", code: "RS1", status: "active" },
    { id: F2, name: "RS Dua", code: "RS2", status: "active" },
  ];
  devices = new Map<string, FieldDevice[]>();
  tooLarge = new Set<string>();
  roomList: FieldRoom[] = [{ id: "r1", name: "Radiologi" }];
  catalogueEtag = '"cat-1"';
  catalogueDoc: unknown = { versions: [{ id: "v1" }] };
  /** Fail the n-th device page read (1-based), once. */
  failPage: number | null = null;
  pageReads = 0;
  catalogueCalls: (string | null)[] = [];
  wipes: { wipedUserId: string; captures: number; photos: number }[] = [];
  wipeFails = false;
  /** A 304 even with no etag (a misbehaving cache). */
  alwaysNotModified = false;

  async whoAmI() {
    return this.me;
  }
  async facilities(u: FieldUser) {
    return u.clientFacilityId ? this.facilityList.filter((f) => f.id === u.clientFacilityId) : this.facilityList;
  }
  async facilitySize(facilityId: string): Promise<FacilitySize> {
    if (this.tooLarge.has(facilityId)) return { ok: false, tooLarge: true, message: "This selection has 2,500 devices" };
    return { ok: true, total: (this.devices.get(facilityId) ?? []).length };
  }
  async devicePage(facilityId: string, page: number, limit: number) {
    this.pageReads += 1;
    if (this.failPage === this.pageReads) {
      this.failPage = null;
      throw new Error("network");
    }
    const all = this.devices.get(facilityId) ?? [];
    return { rows: all.slice((page - 1) * limit, page * limit), total: all.length };
  }
  async rooms() {
    return this.roomList;
  }
  async catalogue(etag: string | null): Promise<CatalogueRead> {
    this.catalogueCalls.push(etag);
    if (this.alwaysNotModified || (etag !== null && etag === this.catalogueEtag)) return { notModified: true };
    return { notModified: false, etag: this.catalogueEtag, document: this.catalogueDoc };
  }
  async recordWipe(wipedUserId: string, captures: number, photos: number) {
    if (this.wipeFails) throw new Error("403");
    this.wipes.push({ wipedUserId, captures, photos });
  }
}

/** Browser globals with a manual timer queue. */
export class FakeGlobals implements BrowserGlobals {
  t = Date.UTC(2026, 9, 12, 2);
  online = true;
  timers = new Map<number, { fn: () => void; at: number }>();
  private nextId = 1;
  now() {
    return this.t;
  }
  getRandomValues(a: Uint8Array): Uint8Array {
    webcrypto.getRandomValues(a as Uint8Array<ArrayBuffer>);
    return a;
  }
  onLine() {
    return this.online;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { fn, at: this.t + ms });
    return id;
  }
  clearTimeout(id: number) {
    this.timers.delete(id);
  }
  /** Moves the clock and fires every timer due. */
  advance(ms: number) {
    this.t += ms;
    for (const [id, timer] of [...this.timers]) {
      if (timer.at <= this.t) {
        this.timers.delete(id);
        timer.fn();
      }
    }
  }
}

export class MemoryFlags implements FlagStorage {
  map = new Map<string, string>();
  throws = false;
  getItem(k: string) {
    if (this.throws) throw new Error("private");
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.throws) throw new Error("private");
    this.map.set(k, v);
  }
  removeItem(k: string) {
    if (this.throws) throw new Error("private");
    this.map.delete(k);
  }
}

/** Lets pending promise chains settle. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 5));
};
