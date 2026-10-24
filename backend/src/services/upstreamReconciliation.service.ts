/**
 * P25-01 — the automated reconciliation of one transformed upstream run
 * (docs/UPSTREAM/05 § 7, R-1 … R-12; threat model § 11, G-30 RC-F1 … RC-F5).
 *
 * Aggregates only. Every statement goes through `sql()` on the transform
 * connection (the application's connection never touches `upstream_import`),
 * with every value bound; a staged table's name reaches a statement only
 * through the staging allow-list (ledger.ts#stagedTable). Counts and codes
 * only: no staged value, no legacy id, no name, no serial, no hash ever
 * leaves the database through this module — the same rule the import's own
 * views live by (ADR-129).
 *
 * What each check compares (05 § 7, per tenant of the run's provider):
 *
 *   R-1  devices per facility: staged `trx_inventory` rows of the run with a
 *        QR (mapped or quarantined) vs `calibration_devices` with a QR
 *   R-2  sessions per facility: staged `trx_hasil_pemeriksaan` rows vs
 *        `inspection_sessions` + quarantined `duplicate_header`/`no_device`
 *   R-3  detail rows per facility per section: staged rows of each `trx_*`
 *        table vs `inspection_results` of its section + quarantine
 *   R-4  outcome distribution per section: staged `status` codes vs stored
 *        `outcome` codes, through the transform's own maps (ipm.ts)
 *   R-5  numeric sums: staged `terukur_1` (decimal comma) vs stored
 *        `measured_value_1`, per section
 *   R-6  environment: AVG/MIN/MAX of staged temperature/humidity vs stored
 *   R-7  calibrations: staged `trx_kalibrasi` rows vs `calibration_records`
 *        + quarantine
 *   R-8  files: staged photo names per folder vs `attachments` + quarantine;
 *        every stored checksum equals the manifest's (the step proved it)
 *   R-9  users: staged members per group vs users per (tenant, role)
 *   R-10 completeness: every staged row id is in `id_map` or `quarantine`
 *        (the runner already proves this per step; asserted again here)
 *   R-11 isolation: no `inspection_results.tenant_id` differs from its
 *        session's, no session's from its device's (the composite FKs hold it)
 *   RC-F1 every imported row's facility = `id_map.client_facility_id`
 *   RC-F2 every child's facility = its device's
 *   RC-F3 every attachment key's `f/<facility>` segment = its row's
 *   RC-F4 per-facility counts equal the source's (covered by R-1 … R-9)
 *   RC-F5 no imported facility account (a FACILITY_BOUND_ROLES role) is
 *        unbound; "two facilities" cannot happen (one `client_facility_id`)
 *   R-12 the app-level smoke: the suites that must have passed on the
 *        dry-run database (named, with whether each did)
 *
 * AS BUILT (P25-01 review, 2026-10-24): R-1, R-2 and R-7 per facility and
 * R-10, R-11, RC-F1, RC-F2, RC-F3 and RC-F5 per run are computed. R-3 … R-6,
 * R-8, R-9, RC-F4 and R-12 are NOT automated: they answer `manual` with what
 * to run in P25-04. R-1/R-2/R-7 compare the MAPPED staged rows of a facility
 * (id_map) with the stored rows those mappings name: they catch a lost or
 * moved row, not a quarantined one (the quarantine is P25-02's report). A
 * staged table the dump lacked counts as zero rows. R-10 runs over every
 * source of the step registry (steps.ts), each with its own legacy key.
 */
import { sql, type SqlRunner } from "../utils/sql.util";
import { createTransformDb, transformRoleName } from "../config/upstreamImport";
import {
  ID_MAP,
  QUARANTINE,
  stagedTable,
  stagedTableExists,
} from "./upstreamImport/transform/ledger";
import {
  TRANSFORM_STEPS,
  type StepContext,
  type TransformSource,
} from "./upstreamImport/transform/steps";
import { FACILITY_BOUND_ROLES } from "../constants/facilityAccess";
import type {
  ReconciliationCheckResult,
  UpstreamReconciliationCheck,
  UpstreamReconciliationResult,
} from "@callibrator/contracts/upstreamReconciliation";
import models from "../models";
import { AppError } from "../utils/appError.util";
import { CodedError } from "../utils/codedError.util";

const { UpstreamSqlImport, ClientFacility } = models;

interface Run {
  id: string;
  status: string;
  transformStatus: string;
  transformTenantId: string | null;
  transformSummary: { durationMs: number; steps: { step: string }[] } | null;
}

/** One facility of the provider tenant: its id and code only — never its name. */
interface Facility {
  id: string;
  code: string;
}

