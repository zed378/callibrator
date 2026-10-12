/**
 * P22-10c1 — the field app's runtime: one user's encrypted store, the sync engine over it, and the
 * per-profile registry kept in step (P19-08 § 7.1, § 10, § 11; AM-23). Everything a browser gives
 * is passed in (`FieldDeps`), so the tests run it over `fake-indexeddb` and node's WebCrypto.
 *
 *  - **open:** the user's database (its key made on first use); a row of the registry for the user;
 *    a working set the profile guard dropped while another user was signed in is reconciled
 *    (`meta.workingSetPresent` cannot be changed without the key, so it is corrected here);
 *  - **purge triggers wired:** the session ending (`client.ts#onSessionEnd` — the refresh failed),
 *    a scope-loss code on any field read, the clocks at open and every 10 minutes;
 *  - **the registry** follows every engine status change (outbox count, working set, last sync);
 *  - **sign-out / offline mode off:** refused with a non-empty outbox; otherwise the database and its
 *    row are deleted and the worker unregistered.
 */
import { isScopeLossCode } from "@callibrator/contracts/clientFacilities";
import { createSyncEngine, type SyncEngine } from "../engine/engine";
import type { EngineConfig } from "../engine/config";
import type { Transport } from "../engine/ports";
import { signOutAllowed } from "../engine/purge";
import { canEnable, onSignIn, registryKey, type RegistryRow } from "../engine/registry";
import { browserPorts, type BrowserGlobals, type BrowserPorts } from "../platform/browserPorts";
import type { CryptoDeps } from "../platform/crypto";
import { deleteDb } from "../platform/idb";
import { countForeignOutbox, dbName, dropForeignWorkingSet, openFieldStore, type FieldStore } from "../platform/idbStore";
import { openRegistry, type FlagStorage, type RegistryStore } from "../platform/registryStore";
import type { FieldApi, FieldUser } from "./fieldApi";

export interface FieldDeps {
  readonly idb: IDBFactory;
  readonly crypto: CryptoDeps;
  readonly flags: FlagStorage | null;
  readonly globals: BrowserGlobals;
  readonly transport: Transport;
  readonly api: FieldApi;
  /** `client.ts#onSessionEnd` (a seam: the tests pass their own). */
  readonly onSessionEnd: (hook: () => Promise<void>) => () => void;
  readonly config?: Partial<EngineConfig>;
}

/** The clock check while the app is open (P19-08 § 10: every 10 minutes). */
export const CLOCK_CHECK_MS = 10 * 60 * 1000;

/** `localStorage` key of the wipes recorded on the server whose deletion has not finished (ids only). */
export const WIPE_PENDING_FLAG = "cf.field.wipePending";

export interface FieldRuntime {
  readonly user: FieldUser;
  readonly key: string;
  readonly store: FieldStore;
  readonly engine: SyncEngine;
  readonly registry: RegistryStore;
  readonly ports: BrowserPorts;
  /** Purges when a field read answered a scope-loss code; true when it did. */
  scopeLoss(code: string | null): Promise<boolean>;
  /** Writes this user's registry row from the engine's status. */
  syncRegistry(): Promise<void>;
  /** Sign-out or offline mode off: refused with a non-empty outbox; else the database is deleted. */
  turnOff(): Promise<{ refused: boolean; pending: number }>;
  close(): void;
}

const splitKey = (key: string): { tenantId: string; userId: string } => {
  const i = key.indexOf(":");
  return { tenantId: key.slice(0, i), userId: key.slice(i + 1) };
};

export async function openRuntime(deps: FieldDeps, user: FieldUser): Promise<FieldRuntime> {
  const key = registryKey(user.tenantId, user.id);
  const registry = await openRegistry(deps.idb, deps.flags);
  const store = await openFieldStore(deps.idb, deps.crypto, user.tenantId, user.id);
  const ports = browserPorts(deps.globals);
  const engine = createSyncEngine({ store, transport: deps.transport, ...ports }, deps.config);

  // The profile guard may have dropped this user's working set while another user was signed in.
  const mine = (await registry.list()).find((r) => r.key === key);
  const meta = await store.getMeta();
  if (mine && !mine.workingSetPresent && meta.workingSetPresent) await store.putMeta({ ...meta, workingSetPresent: false });

  // Row writes are serialised and stop once the runtime closes, so a late write never re-creates
  // a row that turning off has just removed.
  let closed = false;
  let registryWrite: Promise<void> = Promise.resolve();
  const syncRegistry = (): Promise<void> => {
    const next = registryWrite.then(async () => {
      if (closed) return;
      const status = await engine.status();
      const m = await store.getMeta();
      await registry.put({ key, outboxCount: status.outbox, workingSetPresent: m.workingSetPresent, lastSyncServerAt: m.lastSyncServerAt });
    });
    registryWrite = next.catch(() => undefined);
    return next;
  };
  await syncRegistry();

  const unsubscribe = engine.subscribe(() => {
    // A row write that loses a race with closing is written again at the next open.
    syncRegistry().catch(() => undefined);
  });
  const unhook = deps.onSessionEnd(async () => {
    await engine.onSessionEnded();
    await syncRegistry();
  });
  await engine.checkClock(null);
  const tick = (): void => {
    if (closed) return;
    void engine
      .checkClock(null)
      .then(syncRegistry)
      .finally(() => {
        if (!closed) stopClock = ports.scheduler.setTimeout(tick, CLOCK_CHECK_MS);
      });
  };
  let stopClock = ports.scheduler.setTimeout(tick, CLOCK_CHECK_MS);

  const stop = (): void => {
    closed = true;
    unsubscribe();
    unhook();
    stopClock();
  };
  const close = (): void => {
    if (closed) return;
    stop();
    store.close();
    registry.close();
  };

  return {
    user,
    key,
    store,
    engine,
    registry,
    ports,
    async scopeLoss(code) {
      if (!isScopeLossCode(code)) return false;
      await engine.onScopeLost(code);
      await syncRegistry();
      return true;
    },
    syncRegistry,
    async turnOff() {
      const pending = (await engine.status()).outbox;
      if (!signOutAllowed(pending)) return { refused: true, pending };
      stop();
      await registryWrite;
      await registry.remove(key);
      registry.close();
      await store.destroy();
      return { refused: false, pending: 0 };
    },
    close,
  };
}

