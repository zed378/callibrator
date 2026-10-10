/** @jest-environment node */
/**
 * P22-10b follow-up (2026-10-10, no-skip rule) — the promise layer over IndexedDB, every branch.
 *
 * The blocked-upgrade test P22-10b removed is back, and deterministic: it never waits on a timer.
 * A second connection asks for a higher version while the first stays open; the spec fires
 * `versionchange` at the open connection and then `blocked` at the request. The test records the
 * `versionchange` explicitly, asserts the rejection, then closes the old connection so the queued
 * upgrade finishes and nothing is left pending. The `?? new Error(...)` fallbacks (a request or
 * transaction that reports no `error`) cannot be produced by a real IndexedDB, so they are driven
 * through hand-built doubles whose handlers the test fires itself.
 */
import { IDBFactory } from "fake-indexeddb";
import { deleteDb, done, openDb, tx } from "../idb";

const STORE = "s";

const createStore = (db: IDBDatabase): void => {
  if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
};

/** A request double: the code under test assigns its handlers, the test fires them. */
type RequestDouble = {
  result: unknown;
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
  onupgradeneeded: ((event: { oldVersion: number }) => void) | null;
};

const requestDouble = (error: DOMException | null = null): RequestDouble => ({
  result: undefined,
  error,
  onsuccess: null,
  onerror: null,
  onblocked: null,
  onupgradeneeded: null,
});

const factoryOver = (request: RequestDouble): IDBFactory =>
  ({ open: () => request, deleteDatabase: () => request }) as unknown as IDBFactory;

/** A transaction double whose `abort` can be made to throw (the "already finished" case). */
type TxDouble = {
  error: DOMException | null;
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  abort: () => void;
};

const txDouble = (abortThrows: boolean, error: DOMException | null = null): TxDouble => ({
  error,
  oncomplete: null,
  onerror: null,
  onabort: null,
  abort: () => {
    if (abortThrows) throw new Error("InvalidStateError: transaction finished");
  },
});

const dbOver = (t: TxDouble): IDBDatabase => ({ transaction: () => t }) as unknown as IDBDatabase;

/** Lets the microtasks of a settled `work` promise run, without any timer. */
const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("idb — openDb", () => {
  it("creates the schema on first open, passes the old version, and reopens without upgrading", async () => {
    const factory = new IDBFactory();
    const seen: number[] = [];
    const db = await openDb(factory, "a", 1, (d, old) => {
      seen.push(old);
      createStore(d);
    });
    expect(seen).toEqual([0]);
    expect(Array.from(db.objectStoreNames)).toEqual([STORE]);
    db.close();
    const again = await openDb(factory, "a", 1, () => seen.push(-1));
    expect(seen).toEqual([0]);
    again.close();
  });

  it("rejects a blocked upgrade after the open connection receives versionchange (no timer)", async () => {
    const factory = new IDBFactory();
    const first = await openDb(factory, "b", 1, createStore);
    const versionChanges: Array<{ oldVersion: number; newVersion: number | null }> = [];
    // The first connection hears the request and deliberately does NOT close: that is what blocks.
    first.onversionchange = (event) => versionChanges.push({ oldVersion: event.oldVersion, newVersion: event.newVersion });

    const upgrades: number[] = [];
    await expect(openDb(factory, "b", 2, (_d, old) => upgrades.push(old))).rejects.toThrow("IndexedDB open blocked by another tab");
    expect(versionChanges).toEqual([{ oldVersion: 1, newVersion: 2 }]);
    expect(upgrades).toEqual([]);

    // Releasing the old connection lets the queued upgrade run; the next open sees version 2.
    first.close();
    const after = await openDb(factory, "b", 2, () => upgrades.push(-1));
    expect(after.version).toBe(2);
    after.close();
  });

  it("rejects with the request's error when the open fails (a lower version than stored)", async () => {
    const factory = new IDBFactory();
    const db = await openDb(factory, "c", 3, createStore);
    db.close();
    await expect(openDb(factory, "c", 2, createStore)).rejects.toMatchObject({ name: "VersionError" });
  });

  it("rejects with a generic error when the failed open reports none", async () => {
    const request = requestDouble();
    const pending = openDb(factoryOver(request), "d", 1, createStore);
    request.onerror?.();
    await expect(pending).rejects.toThrow("IndexedDB open failed");
  });
});

describe("idb — done", () => {
  it("resolves a request's result", async () => {
    const factory = new IDBFactory();
    const db = await openDb(factory, "e", 1, createStore);
    await tx(db, STORE, "readwrite", (t) => done(t.objectStore(STORE).put("v", "k")));
    await expect(tx(db, STORE, "readonly", (t) => done(t.objectStore(STORE).get("k")))).resolves.toBe("v");
    db.close();
  });

  it("rejects with the request's own error", async () => {
    const error = new DOMException("constraint", "ConstraintError");
    const request = requestDouble(error);
    const pending = done(request as unknown as IDBRequest<unknown>);
    request.onerror?.();
    await expect(pending).rejects.toBe(error);
  });

  it("rejects with a generic error when the request reports none", async () => {
    const request = requestDouble();
    const pending = done(request as unknown as IDBRequest<unknown>);
    request.onerror?.();
    await expect(pending).rejects.toThrow("IndexedDB request failed");
  });
});

