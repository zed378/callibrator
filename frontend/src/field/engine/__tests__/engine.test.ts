/**
 * P22-10a — the engine against the in-memory adapters and the fake server (`06` § 10):
 *  - a capture made offline syncs completely once online: create → header → results → photo →
 *    submit, each request once, the server holding exactly the local capture;
 *  - a retry re-sends the SAME frozen request (key and bytes); a crash leaving an op in flight
 *    re-sends it unchanged after a restart, and the server's replay answers without a duplicate;
 *  - an edit made while an op is pending is planned after it, under a new key;
 *  - conflicts: a revision conflict (keep mine), a draft that exists (use the server draft), a
 *    submit refused (edit), a reused key (re-plan once, then attention), a scope loss (purge, the
 *    outbox kept), a session that ended (purge), a changed fingerprint and the server clock (purge);
 *  - a registration then the IPM that depends on it; two captures in parallel, each in order;
 *    discards; sign-out refused with an outbox; the edit debounce online only;
 *  - properties over random sequences: a frozen op is never re-sent with another body, no photo
 *    follows a submit, the confirmed state equals the local capture.
 */
import { createSyncEngine, type SyncEngine } from "../engine";
import type { Op } from "../model";
import { FakeServer, ManualClock, MemoryStore, SeededRandom, fakeAnswer, rig, type Rig } from "../testing/memory";

const photo = () => new Blob(["jpeg"]);
const header = { performedAt: "2026-10-10T01:00:00.000Z", recommendation: "fit_for_use" };
const results = [{ inputKind: "check", templateItemId: "i1", outcome: "done" }];

let r: Rig;
let engine: SyncEngine;
beforeEach(() => {
  r = rig();
  engine = createSyncEngine(r.ports);
});

const ops = (store: MemoryStore): Op[] => [...store.ops.values()].sort((a, b) => a.seq - b.seq);

describe("P22-10a — a capture end to end", () => {
  it("made offline: nothing is sent, the outbox counts it; online: create → header → results → photo → submit, once each", async () => {
    r.server.up = false;
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1", templateVersionId: "v1", header: { performedAt: header.performedAt } });
    await engine.editCapture(id, { header: { recommendation: "fit_for_use" }, results });
    await engine.addPhoto(id, photo(), "ipm_evidence");
    await engine.submitLocal(id);
    expect(await engine.runCycle("start")).toMatchObject({ offline: true, sent: 0 });
    expect(await engine.status()).toMatchObject({ outbox: 1, attention: 0, lastSyncServerAt: null });
    expect((await r.store.getCapture(id))?.capturedOffline).toBe(true);

    r.server.up = true;
    const report = await engine.runCycle("online");
    expect(report).toMatchObject({ sent: 5, succeeded: 5, attention: 0, offline: false });
    expect(r.server.received.map((x) => `${x.method} ${x.path.replace(/ses-\d+/, ":id")}`)).toEqual([
      "POST /api/v1/ipm/sessions",
      "PATCH /api/v1/ipm/sessions/:id",
      "PUT /api/v1/ipm/sessions/:id/results",
      "POST /api/v1/attachments",
      "POST /api/v1/ipm/sessions/:id/submit",
    ]);
    const server = [...r.server.sessions.values()][0];
    expect(server).toMatchObject({ status: "submitted", header: { performedAt: header.performedAt, recommendation: "fit_for_use" }, results, photos: ["ipm_evidence"] });
    const local = await r.store.getCapture(id);
    expect(local).toMatchObject({ state: "synced", confirmed: { submitted: true } });
    expect(r.store.photos.size).toBe(0);
    expect(await engine.status()).toMatchObject({ outbox: 0, lastSyncServerAt: r.server.serverDate });
    expect(r.store.meta.scopeFingerprint).toBe("fp-1");
    expect(r.log.events.some((e) => e.name === "op" && JSON.stringify(e.fields).includes("dev-1"))).toBe(false);
  });

  it("a 5xx, then no answer: the SAME frozen request is re-sent (key and bytes) after its backoff; Retry-After honoured", async () => {
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    await engine.submitLocal(id);
    r.server.forced.push(fakeAnswer(503, null, { retryAfterSec: 30 }));
    expect(await engine.runCycle("t")).toMatchObject({ waiting: 1, succeeded: 0 });
    const first = ops(r.store)[0] as Op;
    expect(first.nextAttemptAt - r.clock.now()).toBe(30000);
    expect(await engine.runCycle("t")).toMatchObject({ sent: 0, waiting: 1 });
    r.clock.advance(30000);
    r.server.forced.push("network");
    expect(await engine.runCycle("t")).toMatchObject({ offline: true });
    r.clock.advance(10 * 60 * 1000);
    await engine.runCycle("t");
    const sends = r.server.received.filter((x) => x.path === "/api/v1/ipm/sessions");
    expect(sends.length).toBe(2);
    expect(new Set(sends.map((x) => `${x.key}|${x.hash}|${x.bodyText ?? ""}`)).size).toBe(1);
    expect((await r.store.getCapture(id))?.state).toBe("synced");
  });

  it("a crash with an op in flight: a restarted engine re-sends it unchanged; the server's replay answers, no duplicate", async () => {
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1", results });
    await engine.submitLocal(id);
    r.server.forced.push("network");
    await engine.runCycle("t");
    const frozen = ops(r.store)[0] as Op;
    // The answer was lost after the server processed it: deliver once, then mark the op in flight as a crash would leave it.
    await r.server.send(frozen.request, null);
    await r.store.putOp({ ...frozen, state: "in_flight", nextAttemptAt: 0 });
    const restarted = createSyncEngine(r.ports);
    await restarted.runCycle("start");
    expect(r.server.sessions.size).toBe(1);
    const creates = r.server.received.filter((x) => x.path === "/api/v1/ipm/sessions");
    expect(new Set(creates.map((x) => x.key)).size).toBe(1);
    expect((await r.store.getCapture(id))?.state).toBe("synced");
  });

  it("an edit while an op waits is planned after it, under a new key; the store failing mid-plan loses nothing", async () => {
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    r.server.forced.push(fakeAnswer(500));
    await engine.runCycle("t");
    await engine.editCapture(id, { header: { notes: "late" } });
    r.clock.advance(60000);
    r.store.failNextPutOp = true;
    await expect(engine.runCycle("t")).rejects.toThrow("store crashed");
    await engine.runCycle("t");
    const keys = r.server.received.map((x) => x.key);
    expect(new Set(keys).size).toBe(2);
    expect([...r.server.sessions.values()][0]?.header).toMatchObject({ notes: "late" });
  });
});

