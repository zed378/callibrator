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
 *   Q-28 - per facility the missing half (2026-10-27): photos quarantined
 *     file_missing, in their device's facility; at the run level the
 *     unreferenced half (2026-10-28): files the image imports' manifests put
 *     in the photo folders that no staged device row names (`runFindings`)
 *
 *   duplicates (2026-10-28) - Q-8 second session headers (quarantined
 *     duplicate_header, by staged id_client); Q-9 devices with more than one
 *     live calibration
 *   orphans (2026-10-28) - Q-2 / Q-3 / Q-10: mapped IPM rows, devices and
 *     calibrations whose staged id_user is no imported account
 *
 *   the rest of 03 § 7 (2026-11-02, ADR-129 Am. 14), per facility: Q-5 rows whose
 *     device type differs from the device's, Q-6 / Q-7 item references deleted /
 *     absent, Q-11 the device's date against its calibrations, Q-15 no created_at,
 *     Q-17 serial placeholders, Q-18 duplicates NULLed by UD-9 (`Q-18-NULL`), Q-20
 *     a device name that is not its type's, Q-21 environment readings kept raw,
 *     Q-22 decimal commas, Q-23 non-numeric readings, Q-24 untrimmed device text,
 *     Q-27 photo URLs with a host
 *   run level (`runFindings`): Q-16 archive rows with no created_at, duplicate
 *     files (`F-DUP-HASH` one content under several paths, `F-DUP-NAME` one file
 *     named by several devices), the users section U-1 … U-6
 *
 * Not counted: Q-1 and Q-25 describe the schema and the encoding (no per-run
 * number); Q-26 is `auth_logins`, which is never staged.
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
import {
  RESULT_TABLES,
  SESSION_TABLES,
  type ResultTableRule,
} from "./upstreamImport/transform/ipm";
import { photoNameOf } from "./upstreamImport/transform/attachments";
import { FORMER_USERS } from "./upstreamImport/transform/people";
import { catalogueOf } from "./upstreamImport/transform/photoFiles";
import { manifestsOf } from "./upstreamImport/transformFiles";
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
 * The run's IPM session rows quarantined with `reason`, per facility — Q-4 `no_device` (the QR
 * matches no imported device), Q-8 `duplicate_header` (a second header for one key). Such a row is
 * never mapped, so its facility is its staged `id_client` through the facility step's mapping
 * (`mst_faskes` -> client facility). Their result rows follow as `session_not_imported` and are
 * not counted again.
 */
