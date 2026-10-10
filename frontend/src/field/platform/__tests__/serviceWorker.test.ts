/**
 * P22-10b — the field worker's registration (P19-08 § 4.1, § 13, § 3.2): registered with scope
 * `/field`, classic, never from the HTTP cache; unregistering removes only the field worker and the
 * `cf-*` caches; the missing features named; persistence asked and the quota read (failures
 * tolerated); an update applied only on the user's word.
 */
import { applyUpdate, missingFeatures, persistence, registerFieldWorker, unregisterFieldWorker } from "../serviceWorker";

describe("P22-10b — the field worker's registration", () => {
  it("registers /sw.js with scope /field, classic, updateViaCache none", async () => {
    const register = jest.fn(async () => ({}) as ServiceWorkerRegistration);
    await registerFieldWorker({ register } as unknown as ServiceWorkerContainer);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/field", type: "classic", updateViaCache: "none" });
  });

  it("unregisters only the field worker and deletes only the cf-* caches", async () => {
    const field = { scope: "https://a.example/field", unregister: jest.fn(async () => true) };
    const other = { scope: "https://a.example/", unregister: jest.fn(async () => true) };
    const stuck = { scope: "https://a.example/field/", unregister: jest.fn(async () => false) };
    const deleted: string[] = [];
    const caches = { keys: async () => ["cf-shell-v1", "cf-static-v1", "next-data"], delete: async (n: string) => (deleted.push(n), true) } as unknown as CacheStorage;
    const removed = await unregisterFieldWorker({ getRegistrations: async () => [field, other, stuck] } as unknown as ServiceWorkerContainer, caches);
    expect(removed).toBe(1);
    expect(other.unregister).not.toHaveBeenCalled();
    expect(deleted).toEqual(["cf-shell-v1", "cf-static-v1"]);
    expect(await unregisterFieldWorker({ getRegistrations: async () => [] } as unknown as ServiceWorkerContainer, undefined)).toBe(0);
  });

  it("names what a browser lacks", () => {
    expect(missingFeatures({})).toEqual(["Service Worker", "Cache Storage", "IndexedDB", "Web Crypto"]);
    expect(missingFeatures({ serviceWorker: {} as never, caches: {} as never, indexedDB: {} as never, subtle: {} as never })).toEqual([]);
  });

  it("persistence: granted or not, the quota read; a missing API or a failure tolerated", async () => {
    expect(await persistence(undefined)).toEqual({ persisted: false, usage: null, quota: null });
    expect(await persistence({ persist: async () => true, estimate: async () => ({ usage: 5, quota: 100 }) } as unknown as StorageManager)).toEqual({ persisted: true, usage: 5, quota: 100 });
    expect(await persistence({ estimate: async () => ({}) } as unknown as StorageManager)).toEqual({ persisted: false, usage: null, quota: null });
    expect(
      await persistence({
        persist: async () => {
          throw new Error("x");
        },
        estimate: async () => {
          throw new Error("y");
        },
      } as unknown as StorageManager),
    ).toEqual({ persisted: false, usage: null, quota: null });
    expect(await persistence({} as StorageManager)).toEqual({ persisted: false, usage: null, quota: null });
  });

  it("an update applies only when one is waiting, by SKIP_WAITING", () => {
    const postMessage = jest.fn();
    expect(applyUpdate({ waiting: { postMessage } } as unknown as ServiceWorkerRegistration)).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(applyUpdate({ waiting: null } as unknown as ServiceWorkerRegistration)).toBe(false);
  });
});
