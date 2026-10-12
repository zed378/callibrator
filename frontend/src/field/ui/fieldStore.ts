/**
 * P22-10c2 — the field app's state (P19-08 § 3.3): one Zustand store, in memory, over the runtime
 * of P22-10c1. It holds the DECRYPTED working set (the index), the catalogue, the rooms, the
 * captures and the sync state; every change is written through the engine to IndexedDB **before**
 * the store reflects it. React reads it with a selector (no effect sets state: the React Compiler
 * rule), and the store is created per app instance with injected browser deps, so the tests drive
 * it in node over `fake-indexeddb`.
 *
 * Boot: online, `POST /auth/verify` names the user and the profile guard runs (AM-23); offline, the
 * registry row holding data names the database to open and its stored profile stands in for the
 * verify (nothing is sent). Offline mode is on for a user when the registry has their row.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { describeApiError } from "@/api/client";
import type { CapturePatch, CycleReport, NewCapture, SyncStatus, AttentionAction } from "../engine/engine";
import type { Capture } from "../engine/model";
import { registryKey, type RegistryRow } from "../engine/registry";
import { openFieldStore } from "../platform/idbStore";
import { openRegistry } from "../platform/registryStore";
import { missingFeatures, persistence, registerFieldWorker, unregisterFieldWorker, applyUpdate, type BrowserCapabilities } from "../platform/serviceWorker";
import type { FieldDevice, FieldFacility, FieldRoom, FieldUser, SubmittedVisit } from "../app/fieldApi";
import { admitPhoto, type PhotoRefusal } from "../app/photos";
import type { PhotoCodec } from "@/lib/photoPrep";
import { adminWipe, enableOffline, fieldProfileGuard, mayWipe, openRuntime, type FieldDeps, type FieldRuntime, type WipeResult } from "../app/runtime";
import { checkChoice, downloadWorkingSet, indexWorkingSet, refreshCatalogue, sizeUp, type CatalogueCopy, type ChoiceError, type DownloadedFacility, type SizedFacility, type WorkingSetIndex } from "../app/workingSet";
import type { components } from "@/api/typed";

export type PublishedCatalogue = components["schemas"]["InspectionPublishedCatalogue"];

export type Phase =
  /** Reading who we are and what this phone holds. */
  | "booting"
  /** Offline, and this phone holds no offline data: nothing can be done. */
  | "offline_empty"
  /** Online, offline mode not on for this user (or the browser cannot): the Settings screen. */
  | "setup"
  /** Offline mode on: the store and the engine are open. */
  | "ready";

export interface FieldState {
  readonly phase: Phase;
  readonly online: boolean;
  /** What this browser lacks to work offline (empty: it can). */
  readonly missing: readonly string[];
  readonly user: FieldUser | null;
  /** Another user's data blocks enabling (AM-23). */
  readonly blockedByOther: boolean;
  /** Another user's unsynced captures on this phone (a count only). */
  readonly othersPending: number;
  readonly status: SyncStatus | null;
  /** Device-clock ms of the last successful sync (the working set's expiry counts from it). */
  readonly lastSyncDeviceAt: number | null;
  readonly syncing: boolean;
  readonly lastReport: CycleReport | null;
  readonly index: WorkingSetIndex;
  readonly facilities: readonly DownloadedFacility[];
  readonly catalogue: PublishedCatalogue | null;
  readonly rooms: readonly FieldRoom[];
  readonly captures: readonly Capture[];
  readonly submitted: readonly SubmittedVisit[];
  readonly storage: { readonly persisted: boolean; readonly usage: number | null; readonly quota: number | null } | null;
  readonly updateReady: boolean;
  readonly download: { readonly done: number; readonly total: number } | null;
  /** The last failure, as a message key of `field.error.*` (and the server's words when it gave some). */
  readonly error: { readonly key: string; readonly detail: string | null } | null;
}

