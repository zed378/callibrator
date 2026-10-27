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
 * AS BUILT (P25-01 review, 2026-10-24; R-3 … R-6, R-8 and R-9 2026-10-27):
 * R-1 … R-8 per facility and R-8, R-9, R-10, R-11, RC-F1, RC-F2, RC-F3 and
 * RC-F5 per run are computed. RC-F4 and R-12 are NOT automated: they answer
 * `manual` with what to run in P25-04. R-3 … R-6 are ROW-LEVEL (the contract carries
 * integer counts, so a sum or an average would not fit it): each mapped
 * staged result row is joined to the result its mapping names, and R-4 … R-6
 * count the landed rows whose outcome or readings are the staged row's —
 * equal rows give equal distributions, sums and AVG/MIN/MAX. R-1/R-2/R-7 compare the MAPPED staged rows of a facility
 * (id_map) with the stored rows those mappings name: they catch a lost or
 * moved row, not a quarantined one (the quarantine is P25-02's report). A
 * staged table the dump lacked counts as zero rows. R-10 runs over every
 * source of the step registry (steps.ts), each with its own legacy key.
 */
import { sql, type BindValue, type SqlRunner } from "../utils/sql.util";
import { createTransformDb, transformRoleName } from "../config/upstreamImport";
import {
  ID_MAP,
  QUARANTINE,
  checkedName,
  stagedTable,
  stagedTableExists,
} from "./upstreamImport/transform/ledger";
import {
  ENVIRONMENT_RANGES,
  ENVIRONMENT_TABLE,
  RESULT_CODES,
  RESULT_TABLES,
  type ResultTableRule,
} from "./upstreamImport/transform/ipm";
import {
  TRANSFORM_STEPS,
  type StepContext,
  type TransformSource,
} from "./upstreamImport/transform/steps";
import { FACILITY_BOUND_ROLES } from "../constants/facilityAccess";
import { ROLE_NAMES } from "../constants/roleConstants";
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

/** A staged column as text, trimmed (the row read through `to_jsonb`, so a column the dump lacked is NULL, not an error). */
const stagedText = (column: string): string =>
  `regexp_replace(coalesce(to_jsonb(s) ->> '${checkedName(column)}', ''), '^\\s+|\\s+$', '', 'g')`;

/** A staged reading as `parseDecimal` reads it (inspectionValues § 6.1): one `,` or `.` as the point, else NULL. */
const decimalSql = (column: string): string =>
  `CASE WHEN ${stagedText(column)} ~ '^[+-]?[0-9]+([.,][0-9]+)?$' THEN replace(${stagedText(column)}, ',', '.')::numeric END`;

/** The sections whose `terukur_1`/`terukur_2` become `measured_value_1`/`_2` (R-5). */
const TWO_READINGS: ReadonlySet<string> = new Set(["performance", "battery"]);

/**
 * Whether a landed result's readings are the staged row's, written from 05 § 7 and spec § 6.1
 * independently of `resultValuesOf`: R-5 the two readings of performance and battery, R-6 the
 * environment reading (NULL when outside its plausible range, Q-21). Other sections: TRUE.
 */
const readingMatchSql = (
  table: string,
  rule: ResultTableRule,
): { text: string; bind: BindValue[] } => {
  if (TWO_READINGS.has(rule.section)) {
    return {
      text: `r.measured_value_1::numeric IS NOT DISTINCT FROM ${decimalSql("terukur_1")}
         AND r.measured_value_2::numeric IS NOT DISTINCT FROM ${decimalSql("terukur_2")}`,
      bind: [],
    };
  }
  if (table === ENVIRONMENT_TABLE && rule.item !== null) {
    const codes = Object.keys(ENVIRONMENT_RANGES);
    const reading = decimalSql("value");
    return {
      text: `r.measured_value::numeric IS NOT DISTINCT FROM (
           SELECT CASE WHEN e.code IS NOT NULL AND (${reading} < e.low OR ${reading} > e.high) THEN NULL ELSE ${reading} END
             FROM (SELECT 1) one
             LEFT JOIN unnest($6::text[], $7::numeric[], $8::numeric[]) AS e(code, low, high) ON e.code = ${stagedText(rule.item.column)})`,
      bind: [
        codes,
        codes.map(
          (c) => (ENVIRONMENT_RANGES[c] as readonly [number, number])[0],
        ),
        codes.map(
          (c) => (ENVIRONMENT_RANGES[c] as readonly [number, number])[1],
        ),
      ],
    };
  }
  return { text: "TRUE", bind: [] };
};

/** One result table's mapped rows of one facility: staged, landed, landed in the facility, outcome and reading matches. */
interface SectionRow {
  facility: string;
  staged: number;
  landed: number;
  stored: number;
  outcomeMatch: number;
  readingMatch: number;
}

/**
 * R-3 … R-6 for one result table: its run's mapped staged rows per decided facility, each joined
 * to the result its mapping names. The expected outcome comes from the section's code map
 * (ipm.ts RESULT_CODES, the map 04 § 5 fixes); an unknown code or a measured one expects NULL.
 */
const sectionRows = async (
  context: StepContext,
  table: string,
): Promise<SectionRow[]> => {
  if (!(await stagedTableExists(context, table))) {
    return [];
  }
  const rule = RESULT_TABLES[table] as ResultTableRule;
  const codes = Object.entries(RESULT_CODES[rule.section]);
  const reading = readingMatchSql(table, rule);
  return sql<SectionRow>(
    context.runner,
    `SELECT m.client_facility_id AS "facility",
            count(*)::int AS staged,
            count(r.id)::int AS landed,
            count(*) FILTER (WHERE r.client_facility_id = m.client_facility_id)::int AS stored,
            count(*) FILTER (WHERE r.id IS NOT NULL AND r.outcome::text IS NOT DISTINCT FROM c.outcome)::int AS "outcomeMatch",
            count(*) FILTER (WHERE r.id IS NOT NULL AND (${reading.text}))::int AS "readingMatch"
       FROM ${stagedTable(table)} s
       JOIN ${ID_MAP} m ON m.source_table = $2 AND m.legacy_id = (${String(sourceOf(table).legacyId)})
       LEFT JOIN inspection_results r ON r.id = m.target_id AND r.tenant_id = $3
       LEFT JOIN unnest($4::text[], $5::text[]) AS c(code, outcome) ON c.code = ${stagedText("status")}
      WHERE s.import_run_id = $1 AND m.client_facility_id IS NOT NULL
      GROUP BY m.client_facility_id`,
    [
      context.runId,
      table,
      context.tenantId,
      codes.map(([code]) => code),
      codes.map(([, outcome]) => outcome),
      ...reading.bind,
    ],
    { transaction: context.transaction },
  );
};

/** R-3 … R-6 of one facility, summed over the result tables. */
interface SectionTotals {
  staged: number;
  stored: number;
  landed: number;
  outcomeMatch: number;
  readingLanded: number;
  readingMatch: number;
  environmentLanded: number;
  environmentMatch: number;
  /** The sections whose staged and stored counts differ (fixed codes). */
  differing: Set<string>;
}

const emptyTotals = (): SectionTotals => ({
  staged: 0,
  stored: 0,
  landed: 0,
  outcomeMatch: 0,
  readingLanded: 0,
  readingMatch: 0,
  environmentLanded: 0,
  environmentMatch: 0,
  differing: new Set<string>(),
});

/** R-3 … R-6 per facility over every result table the run staged. */
const sectionTotals = async (
  context: StepContext,
): Promise<Map<string, SectionTotals>> => {
  const totals = new Map<string, SectionTotals>();
  for (const table of Object.keys(RESULT_TABLES)) {
    const { section } = RESULT_TABLES[table] as ResultTableRule;
    for (const row of await sectionRows(context, table)) {
      const t = totals.get(row.facility) ?? emptyTotals();
      t.staged += row.staged;
      t.stored += row.stored;
      t.landed += row.landed;
      t.outcomeMatch += row.outcomeMatch;
      if (TWO_READINGS.has(section)) {
        t.readingLanded += row.landed;
        t.readingMatch += row.readingMatch;
      } else if (table === ENVIRONMENT_TABLE) {
        t.environmentLanded += row.landed;
        t.environmentMatch += row.readingMatch;
      }
      if (row.staged !== row.stored) {
        t.differing.add(section);
      }
      totals.set(row.facility, t);
    }
  }
  return totals;
};

/** The R-3 note: the sections that differ, cut to the contract's 280 characters. */
const r3Note = (differing: ReadonlySet<string>): string =>
  (differing.size === 0
    ? "mapped staged result rows vs results landed in the facility, every section (05 § 7)"
    : `mapped staged result rows vs results landed in the facility; differ: ${[...differing].sort().join(", ")}`
  ).slice(0, 280);

/**
 * R-9: the role each upstream group gives (P18-01 § 2.1), written from the rule, not read from
 * users.ts. A `client` is HEALTHCARE ADMIN when it is its facility's earliest active client, else
 * ROOM USER — both are accepted here; which of them a client got is not checked.
 */
const GROUP_ROLE_PAIRS: readonly (readonly [group: string, role: string])[] =
  Object.freeze([
    ["admin", ROLE_NAMES.CALIBRATOR_ADMIN],
    ["user", ROLE_NAMES.TECHNICIAN],
    ["client", ROLE_NAMES.ROOM_USER],
    ["client", ROLE_NAMES.HEALTCARE_ADMIN],
    ["teknisi_client", ROLE_NAMES.HEALTHCARE_TECHNICIAN],
  ]);

/**
 * R-9 at the run level: the run's mapped staged users whose account landed in the tenant, and those
 * whose role is one their staged group gives. Run-level because provider staff have no facility.
 * @returns [landed, matching]
 */
const userRoles = async (
  context: StepContext,
): Promise<[number, number]> => {
  if (!(await stagedTableExists(context, "users"))) {
    return [0, 0];
  }
  const grouped =
    (await stagedTableExists(context, "auth_groups")) &&
    (await stagedTableExists(context, "auth_groups_users"));
  const [row] = await sql<{ landed: number; matching: number }>(
    context.runner,
    `SELECT count(*)::int AS landed,
            ${
  grouped
    ? `count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM ${stagedTable("auth_groups_users")} gu
                JOIN ${stagedTable("auth_groups")} g ON g.import_run_id = $1 AND g."id"::bigint = gu."group_id"::bigint
                JOIN unnest($3::text[], $4::text[]) AS c(grp, role) ON c.grp = lower(btrim(g."name"::text))
               WHERE gu.import_run_id = $1 AND gu."user_id"::bigint = s."id"::bigint AND c.role = r.name))::int`
    : "0"
} AS matching
       FROM ${stagedTable("users")} s
       JOIN ${ID_MAP} m ON m.source_table = 'users' AND m.legacy_id = (${String(sourceOf("users").legacyId)})
       JOIN users u ON u.id = m.target_id AND u.tenant_id = $2
       JOIN roles r ON r.id = u.role_id
      WHERE s.import_run_id = $1`,
    [
      context.runId,
      context.tenantId,
      GROUP_ROLE_PAIRS.map(([group]) => group),
      GROUP_ROLE_PAIRS.map(([, role]) => role),
    ],
    { transaction: context.transaction },
  );
  return [row?.landed ?? 0, row?.matching ?? 0];
};

