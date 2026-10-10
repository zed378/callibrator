/**
 * P21-04 — "due" (ADR-126 § 6; spec MEMORY/specs/P19-02-ipm-session-aggregate.md § 11): the devices
 * whose IPM is due, computed at read, never enforced (a capture is never blocked by it).
 *
 * `GET /ipm/due` is ONE batched raw read per page (`sql()`): the devices of the caller's tenant —
 * and, for a facility-bound caller, of its facility only (`facilityClause`, G-14) — with their last
 * EFFECTIVE session (`status = 'submitted' AND superseded_by_id IS NULL`, the partial index
 * `inspection_sessions_effective_device`) through a LATERAL join. Both tables carry the tenant
 * predicate, BOUND (`tenant_id = $1`; raw SQL bypasses the hooks). The month arithmetic in SQL is the
 * same as `computeIpmDue` (contracts), which then gives each row its `ipmDue` — so the filter and
 * the answer cannot disagree; the live suite proves both on PostgreSQL 18 (memoryDb refuses raw SQL).
 *
 * The interval is the device's `ipm_interval_months` (0 = not under IPM), else the tenant's
 * `ipm_interval_months` setting (unset = not scheduled); the month is the tenant's time zone's.
 *
 * P21-07 (ADR-126 Am. 6): `?month=YYYY-MM` moves the reference month ("due by the end of that
 * month") from the current one up to `IPM_DUE_MONTH_HORIZON` months ahead — the SQL compares with
 * that month and `computeIpmDue` reads `ipmDueReference`'s instant, so they still agree; and
 * `countDue` gives the dashboard its counts by the same rule (one raw read, the same predicates).
 * Named exports only.
 */
import { db } from "../config";
import { sql, type SqlRunner } from "../utils/sql.util";
import { facilityClause } from "../utils/facilityPredicate.util";
import { ipmSettingsOf } from "./ipmSettings.service";
import { CodedError } from "../utils/codedError.util";
import { IPM_DUE_MONTH_HORIZON, IPM_DUE_MONTH_OUT_OF_RANGE, computeIpmDue, ipmDueReference, type IpmDue } from "@callibrator/contracts/inspectionValues";
import type { IpmDueQuery } from "@callibrator/contracts/inspectionSessions";

/** One row of the raw read. */
interface DueRow {
  id: string;
  name: string;
  qrCode: string | null;
  serialNumber: string | null;
  clientFacilityId: string;
  status: string | null;
  ipmIntervalMonths: number | null;
  lastPerformedAt: Date | null;
  total: string | number;
}

/** A due list's page. */
export interface IpmDuePage {
  readonly rows: Record<string, unknown>[];
  readonly meta: { total: number; page: number; limit: number; totalPages: number };
}

/**
 * `GET /ipm/due`.
 *
 * @param tenantId - the caller's tenant (bound into both tables' predicates)
 * @param query - the validated filters and page
 * @returns the devices with their `ipmDue`, ordered by name then id; paging in `meta`
 */