describe("P22-10a — conflicts and refusals", () => {
  it("a revision conflict → attention; keep mine re-reads the revision and re-sends the whole state", async () => {
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1", results });
    await engine.runCycle("t");
    const session = [...r.server.sessions.values()][0];
    if (session) session.revision = 7;
    await engine.editCapture(id, { header: { notes: "mine" } });
    await engine.runCycle("t");
    const stuck = await r.store.getCapture(id);
    expect(stuck).toMatchObject({ state: "attention", attention: { status: 409, code: "IPM_REVISION_CONFLICT", opKind: "header", previousState: "editing" } });
    expect(await engine.status()).toMatchObject({ attention: 1 });
    await engine.resolveAttention(id, "keep_mine");
    await engine.runCycle("t");
    expect(session?.header).toMatchObject({ notes: "mine" });
    expect(session?.results).toEqual(results);
    expect((await r.store.getCapture(id))?.state).toBe("editing");
  });

  it("a draft that exists on the server → use it: this phone's content goes onto it", async () => {
    r.server.sessions.set("ses-old", { id: "ses-old", deviceId: "dev-1", clientRef: "other", revision: 3, status: "draft", header: {}, results: [], photos: [] });
    r.server.existingDraftFor = "ses-old";
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1", results, header });
    await engine.runCycle("t");
    expect(await r.store.getCapture(id)).toMatchObject({ state: "attention", attention: { code: "IPM_DRAFT_EXISTS", draftId: "ses-old" } });
    await engine.resolveAttention(id, "use_server_draft");
    await engine.runCycle("t");
    expect(r.server.sessions.get("ses-old")).toMatchObject({ results, header: { recommendation: "fit_for_use" } });
    expect(r.server.sessions.size).toBe(1);
  });

  it("a submit refused (missing items) → edit; a reused key re-plans once, then attention; retry restores the state", async () => {
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    await engine.submitLocal(id);
    await engine.runCycle("t");
    const fresh = await engine.createCapture({ kind: "ipm", deviceId: "dev-2" });
    await engine.submitLocal(fresh);
    r.server.forced.push(fakeAnswer(400, null, { message: "Missing required items" }));
    await engine.runCycle("t");
    expect(await r.store.getCapture(fresh)).toMatchObject({ state: "attention", attention: { status: 400, opKind: "create", previousState: "syncing" } });
    await engine.resolveAttention(fresh, "edit");
    expect((await r.store.getCapture(fresh))?.state).toBe("editing");

    // A capture of its own (the forced answers go to it alone).
    const r2 = rig();
    const e2 = createSyncEngine(r2.ports);
    const k = await e2.createCapture({ kind: "ipm", deviceId: "dev-3" });
    r2.server.forced.push(fakeAnswer(409, null, { code: "IDEMPOTENCY_KEY_REUSED" }), fakeAnswer(409, null, { code: "IDEMPOTENCY_KEY_REUSED" }));
    await e2.runCycle("t");
    expect(await r2.store.getCapture(k)).toMatchObject({ state: "attention", keyReplanned: true, attention: { code: "IDEMPOTENCY_KEY_REUSED" } });
    expect(new Set(r2.server.received.map((x) => x.key)).size).toBe(2);
    await e2.resolveAttention(k, "retry");
    expect(await r2.store.getCapture(k)).toMatchObject({ state: "editing", keyReplanned: false, attention: null });
    await expect(e2.resolveAttention(k, "retry")).rejects.toThrow("needs no attention");
  });

  it("a scope-loss code: the working set purged, the capture kept in attention with its op frozen, the cycle stopped", async () => {
    r.store.meta = { lastSyncDeviceAt: r.clock.now(), lastSyncServerAt: r.server.serverDate, scopeFingerprint: "fp-1", workingSetPresent: true };
    const a = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    const b = await engine.createCapture({ kind: "ipm", deviceId: "dev-2" });
    r.server.forced.push(fakeAnswer(403, null, { code: "FACILITY_ENDED" }));
    const report = await engine.runCycle("t");
    expect(report.purged).toBe("scope_lost");
    expect(r.store.workingSetDrops).toBe(1);
    expect(r.store.meta.workingSetPresent).toBe(false);
    expect(r.store.captures.size).toBe(2);
    expect([...r.store.captures.values()].filter((c) => c.state === "attention").length).toBeGreaterThanOrEqual(1);
    expect(ops(r.store).some((o) => o.state === "planned")).toBe(true);
    expect((await engine.status()).purged).toBe("scope_lost");
    void a;
    void b;
    await engine.onScopeLost("FACILITY_ROUTE_REFUSED");
    expect(r.store.workingSetDrops).toBe(1);
    await engine.onScopeLost("TENANT_DELETED");
    expect(r.store.workingSetDrops).toBe(2);
  });

  it("a session that ended — at verify or on a request: purge, the outbox kept", async () => {
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    r.server.verifySession = true;
    expect(await engine.runCycle("t")).toMatchObject({ sessionEnded: true, purged: "session_ended" });
    r.server.verifySession = false;
    r.server.forced.push("session");
    expect(await engine.runCycle("t")).toMatchObject({ sessionEnded: true });
    expect(r.store.workingSetDrops).toBe(2);
    expect(await r.store.getCapture(id)).not.toBeNull();
  });

  it("a changed scope fingerprint and an old server Date purge the working set before anything is used", async () => {
    r.store.meta = { lastSyncDeviceAt: r.clock.now(), lastSyncServerAt: r.server.serverDate, scopeFingerprint: "fp-0", workingSetPresent: true };
    expect((await engine.runCycle("t")).purged).toBe("scope_changed");
    r.store.meta = { ...r.store.meta, workingSetPresent: true };
    r.server.serverDate = (r.server.serverDate as number) + 73 * 3600 * 1000;
    expect((await engine.runCycle("t")).purged).toBe("server_clock_expired");
    r.store.meta = { ...r.store.meta, workingSetPresent: true, lastSyncServerAt: r.server.serverDate };
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    void id;
    r.server.serverDate = (r.server.serverDate as number) + 80 * 3600 * 1000;
    r.server.fingerprint = "fp-1";
    r.store.meta = { ...r.store.meta, scopeFingerprint: "fp-1", lastSyncServerAt: (r.server.serverDate as number) - 1 };
    // An answer's Date far past the last sync (between cycles) purges mid-cycle.
    r.store.meta = { ...r.store.meta, workingSetPresent: true, lastSyncServerAt: (r.server.serverDate as number) - 1 };
    const send = r.server.send.bind(r.server);
    r.server.send = async (req, p) => ({ ...(await send(req, p)), serverDate: (r.server.serverDate as number) + 100 * 3600 * 1000 });
    expect((await engine.runCycle("t")).purged).not.toBeNull();
  });
});