/**
 * R-8: the two photo folders (columns of the staged device rows) and the purpose an imported photo
 * of each carries — 08-FILE-POLICY § 7 and devicePhoto.service, written here, not read from attachments.ts.
 */
const PHOTO_FOLDER_PURPOSES: readonly (readonly [folder: string, purpose: string])[] =
  Object.freeze([
    ["foto_depan", "device_front"],
    ["foto_sn", "device_serial_plate"],
  ]);

/** R-8 of one run: the run-level accounting and, per decided facility, mapped photos against landed ones. */
interface PhotoTotals {
  referenced: number;
  accounted: number;
  quarantined: number;
  perFacility: Map<string, { mapped: number; landed: number }>;
}

/**
 * R-8: every name a staged device row references, per folder, is a mapped attachment (this run or an
 * earlier one) or quarantined in this run (05 § 7: "referenced names per folder = attachments +
 * quarantine"); and every mapped photo landed as a live attachment of the folder's purpose on its
 * device, in the facility the transform decided. The checksums are step 9's own proof (it compares
 * the stored object's SHA-256 with the manifest's before it writes the row).
 */
const photoTotals = async (context: StepContext): Promise<PhotoTotals> => {
  const totals: PhotoTotals = {
    referenced: 0,
    accounted: 0,
    quarantined: 0,
    perFacility: new Map(),
  };
  if (!(await stagedTableExists(context, "trx_inventory"))) {
    return totals;
  }
  const device = String(sourceOf("trx_inventory").legacyId);
  for (const [folder, purpose] of PHOTO_FOLDER_PURPOSES) {
    const [run] = await sql<{
      referenced: number;
      mapped: number;
      quarantined: number;
    }>(
      context.runner,
      `SELECT count(*)::int AS referenced,
              count(m.legacy_id)::int AS mapped,
              count(*) FILTER (WHERE m.legacy_id IS NULL AND EXISTS (
                SELECT 1 FROM ${QUARANTINE} q
                 WHERE q.import_run_id = $1 AND q.source_table = $2 AND q.source_row_number = s.source_row_number))::int AS quarantined
         FROM ${stagedTable("trx_inventory")} s
         LEFT JOIN ${ID_MAP} m ON m.source_table = $2 AND m.legacy_id = (${device})
        WHERE s.import_run_id = $1 AND nullif(btrim(to_jsonb(s) ->> $2), '') IS NOT NULL`,
      [context.runId, folder],
      { transaction: context.transaction },
    );
    totals.referenced += run?.referenced ?? 0;
    totals.accounted += (run?.mapped ?? 0) + (run?.quarantined ?? 0);
    totals.quarantined += run?.quarantined ?? 0;
    const rows = await sql<{ facility: string; mapped: number; landed: number }>(
      context.runner,
      `SELECT m.client_facility_id AS "facility", count(*)::int AS mapped,
              count(a.id)::int AS landed
         FROM ${stagedTable("trx_inventory")} s
         JOIN ${ID_MAP} m ON m.source_table = $2 AND m.legacy_id = (${device})
         LEFT JOIN ${ID_MAP} dm ON dm.source_table = 'trx_inventory' AND dm.legacy_id = (${device})
         LEFT JOIN attachments a ON a.id = m.target_id AND a.tenant_id = $3 AND a.is_deleted = false
              AND a.resource_type = 'device' AND a.purpose = $4 AND a.resource_id = dm.target_id
              AND a.client_facility_id = m.client_facility_id
        WHERE s.import_run_id = $1 AND m.client_facility_id IS NOT NULL
          AND nullif(btrim(to_jsonb(s) ->> $2), '') IS NOT NULL
        GROUP BY m.client_facility_id`,
      [context.runId, folder, context.tenantId, purpose],
      { transaction: context.transaction },
    );
    for (const row of rows) {
      const t = totals.perFacility.get(row.facility) ?? { mapped: 0, landed: 0 };
      t.mapped += row.mapped;
      t.landed += row.landed;
      totals.perFacility.set(row.facility, t);
    }
  }
  return totals;
};

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

      // R-9: every imported account's role is one its upstream group gives.
      const [usersLanded, usersMatching] = await userRoles(context);
      const r9 = check(
        "R-9",
        usersLanded,
        usersMatching,
        0,
        "imported accounts whose role is one their upstream group gives (P18-01 § 2.1; a client's admin-or-room-user choice is not checked)",
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

      // Per facility: R-3 … R-6 over the result tables (05 § 7).
      const sections = await sectionTotals(context);
      // R-8: the photos, per facility and at the run level.
      const photos = await photoTotals(context);

      const facilityRows = facilities.map(({ id, code }) => {
        const t = sections.get(id) ?? emptyTotals();
        const p = photos.perFacility.get(id) ?? { mapped: 0, landed: 0 };
        return {
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
            check("R-3", t.staged, t.stored, 0, r3Note(t.differing)),
            check(
              "R-4",
              t.landed,
              t.outcomeMatch,
              0,
              "landed results whose outcome is the one the section's code map gives the staged status (04 § 5)",
            ),
            check(
              "R-5",
              t.readingLanded,
              t.readingMatch,
              0,
              "landed performance and battery results whose two readings equal the staged terukur_1/terukur_2 (decimal comma read)",
            ),
            check(
              "R-6",
              t.environmentLanded,
              t.environmentMatch,
              0,
              "landed environment results whose reading equals the staged value (NULL outside its plausible range, Q-21)",
            ),
            check(
              "R-7",
              stagedCalibrations.get(id) ?? 0,
              calibrations.get(id) ?? 0,
              0,
              "mapped staged calibrations vs stored imported calibrations of the facility",
            ),
            check(
              "R-8",
              p.mapped,
              p.landed,
              0,
              "mapped photos vs live attachments of the folder's purpose on their device, in the facility (step 9 proves the checksums)",
            ),
          ],
        };
      });

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
          r9,
          check(
            "R-8",
            photos.referenced,
            photos.accounted,
            photos.quarantined,
            "every photo name a staged device references, per folder, is a mapped attachment or quarantined (05 § 7)",
          ),
          manual(
            "RC-F4",
            "per-facility counts equal the source's: R-1 … R-7 cover the mapped rows; the source-side totals are P25-04's",
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
