/**
 * P25-02 — the quarantine review and per-tenant data-quality report of one
 * transformed upstream run (docs/UPSTREAM/05 § 7; docs/UPSTREAM/03 § 7, the
 * Q-findings it names).
 *
 * Aggregates only. Every statement goes through `sql()` on the transform
 * connection (the application's connection never touches `upstream_import`),
 * with every value bound; a staged table's name reaches a statement only
 * through the staging allow-list (ledger.ts#stagedTable). Counts and codes
 * only: no staged value, no legacy id, no name, no serial, no room, no hash
 * ever leaves the database through this module — the same rule the
 * reconciliation (P25-01) and the import's own views live by (ADR-129).
 *
 * AS BUILT (P25-02 review, 2026-10-24), per facility of the run's provider:
 *
 *   quarantine — every quarantined row of the run by source table and reason
 *     (codes only). The run-level `totals` carry them all; a facility row
 *     carries only the groups whose row also has a mapping (a changed row
 *     quarantined on a re-run) — a never-mapped row has no facility yet
 *   Q-18 — stored serial groups inside one facility that differ only in case
 *     (exact duplicates cannot exist: 0118, UD-9) — 0 expected
 *   Q-19 — serials the facility shares with another facility (harmless)
 *   Q-12 / Q-13 — future dates, and dates before 2023, of inventory and
 *     calibration
 *
 *   Q-4 (2026-10-27) - IPM session rows quarantined no_device, attributed by
 *     their staged id_client through the facility mapping
 *   Q-14 (2026-10-27) - calibrations dated before their device's inventory date
 *   Q-28 (2026-10-27, the missing half) - photos quarantined file_missing, in
 *     their device's facility; `manual` when none, because unreferenced files
 *     on disk (the manifest's side) are not counted
 *
 * NOT built: the orphan, file and user sections the contract's
 * UPSTREAM_DATA_QUALITY_SECTIONS names as a target (R-8 and R-9 of the
 * reconciliation cover the files and users per run). They are P25-04's.
 * The facility row carries the id and code only: the name is sensitive
 * operational data (03 § 9).
 */
import { sql, type SqlRunner } from "../utils/sql.util";
import { createTransformDb, transformRoleName } from "../config/upstreamImport";
import {
  ID_MAP,
  QUARANTINE,
  stagedTable,
  stagedTableExists,
} from "./upstreamImport/transform/ledger";
import { SESSION_TABLES } from "./upstreamImport/transform/ipm";
import type { StepContext } from "./upstreamImport/transform/steps";
import type {
  DataQualityFinding,
  DataQualityQuarantineGroup,
  UpstreamDataQualityResult,
} from "@callibrator/contracts/upstreamDataQuality";
import models from "../models";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";

const { UpstreamSqlImport, ClientFacility } = models;

interface Run {
  id: string;
  status: string;
  transformStatus: string;
  transformTenantId: string | null;
}

/** One facility of the provider tenant: its id and code only — never its name. */
interface Facility {
  id: string;
  code: string;
}

const finding = (
  findingId: string,
  status: DataQualityFinding["status"],
  count: number,
  note: string,
): DataQualityFinding => ({ finding: findingId, status, count, note });

/** `n` per facility of a `(facilityId, n)` statement's rows. */
const byFacility = (
  rows: readonly { facilityId: string; n: number }[],
): Map<string, number> => new Map(rows.map((r) => [r.facilityId, r.n]));

/** The two photo folders (columns of the staged device rows) whose missing files Q-28 counts. */
const PHOTO_FOLDERS: readonly string[] = Object.freeze(["foto_depan", "foto_sn"]);

/** Adds `rows` into `into`, per facility. */
const addInto = (
  into: Map<string, number>,
  rows: readonly { facilityId: string; n: number }[],
): void => {
  for (const r of rows) {
    into.set(r.facilityId, (into.get(r.facilityId) ?? 0) + r.n);
  }
};

