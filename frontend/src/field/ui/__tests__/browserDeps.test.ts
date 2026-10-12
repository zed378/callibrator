/**
 * P22-10c2 — the field app's browser wiring: every API taken from `window` in one place. The
 * globals behave as the browser's (clock, random bytes, `onLine`, timers); a browser without a
 * service worker or Cache Storage is described as such (the Settings screen names what lacks); a
 * `localStorage` that throws (a private window) gives no flag storage.
 */
import { webcrypto } from "node:crypto";
import { browserStoreDeps, flagStorage } from "../browserDeps";

describe("browserStoreDeps", () => {
  it("wires the browser's clock, random bytes, connection and timers", () => {
    const deps = browserStoreDeps();
    const g = deps.field.globals;
    expect(Math.abs(g.now() - Date.now())).toBeLessThan(1000);
    const bytes = g.getRandomValues(new Uint8Array(8));
    expect(bytes).toHaveLength(8);
    expect(g.onLine()).toBe(navigator.onLine);
    const fn = jest.fn();
    jest.useFakeTimers();
    try {
      const id = g.setTimeout(fn, 10);
      g.clearTimeout(id);
      g.setTimeout(fn, 10);
      jest.advanceTimersByTime(20);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
    expect(deps.field.flags).toBe(window.localStorage);
    expect(typeof deps.field.onSessionEnd).toBe("function");
    expect(typeof deps.field.api.whoAmI).toBe("function");
    expect(typeof deps.field.transport.send).toBe("function");
  });

  it("describes what the browser has: jsdom has no worker and no Cache Storage", () => {
    const deps = browserStoreDeps();
    expect(deps.capabilities.serviceWorker).toBeUndefined();
    expect(deps.capabilities.caches).toBeUndefined();
  });

  it("takes the worker container, the caches, IndexedDB and WebCrypto when the browser has them", () => {
    const sw = {} as ServiceWorkerContainer;
    const cacheStorage = {} as CacheStorage;
    const idb = {} as IDBFactory;
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
    (globalThis as { caches?: CacheStorage }).caches = cacheStorage;
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = idb;
    const originalCrypto = window.crypto;
    Object.defineProperty(window, "crypto", { configurable: true, value: webcrypto });
    try {
      const deps = browserStoreDeps();
      expect(deps.capabilities).toMatchObject({ serviceWorker: sw, caches: cacheStorage, indexedDB: idb });
      expect(deps.capabilities.subtle).toBe(webcrypto.subtle);
      expect(deps.field.idb).toBe(idb);
    } finally {
      Object.defineProperty(window, "crypto", { configurable: true, value: originalCrypto });
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
      delete (globalThis as { caches?: unknown }).caches;
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    }
  });

  it("a localStorage that throws gives no flag storage", () => {
    expect(
      flagStorage(() => {
        throw new Error("private window");
      }),
    ).toBeNull();
  });
});
