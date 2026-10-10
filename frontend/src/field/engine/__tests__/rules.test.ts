/**
 * P22-10a — the engine's pure rules (P19-08 § 9 – § 11; `06` § 5 – § 9):
 *  - config: P19-08's numbers as defaults, each refused when loosened; the backoff (2 s × 2ⁿ to 5 min,
 *    ± 20 %, `Retry-After` when longer);
 *  - purge: the device clock (72 h, and a clock that ran backwards), the server clock (AM-24), the
 *    scope-loss codes (not `FACILITY_ROUTE_REFUSED`), the fingerprint (AM-26), sign-out refused with
 *    an outbox;
 *  - the one-field-user registry (AM-23);
 *  - classification of every answer;
 *  - the planner's order and its stops; freezing; the canonical JSON; UUID v4.
 */
import { backoffMs, DEFAULT_CONFIG, engineConfig } from "../config";
import { classify, NO_ANSWER } from "../classify";
import { NOTHING_CONFIRMED, type Capture } from "../model";
import { canonicalJson, fnv1a, freeze, headerChanges, plan, uuidV4 } from "../planner";
import { answerPurge, clockPurge, fingerprintPurge, signOutAllowed } from "../purge";
import { canEnable, onSignIn, registryKey } from "../registry";
import { fakeAnswer } from "../testing/memory";

const H = 3600 * 1000;

const capture = (over: Partial<Capture> = {}): Capture => ({
  localId: "l1",
  kind: "ipm",
  state: "editing",
  clientRef: "ref-1",
  dependsOn: null,
  deviceId: "dev-1",
  templateVersionId: "v1",
  capturedOffline: true,
  clientCapturedAt: "2026-10-10T02:00:00.000Z",
  header: {},
  results: [],
  device: null,
  photos: [],
  confirmed: NOTHING_CONFIRMED,
  attention: null,
  keyReplanned: false,
  updatedAt: 0,
  ...over,
});

describe("P22-10a — config", () => {
  it("P19-08's numbers are the defaults; tighter is allowed; looser is refused, each", () => {
    expect(DEFAULT_CONFIG).toEqual({ workingSetLifeMs: 72 * H, parallelCaptures: 2, backoffBaseMs: 2000, backoffMaxMs: 300000, backoffJitter: 0.2, offlineWindowMs: 60000, editDebounceMs: 2000 });
    expect(engineConfig({ workingSetLifeMs: 24 * H, parallelCaptures: 1 }).workingSetLifeMs).toBe(24 * H);
    for (const loose of [
      { workingSetLifeMs: 73 * H },
      { parallelCaptures: 3 },
      { parallelCaptures: 1.5 },
      { backoffBaseMs: 3000 },
      { backoffMaxMs: 600000 },
      { backoffMaxMs: 1000 },
      { backoffJitter: 0.5 },
      { offlineWindowMs: 120000 },
      { editDebounceMs: 5000 },
      { editDebounceMs: -1 },
      { workingSetLifeMs: 0 },
    ]) {
      expect(() => engineConfig(loose)).toThrow("may not be looser than P19-08");
    }
  });

  it("backoff: 2 s × 2ⁿ to 5 min, ± 20 %, the server's Retry-After when longer", () => {
    const c = DEFAULT_CONFIG;
    expect(backoffMs(c, 1, 0.5)).toBe(2000);
    expect(backoffMs(c, 3, 0.5)).toBe(8000);
    expect(backoffMs(c, 30, 0.5)).toBe(300000);
    expect(backoffMs(c, 1, 0)).toBe(1600);
    expect(backoffMs(c, 1, 0.999)).toBe(2399); // the jitter stays within ± 20 %
    expect(backoffMs(c, 0, 0.5)).toBe(2000);
    expect(backoffMs(c, 1, 0.5, 30)).toBe(30000);
    expect(backoffMs(c, 3, 0.5, 1)).toBe(8000);
    expect(backoffMs(c, 3, 0.5, 0)).toBe(8000);
  });
});

