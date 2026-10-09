/**
 * P21-06 (ADR-126 § 8, ADR-133 Am. 3; spec MEMORY/specs/P19-05-calibration-dates.md § 8,
 * docs/UPSTREAM/09-REPORT-LAYOUTS.md § 4.3, § 5): the READS behind the calibration recaps and the
 * inventory export. The browser renders every PDF and XLSX from these pages (owner rule
 * 2026-10-07): there is no backend document, no batch job and no stored file.
 *
 *  - `recapRange`: a recap's range on the input date (`created`) or the calibration date — instants
 *    as before, or inclusive DAYS of the tenant's time zone (`fromDay`, `toDay`);
 *  - `qrDeviceId`: a sticker normalised with the tenant's settings and looked up IN CONTEXT (another
 *    facility's or tenant's QR finds nothing, so the page is empty — never a 404 oracle);
 *  - `latestRecordPage`: one row per device — its latest EFFECTIVE record within the filters (F-63,
 *    F-69) — as ONE raw read (`sql()`, DISTINCT ON over 0109's live-records order) with the tenant
 *    predicate BOUND and, for a facility-bound reader, `facilityClause` (G-14). It answers the
 *    page's ids and the total; the rows are then read through the models (the hooks scope them a
 *    second time) so both list modes answer the same shape;
 *  - `recapFacts`: each row's `room` (the SNAPSHOT at entry, "—" when none — never the device's
 *    current room, 09 § 4.2's defect), `effective`, and, for provider staff, `clientFacility`.
 *
 * Named exports only.
 */
import models from "../models";
import { db } from "../config";
import { sql, type SqlRunner } from "../utils/sql.util";
import { facilityClause } from "../utils/facilityPredicate.util";
import { tenantStorage } from "../middlewares/tenantContext.middleware";
import { deviceSettingsOf } from "./deviceSettings.service";
import { normaliseQrFor } from "./deviceRegister.service";
import { zonedDayStart } from "@callibrator/contracts/deviceValues";

/** "—": a recap cell with nothing recorded (09 § 4.3). */
export const NOT_RECORDED = "—";

/** The recap's range on one column: inclusive lower and upper instants, an exclusive day end. */
export interface RecapRange {
  readonly column: "calibrationDate" | "createdAt";
  /** Instants, as the caller gave them (a Date, or a JavaScript caller's ISO text). */
  readonly gte: Date | string | null;
  readonly lte: Date | string | null;
  readonly lt: Date | null;
}

