/**
 * P22-10c2 — the field app's browser wiring: every browser API the store and the runtime use,
 * taken from `window` in one place (the tests build their own `StoreDeps`).
 */
import apiClient, { onSessionEnd } from "@/api/client";
import { createFieldApi } from "../app/fieldApi";
import type { CryptoDeps } from "../platform/crypto";
import type { FlagStorage } from "../platform/registryStore";
import { createTransport } from "../platform/transport";
import type { StoreDeps } from "./fieldStore";

/** The flag storage: `localStorage`, or none where reading it throws (a private window). */
export const flagStorage = (read: () => Storage = () => window.localStorage): FlagStorage | null => {
  try {
    return read();
  } catch {
    return null;
  }
};

export const browserStoreDeps = (): StoreDeps => ({
  field: {
    idb: window.indexedDB,
    crypto: window.crypto as unknown as CryptoDeps,
    flags: flagStorage(),
    globals: {
      now: () => Date.now(),
      getRandomValues: (a) => {
        window.crypto.getRandomValues(a);
        return a;
      },
      onLine: () => navigator.onLine,
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    },
    transport: createTransport(apiClient),
    api: createFieldApi(apiClient),
    onSessionEnd,
  },
  capabilities: {
    serviceWorker: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
    caches: typeof caches === "undefined" ? undefined : caches,
    indexedDB: typeof indexedDB === "undefined" ? undefined : indexedDB,
    subtle: window.crypto?.subtle,
    storage: navigator.storage,
  },
  reload: () => window.location.reload(),
});