export interface FieldActions {
  boot(): Promise<void>;
  /** The device clock the runtime uses (the screens compute the expiry with the same one). */
  now(): number;
  setOnline(online: boolean): void;
  /** The facilities this user may take offline. */
  listFacilities(): Promise<FieldFacility[]>;
  /** Sizes first (§ 7.2). */
  size(facilities: readonly FieldFacility[]): Promise<SizedFacility[]>;
  /** Enable offline mode and download (opt-in, § 3.2). */
  prepare(facilities: readonly SizedFacility[]): Promise<ChoiceError | "blocked" | "failed" | null>;
  syncNow(trigger: string): Promise<CycleReport | null>;
  /** Offline mode off (= sign-out of the field app): refused with a non-empty outbox. */
  turnOff(): Promise<{ refused: boolean; pending: number }>;
  otherUsers(): Promise<RegistryRow[]>;
  wipe(key: string): Promise<WipeResult>;
  applyUpdate(): boolean;
  createCapture(input: NewCapture): Promise<string>;
  editCapture(localId: string, patch: CapturePatch): Promise<void>;
  addPhoto(localId: string, file: File, purpose: string): Promise<PhotoRefusal | null>;
  removePhoto(localId: string, photoId: string): Promise<void>;
  photo(photoId: string): Promise<Blob | null>;
  submit(localId: string): Promise<void>;
  discard(localId: string): Promise<void>;
  resolve(localId: string, action: AttentionAction): Promise<void>;
  lookupQr(text: string): Promise<FieldDevice[]>;
  close(): void;
}

export type FieldStoreState = FieldState & FieldActions;

export interface StoreDeps {
  readonly field: FieldDeps;
  readonly capabilities: BrowserCapabilities;
  /** Reload the page after the user applied an update (`location.reload`). */
  readonly reload: () => void;
  /** The image codec (the browser's by default; a test passes its own — node has no decoder). */
  readonly photoCodec?: PhotoCodec;
}

const EMPTY_INDEX = indexWorkingSet([]);

const initial: FieldState = {
  phase: "booting",
  online: true,
  missing: [],
  user: null,
  blockedByOther: false,
  othersPending: 0,
  status: null,
  lastSyncDeviceAt: null,
  syncing: false,
  lastReport: null,
  index: EMPTY_INDEX,
  facilities: [],
  catalogue: null,
  rooms: [],
  captures: [],
  submitted: [],
  storage: null,
  updateReady: false,
  download: null,
  error: null,
};

const splitKey = (key: string): { tenantId: string; userId: string } => {
  const i = key.indexOf(":");
  return { tenantId: key.slice(0, i), userId: key.slice(i + 1) };
};

/** Whether an error is "no answer" (offline, timeout) rather than an answer. */
const noAnswer = (err: unknown): boolean => {
  const e = describeApiError(err);
  return e.kind === "network" || e.kind === "timeout";
};

