/**
 * P22-10b — the per-profile registry (P19-08 § 7.1, § 11; AM-23): the database
 * `callibrator-field-registry`, store `users`, rows of ids, counts and timestamps ONLY (it names
 * nobody), and the `localStorage` flag `cf.field.present = "1"` that tells the authenticated shells
 * to load the profile guard (so a profile that never enabled field mode pays nothing).
 */
import type { RegistryRow } from "../engine/registry";
import { done, openDb, tx } from "./idb";

export const REGISTRY_DB = "callibrator-field-registry";
export const PRESENT_FLAG = "cf.field.present";

/** The flag's storage (the browser's `localStorage`, which can throw in a private window). */
export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RegistryStore {
  list(): Promise<RegistryRow[]>;
  put(row: RegistryRow): Promise<void>;
  remove(key: string): Promise<void>;
  close(): void;
}

export async function openRegistry(factory: IDBFactory, flags: FlagStorage | null): Promise<RegistryStore> {
  const db = await openDb(factory, REGISTRY_DB, 1, (d) => {
    if (!d.objectStoreNames.contains("users")) d.createObjectStore("users", { keyPath: "key" });
  });
  const setFlag = (present: boolean) => {
    try {
      if (present) flags?.setItem(PRESENT_FLAG, "1");
      else flags?.removeItem(PRESENT_FLAG);
    } catch {
      // A private window: the guard then runs only from the field app itself.
    }
  };
  const registry: RegistryStore = {
    list: () => tx(db, "users", "readonly", async (t) => (await done(t.objectStore("users").getAll())) as RegistryRow[]),
    async put(row) {
      // Only the four registry fields are written: nothing else can slip into the clear.
      const clean: RegistryRow = { key: row.key, outboxCount: row.outboxCount, workingSetPresent: row.workingSetPresent, lastSyncServerAt: row.lastSyncServerAt };
      await tx(db, "users", "readwrite", async (t) => {
        await done(t.objectStore("users").put(clean));
      });
      setFlag(true);
    },
    async remove(key) {
      await tx(db, "users", "readwrite", async (t) => {
        await done(t.objectStore("users").delete(key));
      });
      if ((await registry.list()).length === 0) setFlag(false);
    },
    close() {
      db.close();
    },
  };
  return registry;
}

/** Whether this profile ever enabled field mode (read without opening anything). */
export const fieldPresent = (flags: FlagStorage | null): boolean => {
  try {
    return flags?.getItem(PRESENT_FLAG) === "1";
  } catch {
    return false;
  }
};
