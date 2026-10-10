/**
 * P22-10a — every port the engine runs through (`docs/SHARED/06-SYNC-ENGINE.md` § 4, narrowed to
 * what the code uses). The web adapters (P22-10b) implement them over IndexedDB + WebCrypto, timers,
 * `navigator.onLine` and the typed API client; the native app (P35) over SQLCipher and its own
 * scheduler. The engine never reaches past them.
 */
import type { Answer, Capture, FrozenRequest, Op } from "./model";
import type { SyncMeta } from "./purge";

/** One user's encrypted store (how it is encrypted is the adapter's; nothing readable at rest without the key). */
export interface CaptureStore {
  getMeta(): Promise<SyncMeta>;
  putMeta(meta: SyncMeta): Promise<void>;
  listCaptures(): Promise<Capture[]>;
  getCapture(localId: string): Promise<Capture | null>;
  putCapture(capture: Capture): Promise<void>;
  /** The capture, its ops and its photos. */
  deleteCapture(localId: string): Promise<void>;
  listOps(localId: string): Promise<Op[]>;
  putOp(op: Op): Promise<void>;
  putPhoto(photoId: string, bytes: Blob): Promise<void>;
  getPhoto(photoId: string): Promise<Blob | null>;
  deletePhoto(photoId: string): Promise<void>;
  /** Drop the working set (devices, rooms, catalogue) WITHOUT reading it. Never touches captures, ops, photos. */
  dropWorkingSet(): Promise<void>;
  /** Delete the whole store and its key (sign-out with an empty outbox; the administrator wipe). */
  destroy(): Promise<void>;
}

/** The session ended (the refresh failed): the engine purges and stops; the outbox stays. */
export class SessionEnded extends Error {
  constructor() {
    super("session ended");
    this.name = "SessionEnded";
  }
}

/** The network the engine talks through: the app's typed client underneath (refresh-once, errors normalised). */
export interface Transport {
  /**
   * Sends a frozen request EXACTLY (its key as `Idempotency-Key`, its body text as is; a photo as
   * multipart with its fields). Resolves with any HTTP answer; rejects when none came (offline,
   * timeout) or with `SessionEnded`.
   */
  send(request: FrozenRequest, photo: Blob | null): Promise<Answer>;
  /** A read (a draft re-read after a conflict). */
  read(path: string): Promise<Answer>;
  /** `POST /auth/verify`: the scope fingerprint (AM-26) and the server's `Date`. */
  verify(): Promise<{ readonly scopeFingerprint: string; readonly serverDate: number | null }>;
}

export interface Clock {
  now(): number;
}
export interface Random {
  bytes(n: number): Uint8Array;
}
export interface Network {
  online(): boolean;
}
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): () => void;
}
/** Diagnostics WITHOUT tenant data: op ids, kinds, states, statuses, counts. */
export interface EngineLog {
  event(name: string, fields: Readonly<Record<string, string | number | boolean>>): void;
}

export interface EnginePorts {
  readonly store: CaptureStore;
  readonly transport: Transport;
  readonly clock: Clock;
  readonly random: Random;
  readonly network: Network;
  readonly scheduler: Scheduler;
  readonly log: EngineLog;
}
