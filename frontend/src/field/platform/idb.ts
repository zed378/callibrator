/**
 * P22-10b — a thin promise layer over IndexedDB (no library): open with an upgrade, one request at
 * a time inside a transaction that completes before the promise resolves. Injected `IDBFactory`, so
 * the tests run it over `fake-indexeddb`.
 */

/** A request's result. */
export const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });

/** Opens (and upgrades) a database. */
export const openDb = (factory: IDBFactory, name: string, version: number, upgrade: (db: IDBDatabase, oldVersion: number) => void): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = (event) => upgrade(request.result, event.oldVersion);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB open blocked by another tab"));
  });

/** Runs `work` in one transaction and resolves after the transaction COMMITTED (not merely after the requests). */
export const tx = <T>(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode, work: (t: IDBTransaction) => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let value: T;
    let failed: unknown = null;
    t.oncomplete = () => (failed === null ? resolve(value) : reject(failed));
    t.onerror = () => reject(t.error ?? failed ?? new Error("IndexedDB transaction failed"));
    t.onabort = () => reject(t.error ?? failed ?? new Error("IndexedDB transaction aborted"));
    work(t).then(
      (v) => {
        value = v;
      },
      (err: unknown) => {
        failed = err;
        try {
          t.abort();
        } catch {
          // already finished
        }
      },
    );
  });

/** Deletes a database. */
export const deleteDb = (factory: IDBFactory, name: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed"));
    request.onblocked = () => resolve();
  });