describe("P22-10a — purge rules", () => {
  const meta = { lastSyncDeviceAt: 1000, lastSyncServerAt: 5000, scopeFingerprint: "fp", workingSetPresent: true };
  it("the device clock: 72 h, a clock that ran backwards, never synced; nothing to purge without a set", () => {
    expect(clockPurge(DEFAULT_CONFIG, meta, 1000 + 72 * H, null)).toBeNull();
    expect(clockPurge(DEFAULT_CONFIG, meta, 1000 + 72 * H + 1, null)).toBe("device_clock_expired");
    expect(clockPurge(DEFAULT_CONFIG, meta, 999, null)).toBe("device_clock_expired");
    expect(clockPurge(DEFAULT_CONFIG, { ...meta, lastSyncDeviceAt: null }, 0, null)).toBe("device_clock_expired");
    expect(clockPurge(DEFAULT_CONFIG, { ...meta, workingSetPresent: false }, 10 ** 12, null)).toBeNull();
  });
  it("the server clock (AM-24): a rolled-back device clock cannot keep the set once online", () => {
    expect(clockPurge(DEFAULT_CONFIG, meta, 2000, 5000 + 72 * H + 1)).toBe("server_clock_expired");
    expect(clockPurge(DEFAULT_CONFIG, meta, 2000, 5000 + H)).toBeNull();
    expect(clockPurge(DEFAULT_CONFIG, { ...meta, lastSyncServerAt: null }, 2000, 10 ** 12)).toBeNull();
  });
  it("scope-loss codes purge, a refused route does not; a changed fingerprint purges; sign-out needs an empty outbox", () => {
    expect(answerPurge("FACILITY_ENDED")).toBe("scope_lost");
    expect(answerPurge("TENANT_SUSPENDED")).toBe("scope_lost");
    expect(answerPurge("FACILITY_ROUTE_REFUSED")).toBeNull();
    expect(answerPurge(null)).toBeNull();
    expect(fingerprintPurge(meta, "fp")).toBeNull();
    expect(fingerprintPurge(meta, "other")).toBe("scope_changed");
    expect(fingerprintPurge({ ...meta, scopeFingerprint: null }, "other")).toBeNull();
    expect(fingerprintPurge({ ...meta, workingSetPresent: false }, "other")).toBeNull();
    expect(signOutAllowed(0)).toBe(true);
    expect(signOutAllowed(1)).toBe(false);
  });
});

describe("P22-10a — one field user per profile (AM-23)", () => {
  const me = registryKey("t1", "u1");
  const row = (key: string, outboxCount = 0, workingSetPresent = false) => ({ key, outboxCount, workingSetPresent, lastSyncServerAt: null });
  it("enabling: refused while another user has an outbox or a working set; their empty rows removed silently", () => {
    expect(me).toBe("t1:u1");
    expect(canEnable([row(me, 3, true), row("t1:u2")], me)).toEqual({ allowed: true, removeKeys: ["t1:u2"] });
    expect(canEnable([row("t1:u2", 1)], me)).toEqual({ allowed: false, reason: "other_user_data" });
    expect(canEnable([row("t1:u2", 0, true)], me)).toEqual({ allowed: false, reason: "other_user_data" });
  });
  it("another user's sign-in: their working sets purged unopened, their pending count kept as a number", () => {
    expect(onSignIn([row(me, 1, true), row("t1:u2", 2, true), row("t2:u3", 1, false)], me)).toEqual({ purgeKeys: ["t1:u2"], othersPending: 3 });
  });
});

describe("P22-10a — classification", () => {
  it("success, retry, replan, scope loss, attention", () => {
    expect(classify(fakeAnswer(201)).kind).toBe("success");
    expect(classify(fakeAnswer(503, null, { retryAfterSec: 9 }))).toEqual({ kind: "retry", retryAfterSec: 9 });
    expect(classify(fakeAnswer(429)).kind).toBe("retry");
    expect(classify(fakeAnswer(408)).kind).toBe("retry");
    expect(classify(fakeAnswer(409, null, { code: "IDEMPOTENCY_IN_FLIGHT" })).kind).toBe("retry");
    expect(classify(fakeAnswer(409, null, { code: "IDEMPOTENCY_KEY_REUSED" })).kind).toBe("replan");
    expect(classify(fakeAnswer(403, null, { code: "FACILITY_ENDED" }))).toEqual({ kind: "scope_lost", code: "FACILITY_ENDED" });
    expect(classify(fakeAnswer(403, null, { code: "FACILITY_ROUTE_REFUSED" })).kind).toBe("attention");
    for (const status of [400, 404, 409, 413, 415]) expect(classify(fakeAnswer(status)).kind).toBe("attention");
    expect(NO_ANSWER.kind).toBe("retry");
  });
});

