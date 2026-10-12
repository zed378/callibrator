/** @jest-environment node */
/**
 * P22-10c1 — the field runtime over the REAL encrypted store and registry (`fake-indexeddb`, node
 * WebCrypto) and the engine's fake server (P19-08 § 10, § 11; AM-23, AM-24, ADR-135):
 *  - open writes this user's registry row and follows the engine's status;
 *  - the purge triggers wired in: the session ending (the client's hook), a scope-loss code (and
 *    not any other code), the clocks at open and every 10 minutes — the outbox survives each;
 *  - a working set dropped by the profile guard is reconciled in `meta` at the next open;
 *  - turning off: refused with a non-empty outbox; else the database and its row are deleted;
 *  - enabling: refused while another user holds data; another user's empty row is removed;
 *  - the profile guard: other users' working sets dropped WITHOUT their key, outboxes untouched;
 *  - the administrator wipe: unbound tenant admin only, online only, recorded BEFORE the deletion,
 *    a failed record deletes nothing, a failed deletion retried at the next launch.
 */
import { IDBFactory } from "fake-indexeddb";
import { FakeServer } from "../../engine/testing/memory";
import { dbName, openFieldStore } from "../../platform/idbStore";
import { openRegistry, PRESENT_FLAG } from "../../platform/registryStore";
import { adminWipe, CLOCK_CHECK_MS, enableOffline, fieldProfileGuard, mayWipe, openRuntime, WIPE_PENDING_FLAG, type FieldDeps } from "../runtime";
import { crypto, device, F1, FakeFieldApi, FakeGlobals, MemoryFlags, settle, TENANT, user } from "./fieldHelpers";

const OTHER = user({ id: "bbbbbbbb-0000-4000-8000-00000000000b" });
const ADMIN = user({ id: "cccccccc-0000-4000-8000-00000000000c", roleName: "TENANT_ADMIN", roleLevel: 8 });

let idb: IDBFactory;
let flags: MemoryFlags;
let globals: FakeGlobals;
let server: FakeServer;
let api: FakeFieldApi;
let hooks: Set<() => Promise<void>>;
let deps: FieldDeps;

beforeEach(() => {
  idb = new IDBFactory();
  flags = new MemoryFlags();
  globals = new FakeGlobals();
  server = new FakeServer();
  api = new FakeFieldApi();
  hooks = new Set();
  deps = {
    idb,
    crypto,
    flags,
    globals,
    transport: server,
    api,
    onSessionEnd: (hook) => {
      hooks.add(hook);
      return () => hooks.delete(hook);
    },
  };
});

const rows = async () => {
  const r = await openRegistry(idb, null);
  const list = await r.list();
  r.close();
  return list;
};

const withWorkingSet = async (u = user()) => {
  const store = await openFieldStore(idb, crypto, u.tenantId, u.id);
  await store.putWorkingSetPage(F1, 1, [device("d1", F1)], globals.now());
  await store.putMeta({ lastSyncDeviceAt: globals.now(), lastSyncServerAt: globals.now(), scopeFingerprint: "fp-1", workingSetPresent: true });
  store.close();
};

const fireSessionEnd = () => Promise.all([...hooks].map((h) => h()));

