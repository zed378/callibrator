/**
 * P22-10a — in-memory adapters for the engine's tests (`06` § 10): a store, a clock that can go
 * backwards, a seeded random source, a flapping network, a manual scheduler and a log; and a FAKE
 * SERVER that keeps the server rules the engine depends on — `client_ref` replay per creator, the
 * `Idempotency-Key` replay (same key + same body → the stored answer; same key + another body →
 * 409 `IDEMPOTENCY_KEY_REUSED`), the draft revision (409 `IPM_REVISION_CONFLICT`), photos only
 * before the submit, and injectable failures. Test support only: never imported by app code.
 */
import type { Answer, Capture, FrozenRequest, Op } from "../model";
import type { CaptureStore, Clock, EngineLog, EnginePorts, Network, Random, Scheduler, Transport } from "../ports";
import { SessionEnded } from "../ports";
import type { SyncMeta } from "../purge";

export const EMPTY_META: SyncMeta = { lastSyncDeviceAt: null, lastSyncServerAt: null, scopeFingerprint: null, workingSetPresent: false };

export class MemoryStore implements CaptureStore {
  meta: SyncMeta = EMPTY_META;
  captures = new Map<string, Capture>();
  ops = new Map<string, Op>();
  photos = new Map<string, Blob>();
  workingSetDrops = 0;
  destroyed = false;
  /** Throw on the next `putOp` (a crash mid-transaction). */
  failNextPutOp = false;

  async getMeta() {
    return this.meta;
  }
  async putMeta(meta: SyncMeta) {
    this.meta = meta;
  }
  async listCaptures() {
    return [...this.captures.values()];
  }
  async getCapture(localId: string) {
    return this.captures.get(localId) ?? null;
  }
  async putCapture(capture: Capture) {
    this.captures.set(capture.localId, capture);
  }
  async deleteCapture(localId: string) {
    const c = this.captures.get(localId);
    for (const p of c?.photos ?? []) this.photos.delete(p.photoId);
    this.captures.delete(localId);
    for (const [id, op] of this.ops) if (op.localId === localId) this.ops.delete(id);
  }
  async listOps(localId: string) {
    return [...this.ops.values()].filter((o) => o.localId === localId);
  }
  async putOp(op: Op) {
    if (this.failNextPutOp) {
      this.failNextPutOp = false;
      throw new Error("store crashed");
    }
    this.ops.set(op.opId, op);
  }
  async putPhoto(photoId: string, bytes: Blob) {
    this.photos.set(photoId, bytes);
  }
  async getPhoto(photoId: string) {
    return this.photos.get(photoId) ?? null;
  }
  async deletePhoto(photoId: string) {
    this.photos.delete(photoId);
  }
  async dropWorkingSet() {
    this.workingSetDrops += 1;
  }
  async destroy() {
    this.destroyed = true;
    this.captures.clear();
    this.ops.clear();
    this.photos.clear();
  }
}

export class ManualClock implements Clock {
  constructor(public t = Date.UTC(2026, 9, 10, 2)) {}
  now() {
    return this.t;
  }
  advance(ms: number) {
    this.t += ms;
  }
}

/** A seeded xorshift source (deterministic tests). */
export class SeededRandom implements Random {
  constructor(private seed = 0x9e3779b9) {}
  next(): number {
    let x = this.seed >>> 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed;
  }
  bytes(n: number) {
    return Uint8Array.from({ length: n }, () => this.next() & 0xff);
  }
}

export class FlagNetwork implements Network {
  up = true;
  online() {
    return this.up;
  }
}

export class ManualScheduler implements Scheduler {
  tasks: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  setTimeout(fn: () => void, ms: number) {
    const task = { fn, ms, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }
  /** Runs every task not cancelled. */
  flush() {
    const due = this.tasks.filter((t) => !t.cancelled);
    this.tasks = [];
    for (const t of due) t.fn();
  }
}

export class ListLog implements EngineLog {
  events: { name: string; fields: Record<string, string | number | boolean> }[] = [];
  event(name: string, fields: Readonly<Record<string, string | number | boolean>>) {
    this.events.push({ name, fields: { ...fields } });
  }
}

interface ServerSession {
  id: string;
  deviceId: string;
  clientRef: string;
  revision: number;
  status: "draft" | "submitted" | "discarded";
  header: Record<string, unknown>;
  results: unknown[];
  photos: string[];
}

const answer = (status: number, data: unknown = null, extra: Partial<Answer> = {}): Answer => ({
  status,
  data,
  code: null,
  message: status >= 400 ? `HTTP ${String(status)}` : "ok",
  draftId: null,
  retryAfterSec: null,
  serverDate: null,
  ...extra,
});

/** A fake server keeping the rules the engine depends on. */
export class FakeServer implements Transport {
  sessions = new Map<string, ServerSession>();
  devices = new Map<string, { id: string; clientRef: string; photos: string[]; body: Record<string, unknown> }>();
  /** Every request received, in order: (method path key hash). */
  received: { method: string; path: string; key: string; hash: string; bodyText: string | null }[] = [];
  private idem = new Map<string, { hash: string; answer: Answer }>();
  private next = 1;
  /** Answers forced for the next requests, in order (an injected failure); `"network"` = no answer, `"session"` = SessionEnded. */
  forced: (Answer | "network" | "session")[] = [];
  /** Whether `verify` answers (false = offline), its fingerprint, and the server `Date`. */
  up = true;
  verifySession = false;
  fingerprint = "fp-1";
  serverDate: number | null = Date.UTC(2026, 9, 10, 2);
  /** Answer this code on the next create (e.g. a draft that already exists). */
  existingDraftFor: string | null = null;