describe("P22-10a — dependencies, parallel captures, discards, sign-out, debounce", () => {
  it("a registration made offline, then an IPM of that device: blocked until the device exists, then on it", async () => {
    const reg = await engine.createCapture({ kind: "device", device: { name: "New pump" } });
    await engine.addPhoto(reg, photo(), "device_front");
    const ipm = await engine.createCapture({ kind: "ipm", dependsOn: reg, results });
    await engine.submitLocal(ipm);
    r.server.forced.push(fakeAnswer(500));
    await engine.runCycle("t");
    expect((await r.store.getCapture(ipm))?.confirmed.id).toBeNull();
    await engine.submitLocal(reg);
    r.clock.advance(60000);
    await engine.runCycle("t");
    await engine.runCycle("t");
    const device = [...r.server.devices.values()][0];
    expect(device).toMatchObject({ body: { name: "New pump" }, photos: ["device_front"] });
    expect((await r.store.getCapture(reg))?.state).toBe("synced");
    expect([...r.server.sessions.values()][0]?.deviceId).toBe(device?.id);
    expect((await r.store.getCapture(ipm))?.state).toBe("synced");
  });

  it("two captures in parallel, each strictly in order", async () => {
    const a = await engine.createCapture({ kind: "ipm", deviceId: "dev-1", results });
    const b = await engine.createCapture({ kind: "ipm", deviceId: "dev-2", results });
    await engine.submitLocal(a);
    await engine.submitLocal(b);
    await engine.runCycle("t");
    const order = (dev: string) => {
      const sid = [...r.server.sessions.values()].find((s) => s.deviceId === dev)?.id as string;
      return r.server.received.filter((x) => x.path.includes(sid) || (x.path === "/api/v1/ipm/sessions" && (x.bodyText ?? "").includes(dev))).map((x) => x.path.split("/").pop());
    };
    expect(order("dev-1")).toEqual(["sessions", "results", "submit"]);
    expect(order("dev-2")).toEqual(["sessions", "results", "submit"]);
  });

  it("discards: never sent → deleted; on the server → a server discard, then deleted; photos removable before upload only", async () => {
    const local = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    const p = await engine.addPhoto(local, photo(), "ipm_evidence");
    await engine.removePhoto(local, p);
    await expect(engine.removePhoto(local, "nope")).rejects.toThrow();
    await engine.discardLocal(local);
    expect(await r.store.getCapture(local)).toBeNull();
    const remote = await engine.createCapture({ kind: "ipm", deviceId: "dev-2" });
    await engine.runCycle("t");
    await engine.discardLocal(remote);
    expect((await r.store.getCapture(remote))?.state).toBe("discarded_local");
    await engine.runCycle("t");
    expect(await r.store.getCapture(remote)).toBeNull();
    expect([...r.server.sessions.values()][0]?.status).toBe("discarded");
    const att = await engine.createCapture({ kind: "ipm", deviceId: "dev-3" });
    r.server.forced.push(fakeAnswer(404));
    await engine.runCycle("t");
    await engine.resolveAttention(att, "discard");
    expect(await r.store.getCapture(att)).toBeNull();
  });

  it("the lifecycle refuses what the state forbids; unknown captures are refused", async () => {
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    await engine.submitLocal(id);
    await expect(engine.editCapture(id, { notes: 1 } as never)).rejects.toThrow("being edited");
    await expect(engine.addPhoto(id, photo(), "ipm_evidence")).rejects.toThrow("before the submit");
    await expect(engine.submitLocal(id)).rejects.toThrow("being edited");
    await expect(engine.editCapture("missing", {})).rejects.toThrow("Unknown capture");
    const dev = await engine.createCapture({ kind: "device", device: { name: "A" } });
    await engine.editCapture(dev, { device: { model: "M" } });
    expect((await r.store.getCapture(dev))?.device).toEqual({ name: "A", model: "M" });
  });

  it("sign-out: refused with an outbox; with none, the store is destroyed", async () => {
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    expect(await engine.signOut()).toEqual({ refused: true, pending: 1 });
    await engine.discardLocal(id);
    expect(await engine.signOut()).toEqual({ refused: false, pending: 0 });
    expect(r.store.destroyed).toBe(true);
  });

  it("online edits plan after a pause (server autosave); offline edits only queue; listeners hear the status", async () => {
    const heard: number[] = [];
    const off = engine.subscribe((s) => heard.push(s.outbox));
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    await engine.editCapture(id, { header: { notes: "a" } });
    await engine.editCapture(id, { header: { notes: "b" } });
    expect(r.scheduler.tasks.filter((t) => !t.cancelled)).toHaveLength(1);
    expect(r.scheduler.tasks.find((t) => !t.cancelled)?.ms).toBe(2000);
    r.scheduler.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.server.received.length).toBeGreaterThan(0);
    r.network.up = false;
    await engine.editCapture(id, { header: { notes: "c" } });
    expect(r.scheduler.tasks).toHaveLength(0);
    off();
    expect(heard.length).toBeGreaterThan(0);
    expect(engine.lastServerContact()).not.toBeNull();
  });

  it("a capture started right after a server answer is not 'captured offline'; a running cycle is not re-entered", async () => {
    await engine.runCycle("t");
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    expect((await r.store.getCapture(id))?.capturedOffline).toBe(false);
    const [first, second] = await Promise.all([engine.runCycle("a"), engine.runCycle("b")]);
    expect(first.sent + second.sent).toBeGreaterThanOrEqual(0);
    expect(second).toMatchObject({ sent: 0 });
  });

  it("resolving with nothing to adopt, or a draft that cannot be read, is refused", async () => {
    const id = await engine.createCapture({ kind: "ipm", deviceId: "dev-1" });
    r.server.forced.push(fakeAnswer(409, null, { code: "IPM_REVISION_CONFLICT" }));
    await engine.runCycle("t");
    await expect(engine.resolveAttention(id, "keep_mine")).rejects.toThrow("No server draft");
    r.server.forced.push(fakeAnswer(409, null, { code: "IPM_DRAFT_EXISTS", draftId: "gone" }));
    await engine.resolveAttention(id, "retry");
    await engine.runCycle("t");
    await expect(engine.resolveAttention(id, "use_server_draft")).rejects.toThrow();
  });
});