describe("openRuntime — the registry and the purge triggers", () => {
  it("writes this user's row (ids and counts) and sets the presence flag; follows a new capture", async () => {
    await withWorkingSet();
    const rt = await openRuntime(deps, user());
    expect(await rows()).toEqual([{ key: `${TENANT}:${user().id}`, outboxCount: 0, workingSetPresent: true, lastSyncServerAt: globals.now() }]);
    expect(flags.map.get(PRESENT_FLAG)).toBe("1");
    await rt.engine.createCapture({ kind: "ipm", deviceId: "d1", templateVersionId: "v1" });
    await settle();
    expect((await rows())[0]?.outboxCount).toBe(1);
    rt.close();
    rt.close(); // idempotent
    expect(hooks.size).toBe(0);
  });

  it("the session ending purges the working set and keeps the outbox", async () => {
    await withWorkingSet();
    const rt = await openRuntime(deps, user());
    const localId = await rt.engine.createCapture({ kind: "ipm", deviceId: "d1", templateVersionId: "v1" });
    await fireSessionEnd();
    expect(await rt.store.readWorkingSet()).toEqual([]);
    expect((await rt.store.getMeta()).workingSetPresent).toBe(false);
    expect((await rt.store.getCapture(localId))?.localId).toBe(localId);
    expect((await rows())[0]).toMatchObject({ workingSetPresent: false, outboxCount: 1 });
    rt.close();
  });

  it("a scope-loss code purges; any other code does not", async () => {
    await withWorkingSet();
    const rt = await openRuntime(deps, user());
    expect(await rt.scopeLoss("IPM_NOT_DRAFT")).toBe(false);
    expect(await rt.scopeLoss(null)).toBe(false);
    expect((await rt.store.getMeta()).workingSetPresent).toBe(true);
    expect(await rt.scopeLoss("FACILITY_ENDED")).toBe(true);
    expect(await rt.store.readWorkingSet()).toEqual([]);
    rt.close();
  });

  it("purges at open when the device clock says 72 h passed, and every 10 minutes while open", async () => {
    await withWorkingSet();
    globals.t += 73 * 3600 * 1000;
    const rt = await openRuntime(deps, user());
    expect((await rt.store.getMeta()).workingSetPresent).toBe(false);
    rt.close();

    const g2 = new FakeGlobals();
    const deps2 = { ...deps, idb: new IDBFactory(), globals: g2 };
    const s = await openFieldStore(deps2.idb, crypto, TENANT, user().id);
    await s.putMeta({ lastSyncDeviceAt: g2.now(), lastSyncServerAt: g2.now(), scopeFingerprint: "fp", workingSetPresent: true });
    s.close();
    const rt2 = await openRuntime(deps2, user());
    g2.advance(CLOCK_CHECK_MS);
    await settle();
    expect((await rt2.store.getMeta()).workingSetPresent).toBe(true);
    g2.advance(72 * 3600 * 1000);
    await settle();
    expect((await rt2.store.getMeta()).workingSetPresent).toBe(false);
    expect(g2.timers.size).toBe(1); // re-armed
    rt2.close();
    expect(g2.timers.size).toBe(0);
  });

  it("a tick that fires after close does nothing and does not re-arm", async () => {
    const rt = await openRuntime(deps, user());
    const [timer] = [...globals.timers.values()];
    rt.close();
    timer?.fn();
    await settle();
    expect(globals.timers.size).toBe(0);
  });

  it("a registry write after close does nothing; a failing write rejects to its caller and is swallowed for the subscription", async () => {
    const rt = await openRuntime(deps, user());
    rt.registry.close(); // every later row write fails
    await expect(rt.syncRegistry()).rejects.toThrow();
    await rt.engine.createCapture({ kind: "ipm", deviceId: "d1", templateVersionId: "v1" });
    await settle();
    rt.close();
    await expect(rt.syncRegistry()).resolves.toBeUndefined();
  });

  it("a clock check still in flight when the runtime closes does not re-arm", async () => {
    const rt = await openRuntime(deps, user());
    globals.advance(CLOCK_CHECK_MS);
    rt.close();
    await settle();
    expect(globals.timers.size).toBe(0);
  });

  it("reconciles a working set the profile guard dropped while another user was signed in", async () => {
    await withWorkingSet();
    const first = await openRuntime(deps, user());
    first.close();
    await fieldProfileGuard(deps, OTHER);
    const again = await openRuntime(deps, user());
    expect((await again.store.getMeta()).workingSetPresent).toBe(false);
    again.close();
  });

  it("turning off is refused with a non-empty outbox; with none, the database and the row go", async () => {
    const rt = await openRuntime(deps, user());
    const localId = await rt.engine.createCapture({ kind: "ipm", deviceId: "d1", templateVersionId: "v1" });
    expect(await rt.turnOff()).toEqual({ refused: true, pending: 1 });
    await rt.engine.discardLocal(localId);
    await rt.engine.runCycle("test");
    const result = await rt.turnOff();
    expect(result.refused).toBe(false);
    expect(await rows()).toEqual([]);
    expect(flags.map.has(PRESENT_FLAG)).toBe(false);
    const dbs = await idb.databases();
    expect(dbs.map((d) => d.name)).not.toContain(dbName(TENANT, user().id));
  });
});

