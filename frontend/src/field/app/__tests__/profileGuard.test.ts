/** @jest-environment node */
/** P22-10c1 — the profile guard's browser entry: no IndexedDB → nothing; else the guard over the browser's stores. */
import { IDBFactory } from "fake-indexeddb";
import { openRegistry } from "../../platform/registryStore";
import { runFieldProfileGuard } from "../profileGuard";

it("does nothing without IndexedDB; with it, purges other users' sets (none here)", async () => {
  expect(await runFieldProfileGuard({}, { id: "u", tenantId: "t" })).toBeNull();
  const idb = new IDBFactory();
  const r = await openRegistry(idb, null);
  await r.put({ key: "t:other", outboxCount: 2, workingSetPresent: false, lastSyncServerAt: null });
  r.close();
  expect(await runFieldProfileGuard({ indexedDB: idb }, { id: "u", tenantId: "t" })).toEqual({ purged: 0, othersPending: 2 });
  const map = new Map<string, string>();
  const storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => map.set(k, v), removeItem: (k: string) => map.delete(k) } as unknown as Storage;
  expect(await runFieldProfileGuard({ indexedDB: idb, localStorage: storage }, { id: "u", tenantId: "t" })).toEqual({ purged: 0, othersPending: 2 });
});