/** Enabling offline mode for `me` (§ 11.1): refused while another user holds data; others' empty rows go. */
export async function enableOffline(deps: Pick<FieldDeps, "idb" | "flags">, user: FieldUser): Promise<{ allowed: boolean }> {
  const registry = await openRegistry(deps.idb, deps.flags);
  try {
    const decision = canEnable(await registry.list(), registryKey(user.tenantId, user.id));
    if (!decision.allowed) return { allowed: false };
    for (const k of decision.removeKeys) {
      const { tenantId, userId } = splitKey(k);
      await deleteDb(deps.idb, dbName(tenantId, userId));
      await registry.remove(k);
    }
    return { allowed: true };
  } finally {
    registry.close();
  }
}

/**
 * The profile guard (§ 11.2, AM-23): run by the authenticated shells when the profile carries the
 * field flag. Every OTHER user's working set is dropped without opening their key; their outbox is
 * left encrypted and untouched; the count of their pending captures is returned for the note.
 */
export async function fieldProfileGuard(deps: Pick<FieldDeps, "idb" | "flags">, user: { id: string; tenantId: string }): Promise<{ purged: number; othersPending: number }> {
  const registry = await openRegistry(deps.idb, deps.flags);
  try {
    const rows = await registry.list();
    const plan = onSignIn(rows, registryKey(user.tenantId, user.id));
    for (const k of plan.purgeKeys) {
      const { tenantId, userId } = splitKey(k);
      await dropForeignWorkingSet(deps.idb, dbName(tenantId, userId));
      const row = rows.find((r) => r.key === k) as RegistryRow;
      await registry.put({ ...row, workingSetPresent: false });
    }
    await retryPendingWipes(deps, registry);
    return { purged: plan.purgeKeys.length, othersPending: plan.othersPending };
  } finally {
    registry.close();
  }
}

const readPending = (flags: FlagStorage | null): string[] => {
  try {
    const raw = flags?.getItem(WIPE_PENDING_FLAG);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
};
const writePending = (flags: FlagStorage | null, keys: readonly string[]): void => {
  if (!flags) return;
  try {
    if (keys.length === 0) flags.removeItem(WIPE_PENDING_FLAG);
    else flags.setItem(WIPE_PENDING_FLAG, JSON.stringify(keys));
  } catch {
    // A private window: the deletion is retried only within this page.
  }
};

/** A wipe recorded on the server whose deletion failed is retried at the next launch (ADR-135). */
async function retryPendingWipes(deps: Pick<FieldDeps, "idb" | "flags">, registry: RegistryStore): Promise<void> {
  const pending = readPending(deps.flags);
  const left: string[] = [];
  for (const k of pending) {
    const { tenantId, userId } = splitKey(k);
    try {
      await deleteDb(deps.idb, dbName(tenantId, userId));
      await registry.remove(k);
    } catch {
      left.push(k);
    }
  }
  if (pending.length > 0) writePending(deps.flags, left);
}

/** Whether this user may wipe another user's field data (§ 11.3): an unbound tenant administrator (the server decides again). */
export const mayWipe = (user: FieldUser): boolean => user.clientFacilityId === null && user.roleLevel >= 8;

export type WipeResult = { readonly done: true; readonly captures: number; readonly photos: number } | { readonly done: false; readonly reason: "offline" | "not_allowed" | "own_data" | "not_recorded" };

/**
 * The administrator wipe (§ 11.3, as amended by ADR-135): the counts are read without the key, the
 * wipe is RECORDED on the server first (`POST /field/wipes`), and only then is the database deleted;
 * a failed deletion is retried at the next launch. Offline, nothing happens ("needs a connection").
 */
export async function adminWipe(deps: Pick<FieldDeps, "idb" | "flags" | "api" | "globals">, admin: FieldUser, targetKey: string): Promise<WipeResult> {
  if (!mayWipe(admin)) return { done: false, reason: "not_allowed" };
  if (targetKey === registryKey(admin.tenantId, admin.id)) return { done: false, reason: "own_data" };
  if (!deps.globals.onLine()) return { done: false, reason: "offline" };
  const { tenantId, userId } = splitKey(targetKey);
  const name = dbName(tenantId, userId);
  const counts = await countForeignOutbox(deps.idb, name);
  try {
    await deps.api.recordWipe(userId, counts.captures, counts.photos);
  } catch {
    return { done: false, reason: "not_recorded" };
  }
  const registry = await openRegistry(deps.idb, deps.flags);
  try {
    await deleteDb(deps.idb, name);
    await registry.remove(targetKey);
  } catch {
    writePending(deps.flags, [...readPending(deps.flags), targetKey]);
  } finally {
    registry.close();
  }
  return { done: true, ...counts };
}