  private id(prefix: string): string {
    const id = `${prefix}-${String(this.next)}`;
    this.next += 1;
    return id;
  }

  async verify() {
    if (this.verifySession) throw new SessionEnded();
    if (!this.up) throw new Error("offline");
    return { scopeFingerprint: this.fingerprint, serverDate: this.serverDate };
  }

  async read(path: string): Promise<Answer> {
    const id = path.split("/").pop() as string;
    const s = this.sessions.get(id);
    return s ? answer(200, { id: s.id, revision: s.revision, status: s.status }) : answer(404);
  }

  async send(request: FrozenRequest, photo: Blob | null): Promise<Answer> {
    if (!this.up) throw new Error("offline");
    const forced = this.forced.shift();
    if (forced === "network") throw new Error("network");
    if (forced === "session") throw new SessionEnded();
    this.received.push({ method: request.method, path: request.path, key: request.idempotencyKey, hash: request.hash, bodyText: request.bodyText });
    if (forced) return forced;
    const seen = this.idem.get(request.idempotencyKey);
    if (seen) return seen.hash === request.hash ? seen.answer : answer(409, null, { code: "IDEMPOTENCY_KEY_REUSED" });
    const result = this.handle(request, photo);
    if (result.status < 400) this.idem.set(request.idempotencyKey, { hash: request.hash, answer: result });
    return { ...result, serverDate: this.serverDate };
  }

  private session(id: string) {
    return this.sessions.get(id);
  }

  private handle(request: FrozenRequest, photo: Blob | null): Answer {
    const body = request.bodyText ? (JSON.parse(request.bodyText) as Record<string, unknown>) : {};
    const parts = request.path.split("/").filter(Boolean); // api v1 ...
    if (request.path === "/api/v1/calibration-devices") {
      const existing = [...this.devices.values()].find((d) => d.clientRef === body["clientRef"]);
      if (existing) return answer(200, { id: existing.id });
      const id = this.id("dev");
      this.devices.set(id, { id, clientRef: String(body["clientRef"]), photos: [], body });
      return answer(201, { id });
    }
    if (parts[2] === "calibration-devices" && parts[4] === "photos") {
      const d = this.devices.get(parts[3] as string);
      if (!d) return answer(404);
      if (!photo) return answer(400);
      d.photos.push(String(request.photo?.fields["purpose"]));
      return answer(201, { id: this.id("att") });
    }
    if (request.path === "/api/v1/attachments") {
      const s = this.session(String(request.photo?.fields["resourceId"]));
      if (!s) return answer(404);
      if (s.status !== "draft") return answer(409, null, { code: "IPM_NOT_DRAFT" });
      s.photos.push(String(request.photo?.fields["purpose"]));
      return answer(201, { id: this.id("att") });
    }
    if (request.path === "/api/v1/ipm/sessions") {
      if (this.existingDraftFor) {
        const draftId = this.existingDraftFor;
        this.existingDraftFor = null;
        return answer(409, null, { code: "IPM_DRAFT_EXISTS", draftId, message: "You already have an IPM draft for this device" });
      }
      const existing = [...this.sessions.values()].find((s) => s.clientRef === body["clientRef"]);
      if (existing) return answer(200, { id: existing.id, revision: existing.revision, ...existing.header });
      const id = this.id("ses");
      const header: Record<string, unknown> = typeof body["performedAt"] === "string" ? { performedAt: body["performedAt"] } : {};
      this.sessions.set(id, { id, deviceId: String(body["deviceId"]), clientRef: String(body["clientRef"]), revision: 0, status: "draft", header, results: [], photos: [] });
      return answer(201, { id, revision: 0, ...header });
    }
    const s = this.session(parts[4] as string);
    if (!s) return answer(404);
    const action = parts[5];
    if (action === "discard") {
      s.status = "discarded";
      return answer(200, { id: s.id });
    }
    if (s.status !== "draft") return answer(409, null, { code: "IPM_NOT_DRAFT", message: "Already submitted" });
    if (body["revision"] !== s.revision) return answer(409, null, { code: "IPM_REVISION_CONFLICT", message: "This draft was saved elsewhere" });
    if (action === undefined && request.method === "PATCH") {
      const { revision: _r, ...fields } = body;
      void _r;
      Object.assign(s.header, fields);
    } else if (action === "results") {
      s.results = body["results"] as unknown[];
    } else if (action === "submit") {
      s.status = "submitted";
      return answer(200, { id: s.id, revision: s.revision, status: "submitted" });
    }
    s.revision += 1;
    return answer(200, { id: s.id, revision: s.revision });
  }
}

export interface Rig {
  ports: EnginePorts;
  store: MemoryStore;
  server: FakeServer;
  clock: ManualClock;
  network: FlagNetwork;
  scheduler: ManualScheduler;
  log: ListLog;
}

export const rig = (): Rig => {
  const store = new MemoryStore();
  const server = new FakeServer();
  const clock = new ManualClock();
  const network = new FlagNetwork();
  const scheduler = new ManualScheduler();
  const log = new ListLog();
  return { ports: { store, transport: server, clock, random: new SeededRandom(), network, scheduler, log }, store, server, clock, network, scheduler, log };
};

export { answer as fakeAnswer };
