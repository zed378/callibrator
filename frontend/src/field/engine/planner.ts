/**
 * P22-10a — the planner and the freezing (P19-08 § 9.2; `06` § 7). Pure.
 *
 * The planner diffs the LOCAL capture against what the server confirmed and names the ONE next
 * request, in the order a capture needs them:
 *
 *  1. no server record → the create (`POST /ipm/sessions` with `clientRef`, `capturedOffline`,
 *     `clientCapturedAt`; a registration: `POST /calibration-devices` with `clientRef`); a capture
 *     that depends on a registration not yet synced is BLOCKED;
 *  2. the header differs → `PATCH` with the revision and only the changed fields;
 *  3. the results differ → `PUT …/results` with the revision and the WHOLE set;
 *  4. a photo not uploaded → one upload per photo — never after a submit;
 *  5. submitted locally and all of the above confirmed → `POST …/submit` with the revision.
 *
 * Freezing writes the key and the exact body BEFORE the first attempt; a retry sends the same bytes.
 */
import type { Capture, FrozenRequest, OpKind } from "./model";

/** The next request, not yet frozen. */
export interface OpPlan {
  readonly kind: OpKind;
  readonly method: FrozenRequest["method"];
  readonly path: string;
  readonly body: Readonly<Record<string, unknown>> | null;
  readonly photo: FrozenRequest["photo"];
}

/** What the planner needs to know of the capture this one depends on. */
export interface Dependency {
  readonly synced: boolean;
  /** The registration's server id once known (the device to inspect). */
  readonly serverId: string | null;
}

export type PlanResult = OpPlan | "blocked" | null;

/** JSON with object keys sorted at every level: two equal values give one text (the results' identity). */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

/** The header fields whose value differs from the confirmed one. */
export const headerChanges = (capture: Capture): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(capture.header)) {
    if (value === undefined) continue;
    if (canonicalJson(value) !== canonicalJson(capture.confirmed.header[key] ?? null)) out[key] = value;
  }
  return out;
};

const ACTIVE = new Set(["editing", "submitted_local", "syncing"]);

/** The next request of a capture, `"blocked"` while it waits for a dependency, or null when nothing is left. */
export const plan = (capture: Capture, dependency: Dependency | null = null): PlanResult => {
  const c = capture.confirmed;
  if (capture.state === "discarded_local") {
    return capture.kind === "ipm" && c.id !== null && !c.discarded && !c.submitted
      ? { kind: "discard", method: "POST", path: `/api/v1/ipm/sessions/${c.id}/discard`, body: {}, photo: null }
      : null;
  }
  if (!ACTIVE.has(capture.state)) return null;

  if (capture.kind === "device") {
    if (c.id === null) {
      return { kind: "create", method: "POST", path: "/api/v1/calibration-devices", body: { ...(capture.device ?? {}), clientRef: capture.clientRef }, photo: null };
    }
    const photo = capture.photos.find((x) => !x.uploaded);
    if (photo) {
      return { kind: "photo", method: "POST", path: `/api/v1/calibration-devices/${c.id}/photos`, body: null, photo: { photoId: photo.photoId, fields: { purpose: photo.purpose } } };
    }
    return null;
  }

  if (c.id === null) {
    if (capture.dependsOn !== null && !(dependency?.synced === true && dependency.serverId !== null)) return "blocked";
    const deviceId = capture.deviceId ?? dependency?.serverId ?? null;
    const performedAt = capture.header["performedAt"];
    return {
      kind: "create",
      method: "POST",
      path: "/api/v1/ipm/sessions",
      body: {
        deviceId,
        ...(capture.templateVersionId ? { templateVersionId: capture.templateVersionId } : {}),
        clientRef: capture.clientRef,
        capturedOffline: capture.capturedOffline,
        clientCapturedAt: capture.clientCapturedAt,
        ...(typeof performedAt === "string" ? { performedAt } : {}),
      },
      photo: null,
    };
  }
  if (c.submitted) return null;
  const changes = headerChanges(capture);
  if (Object.keys(changes).length > 0) {
    return { kind: "header", method: "PATCH", path: `/api/v1/ipm/sessions/${c.id}`, body: { revision: c.revision, ...changes }, photo: null };
  }
  const resultsKey = canonicalJson(capture.results);
  if (resultsKey !== (c.resultsKey ?? canonicalJson([]))) {
    return { kind: "results", method: "PUT", path: `/api/v1/ipm/sessions/${c.id}/results`, body: { revision: c.revision, results: capture.results }, photo: null };
  }
  const photo = capture.photos.find((x) => !x.uploaded);
  if (photo) {
    return {
      kind: "photo",
      method: "POST",
      path: "/api/v1/attachments",
      body: null,
      photo: { photoId: photo.photoId, fields: { resourceType: "inspectionsession", resourceId: c.id, purpose: photo.purpose } },
    };
  }
  if (capture.state === "submitted_local" || capture.state === "syncing") {
    return { kind: "submit", method: "POST", path: `/api/v1/ipm/sessions/${c.id}/submit`, body: { revision: c.revision }, photo: null };
  }
  return null;
};

/** FNV-1a (32-bit) as hex — the request's own digest, so a test can prove a retry sends identical bytes. */
export const fnv1a = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

/** A UUID v4 from 16 random bytes (the Random port). */
export const uuidV4 = (bytes: Uint8Array): string => {
  const b = Array.from(bytes.slice(0, 16));
  while (b.length < 16) b.push(0);
  b[6] = ((b[6] as number) & 0x0f) | 0x40;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** The plan frozen: its key and exact bytes, to be written to the store before the first attempt. */
export const freeze = (p: OpPlan, idempotencyKey: string): FrozenRequest => {
  const bodyText = p.body === null ? null : JSON.stringify(p.body);
  const photoText = p.photo ? canonicalJson(p.photo) : "";
  return {
    method: p.method,
    path: p.path,
    idempotencyKey,
    bodyText,
    photo: p.photo,
    hash: fnv1a(`${p.method} ${p.path}\n${idempotencyKey}\n${bodyText ?? ""}\n${photoText}`),
  };
};