export function createFieldStore(deps: StoreDeps): StoreApi<FieldStoreState> {
  let runtime: FieldRuntime | null = null;
  let unsubscribeEngine: (() => void) | null = null;
  let registration: ServiceWorkerRegistration | null = null;
  const cleanups: (() => void)[] = [];

  return createStore<FieldStoreState>()((set, get) => {
    const fail = (key: string, err: unknown): void => {
      set({ error: { key, detail: describeApiError(err).message } });
    };

    /** Everything the screens read, from the encrypted store into memory. */
    const reload = async (): Promise<void> => {
      const rt = runtime as FieldRuntime;
      const [devices, facilities, catalogue, rooms, captures, status, meta] = await Promise.all([
        rt.store.readWorkingSet(),
        rt.store.readFacilities(),
        rt.store.readCatalogue(),
        rt.store.readRooms("tenant"),
        rt.store.listCaptures(),
        rt.engine.status(),
        rt.store.getMeta(),
      ]);
      set({
        index: indexWorkingSet(devices as FieldDevice[]),
        facilities: facilities as DownloadedFacility[],
        catalogue: ((catalogue as CatalogueCopy | null)?.document ?? null) as PublishedCatalogue | null,
        rooms: (rooms ?? []) as FieldRoom[],
        captures: [...captures].sort((a, b) => b.updatedAt - a.updatedAt),
        status,
        lastSyncDeviceAt: meta.workingSetPresent ? meta.lastSyncDeviceAt : null,
      });
    };

    const watchWorker = async (): Promise<void> => {
      const container = deps.capabilities.serviceWorker;
      if (!container) return;
      registration = (await container.getRegistration("/field")) ?? null;
      if (!registration) return;
      const reg = registration;
      if (reg.waiting) set({ updateReady: true });
      const onUpdate = (): void => {
        const installing = reg.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && container.controller) set({ updateReady: true });
        });
      };
      const onController = (): void => deps.reload();
      reg.addEventListener("updatefound", onUpdate);
      container.addEventListener("controllerchange", onController);
      cleanups.push(() => {
        reg.removeEventListener("updatefound", onUpdate);
        container.removeEventListener("controllerchange", onController);
      });
    };

    /** Opens the user's runtime; `ready` false keeps the Settings screen up (a download follows). */
    const open = async (user: FieldUser, ready = true): Promise<void> => {
      runtime = await openRuntime(deps.field, user);
      unsubscribeEngine = runtime.engine.subscribe((status) => set({ status }));
      set(ready ? { user, phase: "ready" } : { user });
      await reload();
      await watchWorker().catch(() => undefined);
      set({ storage: await persistence(deps.capabilities.storage) });
    };

    const readRows = async (): Promise<RegistryRow[]> => {
      const registry = await openRegistry(deps.field.idb, deps.field.flags);
      try {
        return await registry.list();
      } finally {
        registry.close();
      }
    };

    return {
      ...initial,

      async boot() {
        const missing = missingFeatures(deps.capabilities);
        const online = deps.field.globals.onLine();
        set({ missing, online });
        if (missing.includes("IndexedDB") || missing.includes("Web Crypto")) {
          set({ phase: online ? "setup" : "offline_empty" });
          return;
        }
        let user: FieldUser | null = null;
        if (online) {
          try {
            user = await deps.field.api.whoAmI();
          } catch (err) {
            if (!noAnswer(err)) {
              fail("verify", err);
              set({ phase: "setup" });
              return;
            }
            set({ online: false });
          }
        }
        if (user) {
          const guard = await fieldProfileGuard(deps.field, user);
          // Read AFTER the guard: other users' working sets are gone, so only an outbox blocks (AM-23).
          const rows = await readRows();
          const me = registryKey(user.tenantId, user.id);
          set({ user, othersPending: guard.othersPending, blockedByOther: rows.some((r) => r.key !== me && r.outboxCount > 0) });
          if (rows.some((r) => r.key === me)) {
            await open(user);
            await (runtime as FieldRuntime).store.putProfile({ roleName: user.roleName, roleLevel: user.roleLevel, clientFacilityId: user.clientFacilityId, scopeFingerprint: user.scopeFingerprint });
            void get().syncNow("start");
          } else {
            set({ phase: "setup" });
          }
          return;
        }
        const rows = await readRows();
        // Offline: the row holding data is the one user this phone works for (AM-23).
        const row = rows.find((r) => r.outboxCount > 0 || r.workingSetPresent) ?? rows[0];
        if (!row) {
          set({ phase: "offline_empty" });
          return;
        }
        const { tenantId, userId } = splitKey(row.key);
        const peek = await openFieldStore(deps.field.idb, deps.field.crypto, tenantId, userId);
        const profile = await peek.readProfile();
        peek.close();
        await open({ id: userId, tenantId, ...(profile ?? { roleName: null, roleLevel: 0, clientFacilityId: null, scopeFingerprint: "" }) });
      },

      now() {
        return deps.field.globals.now();
      },

      setOnline(online) {
        set({ online });
        if (online && runtime) void get().syncNow("online");
      },

      async listFacilities() {
        const user = get().user;
        if (!user) return [];
        try {
          return await deps.field.api.facilities(user);
        } catch (err) {
          fail("facilities", err);
          return [];
        }
      },

      async size(facilities) {
        try {
          return await sizeUp(deps.field.api, facilities);
        } catch (err) {
          fail("size", err);
          return [];
        }
      },

      async prepare(facilities) {
        const user = get().user;
        if (!user) return "failed";
        const choice = checkChoice(
          user,
          facilities.map((f) => f.id),
        );
        if (choice) return choice;
        const allowed = await enableOffline(deps.field, user);
        if (!allowed.allowed) {
          set({ blockedByOther: true });
          return "blocked";
        }
        set({ error: null, download: { done: 0, total: facilities.reduce((n, f) => n + (f.total ?? 0), 0) } });
        try {
          if (deps.capabilities.serviceWorker) await registerFieldWorker(deps.capabilities.serviceWorker);
          if (!runtime) await open(user, false);
          const rt = runtime as unknown as FieldRuntime;
          await rt.store.putProfile({ roleName: user.roleName, roleLevel: user.roleLevel, clientFacilityId: user.clientFacilityId, scopeFingerprint: user.scopeFingerprint });
          await rt.store.putChoice(facilities.map((f) => f.id));
          await downloadWorkingSet({
            api: deps.field.api,
            store: rt.store,
            facilities,
            scopeFingerprint: user.scopeFingerprint,
            deviceNow: () => deps.field.globals.now(),
            serverNow: null,
            onProgress: (done, total) => set({ download: { done, total } }),
          });
          await rt.syncRegistry();
          await reload();
          set({ phase: "ready" });
          return null;
        } catch (err) {
          fail("download", err);
          return "failed";
        } finally {
          set({ download: null });
        }
      },

      async syncNow(trigger) {
        const rt = runtime;
        if (!rt || get().syncing) return null;
        set({ syncing: true });
        try {
          const report = await rt.engine.runCycle(trigger);
          if (!report.offline && !report.sessionEnded) {
            if (report.purged === "scope_changed") {
              // AM-26: the access changed; re-download the same choice under the new scope.
              const user = await deps.field.api.whoAmI();
              const ids = user.clientFacilityId ? [user.clientFacilityId] : await rt.store.readChoice();
              const facilities = (await deps.field.api.facilities(user)).filter((f) => ids.includes(f.id));
              await downloadWorkingSet({ api: deps.field.api, store: rt.store, facilities: await sizeUp(deps.field.api, facilities), scopeFingerprint: user.scopeFingerprint, deviceNow: () => deps.field.globals.now(), serverNow: null });
            } else if ((await rt.store.getMeta()).workingSetPresent) {
              await refreshCatalogue(deps.field.api, rt.store, deps.field.globals.now());
            }
            set({ submitted: await deps.field.api.submitted((get().user as FieldUser).id) });
            // § 9.1: a synced capture stays until the server state was re-read (this cycle did);
            // its visit is now in the "to sign" list.
            for (const c of await rt.store.listCaptures()) if (c.state === "synced") await rt.store.deleteCapture(c.localId);
          }
          await rt.syncRegistry();
          await reload();
          set({ lastReport: report, online: !report.offline });
          return report;
        } catch (err) {
          fail("sync", err);
          return null;
        } finally {
          set({ syncing: false });
        }
      },

      async turnOff() {
        const rt = runtime;
        if (!rt) return { refused: false, pending: 0 };
        const result = await rt.turnOff();
        if (result.refused) return result;
        (unsubscribeEngine as () => void)();
        runtime = null;
        if (deps.capabilities.serviceWorker) await unregisterFieldWorker(deps.capabilities.serviceWorker, deps.capabilities.caches);
        set({ ...initial, phase: "setup", user: get().user, online: get().online, missing: get().missing });
        return result;
      },

      async otherUsers() {
        const user = get().user;
        if (!user) return [];
        const me = registryKey(user.tenantId, user.id);
        return (await readRows()).filter((r) => r.key !== me);
      },

      async wipe(key) {
        const user = get().user;
        if (!user || !mayWipe(user)) return { done: false, reason: "not_allowed" };
        const result = await adminWipe(deps.field, user, key);
        if (result.done) {
          const others = await get().otherUsers();
          set({ blockedByOther: others.some((r) => r.outboxCount > 0), othersPending: others.reduce((n, r) => n + r.outboxCount, 0) });
        }
        return result;
      },

      applyUpdate() {
        return registration ? applyUpdate(registration) : false;
      },

      async createCapture(input) {
        const localId = await (runtime as FieldRuntime).engine.createCapture(input);
        await reload();
        return localId;
      },
      async editCapture(localId, patch) {
        await (runtime as FieldRuntime).engine.editCapture(localId, patch);
        await reload();
      },
      async addPhoto(localId, file, purpose) {
        const storage = deps.capabilities.storage;
        const admitted = await admitPhoto(file, async () => (storage ? storage.estimate() : null), deps.photoCodec);
        if (!admitted.ok) return admitted.reason;
        await (runtime as FieldRuntime).engine.addPhoto(localId, admitted.file, purpose);
        await reload();
        return null;
      },
      async removePhoto(localId, photoId) {
        await (runtime as FieldRuntime).engine.removePhoto(localId, photoId);
        await reload();
      },
      photo(photoId) {
        return (runtime as FieldRuntime).store.getPhoto(photoId);
      },
      async submit(localId) {
        await (runtime as FieldRuntime).engine.submitLocal(localId);
        await reload();
        void get().syncNow("submit");
      },
      async discard(localId) {
        await (runtime as FieldRuntime).engine.discardLocal(localId);
        await reload();
        void get().syncNow("discard");
      },
      async resolve(localId, action) {
        await (runtime as FieldRuntime).engine.resolveAttention(localId, action);
        await reload();
        void get().syncNow("resolve");
      },

      async lookupQr(text) {
        const local = get().index.byQr(text);
        if (local.length > 0 || !get().online) return local;
        try {
          const hit = await deps.field.api.byQr(text.replace(/\s+/g, "").toUpperCase());
          return hit ? [hit] : [];
        } catch (err) {
          if (noAnswer(err)) set({ online: false });
          return [];
        }
      },

      close() {
        for (const cleanup of cleanups.splice(0)) cleanup();
        unsubscribeEngine?.();
        runtime?.close();
        runtime = null;
      },
    };
  });
}
