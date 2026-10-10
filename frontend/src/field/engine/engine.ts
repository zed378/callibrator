/**
 * P22-10a — the offline engine (P19-08 § 9, § 10; `docs/SHARED/06-SYNC-ENGINE.md` § 5): the capture
 * lifecycle the UI calls, and the runner.
 *
 * **A cycle:** `POST /auth/verify` (a changed scope fingerprint purges the working set — AM-26) →
 * each capture's ops, one capture's ops strictly in order, up to `parallelCaptures` captures at once.
 * For a capture: take its first unfinished op (an op left `in_flight` by a crash is re-sent
 * unchanged), or plan and FREEZE the next one (written before its first attempt); send it; classify:
 * success records what the server confirmed and plans the next; retry waits (backoff, `Retry-After`);
 * a reused key re-plans once; a scope-loss code purges and stops; anything else puts the capture in
 * `attention` with the server's answer and stops that capture only.
 *
 * Nothing is dropped without a user action: a discard is `discardLocal` (the UI confirmed it), and
 * an attention is resolved by `resolveAttention`. The outbox survives every purge.
 */
import { backoffMs, engineConfig, type EngineConfig } from "./config";
import { classify, NO_ANSWER, type Outcome } from "./classify";
import { NOTHING_CONFIRMED, type Answer, type Capture, type CaptureKind, type CaptureState, type Op } from "./model";
import { canonicalJson, freeze, plan, uuidV4, type Dependency } from "./planner";
import { SessionEnded, type EnginePorts } from "./ports";
import { answerPurge, clockPurge, fingerprintPurge, signOutAllowed, type PurgeReason, type SyncMeta } from "./purge";

export interface NewCapture {
  readonly kind: CaptureKind;
  readonly deviceId?: string | null;
  readonly dependsOn?: string | null;
  readonly templateVersionId?: string | null;
  readonly header?: Readonly<Record<string, unknown>>;
  readonly results?: readonly unknown[];
  readonly device?: Readonly<Record<string, unknown>> | null;
}

export interface CapturePatch {
  readonly header?: Readonly<Record<string, unknown>>;
  readonly results?: readonly unknown[];
  readonly device?: Readonly<Record<string, unknown>>;
}

/** What the user chose for a capture in attention (P19-08 § 9.6). */
export type AttentionAction =
  /** Try again (a new key), back in the state it was in. */
  | "retry"
  /** Back to editing (a submit refused for missing items, a value refused). */
  | "edit"
  /** `IPM_REVISION_CONFLICT`: keep this phone's version — re-read the revision, re-send everything. */
  | "keep_mine"
  /** `IPM_DRAFT_EXISTS`: adopt the server draft and send this phone's content onto it. */
  | "use_server_draft"
  /** Discard the capture (the UI collected the typed confirmation). */
  | "discard";

export interface SyncStatus {
  /** Captures not yet synced (attention included). */
  readonly outbox: number;
  readonly attention: number;
  readonly lastSyncServerAt: number | null;
  readonly running: boolean;
  /** The last purge and why, until the next successful sync. */
  readonly purged: PurgeReason | null;
}

export interface CycleReport {
  readonly sent: number;
  readonly succeeded: number;
  readonly waiting: number;
  readonly attention: number;
  readonly purged: PurgeReason | null;
  readonly sessionEnded: boolean;
  /** No answer came at all (offline): the cycle did not count as a sync. */
  readonly offline: boolean;
}

export interface SignOutResult {
  readonly refused: boolean;
  readonly pending: number;
}

const ACTIVE: readonly CaptureState[] = ["editing", "submitted_local", "syncing", "discarded_local"];

const parse = (text: string | null): Record<string, unknown> => (text ? (JSON.parse(text) as Record<string, unknown>) : {});
const record = (data: unknown): Record<string, unknown> => (data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {});
const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback);

