/**
 * P22-10b — the field worker's registration and the browser floor (P19-08 § 4.1, § 3.2, § 14).
 *
 * Registered ONLY by the field app, ONLY after the user turns offline mode on:
 * `register("/sw.js", { scope: "/field", type: "classic", updateViaCache: "none" })` — the dashboard
 * and the public pages never register it, and it controls no page outside `/field`. Turning offline
 * mode off unregisters it and deletes its `cf-*` caches. Every browser API is injected.
 */

export interface BrowserCapabilities {
  readonly serviceWorker?: ServiceWorkerContainer;
  readonly caches?: CacheStorage;
  readonly indexedDB?: IDBFactory;
  readonly subtle?: SubtleCrypto;
  readonly storage?: StorageManager;
}

/** What a browser lacks to work offline (empty = it can): the Settings screen names it. */
export const missingFeatures = (b: BrowserCapabilities): string[] =>
  [
    b.serviceWorker ? null : "Service Worker",
    b.caches ? null : "Cache Storage",
    b.indexedDB ? null : "IndexedDB",
    b.subtle ? null : "Web Crypto",
  ].filter((x): x is string => x !== null);

export const WORKER_URL = "/sw.js";
export const WORKER_SCOPE = "/field";

export const registerFieldWorker = (container: ServiceWorkerContainer): Promise<ServiceWorkerRegistration> =>
  container.register(WORKER_URL, { scope: WORKER_SCOPE, type: "classic", updateViaCache: "none" });

/** Unregisters the field worker (and only it) and deletes its caches. */
export const unregisterFieldWorker = async (container: ServiceWorkerContainer, caches: CacheStorage | undefined): Promise<number> => {
  let removed = 0;
  for (const registration of await container.getRegistrations()) {
    if (new URL(registration.scope).pathname.replace(/\/$/, "") === WORKER_SCOPE && (await registration.unregister())) removed += 1;
  }
  if (caches) for (const name of await caches.keys()) if (name.startsWith("cf-")) await caches.delete(name);
  return removed;
};

/** Asks for persistent storage and reads the quota (shown before a download). */
export const persistence = async (storage: StorageManager | undefined): Promise<{ persisted: boolean; usage: number | null; quota: number | null }> => {
  if (!storage) return { persisted: false, usage: null, quota: null };
  let persisted = false;
  try {
    persisted = typeof storage.persist === "function" ? await storage.persist() : false;
  } catch {
    persisted = false;
  }
  try {
    const estimate = typeof storage.estimate === "function" ? await storage.estimate() : {};
    return { persisted, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
  } catch {
    return { persisted, usage: null, quota: null };
  }
};

/** A waiting update is applied on the user's word (P19-08 § 13): the waiting worker skips waiting. */
export const applyUpdate = (registration: ServiceWorkerRegistration): boolean => {
  if (!registration.waiting) return false;
  registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
};

/**
 * P22-10c2 — the warm-up (P19-08 § 4.3): once the worker controls the page, every static file the
 * page has loaded — the lazily imported ones included — is fetched again THROUGH the worker, which
 * keeps it (`/_next/static` is cache-first). A module loaded before the worker took control is
 * otherwise missing offline: the browser's module cache does not ask the worker again.
 *
 * @returns how many files were fetched
 */
export const warmStatic = async (urls: readonly string[], fetchFile: (url: string) => Promise<unknown>): Promise<number> => {
  const isStatic = (url: string): boolean => {
    try {
      return new URL(url, "https://field.invalid").pathname.startsWith("/_next/static/");
    } catch {
      return false;
    }
  };
  let fetched = 0;
  for (const url of [...new Set(urls.filter(isStatic))]) {
    try {
      await fetchFile(url);
      fetched += 1;
    } catch {
      // Offline or evicted: the feature that needs it says "needs a connection".
    }
  }
  return fetched;
};