/** What a recap filters on, as the list query validated it. */
export interface RecapQuery {
  readonly dateField?: "calibration" | "created" | undefined;
  readonly from?: Date | string | null | undefined;
  readonly to?: Date | string | null | undefined;
  readonly fromDay?: string | undefined;
  readonly toDay?: string | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
/** The lower bound: `from` as given when no day bounds it, else the later of the two. */
const lowerOf = (from: Date | string | null | undefined, fromDayStart: Date | null): Date | string | null => {
  if (!fromDayStart) {
    return from ?? null;
  }
  const at = from ? new Date(from) : null;
  return at && at > fromDayStart ? at : fromDayStart;
};

/**
 * The range a recap reads: `from`/`to` (instants, inclusive) and `fromDay`/`toDay` (days of the
 * tenant's zone, inclusive — the upper bound is the next day's start, exclusive). Both may be given;
 * the narrower lower bound wins.
 */
export const recapRange = async (tenantId: string, query: RecapQuery): Promise<RecapRange> => {
  const column = query.dateField === "created" ? "createdAt" : "calibrationDate";
  let fromDayStart: Date | null = null;
  let toDayEnd: Date | null = null;
  if (query.fromDay !== undefined || query.toDay !== undefined) {
    const { timeZone } = await deviceSettingsOf(tenantId);
    fromDayStart = query.fromDay === undefined ? null : zonedDayStart(dayNumber(query.fromDay), timeZone);
    toDayEnd = query.toDay === undefined ? null : zonedDayStart(dayNumber(query.toDay) + 1, timeZone);
  }
  return { column, gte: lowerOf(query.from, fromDayStart), lte: query.to ?? null, lt: toDayEnd };
};

/**
 * The device a sticker names, in the caller's context — or null (unknown, another facility's,
 * another tenant's: all the same empty page). A value that is no QR is the register's 400.
 */
export const qrDeviceId = async (tenantId: string, qrCode: string): Promise<string | null> => {
  const normalised = await normaliseQrFor(tenantId, qrCode);
  const device = normalised ? await models.CalibrationDevice.findOne({ where: { qrCode: normalised }, attributes: ["id"] }) : null;
  return device?.id ?? null;
};

/** The latest-per-device read's filters (already resolved). */
export interface LatestFilters {
  readonly deviceId: string | null;
  readonly entryKind: string | null;
  readonly clientFacilityId: string | null;
  readonly isCompliant: boolean | null;
  readonly range: RecapRange;
  readonly sort: "calibrationDate" | "createdAt";
  readonly page: number;
  readonly limit: number;
}

/** The columns a recap may order or range on — identifiers from this allow-list, never input. */
const COLUMN: Readonly<Record<"calibrationDate" | "createdAt", string>> = Object.freeze({
  calibrationDate: "calibration_date",
  createdAt: "created_at",
});

/**
 * One page of the latest EFFECTIVE record per device (not voided, not superseded; by calibration
 * date, then input, then id — the order `latestEffectiveRecord` uses), filtered BEFORE the pick.
 *
 * @returns the page's record ids in order, and the number of devices in the recap
 */
export const latestRecordPage = async (tenantId: string, f: LatestFilters): Promise<{ ids: string[]; total: number }> => {
  const facility = facilityClause("r.client_facility_id", 11);
  const range = COLUMN[f.range.column];
  const found = await sql<{ id: string; total: string | number }>(
    db as unknown as SqlRunner,
    `WITH latest AS (
       SELECT DISTINCT ON (r.device_id) r.id, r.calibration_date, r.created_at
         FROM calibration_records r
        WHERE r.tenant_id = $1 AND r.is_deleted = false AND r.deleted_at IS NULL AND r.superseded_by_id IS NULL
          AND ($2::uuid IS NULL OR r.device_id = $2::uuid)
          AND ($3::text IS NULL OR r.entry_kind::text = $3::text)
          AND ($4::uuid IS NULL OR r.client_facility_id = $4::uuid)
          AND ($5::boolean IS NULL OR r.is_compliant = $5::boolean)
          AND ($6::timestamptz IS NULL OR r.${range} >= $6::timestamptz)
          AND ($7::timestamptz IS NULL OR r.${range} <= $7::timestamptz)
          AND ($8::timestamptz IS NULL OR r.${range} < $8::timestamptz)${facility.clause}
        ORDER BY r.device_id, r.calibration_date DESC, r.created_at DESC, r.id DESC
     )
     SELECT id, COUNT(*) OVER () AS total
       FROM latest
      ORDER BY ${COLUMN[f.sort]} DESC, id DESC
      LIMIT $9 OFFSET $10`,
    [
      tenantId,
      f.deviceId,
      f.entryKind,
      f.clientFacilityId,
      f.isCompliant,
      f.range.gte,
      f.range.lte,
      f.range.lt,
      f.limit,
      (f.page - 1) * f.limit,
      ...facility.bind,
    ],
  );
  return { ids: found.map((r) => r.id), total: found.length ? Number(found[0]?.total) : 0 };
};

/**
 * Each row's recap facts: `room` from the snapshot at entry ("—" when none), `effective`, and —
 * for provider staff only — the facility's `{ id, name, code }` (P19-04 § 13.1).
 */
export const recapFacts = async (rows: readonly Record<string, unknown>[]): Promise<Record<string, unknown>[]> => {
  const ctx = tenantStorage.getStore();
  const unbound = ctx?.facilityBound !== true;
  const ids = [...new Set(rows.map((r) => r["clientFacilityId"]).filter((id): id is string => typeof id === "string"))];
  const facilities = unbound && ids.length ? await models.ClientFacility.findAll({ where: { id: ids }, attributes: ["id", "name", "code"] }) : [];
  const facilityOf = new Map<string, { id: string; name: string; code: string | null }>(facilities.map((f) => [f.id, { id: f.id, name: f.name, code: f.code }]));
  return rows.map((r) => ({
    ...r,
    room: { name: (r["roomSnapshot"] as string | null) ?? NOT_RECORDED, floor: (r["floorSnapshot"] as string | null) ?? NOT_RECORDED },
    effective: !r["supersededById"],
    ...(unbound ? { clientFacility: facilityOf.get(r["clientFacilityId"] as string) ?? null } : {}),
  }));
};
