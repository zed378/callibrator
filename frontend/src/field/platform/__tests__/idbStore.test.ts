/** @jest-environment node */
/**
 * P22-10b — the encrypted field store and the registry over a real IndexedDB implementation
 * (`fake-indexeddb`) and node's WebCrypto (P19-08 § 7.1; ADR-127 § 4):
 *  - every engine record round-trips (meta, captures, ops by capture, photos as bytes);
 *  - **at rest**: the raw rows hold ciphertext and only ids / states / timestamps / counts in the
 *    clear — no tenant value (name, QR, note) appears anywhere in a raw row;
 *  - the key is non-extractable and survives reopening; a ciphertext moved to another slot (AAD) or
 *    read with another user's key fails;
 *  - the working set purge never touches the outbox; deleting a capture deletes its ops and photos;
 *    destroying deletes the database; a failing transaction writes nothing;
 *  - the registry: ids and counts only, the presence flag set and cleared, a throwing storage tolerated.
 */
import { webcrypto } from "node:crypto";
import { IDBFactory } from "fake-indexeddb";
import { NOTHING_CONFIRMED, type Capture, type Op } from "../../engine/model";
import { open, seal, slotOf, type CryptoDeps } from "../crypto";
import { done, openDb, tx } from "../idb";
import { dbName, openFieldStore } from "../idbStore";
import { PRESENT_FLAG, fieldPresent, openRegistry } from "../registryStore";

const crypto = webcrypto as unknown as CryptoDeps;

const capture: Capture = {
  localId: "l1",
  kind: "ipm",
  state: "editing",
  clientRef: "ref-1",
  dependsOn: null,
  deviceId: "dev-1",
  templateVersionId: "v1",
  capturedOffline: true,
  clientCapturedAt: "2026-10-10T02:00:00.000Z",
  header: { notes: "SECRET-NOTE" },
  results: [{ inputKind: "text", templateItemId: "i1", text: "SECRET-VALUE" }],
  device: { name: "SECRET-PUMP", qrCode: "QR-SECRET" },
  photos: [{ photoId: "p1", purpose: "ipm_evidence", uploaded: false }],
  confirmed: NOTHING_CONFIRMED,
  attention: null,
  keyReplanned: false,
  updatedAt: 5,
};
const op: Op = {
  opId: "o1",
  localId: "l1",
  seq: 1,
  kind: "create",
  state: "planned",
  attempts: 0,
  nextAttemptAt: 0,
  request: { method: "POST", path: "/api/v1/ipm/sessions", idempotencyKey: "k", bodyText: '{"note":"SECRET-BODY"}', photo: null, hash: "h" },
};

const rawRows = async (factory: IDBFactory, name: string, store: string): Promise<unknown[]> => {
  const db = await openDb(factory, name, 1, () => undefined);
  const rows = await tx(db, store, "readonly", async (t) => (await done(t.objectStore(store).getAll())) as unknown[]);
  db.close();
  return rows;
};

const clearText = (row: unknown): string => JSON.stringify(row, (_k, v: unknown) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? "<bytes>" : v));