const check = (
  checkName: UpstreamReconciliationCheck,
  expected: number,
  actual: number,
  quarantined: number,
  note: string,
): ReconciliationCheckResult => ({
  check: checkName,
  status: expected === actual ? "pass" : "fail",
  expected,
  actual,
  delta: actual - expected,
  quarantined,
  note,
});

/** An invariant: `bad` rows break it; zero passes. */
const invariant = (
  checkName: UpstreamReconciliationCheck,
  bad: number,
  note: string,
): ReconciliationCheckResult => check(checkName, 0, bad, 0, note);

const manual = (
  checkName: UpstreamReconciliationCheck,
  note: string,
): ReconciliationCheckResult => ({
  check: checkName,
  status: "manual",
  expected: 0,
  actual: 0,
  delta: 0,
  quarantined: 0,
  note,
});

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

/** The sum of `n` over a count statement's rows (an aggregate answers one row). */
const sum = (rows: readonly { n: number }[]): number =>
  rows.reduce((acc, r) => acc + r.n, 0);

/** `n` per facility of a `(facilityId, n)` statement's rows. */
const byFacility = (
  rows: readonly { facilityId: string; n: number }[],
): Map<string, number> => new Map(rows.map((r) => [r.facilityId, r.n]));

/** Every staged source of the transform with its legacy key: the step registry is the one list. */
const SOURCES: readonly TransformSource[] = TRANSFORM_STEPS.flatMap(
  (s) => s.sources,
);
const sourceOf = (table: string): TransformSource =>
  SOURCES.find((s) => s.table === table) as TransformSource;

/** The mapped staged rows of `source` of this run, per facility the transform decided. */
const stagedPerFacility = async (
  context: StepContext,
  source: TransformSource,
): Promise<Map<string, number>> =>
  (await stagedTableExists(context, source.table))
    ? byFacility(
      await sql<{ facilityId: string; n: number }>(
        context.runner,
        `SELECT m.client_facility_id AS "facilityId", count(*)::int AS n
         FROM ${stagedTable(source.table)} s
         JOIN ${ID_MAP} m ON m.source_table = $2 AND m.legacy_id = (${String(source.legacyId)})
        WHERE s.import_run_id = $1 AND m.client_facility_id IS NOT NULL
        GROUP BY m.client_facility_id`,
        [context.runId, source.table],
        { transaction: context.transaction },
      ),
    )
    : new Map<string, number>();

/** R-10 over every staged source: [staged, mapped or quarantined, quarantined]. */
const completeness = async (
  context: StepContext,
): Promise<[number, number, number]> => {
  let staged = 0;
  let accounted = 0;
  let quarantined = 0;
  for (const source of SOURCES) {
    if (!(await stagedTableExists(context, source.table))) {
      continue;
    }
    const rows = await sql<{
      staged: number;
      mapped: number;
      quarantined: number;
    }>(
      context.runner,
      `SELECT count(*)::int AS staged,
              count(*) FILTER (WHERE m.legacy_id IS NOT NULL)::int AS mapped,
              count(*) FILTER (WHERE m.legacy_id IS NULL AND EXISTS (
                SELECT 1 FROM ${QUARANTINE} q
                 WHERE q.import_run_id = $1 AND q.source_table = $2 AND q.source_row_number = s.source_row_number))::int AS quarantined
         FROM ${stagedTable(source.table)} s
         LEFT JOIN ${ID_MAP} m ON m.source_table = $2 AND m.legacy_id = (${String(source.legacyId)})
        WHERE s.import_run_id = $1`,
      [context.runId, source.table],
      { transaction: context.transaction },
    );
    for (const row of rows) {
      staged += row.staged;
      accounted += row.mapped + row.quarantined;
      quarantined += row.quarantined;
    }
  }
  return [staged, accounted, quarantined];
};

/**
 * The reconciliation of one transformed run, per facility.
 * @throws {CodedError} 404 UPSTREAM_SQL_IMPORT_NOT_FOUND; 409 RUN_NOT_TRANSFORMED (not `transformed`, or no provider tenant)
 */
