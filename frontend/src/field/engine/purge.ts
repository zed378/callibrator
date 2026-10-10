/**
 * P22-10a — the purge rules as data (P19-08 § 10; `06` § 8.1). "Purge" drops the WORKING SET
 * (devices, rooms, catalogue) and its in-memory copy. **The outbox — captures, ops, photos — is never
 * purged by these rules**; only a confirmed discard, a successful sync or the administrator wipe
 * removes a capture.
 */
import { isScopeLossCode } from "@callibrator/contracts/clientFacilities";
import type { EngineConfig } from "./config";

export type PurgeReason = "device_clock_expired" | "server_clock_expired" | "session_ended" | "scope_lost" | "scope_changed";

/** What `meta` keeps about the last successful sync. */
export interface SyncMeta {
  /** Device-clock ms of the last successful sync; null = never. */
  readonly lastSyncDeviceAt: number | null;
  /** Server `Date` (ms) of the last successful sync; null = never. */
  readonly lastSyncServerAt: number | null;
  /** The scope fingerprint the working set was downloaded under. */
  readonly scopeFingerprint: string | null;
  /** Whether a working set is present at all. */
  readonly workingSetPresent: boolean;
}

/**
 * Whether the working set must be purged by the clocks (checked at start, every 10 min, before
 * every working-set read, and on every online response's `Date`):
 *  - the device clock: 72 h since the last successful sync;
 *  - the server clock (AM-24): an online response's `Date` 72 h past the last sync's server time —
 *    a rolled-back device clock cannot keep a set once the phone is online (FT-87).
 *
 * @returns the reason, or null to keep it
 */
export const clockPurge = (config: EngineConfig, meta: SyncMeta, deviceNow: number, serverNow: number | null): PurgeReason | null => {
  if (!meta.workingSetPresent) return null;
  if (meta.lastSyncDeviceAt === null || deviceNow - meta.lastSyncDeviceAt > config.workingSetLifeMs) return "device_clock_expired";
  // A device clock that runs BACKWARDS past the last sync is treated as expired too (no way to tell how long it was).
  if (deviceNow < meta.lastSyncDeviceAt) return "device_clock_expired";
  if (serverNow !== null && meta.lastSyncServerAt !== null && serverNow - meta.lastSyncServerAt > config.workingSetLifeMs) return "server_clock_expired";
  return null;
};

/** A response's top-level code that loses the scope (AM-1, FT-95) → purge; anything else → null. */
export const answerPurge = (code: string | null): PurgeReason | null => (isScopeLossCode(code) ? "scope_lost" : null);

/** The scope fingerprint of `POST /auth/verify` differs from the working set's (AM-26, FT-96) → purge and re-download. */
export const fingerprintPurge = (meta: SyncMeta, fingerprint: string): PurgeReason | null =>
  meta.workingSetPresent && meta.scopeFingerprint !== null && meta.scopeFingerprint !== fingerprint ? "scope_changed" : null;

/** Signing out or turning offline mode off: refused while the outbox holds anything (P19-08 § 10). */
export const signOutAllowed = (outboxCount: number): boolean => outboxCount === 0;