export const listDue = async (tenantId: string, query: IpmDueQuery): Promise<IpmDuePage> => {
  const settings = await ipmSettingsOf(tenantId);
  const now = new Date();
  const reference = query.month === undefined ? null : ipmDueReference(query.month, now, settings.timeZone);
  if (query.month !== undefined && reference === null) {
    throw new CodedError(
      400,
      IPM_DUE_MONTH_OUT_OF_RANGE,
      `The month must be between the current month and ${String(IPM_DUE_MONTH_HORIZON)} months ahead (in the tenant's time zone).`,
    );
  }
  const facility = facilityClause("d.client_facility_id", 9);
  const rows = await sql<DueRow>(
    db as unknown as SqlRunner,
    `WITH scheduled AS (
       SELECT d.id, d.name, d.qr_code AS "qrCode", d.serial_number AS "serialNumber",
              d.client_facility_id AS "clientFacilityId", d.status::text AS status,
              d.ipm_interval_months AS "ipmIntervalMonths",
              COALESCE(d.ipm_interval_months, $2::int) AS interval_months,
              s.performed_at AS "lastPerformedAt"
         FROM calibration_devices d
         LEFT JOIN LATERAL (
           SELECT x.performed_at FROM inspection_sessions x
            WHERE x.tenant_id = $1 AND x.device_id = d.id AND x.status = 'submitted' AND x.superseded_by_id IS NULL
            ORDER BY x.performed_at DESC, x.id DESC
            LIMIT 1
         ) s ON TRUE
        WHERE d.tenant_id = $1 AND d.is_deleted = false
          AND COALESCE(d.status::text, 'active') NOT IN ('retired', 'inactive')
          AND COALESCE(d.ipm_interval_months, $2::int) > 0
          AND ($7::uuid IS NULL OR d.client_facility_id = $7::uuid)${facility.clause}
     )
     SELECT id, name, "qrCode", "serialNumber", "clientFacilityId", status, "ipmIntervalMonths", "lastPerformedAt",
            COUNT(*) OVER () AS total
       FROM scheduled
      WHERE $3 = 'all_scheduled'
         OR ($3 = 'never_inspected' AND "lastPerformedAt" IS NULL)
         OR ($3 = 'due' AND ("lastPerformedAt" IS NULL
              OR date_trunc('month', "lastPerformedAt" AT TIME ZONE $4) + make_interval(months => interval_months)
                 <= date_trunc('month', COALESCE($8::timestamp, now() AT TIME ZONE $4))))
      ORDER BY name, id
      LIMIT $5 OFFSET $6`,
    [
      tenantId,
      settings.intervalMonths,
      query.state,
      settings.timeZone,
      query.limit,
      (query.page - 1) * query.limit,
      query.clientFacilityId ?? null,
      query.month === undefined ? null : `${query.month}-01`,
      ...facility.bind,
    ],
  );
  const today = reference ?? now;
  const total = rows.length ? Number(rows[0]?.total) : 0;
  return {
    rows: rows.map((r) => {
      const ipmDue: IpmDue = computeIpmDue({
        status: r.status,
        intervalOverride: r.ipmIntervalMonths,
        tenantInterval: settings.intervalMonths,
        lastEffectivePerformedAt: r.lastPerformedAt ? new Date(r.lastPerformedAt) : null,
        today,
        timeZone: settings.timeZone,
      });
      return {
        id: r.id,
        name: r.name,
        qrCode: r.qrCode,
        serialNumber: r.serialNumber,
        clientFacilityId: r.clientFacilityId,
        status: r.status,
        ipmIntervalMonths: r.ipmIntervalMonths,
        ipmDue,
      };
    }),
    meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) },
  };
};

/** The dashboard's IPM counts (P21-07, N-9). */
export interface IpmDueCounts {
  /** Devices under an IPM schedule (interval > 0, not retired or inactive). */
  readonly scheduled: number;
  /** Due this month (tenant zone) — never-inspected devices included, as the list counts them. */
  readonly due: number;
  /** Scheduled and never inspected (a subset of `due`). */
  readonly neverInspected: number;
}

interface CountRow {
  scheduled: string | number;
  due: string | number;
  neverInspected: string | number;
}

/**
 * The dashboard's "due" counts (P21-07; P18-03 N-9): `listDue`'s predicates and month arithmetic,
 * counted in one raw read — the tenant bound on both tables, `facilityClause` for a bound caller
 * (G-14), so a bound user's counts are its facility's only. The dashboard caches them per scope
 * (AM-18, G-20).
 *
 * @param tenantId - the tenant whose devices are counted (bound into both tables' predicates)
 * @returns the counts
 */
export const countDue = async (tenantId: string): Promise<IpmDueCounts> => {
  const settings = await ipmSettingsOf(tenantId);
  const facility = facilityClause("d.client_facility_id", 4);
  const [row] = await sql<CountRow>(
    db as unknown as SqlRunner,
    `SELECT COUNT(*) AS scheduled,
            COUNT(*) FILTER (WHERE s.performed_at IS NULL
              OR date_trunc('month', s.performed_at AT TIME ZONE $3) + make_interval(months => COALESCE(d.ipm_interval_months, $2::int))
                 <= date_trunc('month', now() AT TIME ZONE $3)) AS due,
            COUNT(*) FILTER (WHERE s.performed_at IS NULL) AS "neverInspected"
       FROM calibration_devices d
       LEFT JOIN LATERAL (
         SELECT x.performed_at FROM inspection_sessions x
          WHERE x.tenant_id = $1 AND x.device_id = d.id AND x.status = 'submitted' AND x.superseded_by_id IS NULL
          ORDER BY x.performed_at DESC, x.id DESC
          LIMIT 1
       ) s ON TRUE
      WHERE d.tenant_id = $1 AND d.is_deleted = false
        AND COALESCE(d.status::text, 'active') NOT IN ('retired', 'inactive')
        AND COALESCE(d.ipm_interval_months, $2::int) > 0${facility.clause}`,
    [tenantId, settings.intervalMonths, settings.timeZone, ...facility.bind],
  );
  return { scheduled: Number(row?.scheduled ?? 0), due: Number(row?.due ?? 0), neverInspected: Number(row?.neverInspected ?? 0) };
};
