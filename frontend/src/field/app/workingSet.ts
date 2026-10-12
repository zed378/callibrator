/**
 * P22-10c1 — the working-set download (P19-08 § 7.2; `docs/SHARED/06-SYNC-ENGINE.md` § 6), the plan
 * P22-10a moved here:
 *
 *  1. **Sizes first.** Each chosen facility's device count is read (`meta.total` of a one-row page)
 *     and shown BEFORE anything is downloaded; a facility above the tenant's cap answers 400
 *     `FIELD_WORKING_SET_TOO_LARGE` and is refused with the server's message.
 *  2. **The facility rule.** A bound user takes its own facility only; an unbound user at most three
 *     (P19-08 § 3.2 — the owner question on "more than three" stays open, recommended no).
 *  3. **Pages of 200**, `sort=id`, until the total is read; then the rooms, then the catalogue with
 *     `If-None-Match` (304 keeps the local copy — F-79).
 *  4. **All or nothing.** The old set is dropped first; any failure drops what was written, so a
 *     half-downloaded set is never used. The outbox is never touched.
 *  5. `meta` records the scope fingerprint the set was downloaded under and the sync times
 *     (device and server clock — the 72-hour rules of `purge.ts`).
 */
import type { SyncMeta } from "../engine/purge";
import type { FieldStore } from "../platform/idbStore";
import type { FieldApi, FieldDevice, FieldFacility, FieldUser } from "./fieldApi";

export const PAGE_SIZE = 200;
/** An unbound user's facilities offline at once (P19-08 § 3.2). */
export const MAX_UNBOUND_FACILITIES = 3;

export interface SizedFacility extends FieldFacility {
  /** Null when the facility is above the cap. */
  readonly total: number | null;
  readonly refusal: string | null;
}

/** What is downloaded, as remembered (in the purgeable `rooms` store). */
export interface DownloadedFacility {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly deviceCount: number;
  readonly downloadedAt: number;
}

export interface CatalogueCopy {
  readonly etag: string | null;
  readonly document: unknown;
}

export type ChoiceError = "none_chosen" | "too_many" | "not_own_facility";

/** Whether this user may take these facilities offline (§ 3.2). */
export const checkChoice = (user: FieldUser, facilityIds: readonly string[]): ChoiceError | null => {
  if (facilityIds.length === 0) return "none_chosen";
  if (user.clientFacilityId !== null) return facilityIds.length === 1 && facilityIds[0] === user.clientFacilityId ? null : "not_own_facility";
  return facilityIds.length > MAX_UNBOUND_FACILITIES ? "too_many" : null;
};

/** Step 1: every chosen facility's size, read before downloading. */
export const sizeUp = async (api: FieldApi, facilities: readonly FieldFacility[]): Promise<SizedFacility[]> =>
  Promise.all(
    facilities.map(async (f) => {
      const size = await api.facilitySize(f.id);
      return size.ok ? { ...f, total: size.total, refusal: null } : { ...f, total: null, refusal: size.message };
    }),
  );

export interface DownloadInput {
  readonly api: FieldApi;
  readonly store: FieldStore;
  readonly facilities: readonly SizedFacility[];
  readonly scopeFingerprint: string;
  readonly deviceNow: () => number;
  /** The server's `Date` of the last answer, when known (AM-24). */
  readonly serverNow: number | null;
  readonly onProgress?: (done: number, total: number) => void;
}

/** Refreshes the catalogue copy with `If-None-Match` (each sync cycle and each download). */
export const refreshCatalogue = async (api: FieldApi, store: FieldStore, now: number): Promise<"kept" | "replaced"> => {
  const local = (await store.readCatalogue()) as CatalogueCopy | null;
  const read = await api.catalogue(local?.etag ?? null);
  if (read.notModified && local) return "kept";
  if (read.notModified) {
    // A 304 for a copy we no longer hold cannot happen without an etag; read it whole.
    const full = await api.catalogue(null);
    if (full.notModified) throw new Error("The catalogue answered 304 without a local copy");
    await store.putCatalogue({ etag: full.etag, document: full.document } satisfies CatalogueCopy, now);
    return "replaced";
  }
  await store.putCatalogue({ etag: read.etag, document: read.document } satisfies CatalogueCopy, now);
  return "replaced";
};

