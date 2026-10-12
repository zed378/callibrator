/**
 * P22-10c2 — a field store rig for the tests: the REAL runtime over `fake-indexeddb` and node
 * WebCrypto, the engine's fake server, a fake field API on the contract's key list, a fake worker
 * container. A catalogue with one device type and an empty checklist version unless a test sets one.
 */
import { IDBFactory } from "fake-indexeddb";
import { FakeServer } from "../../engine/testing/memory";
import type { FieldDeps } from "../../app/runtime";
import { createFieldStore, type StoreDeps } from "../fieldStore";
import { crypto, device, F1, F2, FakeFieldApi, FakeGlobals, MemoryFlags } from "../../app/__tests__/fieldHelpers";

export const catalogueDoc = {
  schema: "inspection-catalogue-v1",
  deviceTypes: [{ id: "type-1", name: "Infusion pump" }],
  versions: [{ id: "v1", templateId: "t1", deviceTypeId: "type-1", versionNumber: 1, baseVersionId: null, contentHash: "h", publishedAt: null, items: [] }],
};

export interface Rig {
  deps: StoreDeps;
  api: FakeFieldApi;
  server: FakeServer;
  globals: FakeGlobals;
  idb: IDBFactory;
  flags: MemoryFlags;
  worker: { registered: number; unregistered: number; container: ServiceWorkerContainer };
}

export const rig = (over: Partial<StoreDeps["capabilities"]> = {}): Rig => {
  const idb = new IDBFactory();
  const flags = new MemoryFlags();
  const globals = new FakeGlobals();
  const server = new FakeServer();
  const api = new FakeFieldApi();
  api.catalogueDoc = catalogueDoc;
  api.devices.set(F1, [device("d1", F1, "RS000001"), { ...device("d2", F1, "RS000002"), deviceTypeId: "type-1" }]);
  api.devices.set(F2, [device("e1", F2, "RS000101")]);
  const worker = { registered: 0, unregistered: 0, container: null as unknown as ServiceWorkerContainer };
  worker.container = {
    register: async () => {
      worker.registered += 1;
      return {} as ServiceWorkerRegistration;
    },
    getRegistrations: async () => [{ scope: "https://x/field", unregister: async () => ((worker.unregistered += 1), true) }],
    getRegistration: async () => undefined,
    addEventListener: () => undefined,
  } as unknown as ServiceWorkerContainer;
  const field: FieldDeps = { idb, crypto, flags, globals, transport: server, api, onSessionEnd: () => () => undefined };
  return {
    deps: {
      field,
      capabilities: { serviceWorker: worker.container, caches: { keys: async () => [], delete: async () => true } as unknown as CacheStorage, indexedDB: idb, subtle: crypto.subtle, storage: { persist: async () => true, estimate: async () => ({ usage: 1, quota: 10 ** 10 }) } as unknown as StorageManager, ...over },
      reload: () => undefined,
    },
    api,
    server,
    globals,
    idb,
    flags,
    worker,
  };
};

export const sized = async (store: ReturnType<typeof createFieldStore>, ids: string[]) => {
  const list = (await store.getState().listFacilities()).filter((f) => ids.includes(f.id));
  return store.getState().size(list);
};


/** Waits until the store runs no sync cycle (a cycle started by an action runs on its own). */
export const idle = async (store: ReturnType<typeof createFieldStore>): Promise<void> => {
  for (let i = 0; i < 400; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
    if (!store.getState().syncing) return;
  }
  throw new Error("the store never went idle");
};
