/**
 * P22-10a — the offline engine's model (P19-08 § 7.1, § 9.1; `docs/SHARED/06-SYNC-ENGINE.md` § 3, § 7).
 *
 * PLATFORM-NEUTRAL (ADR-134 § A.11): nothing in `src/field/engine/` touches IndexedDB, WebCrypto,
 * `window`, timers or `fetch` — every such thing is a port (`ports.ts`) the platform supplies, so
 * P35-07 moves this directory into `@callibrator/sync-engine` without a refactor.
 */

/** A capture's life (P19-08 § 9.1). */
export const CAPTURE_STATES = Object.freeze(["editing", "submitted_local", "syncing", "synced", "attention", "discarded_local"] as const);
export type CaptureState = (typeof CAPTURE_STATES)[number];

/** What a capture records: an IPM visit, or the registration of a device. */
export type CaptureKind = "ipm" | "device";

/** A photo kept in the encrypted store until uploaded. */
export interface PhotoRef {
  readonly photoId: string;
  /** `ipm_evidence` for an IPM; `device_front` / `device_serial_plate` / `device_other` for a device. */
  readonly purpose: string;
  readonly uploaded: boolean;
}

/** Why a capture stopped (P19-08 § 9.6): the server's answer, kept with the capture. */
export interface Attention {
  /** The HTTP status, or 0 for an engine-made reason. */
  readonly status: number;
  /** The top-level `code`, when the server sent one. */
  readonly code: string | null;
  /** The server's explanation (shown as written beside the localised one). */
  readonly message: string;
  /** For `IPM_DRAFT_EXISTS`: the caller's own server draft. */
  readonly draftId: string | null;
  /** The op the answer refused. */
  readonly opKind: OpKind;
  /** The state the capture was in, restored when the attention is resolved by a retry. */
  readonly previousState: CaptureState;
}

/** What the server confirmed (the planner diffs the local capture against it). */
export interface Confirmed {
  /** The server id (the session's or the device's); null before the create succeeded. */
  readonly id: string | null;
  /** The draft's revision the next write must carry. */
  readonly revision: number;
  /** The header fields as last accepted. */
  readonly header: Readonly<Record<string, unknown>>;
  /** The canonical text of the results as last accepted; null = never sent. */
  readonly resultsKey: string | null;
  readonly submitted: boolean;
  readonly discarded: boolean;
}

export const NOTHING_CONFIRMED: Confirmed = Object.freeze({ id: null, revision: 0, header: Object.freeze({}), resultsKey: null, submitted: false, discarded: false });

/** One capture, as the encrypted store holds it. The LOCAL capture is the source of truth (06 § 7). */
export interface Capture {
  readonly localId: string;
  readonly kind: CaptureKind;
  readonly state: CaptureState;
  /** UUID v4 made at creation; the server keys it per (tenant, creator, ref) — AM-16. */
  readonly clientRef: string;
  /** A registration capture this one waits for (an IPM of a device registered offline). */
  readonly dependsOn: string | null;
  /** IPM: the device's server id (null while it depends on a registration). */
  readonly deviceId: string | null;
  /** IPM: the pinned checklist version. */
  readonly templateVersionId: string | null;
  /** The capture started without confirmed server contact in the preceding 60 s (ADR-127 § 7). */
  readonly capturedOffline: boolean;
  /** The device's claim, never used for ordering (ADR-127 § 7). */
  readonly clientCapturedAt: string;
  /** IPM: the header fields (`performedAt`, `locationId`, outcomes, recommendation, notes). */
  readonly header: Readonly<Record<string, unknown>>;
  /** IPM: the `ipmResultInput` rows, the WHOLE set (the draft is a document). */
  readonly results: readonly unknown[];
  /** Device registration: the create body (without `clientRef`, added by the planner). */
  readonly device: Readonly<Record<string, unknown>> | null;
  readonly photos: readonly PhotoRef[];
  readonly confirmed: Confirmed;
  readonly attention: Attention | null;
  /** The automatic re-plan after `IDEMPOTENCY_KEY_REUSED` was used (06 § 8: once). */
  readonly keyReplanned: boolean;
  readonly updatedAt: number;
}

/** The op kinds, in the order a capture needs them. */
export type OpKind = "create" | "header" | "results" | "photo" | "submit" | "discard";
export type OpState = "planned" | "in_flight" | "done" | "failed";

/**
 * The FROZEN request (P19-08 § 9.2): written to the store before its first attempt; every retry
 * sends exactly `bodyText` with the same key — the server's request hash would refuse a changed
 * body (`IDEMPOTENCY_KEY_REUSED`).
 */
export interface FrozenRequest {
  readonly method: "POST" | "PUT" | "PATCH";
  /** The resolved path (`/api/v1/ipm/sessions/<id>/results`). */
  readonly path: string;
  readonly idempotencyKey: string;
  /** The JSON body as sent, or null for a multipart photo upload. */
  readonly bodyText: string | null;
  /** A photo upload: the photo and its form fields (multipart). */
  readonly photo: { readonly photoId: string; readonly fields: Readonly<Record<string, string>> } | null;
  /** A digest of everything sent (the test that a retry sends identical bytes). */
  readonly hash: string;
}

export interface Op {
  readonly opId: string;
  readonly localId: string;
  readonly seq: number;
  readonly kind: OpKind;
  readonly state: OpState;
  readonly attempts: number;
  /** Device-clock ms before which the op is not retried. */
  readonly nextAttemptAt: number;
  readonly request: FrozenRequest;
}

/** The answer of one request, as the transport hands it back. */
export interface Answer {
  readonly status: number;
  /** The body's `data` (2xx). */
  readonly data: unknown;
  /** The top-level `code` (non-2xx). */
  readonly code: string | null;
  readonly message: string;
  /** A top-level `draftId` (409 `IPM_DRAFT_EXISTS`). */
  readonly draftId: string | null;
  /** `Retry-After`, seconds. */
  readonly retryAfterSec: number | null;
  /** The response's `Date` header, ms (AM-24). */
  readonly serverDate: number | null;
}