/** Steps 3 – 5: download every facility, all or nothing. */
export async function downloadWorkingSet(input: DownloadInput): Promise<{ devices: number }> {
  const { api, store, facilities, scopeFingerprint, deviceNow, serverNow, onProgress } = input;
  const refused = facilities.find((f) => f.total === null);
  if (refused) throw new Error(refused.refusal ?? "A facility is above the working-set cap");
  // Every total is a number here: a null one was refused above.
  const expected = facilities.reduce((n, f) => n + (f.total as number), 0);
  const meta = await store.getMeta();

  await store.dropWorkingSet();
  await store.putMeta({ ...meta, workingSetPresent: false });
  let fetched = 0;
  try {
    const downloaded: DownloadedFacility[] = [];
    for (const f of facilities) {
      let count = 0;
      for (let page = 1; ; page += 1) {
        const { rows, total } = await api.devicePage(f.id, page, PAGE_SIZE);
        if (rows.length > 0) await store.putWorkingSetPage(f.id, page, rows, deviceNow());
        count += rows.length;
        fetched += rows.length;
        onProgress?.(fetched, expected);
        if (rows.length < PAGE_SIZE || count >= total) break;
      }
      await store.putRooms(f.id, await api.rooms(f.id), deviceNow());
      downloaded.push({ id: f.id, name: f.name, code: f.code, deviceCount: count, downloadedAt: deviceNow() });
    }
    await refreshCatalogue(api, store, deviceNow());
    await store.putFacilities(downloaded, deviceNow());
  } catch (err) {
    await store.dropWorkingSet();
    throw err;
  }
  const next: SyncMeta = { lastSyncDeviceAt: deviceNow(), lastSyncServerAt: serverNow ?? meta.lastSyncServerAt, scopeFingerprint, workingSetPresent: true };
  await store.putMeta(next);
  return { devices: fetched };
}

/** The decrypted working set, in memory (P19-08 § 7.1: pages decrypted at open, no plaintext index at rest). */
export interface WorkingSetIndex {
  readonly devices: readonly FieldDevice[];
  byId(id: string): FieldDevice | null;
  /** Typed or scanned text → the devices whose QR it names (see `qrMatches`). */
  byQr(text: string): FieldDevice[];
  search(text: string): FieldDevice[];
}

/**
 * Offline QR matching WITHOUT the tenant's QR settings (decision, ADR-127 Am. 3 § 2): the stored
 * `qrCode` is already normalised by the server (`normaliseQrCode`), so the typed text is spaced out
 * and upper-cased; an exact match wins; a bare number matches a stored code of letters followed by
 * the same number (zero padding ignored) — which is what the tenant's prefix and padding make of it.
 */
export const qrMatches = (stored: string | null, typed: string): boolean => {
  if (!stored) return false;
  const t = typed.replace(/\s+/g, "").toUpperCase();
  if (t === "") return false;
  if (stored === t) return true;
  if (!/^[0-9]+$/.test(t)) return false;
  const m = /^[A-Z]{1,8}([0-9]+)$/.exec(stored);
  const unpad = (n: string): string => n.replace(/^0+(?=.)/, "");
  return m !== null && unpad(m[1] as string) === unpad(t);
};

export const indexWorkingSet = (devices: readonly FieldDevice[]): WorkingSetIndex => {
  const byId = new Map(devices.map((d) => [d.id, d]));
  return {
    devices,
    byId: (id) => byId.get(id) ?? null,
    byQr(text) {
      const exact = devices.filter((d) => d.qrCode === text.replace(/\s+/g, "").toUpperCase());
      return exact.length > 0 ? exact : devices.filter((d) => qrMatches(d.qrCode, text));
    },
    search(text) {
      const q = text.trim().toLowerCase();
      if (q === "") return [];
      return devices.filter((d) => [d.name, d.serialNumber, d.manufacturer, d.model, d.qrCode].some((v) => typeof v === "string" && v.toLowerCase().includes(q)));
    },
  };
};