/**
 * Q-4: the run's IPM session rows quarantined `no_device` (their QR matches no imported device),
 * per facility. Such a row is never mapped, so its facility is its staged `id_client` through the
 * facility step's mapping (`mst_faskes` -> client facility). Their result rows follow it as
 * `session_not_imported` and are not counted again.
 */
const noDevicePerFacility = async (
  context: StepContext,
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  for (const table of SESSION_TABLES) {
    if (!(await stagedTableExists(context, table))) {
      continue;
    }
    addInto(
      counts,
      await sql<{ facilityId: string; n: number }>(
        context.runner,
        `SELECT fm.client_facility_id AS "facilityId", count(*)::int AS n
           FROM ${QUARANTINE} q
           JOIN ${stagedTable(table)} s ON s.import_run_id = q.import_run_id AND s.source_row_number = q.source_row_number
           JOIN ${ID_MAP} fm ON fm.source_table = 'mst_faskes' AND fm.legacy_id = btrim(to_jsonb(s) ->> 'id_client')
          WHERE q.import_run_id = $1 AND q.source_table = $2 AND q.reason = 'no_device' AND fm.client_facility_id IS NOT NULL
          GROUP BY fm.client_facility_id`,
        [context.runId, table],
        { transaction: context.transaction },
      ),
    );
  }
  return counts;
};

/**
 * Q-28 (the missing half): photos a mapped device names whose file is not on disk - quarantined
 * `file_missing` per folder - in the device's facility. The other half (files on disk no row
 * names) is the manifest's side and is not counted here.
 */
const missingFilesPerFacility = async (
  context: StepContext,
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  if (!(await stagedTableExists(context, "trx_inventory"))) {
    return counts;
  }
  for (const folder of PHOTO_FOLDERS) {
    addInto(
      counts,
      await sql<{ facilityId: string; n: number }>(
        context.runner,
        `SELECT dm.client_facility_id AS "facilityId", count(*)::int AS n
           FROM ${QUARANTINE} q
           JOIN ${stagedTable("trx_inventory")} s ON s.import_run_id = q.import_run_id AND s.source_row_number = q.source_row_number
           JOIN ${ID_MAP} dm ON dm.source_table = 'trx_inventory' AND dm.legacy_id = s."id"::text
          WHERE q.import_run_id = $1 AND q.source_table = $2 AND q.reason = 'file_missing' AND dm.client_facility_id IS NOT NULL
          GROUP BY dm.client_facility_id`,
        [context.runId, folder],
        { transaction: context.transaction },
      ),
    );
  }
  return counts;
};

/** The run's facilities: the provider tenant's, ordered by code. */
const facilitiesOf = async (tenantId: string): Promise<Facility[]> =>
  (
    await ClientFacility.findAll({
      where: { tenantId },
      attributes: ["id", "code"],
      order: [
        ["code", "ASC"],
        ["id", "ASC"],
      ],
    })
  ).map((f) => ({ id: f.id, code: f.code }));

/**
 * The quarantine review and data-quality report of one transformed run, per facility.
 * @throws {CodedError} 404 UPSTREAM_SQL_IMPORT_NOT_FOUND; 409 RUN_NOT_TRANSFORMED (not `transformed`, or no provider tenant)
 */
