/**
 * P22-10b — the engine's `CaptureStore` over IndexedDB, one database per user
 * (`callibrator-field-<tenantId>-<userId>`, P19-08 § 7.1), every payload sealed (`crypto.ts`).
 *
 * | Store | Key | Clear fields (ids, timestamps, states, counts ONLY) | Sealed payload |
 * |---|---|---|---|
 * | `keys` | `"aes"` | — | the non-extractable `CryptoKey` itself |
 * | `meta` | `"sync"` | — | the sync meta (last sync times, the scope fingerprint, the working set's presence) |
 * | `catalogue` | `"published"` | `fetchedAt` | the published catalogue document |
 * | `workingSet` | `"<facilityId>:<page>"` | `facilityId`, `page`, `fetchedAt` | ≤ 200 device summaries |
 * | `rooms` | facility id | `fetchedAt` | the facility's rooms |
 * | `captures` | `localId` | `kind`, `state`, `updatedAt` | the capture |
 * | `ops` | `opId` | `localId`, `seq`, `state` | the op (its frozen request) |
 * | `photos` | `photoId` | — | the JPEG bytes |
 *
 * No name, QR, serial, room, value or note is ever in a clear field or an index (an index on a
 * tenant value would be one). IndexedDB transactions close when they wait on anything else, so a
 * payload is sealed BEFORE its transaction opens and opened AFTER it read. The outbox (`captures`,
 * `ops`, `photos`) is never touched by `dropWorkingSet`; the upgrade never drops a store.
 */
import type { Capture, Op } from "../engine/model";
import type { CaptureStore } from "../engine/ports";
import type { SyncMeta } from "../engine/purge";
import { newKey, open, openBytes, seal, sealBytes, slotOf, type CryptoDeps, type Sealed } from "./crypto";
import { deleteDb, done, openDb, tx } from "./idb";

export const DB_VERSION = 1;
export const STORES = ["keys", "meta", "catalogue", "workingSet", "rooms", "captures", "ops", "photos"] as const;
const WORKING_SET = ["catalogue", "workingSet", "rooms"] as const;

export const dbName = (tenantId: string, userId: string): string => `callibrator-field-${tenantId}-${userId}`;

const EMPTY_META: SyncMeta = { lastSyncDeviceAt: null, lastSyncServerAt: null, scopeFingerprint: null, workingSetPresent: false };

interface Row extends Sealed {
  readonly k: string;
  readonly [clear: string]: unknown;
}

/** The working-set reads and writes the field app needs beside the engine's store (P22-10c). */
export interface FieldStore extends CaptureStore {
  putWorkingSetPage(facilityId: string, page: number, rows: readonly unknown[], fetchedAt: number): Promise<void>;
  readWorkingSet(): Promise<unknown[]>;
  putRooms(facilityId: string, rooms: readonly unknown[], fetchedAt: number): Promise<void>;
  readRooms(facilityId: string): Promise<unknown[] | null>;
  putCatalogue(document: unknown, fetchedAt: number): Promise<void>;
  readCatalogue(): Promise<unknown | null>;
  close(): void;
}

const upgrade = (db: IDBDatabase): void => {
  for (const name of STORES) {
    if (db.objectStoreNames.contains(name)) continue;
    const store = db.createObjectStore(name, { keyPath: "k" });
    if (name === "ops") store.createIndex("localId", "localId", { unique: false });
  }
};