describe("P22-10a — the planner", () => {
  it("an IPM in order: create (clientRef, offline claim) → header changes → the whole results → photos → submit", () => {
    const fresh = capture({ header: { performedAt: "2026-10-10T01:00:00.000Z", notes: "n" }, results: [{ inputKind: "check" }] });
    expect(plan(fresh)).toEqual({
      kind: "create",
      method: "POST",
      path: "/api/v1/ipm/sessions",
      body: { deviceId: "dev-1", templateVersionId: "v1", clientRef: "ref-1", capturedOffline: true, clientCapturedAt: "2026-10-10T02:00:00.000Z", performedAt: "2026-10-10T01:00:00.000Z" },
      photo: null,
    });
    const created = { ...fresh, confirmed: { ...NOTHING_CONFIRMED, id: "s1", revision: 0, header: { performedAt: "2026-10-10T01:00:00.000Z" } } };
    expect(plan(created)).toMatchObject({ kind: "header", method: "PATCH", path: "/api/v1/ipm/sessions/s1", body: { revision: 0, notes: "n" } });
    const headed = { ...created, confirmed: { ...created.confirmed, revision: 1, header: { ...created.confirmed.header, notes: "n" } } };
    expect(plan(headed)).toMatchObject({ kind: "results", method: "PUT", body: { revision: 1, results: [{ inputKind: "check" }] } });
    const resulted = { ...headed, confirmed: { ...headed.confirmed, revision: 2, resultsKey: canonicalJson([{ inputKind: "check" }]) }, photos: [{ photoId: "p1", purpose: "ipm_evidence", uploaded: false }] };
    expect(plan(resulted)).toEqual({ kind: "photo", method: "POST", path: "/api/v1/attachments", body: null, photo: { photoId: "p1", fields: { resourceType: "inspectionsession", resourceId: "s1", purpose: "ipm_evidence" } } });
    const photographed = { ...resulted, photos: [{ photoId: "p1", purpose: "ipm_evidence", uploaded: true }] };
    expect(plan(photographed)).toBeNull();
    expect(plan({ ...photographed, state: "submitted_local" })).toMatchObject({ kind: "submit", body: { revision: 2 } });
    expect(plan({ ...photographed, state: "syncing", confirmed: { ...photographed.confirmed, submitted: true } })).toBeNull();
    expect(plan({ ...photographed, state: "synced" })).toBeNull();
    expect(plan({ ...photographed, state: "attention" })).toBeNull();
  });

  it("a create without a header date or a version; a dependency blocks until synced, then gives the device", () => {
    expect(plan(capture({ templateVersionId: null }))).toMatchObject({ body: { deviceId: "dev-1", clientRef: "ref-1" } });
    const dependent = capture({ deviceId: null, dependsOn: "reg-1" });
    expect(plan(dependent)).toBe("blocked");
    expect(plan(dependent, { synced: false, serverId: "dev-9" })).toBe("blocked");
    expect(plan(dependent, { synced: true, serverId: null })).toBe("blocked");
    expect(plan(dependent, { synced: true, serverId: "dev-9" })).toMatchObject({ body: { deviceId: "dev-9" } });
    expect(plan(capture({ deviceId: null }))).toMatchObject({ body: { deviceId: null } });
  });

  it("a registration: the create with its clientRef, then its photos; a discard is a server discard only for an IPM the server has", () => {
    const reg = capture({ kind: "device", deviceId: null, device: { name: "Pump" }, photos: [{ photoId: "p", purpose: "device_front", uploaded: false }] });
    expect(plan(reg)).toMatchObject({ kind: "create", path: "/api/v1/calibration-devices", body: { name: "Pump", clientRef: "ref-1" } });
    expect(plan({ ...reg, device: null })).toMatchObject({ body: { clientRef: "ref-1" } });
    const made = { ...reg, confirmed: { ...NOTHING_CONFIRMED, id: "dev-2" } };
    expect(plan(made)).toMatchObject({ kind: "photo", path: "/api/v1/calibration-devices/dev-2/photos", photo: { fields: { purpose: "device_front" } } });
    expect(plan({ ...made, photos: [] })).toBeNull();
    expect(plan(capture({ state: "discarded_local", confirmed: { ...NOTHING_CONFIRMED, id: "s1" } }))).toMatchObject({ kind: "discard", path: "/api/v1/ipm/sessions/s1/discard" });
    expect(plan(capture({ state: "discarded_local" }))).toBeNull();
    expect(plan({ ...made, state: "discarded_local" })).toBeNull();
    expect(plan(capture({ state: "discarded_local", confirmed: { ...NOTHING_CONFIRMED, id: "s1", discarded: true } }))).toBeNull();
  });

  it("header changes ignore equal values, undefined ones and key order", () => {
    const c = capture({ header: { a: { x: 1, y: 2 }, b: undefined, c: null }, confirmed: { ...NOTHING_CONFIRMED, header: { a: { y: 2, x: 1 } } } });
    expect(headerChanges(c)).toEqual({});
    expect(headerChanges({ ...c, header: { a: { x: 2 } } })).toEqual({ a: { x: 2 } });
  });

  it("freezing: the exact body and key, a digest that changes with any byte; canonical JSON; UUID v4", () => {
    const p = { kind: "results" as const, method: "PUT" as const, path: "/p", body: { revision: 1, results: [] }, photo: null };
    const a = freeze(p, "k1");
    expect(a).toMatchObject({ method: "PUT", path: "/p", idempotencyKey: "k1", bodyText: '{"revision":1,"results":[]}', photo: null });
    expect(freeze(p, "k1").hash).toBe(a.hash);
    expect(freeze(p, "k2").hash).not.toBe(a.hash);
    expect(freeze({ ...p, body: { revision: 2, results: [] } }, "k1").hash).not.toBe(a.hash);
    expect(freeze({ ...p, body: null, photo: { photoId: "x", fields: { a: "1" } } }, "k1").bodyText).toBeNull();
    expect(fnv1a("")).toBe("811c9dc5");
    expect(canonicalJson({ b: 1, a: [undefined, { d: 2, c: null }] })).toBe('{"a":[null,{"c":null,"d":2}],"b":1}');
    expect(canonicalJson(undefined)).toBe("null");
    expect(uuidV4(new Uint8Array(16).fill(255))).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidV4(new Uint8Array(2))).toMatch(/^0000/);
  });
});