export const reportDataQuality = async (
  runId: string,
): Promise<UpstreamDataQualityResult> => {
  const found = (await UpstreamSqlImport.findByPk(
    runId,
  )) as unknown as Run | null;
  if (found === null) {
    throw new CodedError(
      404,
      "UPSTREAM_SQL_IMPORT_NOT_FOUND",
      "Import run not found",
    );
  }
  if (found.transformStatus !== "transformed") {
    throw new CodedError(
      409,
      "RUN_NOT_TRANSFORMED",
      `The run's transform is ${found.transformStatus}; only a transformed run can be reported.`,
    );
  }
  const tenantId = found.transformTenantId;
  if (tenantId === null) {
    throw new CodedError(
      409,
      "RUN_NOT_TRANSFORMED",
      "The run names no provider tenant.",
    );
  }
  const connection = createTransformDb();
  try {
    return await connection.transaction(async (transaction) => {
      const runner = connection as unknown as SqlRunner;
      // The transform role, not a superuser (the runner's own proof, P24-01).
      const [role] = await sql<{ currentUser: string }>(
        runner,
        'SELECT current_user AS "currentUser"',
        [],
        { transaction },
      );
      if (role?.currentUser !== transformRoleName()) {
        throw new AppError(
          500,
          "The report connection is not the transform role.",
        );
      }
      const facilities = await facilitiesOf(tenantId);

      // Quarantine by (facility, table, reason): the review itself, codes only.
      const quarantineRows = await sql<{
        facilityId: string | null;
        sourceTable: string;
        reason: string;
        n: number;
      }>(
        runner,
        `SELECT m.client_facility_id AS "facilityId", q.source_table AS "sourceTable", q.reason, count(*)::int AS n
           FROM ${QUARANTINE} q
           LEFT JOIN ${ID_MAP} m ON m.source_table = q.source_table AND m.legacy_id = q.legacy_id
          WHERE q.import_run_id = $1
          GROUP BY m.client_facility_id, q.source_table, q.reason
          ORDER BY q.source_table, q.reason`,
        [runId],
        { transaction },
      );
      const quarantineByFacility = new Map<
        string,
        DataQualityQuarantineGroup[]
      >();
      const totals = new Map<string, DataQualityQuarantineGroup>();
      for (const r of quarantineRows) {
        const group: DataQualityQuarantineGroup = {
          sourceTable: r.sourceTable,
          reason: r.reason,
          rows: r.n,
        };
        if (r.facilityId !== null) {
          const list = quarantineByFacility.get(r.facilityId) ?? [];
          list.push(group);
          quarantineByFacility.set(r.facilityId, list);
        }
        const key = `${r.sourceTable}:${r.reason}`;
        const total = totals.get(key) ?? {
          sourceTable: r.sourceTable,
          reason: r.reason,
          rows: 0,
        };
        total.rows += r.n;
        totals.set(key, total);
      }

      // Duplicates. Q-18: case-variant serial groups inside one facility — 0118 holds exact ones
      // unique per facility and the devices step NULLs a duplicate's serial (UD-9), so any group
      // here is a transform defect. Q-19: serials this facility shares with another facility.
      const duplicates = byFacility(
        await sql<{ facilityId: string; n: number }>(
          runner,
          `SELECT client_facility_id AS "facilityId", count(*)::int AS n
           FROM (SELECT client_facility_id FROM calibration_devices
                  WHERE tenant_id = $1 AND serial_number IS NOT NULL AND client_facility_id IS NOT NULL
                  GROUP BY client_facility_id, lower(serial_number) HAVING count(*) > 1) d
          GROUP BY client_facility_id`,
          [tenantId],
          { transaction },
        ),
      );
      const shared = byFacility(
        await sql<{ facilityId: string; n: number }>(
          runner,
          `SELECT d.client_facility_id AS "facilityId", count(DISTINCT lower(d.serial_number))::int AS n
           FROM calibration_devices d
          WHERE d.tenant_id = $1 AND d.serial_number IS NOT NULL AND d.client_facility_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM calibration_devices o
                         WHERE o.tenant_id = $1 AND o.client_facility_id <> d.client_facility_id
                           AND lower(o.serial_number) = lower(d.serial_number))
          GROUP BY d.client_facility_id`,
          [tenantId],
          { transaction },
        ),
      );

      // Dates per facility: future (Q-12) and before 2023 (Q-13), inventory and calibration dates.
      const future = byFacility(
        await sql<{ facilityId: string; n: number }>(
          runner,
          `SELECT f AS "facilityId", sum(n)::int AS n FROM (
             SELECT client_facility_id AS f, count(*) AS n FROM calibration_devices
              WHERE tenant_id = $1 AND client_facility_id IS NOT NULL AND inventoried_on > now() GROUP BY 1
             UNION ALL
             SELECT client_facility_id AS f, count(*) AS n FROM calibration_records
              WHERE tenant_id = $1 AND client_facility_id IS NOT NULL AND calibration_date > now() GROUP BY 1
           ) d GROUP BY f`,
          [tenantId],
          { transaction },
        ),
      );
      const old = byFacility(
        await sql<{ facilityId: string; n: number }>(
          runner,
          `SELECT f AS "facilityId", sum(n)::int AS n FROM (
             SELECT client_facility_id AS f, count(*) AS n FROM calibration_devices
              WHERE tenant_id = $1 AND client_facility_id IS NOT NULL AND inventoried_on < DATE '2023-01-01' GROUP BY 1
             UNION ALL
             SELECT client_facility_id AS f, count(*) AS n FROM calibration_records
              WHERE tenant_id = $1 AND client_facility_id IS NOT NULL AND calibration_date < DATE '2023-01-01' GROUP BY 1
           ) d GROUP BY f`,
          [tenantId],
          { transaction },
        ),
      );

      // Q-14: calibrations dated before their device's inventory date (plausible: calibrated before
      // registration), flagged for review.
      const calibratedBefore = byFacility(
        await sql<{ facilityId: string; n: number }>(
          runner,
          `SELECT r.client_facility_id AS "facilityId", count(*)::int AS n
           FROM calibration_records r JOIN calibration_devices d ON d.id = r.device_id AND d.tenant_id = $1
          WHERE r.tenant_id = $1 AND r.client_facility_id IS NOT NULL AND r.calibration_date < d.inventoried_on
          GROUP BY r.client_facility_id`,
          [tenantId],
          { transaction },
        ),
      );
      // Q-4 and Q-28 read the run's staged rows: a step's context on this connection.
      const context: StepContext = {
        runId,
        runner,
        transaction,
        tenantId,
        sourceZone: "Asia/Jakarta",
      };
      const noDevice = await noDevicePerFacility(context);
      const missingFiles = await missingFilesPerFacility(context);

      const flagged = (
        findingId: string,
        counts: Map<string, number>,
        id: string,
        note: string,
      ): DataQualityFinding => {
        const count = counts.get(id) ?? 0;
        return finding(
          findingId,
          count === 0 ? "pass" : "flagged",
          count,
          note,
        );
      };
      const facilityRows = facilities.map(({ id, code }) => ({
        clientFacilityId: id,
        facilityCode: code,
        quarantine: quarantineByFacility.get(id) ?? [],
        findings: [
          flagged(
            "Q-18",
            duplicates,
            id,
            "stored serial groups differing only in case inside the facility; 0 expected (UD-9, 0118)",
          ),
          flagged(
            "Q-19",
            shared,
            id,
            "serials the facility shares with another facility of the provider: harmless, flagged",
          ),
          flagged(
            "Q-12",
            future,
            id,
            "future inventory / calibration dates: flagged, never a due date",
          ),
          flagged(
            "Q-13",
            old,
            id,
            "inventory / calibration dates before 2023: likely typing errors or real acquisition dates",
          ),
          flagged(
            "Q-4",
            noDevice,
            id,
            "IPM session rows whose QR matches no imported device (quarantined no_device; their results follow as session_not_imported)",
          ),
          flagged(
            "Q-14",
            calibratedBefore,
            id,
            "calibrations dated before their device's inventory date: plausible (calibrated before registration), flagged",
          ),
          (missingFiles.get(id) ?? 0) > 0
            ? flagged(
              "Q-28",
              missingFiles,
              id,
              "photos a device names whose file is missing on disk (file_missing); unreferenced files on disk are the manifest's, P25-04",
            )
            : finding(
              "Q-28",
              "manual",
              0,
              "no photo missing on disk; unreferenced files on disk are not counted here (the manifest's side, P25-04)",
            ),
        ],
      }));

      return {
        runId,
        providerTenantId: tenantId,
        facilities: facilityRows,
        totals: [...totals.values()],
      };
    });
  } finally {
    await connection.close();
  }
};