const sessionQuarantinePerFacility = async (
  context: StepContext,
  reason: "no_device" | "duplicate_header",
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
          WHERE q.import_run_id = $1 AND q.source_table = $2 AND q.reason = $3 AND fm.client_facility_id IS NOT NULL
          GROUP BY fm.client_facility_id`,
        [context.runId, table, reason],
        { transaction: context.transaction },
      ),
    );
  }
  return counts;
};

/** The IPM tables whose rows name a performer (`id_user`): the four session tables and the twelve result tables. */
const IPM_TABLES: readonly string[] = Object.freeze([
  ...SESSION_TABLES,
  ...Object.keys(RESULT_TABLES),
]);

/**
 * Q-2 / Q-3 / Q-10: the run's MAPPED rows of `tables` whose `id_user` is no imported account
 * (absent, a hard-deleted upstream user, or one the users step quarantined) — the performer is
 * kept as a snapshot only (04 § 6). Per the facility the transform decided for the row.
 */
const performerUnknownPerFacility = async (
  context: StepContext,
  tables: readonly string[],
): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  for (const table of tables) {
    if (!(await stagedTableExists(context, table))) {
      continue;
    }
    addInto(
      counts,
      await sql<{ facilityId: string; n: number }>(
        context.runner,
        `SELECT m.client_facility_id AS "facilityId", count(*)::int AS n
           FROM ${stagedTable(table)} s
           JOIN ${ID_MAP} m ON m.source_table = $2 AND m.legacy_id = s."id"::text
           LEFT JOIN ${ID_MAP} um ON um.source_table = 'users' AND um.legacy_id = btrim(to_jsonb(s) ->> 'id_user')
          WHERE s.import_run_id = $1 AND m.client_facility_id IS NOT NULL AND um.legacy_id IS NULL
          GROUP BY m.client_facility_id`,
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

/** The file findings of a run. */
interface FileFindings {
  unreferenced: number;
  /** Paths whose ingested content another path of the folders already has. */
  sameContent: number;
  /** Device references beyond the first to one `<folder>/<name>`. */
  sameName: number;
}

/**
 * Q-28 (the unreferenced half): photo files the provider's image imports brought onto disk (their
 * manifests, read as step 9 reads them) in the two photo folders that no staged device row of the
 * run names - by the same `<folder>/<name>` step 9 looks up. Such a file has no device and so no
 * facility: a run-level finding. So are the duplicate files: one content under several paths (the
 * manifests' stored SHA-256) and one file named by several devices.
 */
const fileFindings = async (
  context: StepContext,
  manifests: readonly string[],
): Promise<FileFindings> => {
  const catalogue = catalogueOf(manifests);
  const referenced = new Set<string>();
  let sameName = 0;
  if (await stagedTableExists(context, "trx_inventory")) {
    const rows = await sql<Record<string, string | null>>(
      context.runner,
      `SELECT to_jsonb(s) ->> 'foto_depan' AS foto_depan, to_jsonb(s) ->> 'foto_sn' AS foto_sn
         FROM ${stagedTable("trx_inventory")} s WHERE s.import_run_id = $1`,
      [context.runId],
      { transaction: context.transaction },
    );
    for (const row of rows) {
      for (const folder of PHOTO_FOLDERS) {
        const name = photoNameOf(row[folder] ?? null);
        if (name !== null) {
          const path = `${folder}/${name}`;
          sameName += referenced.has(path) ? 1 : 0;
          referenced.add(path);
        }
      }
    }
  }
  let unreferenced = 0;
  let sameContent = 0;
  const contents = new Set<string>();
  for (const [path, source] of catalogue) {
    if (!PHOTO_FOLDERS.some((folder) => path.startsWith(`${folder}/`))) {
      continue;
    }
    unreferenced += referenced.has(path) ? 0 : 1;
    if (source.outcome === "ingested") {
      sameContent += contents.has(source.storedSha256) ? 1 : 0;
      contents.add(source.storedSha256);
    }
  }
  return { unreferenced, sameContent, sameName };
};

/** Q-17's words (03 § 7), written from the finding, not read from inventory.ts: a serial placeholder. */
const SERIAL_PLACEHOLDER_WORDS: readonly string[] = Object.freeze([
  "none", "null", "nil", "n/a", "na", "tidak ada", "tidak", "kosong", "unknown", "tanpa sn", "no sn",
]);

/** The per-facility counts of one transformed run's devices. */
interface DeviceCounts {
  facilityId: string;
  q11: number;
  q15: number;
  q17: number;
  q18Nulled: number;
  q20: number;
  q24: number;
  q27: number;
}

/** A staged device column as text. */
const deviceText = (column: string): string => `coalesce(to_jsonb(s) ->> '${column}', '')`;
/** The staged serial, trimmed and folded. */
const SERIAL = `lower(btrim(${deviceText("sn")}))`;
const IS_PLACEHOLDER = `(length(${SERIAL}) < 3 OR ${SERIAL} ~ '^[-0./ ]+$' OR ${SERIAL} = ANY($3::text[]))`;

/**
 * Q-11, Q-15, Q-17, the serials UD-9 NULLed, Q-20, Q-24 and Q-27 over the run's mapped device rows,
 * in the facility the transform decided. Q-20 reads the stored name against its type's, Q-17 the
 * staged serial against the stored NULL.
 */
const deviceCountsPerFacility = async (context: StepContext): Promise<DeviceCounts[]> => {
  if (!(await stagedTableExists(context, "trx_inventory"))) {
    return [];
  }
  const calibrations = (await stagedTableExists(context, "trx_kalibrasi"))
    ? `(SELECT btrim(to_jsonb(c) ->> 'id_inventory') AS ref, array_agg(left(to_jsonb(c) ->> 'tanggal_kalibrasi', 10)) AS days
          FROM ${stagedTable("trx_kalibrasi")} c WHERE c.import_run_id = $1 GROUP BY 1)`
    : "(SELECT NULL::text AS ref, NULL::text[] AS days)";
  const untrimmed = ["nama_alat", "merk", "type", "sn", "nama_ruangan"]
    .map((c) => `${deviceText(c)} <> btrim(${deviceText(c)})`)
    .join(" OR ");
  return sql<DeviceCounts>(
    context.runner,
    `SELECT m.client_facility_id AS "facilityId",
            count(*) FILTER (WHERE k.days IS NOT NULL AND ${deviceText("tgl_kalibrasi")} <> ''
                               AND NOT left(${deviceText("tgl_kalibrasi")}, 10) = ANY(k.days))::int AS q11,
            count(*) FILTER (WHERE ${deviceText("created_at")} = '')::int AS q15,
            count(*) FILTER (WHERE d.serial_number IS NULL AND ${IS_PLACEHOLDER})::int AS q17,
            count(*) FILTER (WHERE d.serial_number IS NULL AND NOT ${IS_PLACEHOLDER})::int AS "q18Nulled",
            count(*) FILTER (WHERE t.name IS NOT NULL AND lower(btrim(d.name)) <> lower(btrim(t.name)))::int AS q20,
            count(*) FILTER (WHERE ${untrimmed})::int AS q24,
            count(*) FILTER (WHERE ${deviceText("foto_depan")} ~* '^https?://' OR ${deviceText("foto_sn")} ~* '^https?://')::int AS q27
       FROM ${stagedTable("trx_inventory")} s
       JOIN ${ID_MAP} m ON m.source_table = 'trx_inventory' AND m.legacy_id = s."id"::text
       JOIN calibration_devices d ON d.id = m.target_id AND d.tenant_id = $2
       LEFT JOIN device_types t ON t.id = d.device_type_id
       LEFT JOIN ${calibrations} k ON k.ref = s."id"::text
      WHERE s.import_run_id = $1 AND m.client_facility_id IS NOT NULL
      GROUP BY m.client_facility_id`,
    [context.runId, context.tenantId, SERIAL_PLACEHOLDER_WORDS],
    { transaction: context.transaction },
  );
};

/** Q-6 and Q-7: the mapped result rows whose item reference names a catalogue row that is gone, or none at all. */
const itemReferencesPerFacility = async (
  context: StepContext,
): Promise<{ deleted: Map<string, number>; absent: Map<string, number> }> => {
  const deleted = new Map<string, number>();
  const absent = new Map<string, number>();
  for (const table of Object.keys(RESULT_TABLES)) {
    const { item } = RESULT_TABLES[table] as ResultTableRule;
    if (item === null || !(await stagedTableExists(context, table))) {
      continue;
    }
    const rows = await sql<{ facilityId: string; gone: number; none: number }>(
      context.runner,
      `SELECT m.client_facility_id AS "facilityId",
              count(*) FILTER (WHERE y.item <> '0' AND c.legacy_id IS NULL)::int AS gone,
              count(*) FILTER (WHERE y.item = '0')::int AS none
         FROM ${stagedTable(table)} s
         JOIN ${ID_MAP} m ON m.source_table = $2 AND m.legacy_id = s."id"::text
         CROSS JOIN LATERAL (SELECT coalesce(nullif(btrim(to_jsonb(s) ->> $3), ''), '0') AS item) y
         LEFT JOIN ${ID_MAP} c ON c.source_table = $4 AND c.legacy_id = y.item
        WHERE s.import_run_id = $1 AND m.client_facility_id IS NOT NULL
        GROUP BY m.client_facility_id`,
      [context.runId, table, item.column, item.catalogue],
      { transaction: context.transaction },
    );
    addInto(deleted, rows.map((r) => ({ facilityId: r.facilityId, n: r.gone })));
    addInto(absent, rows.map((r) => ({ facilityId: r.facilityId, n: r.none })));
  }
  return { deleted, absent };
};

/** Q-5: the mapped IPM rows whose `id_alat` is not their device's current type (the row keeps its snapshot label). */
const typeChangedPerFacility = async (context: StepContext): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  if (!(await stagedTableExists(context, "trx_inventory"))) {
    return counts;
  }
  for (const table of IPM_TABLES) {
    if (!(await stagedTableExists(context, table))) {
      continue;
    }
    addInto(
      counts,
      await sql<{ facilityId: string; n: number }>(
        context.runner,
        `SELECT m.client_facility_id AS "facilityId", count(*)::int AS n
           FROM ${stagedTable(table)} s
           JOIN ${ID_MAP} m ON m.source_table = $2 AND m.legacy_id = s."id"::text
           JOIN ${stagedTable("trx_inventory")} d ON d.import_run_id = $1
                AND btrim(to_jsonb(d) ->> 'no_qrcode') = btrim(to_jsonb(s) ->> 'no_qrcode')
          WHERE s.import_run_id = $1 AND m.client_facility_id IS NOT NULL
            AND nullif(btrim(to_jsonb(s) ->> 'id_alat'), '') <> nullif(btrim(to_jsonb(d) ->> 'id_alat'), '')
          GROUP BY m.client_facility_id`,
        [context.runId, table],
        { transaction: context.transaction },
      ),
    );
  }
  return counts;
};

/** Q-22: the mapped performance rows with a decimal comma in a reading. */
const decimalCommasPerFacility = async (context: StepContext): Promise<Map<string, number>> =>
  (await stagedTableExists(context, "trx_kinerja_alat"))
    ? byFacility(
      await sql<{ facilityId: string; n: number }>(
        context.runner,
        `SELECT m.client_facility_id AS "facilityId", count(*)::int AS n
           FROM ${stagedTable("trx_kinerja_alat")} s
           JOIN ${ID_MAP} m ON m.source_table = 'trx_kinerja_alat' AND m.legacy_id = s."id"::text
          WHERE s.import_run_id = $1 AND m.client_facility_id IS NOT NULL
            AND (coalesce(to_jsonb(s) ->> 'terukur_1', '') LIKE '%,%' OR coalesce(to_jsonb(s) ->> 'terukur_2', '') LIKE '%,%')
          GROUP BY m.client_facility_id`,
        [context.runId],
        { transaction: context.transaction },
      ),
    )
    : new Map<string, number>();

/** The users section (run level: provider staff have no facility), read from the staged accounts. */
interface UserCounts {
  notImported: number;
  inactive: number;
  noMail: number;
  unnamed: number;
  sharedMail: number;
}

const NO_USERS: UserCounts = { notImported: 0, inactive: 0, noMail: 0, unnamed: 0, sharedMail: 0 };

const userCounts = async (context: StepContext): Promise<UserCounts> => {
  if (!(await stagedTableExists(context, "users"))) {
    return NO_USERS;
  }
  const mail = "lower(btrim(coalesce(to_jsonb(s) ->> 'email', '')))";
  const [row] = await sql<UserCounts>(
    context.runner,
    `SELECT count(*) FILTER (WHERE m.legacy_id IS NULL)::int AS "notImported",
            count(*) FILTER (WHERE m.legacy_id IS NOT NULL AND coalesce(nullif(to_jsonb(s) ->> 'active', ''), '0') = '0')::int AS inactive,
            count(*) FILTER (WHERE m.legacy_id IS NOT NULL AND ${mail} !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')::int AS "noMail",
            count(*) FILTER (WHERE m.legacy_id IS NOT NULL AND btrim(coalesce(to_jsonb(s) ->> 'fullname', '')) = '')::int AS unnamed,
            (SELECT count(*)::int FROM (
               SELECT 1 FROM ${stagedTable("users")} s WHERE s.import_run_id = $1 AND ${mail} <> ''
                GROUP BY ${mail} HAVING count(*) > 1) g) AS "sharedMail"
       FROM ${stagedTable("users")} s
       LEFT JOIN ${ID_MAP} m ON m.source_table = 'users' AND m.legacy_id = s."id"::text
      WHERE s.import_run_id = $1`,
    [context.runId],
    { transaction: context.transaction },
  );
  return row ?? NO_USERS;
};

/** U-6: the departed upstream users numbered for snapshots (`former_users`, one numbering per migration). */
const formerUserCount = async (context: StepContext): Promise<number> => {
  const [row] = await sql<{ n: number }>(
    context.runner,
    `SELECT count(*)::int AS n FROM ${FORMER_USERS}`,
    [],
    { transaction: context.transaction },
  );
  return row?.n ?? 0;
};

/** Q-16: archive-index rows with no `created_at` (the upload time is unknown). */
const archiveRowsWithoutTime = async (context: StepContext): Promise<number> => {
  if (!(await stagedTableExists(context, "trx_inventory_file"))) {
    return 0;
  }
  const [row] = await sql<{ n: number }>(
    context.runner,
    `SELECT count(*)::int AS n FROM ${stagedTable("trx_inventory_file")} s
      WHERE s.import_run_id = $1 AND coalesce(to_jsonb(s) ->> 'created_at', '') = ''`,
    [context.runId],
    { transaction: context.transaction },
  );
  return row?.n ?? 0;
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
  // Q-28's manifests are read on the application's connection BEFORE the transform transaction (as the
  // transform does): the transform role cannot read upstream_file_imports.
  const manifests = await manifestsOf(tenantId);
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
      const noDevice = await sessionQuarantinePerFacility(context, "no_device");
      const missingFiles = await missingFilesPerFacility(context);
      const files = await fileFindings(context, manifests);
      // Duplicates: Q-8 second session headers (quarantined), Q-9 devices with more than one live calibration.
      const duplicateHeaders = await sessionQuarantinePerFacility(context, "duplicate_header");
      const calibratedTwice = byFacility(
        await sql<{ facilityId: string; n: number }>(
          runner,
          `SELECT f AS "facilityId", count(*)::int AS n FROM (
             SELECT client_facility_id AS f FROM calibration_records
              WHERE tenant_id = $1 AND client_facility_id IS NOT NULL AND deleted_at IS NULL
              GROUP BY client_facility_id, device_id HAVING count(*) > 1
           ) d GROUP BY f`,
          [tenantId],
          { transaction },
        ),
      );
      // Orphans: performers that are no imported account (Q-2 IPM, Q-3 device registrant, Q-10 calibration).
      const ipmPerformerUnknown = await performerUnknownPerFacility(context, IPM_TABLES);
      const registrantUnknown = await performerUnknownPerFacility(context, ["trx_inventory"]);
      const calibratorUnknown = await performerUnknownPerFacility(context, ["trx_kalibrasi"]);
      // The rest of 03 § 7 (ADR-129 Am. 14).
      const devices = await deviceCountsPerFacility(context);
      const deviceCount = (key: Exclude<keyof DeviceCounts, "facilityId">): Map<string, number> =>
        new Map(devices.map((d) => [d.facilityId, d[key]]));
      const references = await itemReferencesPerFacility(context);
      const typeChanged = await typeChangedPerFacility(context);
      const decimalCommas = await decimalCommasPerFacility(context);
      const kept = await sql<{ facilityId: string; q21: number; q23: number }>(
        runner,
        `SELECT client_facility_id AS "facilityId",
                count(*) FILTER (WHERE section = 'environment' AND (warn_flag OR raw_value IS NOT NULL))::int AS q21,
                count(*) FILTER (WHERE section <> 'environment' AND raw_value IS NOT NULL)::int AS q23
           FROM inspection_results
          WHERE tenant_id = $1 AND client_facility_id IS NOT NULL AND legacy_id IS NOT NULL
          GROUP BY client_facility_id`,
        [tenantId],
        { transaction },
      );
      const users = await userCounts(context);
      const formerUsers = await formerUserCount(context);
      const archiveUntimed = await archiveRowsWithoutTime(context);

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
          flagged(
            "Q-28",
            missingFiles,
            id,
            "photos a device names whose file is missing on disk (file_missing); unreferenced files are a run-level finding",
          ),
          flagged(
            "Q-8",
            duplicateHeaders,
            id,
            "second session headers for one (QR, day), quarantined duplicate_header: the latest header was kept",
          ),
          flagged(
            "Q-9",
            calibratedTwice,
            id,
            "devices with more than one live calibration: kept as history, flagged",
          ),
          flagged(
            "Q-2",
            ipmPerformerUnknown,
            id,
            "imported IPM rows whose performer is no imported account: kept as a snapshot, no account link",
          ),
          flagged(
            "Q-3",
            registrantUnknown,
            id,
            "imported devices whose registrant is no imported account: kept as a snapshot, no account link",
          ),
          flagged(
            "Q-10",
            calibratorUnknown,
            id,
            "imported calibrations whose performer is no imported account (absent or departed): the import key acts for them",
          ),
          flagged(
            "Q-5",
            typeChanged,
            id,
            "imported IPM rows whose device type differs from the device's current type: the row keeps its snapshot label",
          ),
          flagged(
            "Q-6",
            references.deleted,
            id,
            "imported result rows whose item reference names a catalogue row that is gone: the label is kept",
          ),
          flagged(
            "Q-7",
            references.absent,
            id,
            "imported result rows with no item reference (absent by design upstream): matched by label or label only",
          ),
          flagged(
            "Q-11",
            deviceCount("q11"),
            id,
            "devices whose own calibration date is none of their calibration rows' dates: two meanings of the date, both kept",
          ),
          flagged(
            "Q-15",
            deviceCount("q15"),
            id,
            "devices with no upstream created_at: tgl_inventory is the registration date",
          ),
          flagged(
            "Q-17",
            deviceCount("q17"),
            id,
            "serial placeholders stored as NULL (empty, too short, or a none-like word)",
          ),
          flagged(
            "Q-18-NULL",
            deviceCount("q18Nulled"),
            id,
            "real serials stored as NULL because another device of the facility holds them (UD-9): the original is kept in id_map",
          ),
          flagged(
            "Q-20",
            deviceCount("q20"),
            id,
            "devices whose name differs from their type's catalogue name: the name is a free snapshot, kept",
          ),
          flagged(
            "Q-21",
            new Map(kept.map((k) => [k.facilityId, k.q21])),
            id,
            "environment readings outside their range or not numeric: stored NULL with the text kept",
          ),
          flagged(
            "Q-22",
            decimalCommas,
            id,
            "performance rows with a decimal comma in a reading: read as the decimal point",
          ),
          flagged(
            "Q-23",
            new Map(kept.map((k) => [k.facilityId, k.q23])),
            id,
            "result values that are not numeric or not a known code: stored NULL with the text kept",
          ),
          flagged(
            "Q-24",
            deviceCount("q24"),
            id,
            "devices with untrimmed text in a printed field: cleaned on load",
          ),
          flagged(
            "Q-27",
            deviceCount("q27"),
            id,
            "devices whose photo reference embeds a host: stripped to the file name",
          ),
        ],
      }));
      const runFinding = (findingId: string, count: number, note: string): DataQualityFinding =>
        finding(findingId, count === 0 ? "pass" : "flagged", count, note);

      return {
        runId,
        providerTenantId: tenantId,
        facilities: facilityRows,
        totals: [...totals.values()],
        runFindings: [
          runFinding(
            "Q-28",
            files.unreferenced,
            "photo files on disk (the image imports' manifests) in foto_depan / foto_sn that no staged device row names",
          ),
          runFinding(
            "F-DUP-HASH",
            files.sameContent,
            "photo paths whose content another path of the two folders already has (the manifests' stored SHA-256)",
          ),
          runFinding(
            "F-DUP-NAME",
            files.sameName,
            "device photo references beyond the first to one file of a folder",
          ),
          runFinding(
            "Q-16",
            archiveUntimed,
            "certificate archive rows with no upstream created_at: the upload time is unknown",
          ),
          runFinding(
            "U-1",
            users.notImported,
            "staged accounts not imported (their quarantine reasons are in the totals)",
          ),
          runFinding(
            "U-2",
            users.inactive,
            "imported accounts inactive upstream: imported inactive, never invited",
          ),
          runFinding(
            "U-3",
            users.sharedMail,
            "e-mail addresses more than one staged account holds (case folded): one imported, the rest email_in_use",
          ),
          runFinding(
            "U-4",
            users.noMail,
            "imported accounts with no usable e-mail address: they cannot receive an invitation",
          ),
          runFinding(
            "U-5",
            users.unnamed,
            "imported accounts with no full name: snapshots print the unnamed-user label",
          ),
          runFinding(
            "U-6",
            formerUsers,
            "departed upstream users numbered for snapshots: never accounts (ADR-139 § 6)",
          ),
        ],
      };
    });
  } finally {
    await connection.close();
  }
};