describe("P22-10b — the encrypted field store", () => {
  it("round-trips every engine record; the raw rows hold no tenant value", async () => {
    const factory = new IDBFactory();
    const store = await openFieldStore(factory, crypto, "t1", "u1");
    expect(await store.getMeta()).toEqual({ lastSyncDeviceAt: null, lastSyncServerAt: null, scopeFingerprint: null, workingSetPresent: false });
    await store.putMeta({ lastSyncDeviceAt: 1, lastSyncServerAt: 2, scopeFingerprint: "fp-SECRET", workingSetPresent: true });
    await store.putCapture(capture);
    await store.putOp(op);
    await store.putPhoto("p1", new Blob([new Uint8Array([0xff, 0xd8, 0x53, 0x45])]));
    await store.putWorkingSetPage("f1", 1, [{ name: "SECRET-DEVICE" }], 9);
    await store.putRooms("f1", [{ name: "SECRET-ROOM" }], 9);
    await store.putCatalogue({ items: ["SECRET-ITEM"] }, 9);

    expect(await store.getMeta()).toMatchObject({ scopeFingerprint: "fp-SECRET" });
    expect(await store.listCaptures()).toEqual([capture]);
    expect(await store.getCapture("l1")).toEqual(capture);
    expect(await store.getCapture("none")).toBeNull();
    expect(await store.listOps("l1")).toEqual([op]);
    expect(await store.listOps("other")).toEqual([]);
    const photo = await store.getPhoto("p1");
    expect(new Uint8Array(await (photo as Blob).arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0x53, 0x45]));
    expect(photo?.type).toBe("image/jpeg");
    expect(await store.getPhoto("nope")).toBeNull();
    expect(await store.readWorkingSet()).toEqual([{ name: "SECRET-DEVICE" }]);
    expect(await store.readRooms("f1")).toEqual([{ name: "SECRET-ROOM" }]);
    expect(await store.readRooms("f2")).toBeNull();
    expect(await store.readCatalogue()).toEqual({ items: ["SECRET-ITEM"] });
    store.close();

    const name = dbName("t1", "u1");
    for (const s of ["meta", "captures", "ops", "photos", "workingSet", "rooms", "catalogue"]) {
      const text = (await rawRows(factory, name, s)).map(clearText).join("\n");
      expect(text).not.toMatch(/SECRET|QR-|ref-1|dev-1|ipm\/sessions/);
    }
    const [rawCapture] = (await rawRows(factory, name, "captures")) as Record<string, unknown>[];
    expect(Object.keys(rawCapture ?? {}).sort()).toEqual(["ct", "iv", "k", "kind", "state", "updatedAt"]);
    const [rawOp] = (await rawRows(factory, name, "ops")) as Record<string, unknown>[];
    expect(Object.keys(rawOp ?? {}).sort()).toEqual(["ct", "iv", "k", "localId", "seq", "state"]);
  });

  it("the key: non-extractable, kept across reopening; another slot or another user's key cannot read a record", async () => {
    const factory = new IDBFactory();
    const a = await openFieldStore(factory, crypto, "t1", "u1");
    await a.putCapture(capture);
    a.close();
    const again = await openFieldStore(factory, crypto, "t1", "u1");
    expect(await again.getCapture("l1")).toEqual(capture);
    again.close();
    const [keyRow] = (await rawRows(factory, dbName("t1", "u1"), "keys")) as { key: CryptoKey }[];
    expect(keyRow?.key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", keyRow?.key as CryptoKey)).rejects.toBeDefined();
    const sealed = await seal(crypto, keyRow?.key as CryptoKey, slotOf("captures", "l1"), { x: 1 });
    await expect(open(crypto, keyRow?.key as CryptoKey, slotOf("captures", "l2"), sealed)).rejects.toBeDefined();
    const other = await openFieldStore(factory, crypto, "t1", "u2");
    other.close();
    const [otherKey] = (await rawRows(factory, dbName("t1", "u2"), "keys")) as { key: CryptoKey }[];
    await expect(open(crypto, otherKey?.key as CryptoKey, slotOf("captures", "l1"), sealed)).rejects.toBeDefined();
  });

  it("the working-set purge never touches the outbox; a capture's delete takes its ops and photos; destroy deletes the database", async () => {
    const factory = new IDBFactory();
    const store = await openFieldStore(factory, crypto, "t1", "u1");
    await store.putCapture(capture);
    await store.putOp(op);
    await store.putPhoto("p1", new Blob(["x"]));
    await store.putWorkingSetPage("f1", 1, [{ id: "d" }], 1);
    await store.putRooms("f1", [], 1);
    await store.putCatalogue({}, 1);
    await store.dropWorkingSet();
    expect(await store.readWorkingSet()).toEqual([]);
    expect(await store.readCatalogue()).toBeNull();
    expect(await store.readRooms("f1")).toBeNull();
    expect(await store.listCaptures()).toHaveLength(1);
    expect(await store.listOps("l1")).toHaveLength(1);
    expect(await store.getPhoto("p1")).not.toBeNull();
    await store.deletePhoto("p1");
    expect(await store.getPhoto("p1")).toBeNull();
    await store.putPhoto("p1", new Blob(["x"]));
    await store.deleteCapture("l1");
    await store.deleteCapture("never");
    expect(await store.listCaptures()).toEqual([]);
    expect(await store.listOps("l1")).toEqual([]);
    expect(await store.getPhoto("p1")).toBeNull();
    await store.destroy();
    const names = (await factory.databases()).map((d) => d.name);
    expect(names).not.toContain(dbName("t1", "u1"));
  });

  it("a transaction whose work fails writes nothing", async () => {
    const factory = new IDBFactory();
    const db = await openDb(factory, "t", 1, (d) => d.createObjectStore("s", { keyPath: "k" }));
    await expect(
      tx(db, "s", "readwrite", async (t) => {
        await done(t.objectStore("s").put({ k: 1 }));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await tx(db, "s", "readonly", async (t) => done(t.objectStore("s").count()))).toBe(0);
    await expect(tx(db, "s", "readonly", async (t) => done(t.objectStore("s").get(Symbol() as never)))).rejects.toBeDefined();
    db.close();
  });
});

describe("P22-10b — the registry", () => {
  it("ids and counts only; the presence flag set on the first row and cleared with the last; a throwing storage tolerated", async () => {
    const factory = new IDBFactory();
    const flags = new Map<string, string>();
    const storage = { getItem: (k: string) => flags.get(k) ?? null, setItem: (k: string, v: string) => void flags.set(k, v), removeItem: (k: string) => void flags.delete(k) };
    const registry = await openRegistry(factory, storage);
    expect(fieldPresent(storage)).toBe(false);
    await registry.put({ key: "t1:u1", outboxCount: 2, workingSetPresent: true, lastSyncServerAt: 5, name: "SECRET" } as never);
    expect(await registry.list()).toEqual([{ key: "t1:u1", outboxCount: 2, workingSetPresent: true, lastSyncServerAt: 5 }]);
    expect(flags.get(PRESENT_FLAG)).toBe("1");
    expect(fieldPresent(storage)).toBe(true);
    await registry.put({ key: "t1:u2", outboxCount: 0, workingSetPresent: false, lastSyncServerAt: null });
    await registry.remove("t1:u1");
    expect(flags.get(PRESENT_FLAG)).toBe("1");
    await registry.remove("t1:u2");
    expect(flags.has(PRESENT_FLAG)).toBe(false);
    registry.close();
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const again = await openRegistry(factory, throwing);
    await again.put({ key: "x", outboxCount: 0, workingSetPresent: false, lastSyncServerAt: null });
    await again.remove("x");
    expect(fieldPresent(throwing)).toBe(false);
    expect(fieldPresent(null)).toBe(false);
    again.close();
    const none = await openRegistry(factory, null);
    await none.put({ key: "y", outboxCount: 0, workingSetPresent: false, lastSyncServerAt: null });
    none.close();
  });
});