export const reconcileRun = async (
  runId: string,
): Promise<UpstreamReconciliationResult> => {
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
      `The run's transform is ${found.transformStatus}; only a transformed run can be reconciled.`,
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
      const context: StepContext = {
        runId,
        runner,
        transaction,
        tenantId,
        sourceZone: "Asia/Jakarta",
      };
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
          "The reconciliation connection is not the transform role.",
        );
      }
      const facilities = await facilitiesOf(tenantId);

      // R-10 first: every staged row of the run is mapped or quarantined.
      const [staged, accounted, quarantined] = await completeness(context);
      const r10 = check(
        "R-10",
        staged,
        accounted,
        quarantined,
        "every staged row is mapped or quarantined (the runner proves it per step; asserted again here)",
      );

      // R-11: the composite FKs hold the tenant and facility chain (asserted, not trusted).
      const r11 = invariant(
        "R-11",
        sum(
          await sql<{ n: number }>(
            runner,
            `SELECT (
             (SELECT count(*) FROM inspection_results r JOIN inspection_sessions s ON s.id = r.session_id
               WHERE r.tenant_id = $1 AND (s.tenant_id <> $1 OR r.client_facility_id IS DISTINCT FROM s.client_facility_id)) +
             (SELECT count(*) FROM inspection_sessions s JOIN calibration_devices d ON d.id = s.device_id
               WHERE s.tenant_id = $1 AND (d.tenant_id <> $1 OR s.client_facility_id IS DISTINCT FROM d.client_facility_id))
           )::int AS n`,
            [tenantId],
            { transaction },
          ),
        ),
        "no result outside its session's tenant or facility, no session outside its device's (the composite FKs hold it)",
      );

      // RC-F1: every imported row's facility = the facility the transform decided.
      const rcF1 = invariant(
        "RC-F1",
        sum(
          await sql<{ n: number }>(
            runner,
            `SELECT (
             (SELECT count(*) FROM calibration_devices d JOIN ${ID_MAP} m ON m.target_id = d.id
               WHERE d.tenant_id = $2 AND m.source_table = 'trx_inventory' AND m.import_run_id = $1
                 AND d.client_facility_id IS DISTINCT FROM m.client_facility_id) +
             (SELECT count(*) FROM inspection_sessions s JOIN ${ID_MAP} m ON m.target_id = s.id
               WHERE s.tenant_id = $2 AND m.source_table = 'trx_hasil_pemeriksaan' AND m.import_run_id = $1
                 AND s.client_facility_id IS DISTINCT FROM m.client_facility_id) +
             (SELECT count(*) FROM calibration_records r JOIN ${ID_MAP} m ON m.target_id = r.id
               WHERE r.tenant_id = $2 AND m.source_table = 'trx_kalibrasi' AND m.import_run_id = $1
                 AND r.client_facility_id IS DISTINCT FROM m.client_facility_id)
           )::int AS n`,
            [runId, tenantId],
            { transaction },
          ),
        ),
        "every imported row's facility is the facility the transform decided (id_map.client_facility_id)",
      );

      // RC-F2: every child's facility = its device's.
      const rcF2 = invariant(
        "RC-F2",
        sum(
          await sql<{ n: number }>(
            runner,
            `SELECT (
             (SELECT count(*) FROM calibration_records r JOIN calibration_devices d ON d.id = r.device_id
               WHERE r.tenant_id = $1 AND r.client_facility_id IS DISTINCT FROM d.client_facility_id) +
             (SELECT count(*) FROM attachments a JOIN calibration_devices d ON d.id = a.resource_id
               WHERE a.tenant_id = $1 AND a.resource_type = 'device' AND a.client_facility_id IS DISTINCT FROM d.client_facility_id)
           )::int AS n`,
            [tenantId],
            { transaction },
          ),
        ),
        "every calibration's facility is its device's; every device photo's is its device's",
      );

      // RC-F3: every device photo's key carries its row's f/<facility> segment.
      const rcF3 = invariant(
        "RC-F3",
        sum(
          await sql<{ n: number }>(
            runner,
            `SELECT count(*)::int AS n FROM attachments
            WHERE tenant_id = $1 AND resource_type = 'device' AND client_facility_id IS NOT NULL
              AND storage_key NOT LIKE '%/f/' || client_facility_id::text || '/%'`,
            [tenantId],
            { transaction },
          ),
        ),
        "every device photo's storage key carries its row's facility (t/<tenant>/f/<facility>/attachments/)",
      );

      // RC-F5: no imported facility account (a FACILITY_BOUND_ROLES role) is unbound.
      const rcF5 = invariant(
        "RC-F5",
        sum(
          await sql<{ n: number }>(
            runner,
            `SELECT count(*)::int AS n FROM users u
             JOIN roles r ON r.id = u.role_id
             JOIN ${ID_MAP} m ON m.target_id = u.id AND m.source_table = 'users'
            WHERE u.tenant_id = $1 AND r.name = ANY($2::text[]) AND u.client_facility_id IS NULL`,
            [tenantId, FACILITY_BOUND_ROLES],
            { transaction },
          ),
        ),
        "no imported facility account is unbound (the users step quarantines facility_mapping_ambiguous instead)",
      );

      // Per facility: R-1 (devices), R-2 (session headers), R-7 (calibrations).
      const stagedDevices = await stagedPerFacility(
        context,
        sourceOf("trx_inventory"),
      );
      const stagedSessions = await stagedPerFacility(
        context,
        sourceOf("trx_hasil_pemeriksaan"),
      );
      const stagedCalibrations = await stagedPerFacility(
        context,
        sourceOf("trx_kalibrasi"),
      );
      // The stored rows those mappings name, per facility the row landed in.
      const devices = byFacility(
        await sql<{ facilityId: string; n: number }>(
          runner,
          `SELECT t.client_facility_id AS "facilityId", count(*)::int AS n FROM calibration_devices t
             JOIN ${ID_MAP} m ON m.target_id = t.id AND m.source_table = 'trx_inventory'
            WHERE t.tenant_id = $1 GROUP BY t.client_facility_id`,
          [tenantId],
          { transaction },
        ),
      );
      const sessions = byFacility(
        await sql<{ facilityId: string; n: number }>(
          runner,
          `SELECT t.client_facility_id AS "facilityId", count(*)::int AS n FROM inspection_sessions t
             JOIN ${ID_MAP} m ON m.target_id = t.id AND m.source_table = 'trx_hasil_pemeriksaan'
            WHERE t.tenant_id = $1 GROUP BY t.client_facility_id`,
          [tenantId],
          { transaction },
        ),
      );
      const calibrations = byFacility(
        await sql<{ facilityId: string; n: number }>(
          runner,
          `SELECT t.client_facility_id AS "facilityId", count(*)::int AS n FROM calibration_records t
             JOIN ${ID_MAP} m ON m.target_id = t.id AND m.source_table = 'trx_kalibrasi'
            WHERE t.tenant_id = $1 GROUP BY t.client_facility_id`,
          [tenantId],
          { transaction },
        ),
      );

      const facilityRows = facilities.map(({ id, code }) => ({
        clientFacilityId: id,
        facilityCode: code,
        checks: [
          check(
            "R-1",
            stagedDevices.get(id) ?? 0,
            devices.get(id) ?? 0,
            0,
            "mapped staged devices vs stored imported devices of the facility (05 § 7)",
          ),
          check(
            "R-2",
            stagedSessions.get(id) ?? 0,
            sessions.get(id) ?? 0,
            0,
            "mapped staged session headers vs stored imported sessions of the facility",
          ),
          check(
            "R-7",
            stagedCalibrations.get(id) ?? 0,
            calibrations.get(id) ?? 0,
            0,
            "mapped staged calibrations vs stored imported calibrations of the facility",
          ),
        ],
      }));

      return {
        runId,
        providerTenantId: tenantId,
        transformSummary:
          found.transformSummary === null
            ? null
            : {
              durationMs: found.transformSummary.durationMs,
              steps: found.transformSummary.steps.length,
            },
        facilities: facilityRows,
        runChecks: [
          r10,
          r11,
          rcF1,
          rcF2,
          rcF3,
          rcF5,
          manual(
            "R-3",
            "NOT AUTOMATED: detail rows per section; run the section queries of 05 § 7 on the dry-run database, in P25-04",
          ),
          manual(
            "R-4",
            "NOT AUTOMATED: outcome distribution per section; staged status codes vs stored outcomes through ipm.ts, in P25-04",
          ),
          manual(
            "R-5",
            "NOT AUTOMATED: numeric sums; SUM(terukur_1) with decimal comma vs SUM(measured_value_1), in P25-04",
          ),
          manual(
            "R-6",
            "NOT AUTOMATED: environment AVG/MIN/MAX of temperature and humidity, in P25-04",
          ),
          manual(
            "R-8",
            "NOT AUTOMATED: files per folder; referenced names vs attachments + quarantine (step 9 proves the checksums), in P25-04",
          ),
          manual(
            "R-9",
            "NOT AUTOMATED: users per group vs users per (tenant, role), in P25-04",
          ),
          manual(
            "RC-F4",
            "per-facility counts equal the source's: R-1, R-2 and R-7 cover the mapped rows; the source-side totals are P25-04's",
          ),
          manual(
            "R-12",
            "NOT AUTOMATED: the app-level smoke (two-tenant suites and a live E2E on the dry-run database, P21-10's spec), in P25-04",
          ),
        ],
      };
    });
  } finally {
    await connection.close();
  }
};