describe("P22-10a — properties over random sequences", () => {
  it("a frozen op is never re-sent with another body; no photo after a submit; the server ends equal to the local capture", async () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const rand = new SeededRandom(seed * 7919);
      const local = rig();
      const e = createSyncEngine({ ...local.ports, random: new SeededRandom(seed) });
      const id = await e.createCapture({ kind: "ipm", deviceId: "dev-1", header: { performedAt: header.performedAt } });
      let res: unknown[] = [];
      for (let step = 0; step < 12; step += 1) {
        const pick = rand.next() % 6;
        if (pick === 0) await e.editCapture(id, { header: { notes: `n${String(step)}` } });
        if (pick === 1) {
          res = [...res, { inputKind: "check", templateItemId: `i${String(step)}`, outcome: "done" }];
          await e.editCapture(id, { results: res });
        }
        if (pick === 2) await e.addPhoto(id, photo(), "ipm_evidence");
        if (pick === 3) local.server.forced.push(rand.next() % 2 === 0 ? "network" : fakeAnswer(503));
        if (pick === 4) local.server.up = rand.next() % 3 !== 0;
        if (pick === 5) {
          local.clock.advance(10 * 60 * 1000);
          await e.runCycle("random");
        }
      }
      await e.submitLocal(id);
      local.server.up = true;
      local.server.forced = [];
      for (let i = 0; i < 20 && (await local.store.getCapture(id))?.state !== "synced"; i += 1) {
        local.clock.advance(10 * 60 * 1000);
        await e.runCycle("drain");
      }
      const byKey = new Map<string, Set<string>>();
      for (const x of local.server.received) byKey.set(x.key, (byKey.get(x.key) ?? new Set()).add(`${x.hash}|${x.bodyText ?? ""}`));
      for (const variants of byKey.values()) expect(variants.size).toBe(1);
      const submitAt = local.server.received.findIndex((x) => x.path.endsWith("/submit"));
      expect(local.server.received.slice(submitAt + 1).some((x) => x.path === "/api/v1/attachments")).toBe(false);
      const session = [...local.server.sessions.values()][0];
      const capture = await local.store.getCapture(id);
      expect(capture?.state).toBe("synced");
      expect(session?.status).toBe("submitted");
      expect(session?.results).toEqual(capture?.results);
      expect(session?.header).toMatchObject(capture?.header ?? {});
      expect(session?.photos.length).toBe(capture?.photos.length);
    }
  });
});

void FakeServer;
void ManualClock;