describe("enableOffline — one field user per profile (§ 11.1)", () => {
  it("refuses while another user holds an outbox or a working set; removes another user's empty row", async () => {
    await withWorkingSet(OTHER);
    const other = await openRuntime(deps, OTHER);
    other.close();
    expect(await enableOffline(deps, user())).toEqual({ allowed: false });

    const r = await openRegistry(idb, flags);
    await r.put({ key: `${TENANT}:${OTHER.id}`, outboxCount: 0, workingSetPresent: false, lastSyncServerAt: null });
    r.close();
    expect(await enableOffline(deps, user())).toEqual({ allowed: true });
    expect(await rows()).toEqual([]);
    expect((await idb.databases()).map((d) => d.name)).not.toContain(dbName(TENANT, OTHER.id));
  });
});

describe("fieldProfileGuard — another user's sign-in (§ 11.2)", () => {
  it("drops other users' working sets without their key and keeps their outbox; a missing database is not created", async () => {
    await withWorkingSet(OTHER);
    const other = await openRuntime(deps, OTHER);
    await other.engine.createCapture({ kind: "ipm", deviceId: "d1", templateVersionId: "v1" });
    await other.syncRegistry();
    other.close();
    const ghost = await openRegistry(idb, flags);
    await ghost.put({ key: `${TENANT}:ghost`, outboxCount: 0, workingSetPresent: true, lastSyncServerAt: null });
    ghost.close();

    expect(await fieldProfileGuard(deps, user())).toEqual({ purged: 2, othersPending: 1 });
    expect((await idb.databases()).map((d) => d.name)).not.toContain(dbName(TENANT, "ghost"));
    const reopened = await openFieldStore(idb, crypto, TENANT, OTHER.id);
    expect(await reopened.readWorkingSet()).toEqual([]);
    expect(await reopened.listCaptures()).toHaveLength(1);
    reopened.close();
    expect((await rows()).find((r) => r.key.endsWith(OTHER.id))).toMatchObject({ workingSetPresent: false, outboxCount: 1 });
  });
});