export interface SyncEngine {
  createCapture(input: NewCapture): Promise<string>;
  editCapture(localId: string, patch: CapturePatch): Promise<void>;
  addPhoto(localId: string, bytes: Blob, purpose: string): Promise<string>;
  removePhoto(localId: string, photoId: string): Promise<void>;
  submitLocal(localId: string): Promise<void>;
  discardLocal(localId: string): Promise<void>;
  resolveAttention(localId: string, action: AttentionAction): Promise<void>;
  runCycle(trigger: string): Promise<CycleReport>;
  status(): Promise<SyncStatus>;
  subscribe(listener: (status: SyncStatus) => void): () => void;
  onSessionEnded(): Promise<void>;
  onScopeLost(code: string): Promise<void>;
  checkClock(serverNow: number | null): Promise<PurgeReason | null>;
  signOut(): Promise<SignOutResult>;
  /** The server contact time that decides "captured offline" (any answer counts). */
  lastServerContact(): number | null;
}

export function createSyncEngine(ports: EnginePorts, overrides: Partial<EngineConfig> = {}): SyncEngine {
  const config = engineConfig(overrides);
  const { store, transport, clock, random, network, scheduler, log } = ports;
  const listeners = new Set<(s: SyncStatus) => void>();
  let running = false;
  let purged: PurgeReason | null = null;
  let serverContact: number | null = null;
  let cancelDebounce: (() => void) | null = null;

  const uuid = (): string => uuidV4(random.bytes(16));
  const unit = (): number => (random.bytes(1)[0] ?? 0) / 256;

  const status = async (): Promise<SyncStatus> => {
    const captures = await store.listCaptures();
    const meta = await store.getMeta();
    return {
      outbox: captures.filter((c) => c.state !== "synced").length,
      attention: captures.filter((c) => c.state === "attention").length,
      lastSyncServerAt: meta.lastSyncServerAt,
      running,
      purged,
    };
  };
  const notify = async (): Promise<void> => {
    if (listeners.size === 0) return;
    const s = await status();
    for (const l of listeners) l(s);
  };

  const purge = async (reason: PurgeReason): Promise<void> => {
    await store.dropWorkingSet();
    const meta = await store.getMeta();
    await store.putMeta({ ...meta, workingSetPresent: false });
    purged = reason;
    log.event("purge", { reason });
  };

  const mustGet = async (localId: string): Promise<Capture> => {
    const capture = await store.getCapture(localId);
    if (!capture) throw new Error("Unknown capture");
    return capture;
  };
  const save = async (capture: Capture): Promise<void> => {
    await store.putCapture({ ...capture, updatedAt: clock.now() });
  };

  /** Online and editing: plan as server autosave, a pause after the last change (P19-08 § 9.2). */
  const debounce = (): void => {
    if (!network.online()) return;
    cancelDebounce?.();
    cancelDebounce = scheduler.setTimeout(() => {
      cancelDebounce = null;
      void engine.runCycle("edit");
    }, config.editDebounceMs);
  };

  /** Ops not done or failed, in seq order. */
  const pendingOps = async (localId: string): Promise<Op[]> =>
    (await store.listOps(localId)).filter((o) => o.state === "planned" || o.state === "in_flight").sort((a, b) => a.seq - b.seq);
  const dropPending = async (localId: string): Promise<void> => {
    for (const op of await pendingOps(localId)) await store.putOp({ ...op, state: "failed" });
  };

  /** What a success confirms (P19-08 § 9.3). */
  const confirm = async (capture: Capture, op: Op, answer: Answer): Promise<Capture | null> => {
    const data = record(answer.data);
    const c = capture.confirmed;
    const sent = parse(op.request.bodyText);
    switch (op.kind) {
      case "create": {
        const header: Record<string, unknown> = {};
        for (const key of Object.keys(capture.header)) if (key in data) header[key] = data[key];
        return { ...capture, confirmed: { ...c, id: typeof data["id"] === "string" ? data["id"] : c.id, revision: num(data["revision"], 0), header } };
      }
      case "header": {
        const fields = Object.fromEntries(Object.entries(sent).filter(([key]) => key !== "revision"));
        return { ...capture, confirmed: { ...c, revision: num(data["revision"], c.revision + 1), header: { ...c.header, ...fields } } };
      }
      case "results":
        return { ...capture, confirmed: { ...c, revision: num(data["revision"], c.revision + 1), resultsKey: canonicalJson(sent["results"] ?? []) } };
      case "photo": {
        const photoId = op.request.photo?.photoId;
        if (photoId) await store.deletePhoto(photoId);
        return { ...capture, photos: capture.photos.map((x) => (x.photoId === photoId ? { ...x, uploaded: true } : x)) };
      }
      case "submit":
        return { ...capture, state: "synced", confirmed: { ...c, submitted: true, revision: num(data["revision"], c.revision) } };
      case "discard":
        return null;
    }
  };

  const attention = (capture: Capture, op: Op, answer: Answer): Capture => ({
    ...capture,
    state: "attention",
    attention: { status: answer.status, code: answer.code, message: answer.message, draftId: answer.draftId, opKind: op.kind, previousState: capture.state === "attention" ? (capture.attention?.previousState ?? "editing") : capture.state },
  });

  interface LaneResult {
    sent: number;
    succeeded: number;
    waiting: boolean;
    attention: boolean;
    stopAll: "session" | "scope" | null;
    offline: boolean;
  }

  /** One capture's ops until nothing is left, it waits, it needs attention, or the cycle stops. */
  const runCapture = async (localId: string): Promise<LaneResult> => {
    const result: LaneResult = { sent: 0, succeeded: 0, waiting: false, attention: false, stopAll: null, offline: false };
    for (let guard = 0; guard < 100; guard += 1) {
      const capture = await store.getCapture(localId);
      if (!capture || !ACTIVE.includes(capture.state)) return result;
      let op = (await pendingOps(localId))[0];
      if (!op) {
        let dependency: Dependency | null = null;
        if (capture.dependsOn) {
          const dep = await store.getCapture(capture.dependsOn);
          dependency = { synced: dep?.state === "synced", serverId: dep?.confirmed.id ?? null };
        }
        const next = plan(capture, dependency);
        if (next === "blocked") return { ...result, waiting: true };
        if (next === null) {
          if (capture.state === "discarded_local") await store.deleteCapture(localId);
          else if (capture.kind === "device" && capture.state !== "editing" && capture.confirmed.id !== null) await save({ ...capture, state: "synced" });
          return result;
        }
        const ops = await store.listOps(localId);
        op = { opId: uuid(), localId, seq: ops.reduce((m, o) => Math.max(m, o.seq), 0) + 1, kind: next.kind, state: "planned", attempts: 0, nextAttemptAt: 0, request: freeze(next, uuid()) };
        await store.putOp(op);
      }
      if (op.nextAttemptAt > clock.now()) return { ...result, waiting: true };
      const flying: Op = { ...op, state: "in_flight", attempts: op.attempts + 1 };
      await store.putOp(flying);
      if (capture.state === "submitted_local") await save({ ...capture, state: "syncing" });
      const photo = op.request.photo ? await store.getPhoto(op.request.photo.photoId) : null;
      let answer: Answer | null = null;
      try {
        answer = await transport.send(op.request, photo);
      } catch (err) {
        if (err instanceof SessionEnded) return { ...result, stopAll: "session" };
        answer = null;
      }
      result.sent += 1;
      if (answer) serverContact = clock.now();
      const outcome: Outcome = answer ? classify(answer) : NO_ANSWER;
      log.event("op", { kind: op.kind, status: answer?.status ?? 0, outcome: outcome.kind, attempts: flying.attempts });
      if (answer?.serverDate) {
        const reason = await engine.checkClock(answer.serverDate);
        if (reason) return { ...result, stopAll: "scope" };
      }
      const current = (await store.getCapture(localId)) ?? capture;
      switch (outcome.kind) {
        case "success": {
          await store.putOp({ ...flying, state: "done" });
          const updated = await confirm(current, flying, answer as Answer);
          if (updated === null) await store.deleteCapture(localId);
          else await save(updated);
          result.succeeded += 1;
          continue;
        }
        case "retry":
          await store.putOp({ ...flying, state: "planned", nextAttemptAt: clock.now() + backoffMs(config, flying.attempts, unit(), outcome.retryAfterSec) });
          return { ...result, waiting: true, offline: answer === null };
        case "replan":
          await store.putOp({ ...flying, state: "failed" });
          if (current.keyReplanned) {
            await save(attention(current, flying, answer as Answer));
            return { ...result, attention: true };
          }
          await save({ ...current, keyReplanned: true });
          continue;
        case "scope_lost":
          await store.putOp({ ...flying, state: "planned" });
          await save(attention(current, flying, answer as Answer));
          await purge("scope_lost");
          return { ...result, attention: true, stopAll: "scope" };
        case "attention":
          await store.putOp({ ...flying, state: "failed" });
          await save(attention(current, flying, answer as Answer));
          return { ...result, attention: true };
      }
    }
    return result;
  };

  const engine: SyncEngine = {
    async createCapture(input) {
      const now = clock.now();
      const localId = uuid();
      const capture: Capture = {
        localId,
        kind: input.kind,
        state: "editing",
        clientRef: uuid(),
        dependsOn: input.dependsOn ?? null,
        deviceId: input.deviceId ?? null,
        templateVersionId: input.templateVersionId ?? null,
        capturedOffline: serverContact === null || now - serverContact > config.offlineWindowMs,
        clientCapturedAt: new Date(now).toISOString(),
        header: input.header ?? {},
        results: input.results ?? [],
        device: input.device ?? null,
        photos: [],
        confirmed: NOTHING_CONFIRMED,
        attention: null,
        keyReplanned: false,
        updatedAt: now,
      };
      await store.putCapture(capture);
      await notify();
      return localId;
    },

    async editCapture(localId, patch) {
      const capture = await mustGet(localId);
      if (capture.state !== "editing") throw new Error("Only a capture being edited can change");
      await save({
        ...capture,
        header: patch.header ? { ...capture.header, ...patch.header } : capture.header,
        results: patch.results ?? capture.results,
        device: patch.device ? { ...(capture.device ?? {}), ...patch.device } : capture.device,
      });
      debounce();
    },

    async addPhoto(localId, bytes, purpose) {
      const capture = await mustGet(localId);
      if (capture.state !== "editing" || capture.confirmed.submitted) throw new Error("A photo is added before the submit");
      const photoId = uuid();
      await store.putPhoto(photoId, bytes);
      await save({ ...capture, photos: [...capture.photos, { photoId, purpose, uploaded: false }] });
      debounce();
      return photoId;
    },

    async removePhoto(localId, photoId) {
      const capture = await mustGet(localId);
      const photo = capture.photos.find((p) => p.photoId === photoId);
      if (!photo || photo.uploaded) throw new Error("Only a photo not yet uploaded can be removed here");
      await store.deletePhoto(photoId);
      await save({ ...capture, photos: capture.photos.filter((p) => p.photoId !== photoId) });
    },

    async submitLocal(localId) {
      const capture = await mustGet(localId);
      if (capture.state !== "editing") throw new Error("Only a capture being edited can be submitted");
      await save({ ...capture, state: "submitted_local" });
      await notify();
      debounce();
    },

    async discardLocal(localId) {
      const capture = await mustGet(localId);
      await dropPending(localId);
      if (capture.confirmed.id === null || capture.kind === "device" || capture.confirmed.submitted) {
        await store.deleteCapture(localId);
      } else {
        await save({ ...capture, state: "discarded_local", attention: null });
      }
      await notify();
    },

    async resolveAttention(localId, action) {
      const capture = await mustGet(localId);
      if (capture.state !== "attention" || !capture.attention) throw new Error("The capture needs no attention");
      if (action === "discard") {
        await engine.discardLocal(localId);
        return;
      }
      await dropPending(localId);
      const back: CaptureState = capture.attention.previousState === "syncing" ? "submitted_local" : capture.attention.previousState;
      if (action === "retry") {
        await save({ ...capture, state: back, attention: null, keyReplanned: false });
      } else if (action === "edit") {
        await save({ ...capture, state: "editing", attention: null, keyReplanned: false });
      } else {
        const id = action === "use_server_draft" ? capture.attention.draftId : capture.confirmed.id;
        if (!id) throw new Error("No server draft to adopt");
        const answer = await transport.read(`/api/v1/ipm/sessions/${id}`);
        if (answer.status < 200 || answer.status >= 300) throw new Error(answer.message || "The draft could not be read");
        const data = record(answer.data);
        // Re-send this phone's whole state onto the server draft: nothing counts as confirmed but its id and revision.
        await save({ ...capture, state: back, attention: null, keyReplanned: false, confirmed: { ...NOTHING_CONFIRMED, id, revision: num(data["revision"], 0) } });
      }
      await notify();
      debounce();
    },

    async runCycle(trigger) {
      const report = { sent: 0, succeeded: 0, waiting: 0, attention: 0, purged: null as PurgeReason | null, sessionEnded: false, offline: false };
      if (running) return report;
      running = true;
      await notify();
      try {
        let verified: { scopeFingerprint: string; serverDate: number | null };
        try {
          verified = await transport.verify();
          serverContact = clock.now();
        } catch (err) {
          if (err instanceof SessionEnded) {
            await engine.onSessionEnded();
            return { ...report, sessionEnded: true, purged: "session_ended" };
          }
          return { ...report, offline: true };
        }
        const meta = await store.getMeta();
        const changed = fingerprintPurge(meta, verified.scopeFingerprint);
        if (changed) {
          await purge(changed);
          report.purged = changed;
        }
        const clockReason = await engine.checkClock(verified.serverDate);
        if (clockReason) report.purged = clockReason;
        log.event("cycle", { trigger });

        const queue = (await store.listCaptures()).filter((c) => ACTIVE.includes(c.state)).sort((a, b) => a.updatedAt - b.updatedAt).map((c) => c.localId);
        let stop: "session" | "scope" | null = null;
        const lane = async (): Promise<void> => {
          while (queue.length > 0 && stop === null) {
            const localId = queue.shift() as string;
            const r = await runCapture(localId);
            report.sent += r.sent;
            report.succeeded += r.succeeded;
            if (r.waiting) report.waiting += 1;
            if (r.attention) report.attention += 1;
            if (r.offline) report.offline = true;
            if (r.stopAll) stop = r.stopAll;
          }
        };
        await Promise.all(Array.from({ length: config.parallelCaptures }, lane));
        if (stop === "session") {
          await engine.onSessionEnded();
          return { ...report, sessionEnded: true, purged: "session_ended" };
        }
        if (stop === "scope") return { ...report, purged: purged ?? "scope_lost" };
        if (!report.offline) {
          const latest = await store.getMeta();
          await store.putMeta({ ...latest, lastSyncDeviceAt: clock.now(), lastSyncServerAt: verified.serverDate ?? latest.lastSyncServerAt, scopeFingerprint: verified.scopeFingerprint });
          if (report.purged === null) purged = null;
        }
        return report;
      } finally {
        running = false;
        await notify();
      }
    },

    status,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async onSessionEnded() {
      await purge("session_ended");
    },

    async onScopeLost(code) {
      const reason = answerPurge(code);
      if (reason) await purge(reason);
    },

    async checkClock(serverNow) {
      const meta: SyncMeta = await store.getMeta();
      const reason = clockPurge(config, meta, clock.now(), serverNow);
      if (reason) await purge(reason);
      return reason;
    },

    async signOut() {
      const pending = (await store.listCaptures()).filter((c) => c.state !== "synced").length;
      if (!signOutAllowed(pending)) return { refused: true, pending };
      await store.destroy();
      return { refused: false, pending: 0 };
    },

    lastServerContact: () => serverContact,
  };
  return engine;
}
