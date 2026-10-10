/**
 * P22-04 — the IPM history as plain data (P19-02 spec § 7, § 10): the list's filters and query, a
 * session's state as the page shows it, who may correct or void it, and how a result reads.
 *
 * The server decides every transition; these rules only decide which controls are OFFERED (the
 * failure mode is fewer buttons, never a button that always refuses):
 *  - correct: an EFFECTIVE session (submitted, not superseded), by an `ipm` writer who is not the
 *    platform operator (the platform tenant authors nothing, ADR-052);
 *  - void: the same session, by an UNBOUND `ipm` writer — the route also requires the tenant
 *    administrator role (ADR-102: no role names in the client; another role reads the server's 403);
 *  - a draft's header, submit and discard: the caller's own drafts (the list shows only those).
 */
import type { IpmResult, IpmSessionListQuery, IpmSessionSummary } from "@/api/services/ipmHistory.service";

export const PAGE_SIZE = 20;

/** The dictionary namespaces the island reads (the server page picks them). */
export const IPM_NAMESPACES = ["ipm.", "ipmCatalogue.section.", "ipmCatalogue.outcome."];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?deviceId=` when it is one well-formed id; anything else is ignored (the list shows every device). */
export const deviceIdOf = (value: string | string[] | undefined): string | null => (typeof value === "string" && UUID.test(value) ? value : null);
/** A correction's or a void's reason (contracts `reason`: 3 – 2000). */
export const REASON_MIN = 3;
export const REASON_MAX = 2000;

export type StatusFilter = "" | "draft" | "submitted" | "voided" | "discarded";
export type Recommendation = NonNullable<IpmSessionSummary["recommendation"]>;

export interface Filters {
  q: string;
  status: StatusFilter;
  /** Only each visit's current record (`effective=true`). */
  effectiveOnly: boolean;
  recommendation: "" | Recommendation;
  from: string;
  to: string;
  clientFacilityId: string;
}

export const INITIAL_FILTERS: Filters = { q: "", status: "", effectiveOnly: false, recommendation: "", from: "", to: "", clientFacilityId: "" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The first instant of a local calendar day, as ISO. */
export const dayStart = (day: string): string => new Date(`${day}T00:00:00`).toISOString();
/** The last millisecond of a local calendar day, as ISO. */
export const dayEnd = (day: string): string => new Date(`${day}T23:59:59.999`).toISOString();

/** The list's query for a page: only what is set is sent. */
export const listQuery = (f: Filters, page: number, deviceId: string | null): IpmSessionListQuery => ({
  page,
  limit: PAGE_SIZE,
  sort: "performedAt",
  ...(deviceId ? { deviceId } : {}),
  ...(f.q.trim() ? { q: f.q.trim() } : {}),
  ...(f.status ? { status: f.status } : {}),
  ...(f.effectiveOnly ? { effective: true } : {}),
  ...(f.recommendation ? { recommendation: f.recommendation } : {}),
  ...(DAY.test(f.from) ? { from: dayStart(f.from) } : {}),
  ...(DAY.test(f.to) ? { to: dayEnd(f.to) } : {}),
  ...(f.clientFacilityId ? { clientFacilityId: f.clientFacilityId } : {}),
});

/** A session's state as the history shows it. */
export type SessionState = "draft" | "effective" | "superseded" | "voided" | "discarded";

export const stateOf = (s: Pick<IpmSessionSummary, "status" | "effective" | "supersededById">): SessionState => {
  if (s.status === "submitted") return s.effective && !s.supersededById ? "effective" : "superseded";
  return s.status;
};

/** What the page knows of the caller. */
export interface Caller {
  write: boolean;
  bound: boolean;
  superAdmin: boolean;
}

export const canCorrect = (s: Pick<IpmSessionSummary, "status" | "effective" | "supersededById">, c: Caller): boolean =>
  c.write && !c.superAdmin && stateOf(s) === "effective";

export const canVoid = (s: Pick<IpmSessionSummary, "status" | "effective" | "supersededById">, c: Caller): boolean =>
  canCorrect(s, c) && !c.bound;

export const isDraft = (s: Pick<IpmSessionSummary, "status">): boolean => s.status === "draft";

/** A reason the contract accepts (trimmed length 3 – 2000). */
export const reasonValid = (reason: string): boolean => {
  const n = reason.trim().length;
  return n >= REASON_MIN && n <= REASON_MAX;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** The device as the session recorded it (the submit's snapshot), or null for a draft. */
export const deviceOf = (s: Pick<IpmSessionSummary, "deviceSnapshot">): { name: string; qrCode: string | null; serialNumber: string | null } | null => {
  const d = s.deviceSnapshot;
  const name = d ? str(d["name"]) : null;
  if (!d || !name) return null;
  return { name, qrCode: str(d["qrCode"]), serialNumber: str(d["serialNumber"]) };
};

/** The facility as the session recorded it, or null. */
export const facilityOf = (s: Pick<IpmSessionSummary, "facilitySnapshot">): string | null => (s.facilitySnapshot ? str(s.facilitySnapshot["name"]) : null);

/** "Room · floor" as recorded, or null. */
export const roomOf = (s: Pick<IpmSessionSummary, "roomSnapshot" | "floorSnapshot">): string | null => {
  const parts = [s.roomSnapshot, s.floorSnapshot].filter((v): v is string => typeof v === "string" && v !== "");
  return parts.length > 0 ? parts.join(" · ") : null;
};

/** The visit number as printed: three digits ("001"), or null before the submit. */
export const visitLabel = (n: number | null): string | null => (n === null ? null : String(n).padStart(3, "0"));

/** A result's measured part: the values with the unit, `—` when none was entered. */
export const measuredText = (r: Pick<IpmResult, "measuredValue" | "measuredValue1" | "measuredValue2" | "unit">): string | null => {
  const values = [r.measuredValue, r.measuredValue1, r.measuredValue2].filter((v): v is string => v !== null && v !== "");
  if (values.length === 0) return null;
  return `${values.join(" / ")}${r.unit ? ` ${r.unit}` : ""}`;
};

/** The notices a write answered with (`notices`, and the side effects' own), de-duplicated. */
export const noticesOf = (s: { notices?: string[] | null; sideEffects?: Record<string, unknown> | null }): string[] => {
  const fromEffects = s.sideEffects?.["notices"];
  const extra = Array.isArray(fromEffects) ? fromEffects.filter((n): n is string => typeof n === "string") : [];
  return [...new Set([...(s.notices ?? []), ...extra])];
};

/** `YYYY-MM-DDTHH:mm` in the browser's zone, for a `datetime-local` input. */
export const localInput = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