describe("adminWipe — the administrator wipe (§ 11.3, ADR-135 order)", () => {
  const seedOther = async () => {
    const other = await openRuntime(deps, OTHER);
    const localId = await other.engine.createCapture({ kind: "ipm", deviceId: "d1", templateVersionId: "v1" });
    await other.engine.addPhoto(localId, new Blob([new Uint8Array([1, 2, 3])]), "ipm_evidence");
    other.close();
  };
  const otherKey = `${TENANT}:${OTHER.id}`;

  it("only an unbound tenant administrator may wipe, never their own data, and only online", async () => {
    expect(mayWipe(ADMIN)).toBe(true);
    expect(mayWipe(user())).toBe(false);
    expect(mayWipe({ ...ADMIN, clientFacilityId: F1 })).toBe(false);
    expect(await adminWipe(deps, user(), otherKey)).toEqual({ done: false, reason: "not_allowed" });
    expect(await adminWipe(deps, ADMIN, `${TENANT}:${ADMIN.id}`)).toEqual({ done: false, reason: "own_data" });
    globals.online = false;
    expect(await adminWipe(deps, ADMIN, otherKey)).toEqual({ done: false, reason: "offline" });
    expect(api.wipes).toEqual([]);
  });

  it("records the counts first, then deletes the database and the row", async () => {
    await seedOther();
    expect(await adminWipe(deps, ADMIN, otherKey)).toEqual({ done: true, captures: 1, photos: 1 });
    expect(api.wipes).toEqual([{ wipedUserId: OTHER.id, captures: 1, photos: 1 }]);
    expect((await idb.databases()).map((d) => d.name)).not.toContain(dbName(TENANT, OTHER.id));
    expect(await rows()).toEqual([]);
    expect(flags.map.has(WIPE_PENDING_FLAG)).toBe(false);
  });

  it("deletes nothing when the server did not record the wipe", async () => {
    await seedOther();
    api.wipeFails = true;
    expect(await adminWipe(deps, ADMIN, otherKey)).toEqual({ done: false, reason: "not_recorded" });
    expect((await idb.databases()).map((d) => d.name)).toContain(dbName(TENANT, OTHER.id));
  });

  it("a recorded wipe whose deletion failed is retried at the next launch (the guard)", async () => {
    await seedOther();
    const failing = Object.assign(Object.create(idb) as IDBFactory, {
      deleteDatabase: () => {
        throw new Error("blocked");
      },
      open: idb.open.bind(idb),
    });
    expect(await adminWipe({ ...deps, idb: failing }, ADMIN, otherKey)).toEqual({ done: true, captures: 1, photos: 1 });
    expect(JSON.parse(flags.map.get(WIPE_PENDING_FLAG) ?? "[]")).toEqual([otherKey]);
    await fieldProfileGuard(deps, ADMIN);
    expect((await idb.databases()).map((d) => d.name)).not.toContain(dbName(TENANT, OTHER.id));
    expect(flags.map.has(WIPE_PENDING_FLAG)).toBe(false);
  });

  it("works without a flag storage, and keeps a key whose retried deletion fails again", async () => {
    await seedOther();
    const failing = Object.assign(Object.create(idb) as IDBFactory, {
      deleteDatabase: () => {
        throw new Error("blocked");
      },
      open: idb.open.bind(idb),
    });
    const noFlags = { ...deps, flags: null };
    expect(await adminWipe({ ...noFlags, idb: failing }, ADMIN, otherKey)).toEqual({ done: true, captures: 1, photos: 1 });
    expect(await fieldProfileGuard(noFlags, ADMIN)).toEqual({ purged: 0, othersPending: 1 });

    flags.map.set(WIPE_PENDING_FLAG, JSON.stringify([otherKey]));
    await fieldProfileGuard({ ...deps, idb: failing }, ADMIN);
    expect(JSON.parse(flags.map.get(WIPE_PENDING_FLAG) ?? "[]")).toEqual([otherKey]);
  });

  it("tolerates a throwing or corrupt pending list", async () => {
    flags.map.set(WIPE_PENDING_FLAG, "{not json");
    expect(await fieldProfileGuard(deps, ADMIN)).toEqual({ purged: 0, othersPending: 0 });
    flags.map.set(WIPE_PENDING_FLAG, JSON.stringify({ a: 1 }));
    expect(await fieldProfileGuard(deps, ADMIN)).toEqual({ purged: 0, othersPending: 0 });
    flags.map.set(WIPE_PENDING_FLAG, JSON.stringify([7, otherKey]));
    await fieldProfileGuard(deps, ADMIN);
    expect(flags.map.has(WIPE_PENDING_FLAG)).toBe(false);
    // A storage that throws: the deletion still happens (only a FAILED deletion needs the list).
    await seedOther();
    flags.throws = true;
    expect(await adminWipe(deps, ADMIN, otherKey)).toEqual({ done: true, captures: 1, photos: 1 });
    expect((await idb.databases()).map((d) => d.name)).not.toContain(dbName(TENANT, OTHER.id));
  });
});