describe("idb — tx", () => {
  it("resolves the work's value only after the transaction committed", async () => {
    const factory = new IDBFactory();
    const db = await openDb(factory, "f", 1, createStore);
    await expect(tx(db, [STORE], "readwrite", (t) => done(t.objectStore(STORE).put(1, "n")))).resolves.toBe("n");
    db.close();
  });

  it("aborts on a failing work, writes nothing, and rejects with the work's error", async () => {
    const factory = new IDBFactory();
    const db = await openDb(factory, "g", 1, createStore);
    const boom = new Error("work failed");
    await expect(
      tx(db, STORE, "readwrite", async (t) => {
        await done(t.objectStore(STORE).put(1, "x"));
        throw boom;
      }),
    ).rejects.toBe(boom);
    await expect(tx(db, STORE, "readonly", (t) => done(t.objectStore(STORE).get("x")))).resolves.toBeUndefined();
    db.close();
  });

  it("rejects when a request fails inside it, even if the work swallows that request's error", async () => {
    const factory = new IDBFactory();
    const db = await openDb(factory, "h", 1, createStore);
    await tx(db, STORE, "readwrite", (t) => done(t.objectStore(STORE).add(1, "dup")));
    // The request's error event bubbles to the transaction's onerror BEFORE the transaction's own
    // `error` is set (IndexedDB 3 § 5.6), so `tx` rejects with its generic message, not ConstraintError.
    await expect(
      tx(db, STORE, "readwrite", (t) => done(t.objectStore(STORE).add(2, "dup")).catch(() => "swallowed")),
    ).rejects.toThrow("IndexedDB transaction failed");
    await expect(tx(db, STORE, "readonly", (t) => done(t.objectStore(STORE).get("dup")))).resolves.toBe(1);
    db.close();
  });

  it("rejects with the work's error when the transaction completes after the work failed (abort too late)", async () => {
    const t = txDouble(true);
    const boom = new Error("late failure");
    const pending = tx(dbOver(t), STORE, "readwrite", () => Promise.reject(boom));
    await flush();
    t.oncomplete?.();
    await expect(pending).rejects.toBe(boom);
  });

  it("onerror: the transaction's error, else the work's, else a generic error", async () => {
    const own = new DOMException("quota", "QuotaExceededError");
    const withOwn = txDouble(false, own);
    const p1 = tx(dbOver(withOwn), STORE, "readwrite", () => new Promise<never>(() => undefined));
    withOwn.onerror?.();
    await expect(p1).rejects.toBe(own);

    const boom = new Error("work");
    const withWork = txDouble(false);
    const p2 = tx(dbOver(withWork), STORE, "readwrite", () => Promise.reject(boom));
    await flush();
    withWork.onerror?.();
    await expect(p2).rejects.toBe(boom);

    const bare = txDouble(false);
    const p3 = tx(dbOver(bare), STORE, "readwrite", () => new Promise<never>(() => undefined));
    bare.onerror?.();
    await expect(p3).rejects.toThrow("IndexedDB transaction failed");
  });

  it("onabort: the transaction's error, else a generic error", async () => {
    const own = new DOMException("aborted", "AbortError");
    const withOwn = txDouble(false, own);
    const p1 = tx(dbOver(withOwn), STORE, "readwrite", () => new Promise<never>(() => undefined));
    withOwn.onabort?.();
    await expect(p1).rejects.toBe(own);

    const bare = txDouble(false);
    const p2 = tx(dbOver(bare), STORE, "readwrite", () => new Promise<never>(() => undefined));
    bare.onabort?.();
    await expect(p2).rejects.toThrow("IndexedDB transaction aborted");
  });
});

describe("idb — deleteDb", () => {
  it("deletes a database", async () => {
    const factory = new IDBFactory();
    const db = await openDb(factory, "i", 1, createStore);
    db.close();
    await deleteDb(factory, "i");
    const fresh: number[] = [];
    const reopened = await openDb(factory, "i", 1, (_d, old) => fresh.push(old));
    expect(fresh).toEqual([0]);
    reopened.close();
  });

  it("resolves when blocked by an open connection, after that connection hears versionchange (no timer)", async () => {
    const factory = new IDBFactory();
    const db = await openDb(factory, "j", 1, createStore);
    const heard: Array<number | null> = [];
    db.onversionchange = (event) => heard.push(event.newVersion);
    await expect(deleteDb(factory, "j")).resolves.toBeUndefined();
    expect(heard).toEqual([null]);
    db.close();
  });

  it("rejects with the request's error, else a generic error", async () => {
    const error = new DOMException("unknown", "UnknownError");
    const withError = requestDouble(error);
    const p1 = deleteDb(factoryOver(withError), "k");
    withError.onerror?.();
    await expect(p1).rejects.toBe(error);

    const bare = requestDouble();
    const p2 = deleteDb(factoryOver(bare), "k");
    bare.onerror?.();
    await expect(p2).rejects.toThrow("IndexedDB delete failed");
  });
});