/** Opens a user's field store, creating its key on first use. */
export async function openFieldStore(factory: IDBFactory, crypto: CryptoDeps, tenantId: string, userId: string): Promise<FieldStore> {
  const name = dbName(tenantId, userId);
  const db = await openDb(factory, name, DB_VERSION, upgrade);
  let key = await tx(db, "keys", "readonly", async (t) => (await done(t.objectStore("keys").get("aes"))) as { k: string; key: CryptoKey } | undefined);
  if (!key) {
    const made = await newKey(crypto);
    await tx(db, "keys", "readwrite", async (t) => {
      await done(t.objectStore("keys").put({ k: "aes", key: made }));
    });
    key = { k: "aes", key: made };
  }
  const aes = key.key;

  const sealRow = async (store: string, k: string, value: unknown, clear: Record<string, unknown> = {}): Promise<Row> => ({ k, ...clear, ...(await seal(crypto, aes, slotOf(store, k), value)) });
  const openRow = <T>(store: string, row: Row): Promise<T> => open<T>(crypto, aes, slotOf(store, row.k), row);
  const put = async (store: string, row: Row): Promise<void> => {
    await tx(db, store, "readwrite", async (t) => {
      await done(t.objectStore(store).put(row));
    });
  };
  const get = (store: string, k: string): Promise<Row | undefined> => tx(db, store, "readonly", async (t) => (await done(t.objectStore(store).get(k))) as Row | undefined);
  const all = (store: string): Promise<Row[]> => tx(db, store, "readonly", async (t) => (await done(t.objectStore(store).getAll())) as Row[]);

  const store: FieldStore = {
    async getMeta() {
      const row = await get("meta", "sync");
      return row ? openRow<SyncMeta>("meta", row) : EMPTY_META;
    },
    async putMeta(meta) {
      await put("meta", await sealRow("meta", "sync", meta));
    },
    async listCaptures() {
      return Promise.all((await all("captures")).map((row) => openRow<Capture>("captures", row)));
    },
    async getCapture(localId) {
      const row = await get("captures", localId);
      return row ? openRow<Capture>("captures", row) : null;
    },
    async putCapture(capture) {
      await put("captures", await sealRow("captures", capture.localId, capture, { kind: capture.kind, state: capture.state, updatedAt: capture.updatedAt }));
    },
    async deleteCapture(localId) {
      const capture = await store.getCapture(localId);
      const photoIds = capture?.photos.map((p) => p.photoId) ?? [];
      await tx(db, ["captures", "ops", "photos"], "readwrite", async (t) => {
        await done(t.objectStore("captures").delete(localId));
        const opKeys = (await done(t.objectStore("ops").index("localId").getAllKeys(localId))) as IDBValidKey[];
        for (const k of opKeys) await done(t.objectStore("ops").delete(k));
        for (const id of photoIds) await done(t.objectStore("photos").delete(id));
      });
    },
    async listOps(localId) {
      const rows = await tx(db, "ops", "readonly", async (t) => (await done(t.objectStore("ops").index("localId").getAll(localId))) as Row[]);
      return Promise.all(rows.map((row) => openRow<Op>("ops", row)));
    },
    async putOp(op) {
      await put("ops", await sealRow("ops", op.opId, op, { localId: op.localId, seq: op.seq, state: op.state }));
    },
    async putPhoto(photoId, bytes) {
      const sealed = await sealBytes(crypto, aes, slotOf("photos", photoId), await bytes.arrayBuffer());
      await put("photos", { k: photoId, ...sealed });
    },
    async getPhoto(photoId) {
      const row = await get("photos", photoId);
      if (!row) return null;
      return new Blob([await openBytes(crypto, aes, slotOf("photos", photoId), row)], { type: "image/jpeg" });
    },
    async deletePhoto(photoId) {
      await tx(db, "photos", "readwrite", async (t) => {
        await done(t.objectStore("photos").delete(photoId));
      });
    },
    async dropWorkingSet() {
      await tx(db, [...WORKING_SET], "readwrite", async (t) => {
        for (const s of WORKING_SET) await done(t.objectStore(s).clear());
      });
    },
    async destroy() {
      db.close();
      await deleteDb(factory, name);
    },
    async putWorkingSetPage(facilityId, page, rows, fetchedAt) {
      await put("workingSet", await sealRow("workingSet", `${facilityId}:${String(page)}`, rows, { facilityId, page, fetchedAt }));
    },
    async readWorkingSet() {
      const pages = await Promise.all((await all("workingSet")).map((row) => openRow<unknown[]>("workingSet", row)));
      return pages.flat();
    },
    async putRooms(facilityId, rooms, fetchedAt) {
      await put("rooms", await sealRow("rooms", facilityId, rooms, { fetchedAt }));
    },
    async readRooms(facilityId) {
      const row = await get("rooms", facilityId);
      return row ? openRow<unknown[]>("rooms", row) : null;
    },
    async putCatalogue(document, fetchedAt) {
      await put("catalogue", await sealRow("catalogue", "published", document, { fetchedAt }));
    },
    async readCatalogue() {
      const row = await get("catalogue", "published");
      return row ? openRow<unknown>("catalogue", row) : null;
    },
    close() {
      db.close();
    },
  };
  return store;
}
