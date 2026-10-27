/**
 * P24-02g (ADR-129 Am. 9) — the transform's IPM steps (11 and 12) on a REAL PostgreSQL 18, on the
 * transform role's own connection, after the facilities, users, catalogue and register steps:
 *
 *  - migration 0141: down / up / up rebuilds the same column grants and reasons; the transform role
 *    can neither change an issued session's content, nor void it, nor touch a result;
 *  - three sessions issued through 0127's draft → submitted path (0126's CHECKs hold): the duplicate
 *    header, the header-less key, the key without a device, the unknown recommendation code; the
 *    performer, a former user and "Upstream import"; visits recomputed per device, the upstream one
 *    kept; report numbers per facility and day; each stored hash equal to the one the application's
 *    `checkIntegrity` recomputes;
 *  - the results by section: decimals canonical, a failed parse kept raw, an implausible environment
 *    reading NULL and flagged, electrical safety computed from the definition's limit, not_applicable;
 *    the definition matched by the upstream item id;
 *  - a re-run of the same dump writes nothing; upstream's delete-and-reinsert (new ids, same content)
 *    maps onto the issued session; a changed result quarantines the key's rows, the session untouched.
 *
 * Synthetic values only; nothing from upstream.
 *
 *   docker run -d --name la-g-pg18 -e POSTGRES_PASSWORD=p2402gpass -p 127.0.0.1:56270:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=56270 DB_USER=postgres DB_PASS=p2402gpass npm run test:live -- --only=p2402g
 *   docker rm -f la-g-pg18
 */
import type { Transaction } from "sequelize";
import { env } from "../../config/env";
import type { TransformStep } from "../../services/upstreamImport/transform/steps";
import type * as StepsModule from "../../services/upstreamImport/transform/steps";
import type * as RunnerModule from "../../services/upstreamImport/transform/runner";
import type * as ConfigModule from "../../config/upstreamImport";
import type * as ReportModule from "../../services/ipmReport.service";
import type * as JobContextModule from "../../utils/jobContext.util";
import type * as ReconciliationModule from "../../services/upstreamReconciliation.service";
import type * as DataQualityModule from "../../services/upstreamDataQuality.service";

const IMPORT_ROLE = "callibrator_import";
const TRANSFORM_ROLE = "callibrator_transform";
const PROVIDER = "a2402000-0000-4000-8000-0000000000c7";
const SELF = "a2402000-0000-4000-8000-0000000000c8";
const ZONE = "Asia/Jakarta";
const RUN_1 = "a2402000-0000-4000-8000-0000000000f1";
const RUN_2 = "a2402000-0000-4000-8000-0000000000f2";
const RUN_3 = "a2402000-0000-4000-8000-0000000000f3";

type Row = Record<string, unknown>;
type Cell = string | number | null;
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<Transaction>;
  transaction<T>(fn: (t: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  getQueryInterface(): unknown;
}
interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}
interface SessionModel {
  findAll(options: object): Promise<{ id: string; reportNumber: string | null }[]>;
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded after the environment is set; typed by the members used */
const load = () => ({
  db: (require("../../config") as { db: LiveDb }).db,
  models: require("../../models") as { InspectionSession: SessionModel; UpstreamSqlImport: { create(values: object): Promise<unknown> } },
  migrator: (require("../../config/migrator") as { migrator: { pending(): Promise<unknown[]> } }).migrator,
  migrationLock: require("../../utils/migrationLock.util") as { runSchemaSetup(options: object): Promise<unknown> },
  steps: require("../../services/upstreamImport/transform/steps") as typeof StepsModule,
  runner: require("../../services/upstreamImport/transform/runner") as typeof RunnerModule,
  config: require("../../config/upstreamImport") as typeof ConfigModule,
  report: require("../../services/ipmReport.service") as typeof ReportModule,
  jobContext: require("../../utils/jobContext.util") as typeof JobContextModule,
  m0141: require("../../migrations/0141-upstream-transform-ipm") as Migration,
  reconciliation: require("../../services/upstreamReconciliation.service") as typeof ReconciliationModule,
  dataQuality: require("../../services/upstreamDataQuality.service") as typeof DataQualityModule,
});
/* eslint-enable @typescript-eslint/no-require-imports */

const IPM = "id_client integer, id_user integer, id_alat integer, no_qrcode varchar(45), description varchar(255), status varchar(10), created_at timestamp, updated_at timestamp";

/** The staged IPM world. `variant` changes it for the re-runs. */
const world = (variant: "same" | "reinsert" | "changed"): Record<string, { columns: string; rows: readonly (readonly Cell[])[] }> => ({
  stg_trx_hasil_pemeriksaan: {
    columns: "id, id_client, id_user, no_qrcode, status, created_at",
    rows: [
      [1, 1, 7, "QR-G101", "1", "2025-05-10 09:00:00"],
      [2, 1, 7, "QR-G101", "0", "2025-05-10 09:00:00"],
      [3, 1, 7, "QR-G999", "1", "2025-05-11 09:00:00"],
      [variant === "reinsert" ? 40 : 4, 2, null, "QR-G102", "1", "2025-06-01 08:00:00"],
    ],
  },
  stg_trx_hasil_maintenance: { columns: "id, id_client, id_user, no_qrcode, status, created_at", rows: [[1, 1, 7, "QR-G101", "1", "2025-05-10 09:00:00"]] },
  stg_trx_rekomendasi_hasil_pekerjaan: {
    columns: "id, id_client, id_user, no_qrcode, status, created_at",
    rows: [
      [1, 1, 7, "QR-G101", "-2", "2025-05-10 09:00:00"],
      [2, 2, null, "QR-G102", "7", "2025-06-01 08:00:00"],
    ],
  },
  stg_trx_catatan: { columns: "id, id_client, id_user, no_qrcode, description, created_at", rows: [[1, 1, 7, "QR-G101", "  Catatan sintetis  ", "2025-05-10 09:00:00"]] },
  stg_trx_kondisi_lingkungan: {
    columns: "id, id_client, id_user, no_qrcode, id_kondisi_lingkungan, description, value, visit, created_at",
    rows: [
      [1, 1, 7, "QR-G101", 1, "Suhu sintetis", variant === "changed" ? "26" : "25,5", 2, "2025-05-10 09:00:00"],
      [2, 1, 7, "QR-G101", 2, "Kelembaban sintetis", "150", 2, "2025-05-10 09:00:00"],
    ],
  },
  stg_trx_keamanan_listrik: {
    columns: "id, id_client, id_user, no_qrcode, id_keamanan_listrik, description, status, value, symbol, created_at",
    rows: [
      [1, 1, 7, "QR-G101", 1, "Arus bocor sintetis", "1", "50", "I", "2025-05-10 09:00:00"],
      [2, 1, 7, "QR-G101", 0, "Arus bocor kedua", "-1", null, null, "2025-05-10 09:00:00"],
    ],
  },
  stg_trx_kinerja_alat: {
    columns: "id, id_client, id_user, no_qrcode, id_kinerja_alat, description, status, setting, terukur_1, terukur_2, nilai_acuan, created_at",
    rows: [[1, 1, 7, "QR-G101", null, "Laju aliran sintetis", "1", "60 mL/h", "59.80", "abc", "± 10 %", "2025-05-10 09:00:00"]],
  },
  stg_trx_pemeriksaan_fisik: {
    columns: "id, id_client, id_user, no_qrcode, id_pemeriksaan_fisik, description, status, status_kebersihan, created_at",
    rows: [[1, 1, 7, "QR-G101", null, "Casing sintetis", "0", "1", "2025-05-10 09:00:00"]],
  },
  stg_trx_konsumabel: { columns: "id, id_client, id_user, no_qrcode, description, status, created_at", rows: [[1, 1, 99, "QR-G101", "Kertas sintetis", "-1", "2025-06-10 10:00:00"]] },
  stg_trx_fungsi_alat: {
    columns: "id, id_client, id_user, no_qrcode, id_pemeriksaan_fungsi_alat, description, status, created_at",
    rows: [[1, 1, 7, "QR-G999", null, "Fungsi sintetis", "1", "2025-05-11 09:00:00"]],
  },
});

describe("P24-02g — the IPM steps on live PostgreSQL 18, as the transform role", () => {
  jest.setTimeout(300_000);
  let g: ReturnType<typeof load>;
  let transformDb: LiveDb;

  const rows = async (sql: string): Promise<Row[]> => (await g.db.query(sql))[0];

  const errorAs = async (role: string, sql: string): Promise<string | null> => {
    const t = await g.db.transaction();
    try {
      await g.db.query(`SET LOCAL ROLE ${role}`, { transaction: t });
      await g.db.query(sql, { transaction: t });
      return null;
    } catch (err) {
      const e = err as { parent?: { code?: string; message?: string } };
      return `${e.parent?.code ?? "?"} ${e.parent?.message ?? String(err)}`;
    } finally {
      await t.rollback();
    }
  };

  const asImport = async (...statements: string[]): Promise<void> => {
    const t = await g.db.transaction();
    await g.db.query(`SET LOCAL ROLE ${IMPORT_ROLE}`, { transaction: t });
    for (const statement of statements) {
      await g.db.query(statement, { transaction: t });
    }
    await t.commit();
  };

  const lit = (value: Cell): string => (value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replace(/'/g, "''")}'`);
  const values = (run: string, list: readonly (readonly Cell[])[]): string => list.map((r, i) => `('${run}', ${String(i + 1)}, ${r.map(lit).join(", ")})`).join(", ");

  const stage = (run: string, variant: "same" | "reinsert" | "changed"): Promise<void> =>
    asImport(
      `INSERT INTO upstream_import.stg_mst_faskes (import_run_id, source_row_number, id, name_faskes) VALUES ${values(run, [[1, "RS Sintetis Satu"], [2, "Klinik Sintetis Dua"]])}`,
      `INSERT INTO upstream_import.stg_auth_groups (import_run_id, source_row_number, id, name, description) VALUES ${values(run, [[1, "admin", null]])}`,
      `INSERT INTO upstream_import.stg_users (import_run_id, source_row_number, id, email, username, fullname, active, created_at, updated_at) VALUES
         ${values(run, [[7, "teknisi.g@example.test", "teknisig", "Teknisi Sintetis", 1, "2023-06-01 09:00:00", null]])}`,
      `INSERT INTO upstream_import.stg_auth_groups_users (import_run_id, source_row_number, group_id, user_id) VALUES ${values(run, [[1, 7]])}`,
      `INSERT INTO upstream_import.stg_mst_alat (import_run_id, source_row_number, id, nama_alat) VALUES ${values(run, [[1, "Pompa Infus"]])}`,
      `INSERT INTO upstream_import.stg_mst_pemeriksaan_keamanan_listrik (import_run_id, source_row_number, id, description, status, symbol, nilai_acuan, flag) VALUES
         ${values(run, [[1, "Arus bocor sintetis", "1,-1", "I", "≤ 100 µA", 1]])}`,
      `INSERT INTO upstream_import.stg_mst_kondisi_lingkungan (import_run_id, source_row_number, id, description, status) VALUES
         ${values(run, [[1, "Suhu sintetis", null], [2, "Kelembaban sintetis", null]])}`,
      `INSERT INTO upstream_import.stg_trx_inventory (import_run_id, source_row_number, id, id_client, id_alat, id_user, no_qrcode, nama_alat, nama_ruangan, lantai) VALUES
         ${values(run, [[101, 1, 1, 7, "QR-G101", "Pompa Sintetis", "ICU", "2"], [102, 2, 1, null, "QR-G102", "Monitor Sintetis", null, null]])}`,
      ...Object.entries(world(variant)).map(
        ([table, { columns, rows: list }]) => `INSERT INTO upstream_import.${table} (import_run_id, source_row_number, ${columns}) VALUES ${values(run, list)}`,
      ),
    );

  const steps = (): TransformStep[] =>
    [
      "client_facilities",
      "users",
      "device_types",
      "inspection_item_definitions",
      "vendors",
      "warehouses",
      "calibration_devices",
      "inspection_sessions",
      "inspection_results",
      "audit_logs",
    ].map((id) => g.steps.TRANSFORM_STEPS.find((s) => s.id === id) as TransformStep);

  const transform = (runId: string) =>
    g.runner.runTransform({ runId, db: transformDb, runner: transformDb, role: TRANSFORM_ROLE, tenantId: PROVIDER, sourceZone: ZONE, steps: steps() });

  const sources = (summary: Awaited<ReturnType<typeof transform>>, step: string) => summary.steps.find((s) => s.step === step)?.sources ?? [];

  const audits = (): Promise<Row[]> =>
    rows(
      `SELECT resource_type AS type, count(*)::int AS n, bool_and(client_facility_id IS NOT NULL) AS facility,
              bool_and(changes ->> 'operation' = 'UPSTREAM_IMPORT') AS operation
         FROM audit_logs WHERE actor_name = 'system:upstream-transform' AND resource_type IN ('InspectionSession', 'InspectionResult')
        GROUP BY 1 ORDER BY 1`,
    );

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = load();
    g.db.options.logging = false;
    await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    expect(await g.migrator.pending()).toEqual([]);
    await g.db.query(`INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ('${PROVIDER}', 'Penyedia Sintetis G', 'p2402g', 'p@example.test', now(), now())`);
    await g.db.query(`INSERT INTO client_facilities (id, tenant_id, name, code, is_self, created_at, updated_at) VALUES ('${SELF}', '${PROVIDER}', 'Penyedia Sintetis G', 'SELF', true, now(), now())`);
    await g.db.query(
      `INSERT INTO roles (id, name, created_at, updated_at)
       SELECT gen_random_uuid(), n, now(), now()
         FROM unnest(ARRAY['CALIBRATOR ADMIN', 'TECHNICIAN', 'ROOM USER', 'HEALTHCARE TECHNICIAN', 'HEALTHCARE ADMIN']) AS n
        WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.name = n)`,
    );
    const common = "import_run_id uuid NOT NULL, source_row_number bigint NOT NULL, id integer";
    const pk = "PRIMARY KEY (import_run_id, source_row_number)";
    await asImport(
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_faskes (${common}, name_faskes varchar(255), phone varchar(50), address varchar(255), created_at timestamp, updated_at timestamp, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_auth_groups (${common}, name varchar(255), description varchar(255), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_users (${common}, email varchar(255), username varchar(30), fullname varchar(50), active smallint,
         created_at timestamp, updated_at timestamp, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_auth_groups_users (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL, group_id integer, user_id integer, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_alat (${common}, nama_alat varchar(255), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_pemeriksaan_keamanan_listrik (${common}, description varchar(255), status varchar(50), symbol varchar(50),
         nilai_acuan varchar(50), flag smallint, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_kondisi_lingkungan (${common}, description varchar(255), status varchar(50), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_inventory (${common}, id_client integer, id_alat integer, id_user integer, no_qrcode varchar(255),
         nama_alat varchar(255), nama_ruangan varchar(255), lantai varchar(255), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_hasil_pemeriksaan (${common}, ${IPM}, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_hasil_maintenance (${common}, ${IPM}, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_rekomendasi_hasil_pekerjaan (${common}, ${IPM}, notes text, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_catatan (${common}, ${IPM}, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_kondisi_lingkungan (${common}, ${IPM}, id_kondisi_lingkungan integer, value varchar(50), visit integer, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_keamanan_listrik (${common}, ${IPM}, id_keamanan_listrik integer, value varchar(50), symbol varchar(50), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_kinerja_alat (${common}, ${IPM}, id_kinerja_alat integer, setting varchar(50), terukur_1 varchar(50),
         terukur_2 varchar(50), nilai_acuan varchar(50), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_pemeriksaan_fisik (${common}, ${IPM}, id_pemeriksaan_fisik integer, status_kebersihan varchar(10), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_konsumabel (${common}, ${IPM}, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_trx_fungsi_alat (${common}, ${IPM}, id_pemeriksaan_fungsi_alat integer, ${pk})`,
    );
    transformDb = g.config.createTransformDb() as unknown as LiveDb;
  });

  afterAll(async () => {
    await transformDb.close();
    await g.db.close();
  });

  it("0141: down / up / up rebuilds the same grants and reasons; the transform role can only write drafts and issue them", async () => {
    const objects = (): Promise<Row[]> =>
      rows(
        `SELECT table_name || '.' || column_name || ':' || privilege_type AS o FROM information_schema.column_privileges
          WHERE grantee = '${TRANSFORM_ROLE}' AND table_name IN ('inspection_sessions', 'inspection_results', 'tenants', 'calibration_devices', 'calibration_records')
         UNION ALL SELECT 'c:' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'quarantine_reason_vocabulary'
         ORDER BY 1`,
      );
    const before = await objects();
    const list = before.map((r) => String(r["o"]));
    expect(list.filter((o) => o.endsWith(":UPDATE") && o.startsWith("inspection_"))).toEqual(
      ["issuer_snapshot", "report_content_hash", "report_hash_scheme", "report_number", "status", "submitted_at", "updated_at", "verification_token"].map(
        (c) => `inspection_sessions.${c}:UPDATE`,
      ),
    );
    expect(list).not.toContain("inspection_sessions.void_reason:UPDATE");
    expect(list).not.toContain("inspection_sessions.verification_token:SELECT");
    expect(list.find((o) => o.startsWith("c:"))).toEqual(expect.stringContaining("'session_changed_upstream'"));
    expect(list.find((o) => o.startsWith("c:"))).toEqual(expect.stringContaining("'session_not_imported'"));
    await g.m0141.down({ context: g.db.getQueryInterface() });
    await g.m0141.up({ context: g.db.getQueryInterface() });
    await g.m0141.up({ context: g.db.getQueryInterface() });
    expect(await objects()).toEqual(before);
    expect(await errorAs(TRANSFORM_ROLE, "UPDATE inspection_sessions SET void_reason = 'x' WHERE false")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "UPDATE inspection_results SET outcome = 'pass' WHERE false")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM inspection_results WHERE false")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM inspection_sessions WHERE false")).toMatch(/^42501/);
  });

  it("issues three sessions with their results; every stored hash is the one the application recomputes", async () => {
    await stage(RUN_1, "same");
    const summary = await transform(RUN_1);
    expect(sources(summary, "inspection_sessions")).toEqual([
      { table: "trx_hasil_pemeriksaan", staged: 4, mapped: 2, unchanged: 0, quarantined: { duplicate_header: 1, no_device: 1 } },
      { table: "trx_hasil_maintenance", staged: 1, mapped: 1, unchanged: 0, quarantined: {} },
      { table: "trx_rekomendasi_hasil_pekerjaan", staged: 2, mapped: 1, unchanged: 0, quarantined: { value_out_of_range: 1 } },
      { table: "trx_catatan", staged: 1, mapped: 1, unchanged: 0, quarantined: {} },
    ]);
    const results = sources(summary, "inspection_results").filter((s) => s.staged > 0);
    expect(results).toEqual([
      { table: "trx_fungsi_alat", staged: 1, mapped: 0, unchanged: 0, quarantined: { session_not_imported: 1 } },
      { table: "trx_keamanan_listrik", staged: 2, mapped: 2, unchanged: 0, quarantined: {} },
      { table: "trx_kinerja_alat", staged: 1, mapped: 1, unchanged: 0, quarantined: {} },
      { table: "trx_kondisi_lingkungan", staged: 2, mapped: 2, unchanged: 0, quarantined: {} },
      { table: "trx_konsumabel", staged: 1, mapped: 1, unchanged: 0, quarantined: {} },
      { table: "trx_pemeriksaan_fisik", staged: 1, mapped: 1, unchanged: 0, quarantined: {} },
    ]);

    const sessions = await rows(
      `SELECT s.legacy_key AS key, s.status::text AS status, s.visit_number AS visit, s.legacy_visit_number AS legacy_visit, s.report_number AS number,
              s.inspection_outcome::text AS io, s.maintenance_outcome::text AS mo, s.recommendation::text AS rec, s.notes,
              s.performer_snapshot ->> 'name' AS performer, s.performed_by IS NOT NULL AS person, s.created_by IS NULL AS no_creator, s.submitted_by IS NULL AS no_submitter,
              s.template_version_id IS NULL AS no_version, (s.performed_at AT TIME ZONE 'UTC')::text AS at_utc, s.submitted_at = s.performed_at AS submitted_at,
              s.room_snapshot AS room, s.floor_snapshot AS floor, s.side_effects, s.work_order_id IS NULL AS no_order, s.client_facility_id = d.client_facility_id AS same_facility,
              s.verification_token ~ '^[A-Za-z0-9_-]{32}$' AS token, s.report_hash_scheme AS scheme, s.issuer_snapshot ->> 'timeZone' AS zone
         FROM inspection_sessions s JOIN calibration_devices d ON d.id = s.device_id
        WHERE s.tenant_id = '${PROVIDER}' ORDER BY s.performed_at`,
    );
    const common = { status: "submitted", no_creator: true, no_submitter: true, no_version: true, submitted_at: true, side_effects: {}, no_order: true, same_facility: true, token: true, scheme: "ipm-report-v1", zone: ZONE };
    expect(sessions).toEqual([
      {
        ...common, key: "QR-G101|2025-05-10", visit: 1, legacy_visit: 2, number: expect.stringMatching(/^IPM-F-\d{4}-20250510-001$/) as unknown, io: "fail", mo: "pass",
        rec: "needs_repair", notes: "Catatan sintetis", performer: "Teknisi Sintetis", person: true, at_utc: "2025-05-10 02:00:00", room: "ICU", floor: "2",
      },
      {
        ...common, key: "QR-G102|2025-06-01", visit: 1, legacy_visit: null, number: expect.stringMatching(/^IPM-F-\d{4}-20250601-001$/) as unknown, io: "pass", mo: null,
        rec: null, notes: null, performer: "Upstream import", person: false, at_utc: "2025-06-01 01:00:00", room: null, floor: null,
      },
      {
        ...common, key: "QR-G101|2025-06-10", visit: 2, legacy_visit: null, number: expect.stringMatching(/^IPM-F-\d{4}-20250610-001$/) as unknown, io: null, mo: null,
        rec: null, notes: null, performer: "Former upstream user #1", person: false, at_utc: "2025-06-10 03:00:00", room: "ICU", floor: "2",
      },
    ]);

    const stored = await rows(
      `SELECT r.section::text AS section, r.sort_order AS sort, r.label_snapshot AS label, r.outcome::text AS outcome, r.cleanliness::text AS clean,
              r.measured_value::text AS m, r.measured_value_1::text AS m1, r.measured_value_2::text AS m2, r.raw_value AS raw, r.warn_flag AS warn,
              r.computed_outcome::text AS computed, r.outcome_source::text AS src, r.setting_text AS setting, r.reference_text AS reference, r.symbol,
              r.item_definition_id IS NOT NULL AS matched, r.template_item_id IS NULL AS no_item, r.legacy_table AS ltable
         FROM inspection_results r WHERE r.tenant_id = '${PROVIDER}' ORDER BY r.legacy_table, r.legacy_id`,
    );
    const none = { outcome: null, clean: null, m: null, m1: null, m2: null, raw: null, warn: false, computed: null, src: null, setting: null, reference: null, symbol: null, no_item: true };
    expect(stored).toEqual([
      { ...none, section: "electrical_safety", sort: 1, label: "Arus bocor sintetis", m: "50", computed: "pass", src: "computed", symbol: "I", matched: true, ltable: "trx_keamanan_listrik" },
      { ...none, section: "electrical_safety", sort: 2, label: "Arus bocor kedua", outcome: "not_applicable", matched: false, ltable: "trx_keamanan_listrik" },
      {
        ...none, section: "performance", sort: 1, label: "Laju aliran sintetis", outcome: "pass", m1: "59.8", raw: "abc", setting: "60 mL/h", reference: "± 10 %",
        matched: false, ltable: "trx_kinerja_alat",
      },
      { ...none, section: "environment", sort: 1, label: "Suhu sintetis", m: "25.5", matched: true, ltable: "trx_kondisi_lingkungan" },
      { ...none, section: "environment", sort: 2, label: "Kelembaban sintetis", raw: "150", warn: true, matched: true, ltable: "trx_kondisi_lingkungan" },
      { ...none, section: "consumable", sort: 1, label: "Kertas sintetis", outcome: "empty", matched: false, ltable: "trx_konsumabel" },
      { ...none, section: "physical", sort: 1, label: "Casing sintetis", outcome: "minor_damage", clean: "clean", matched: false, ltable: "trx_pemeriksaan_fisik" },
    ]);

    // The application's own recomputation (ipmReport.service checkIntegrity) agrees with every stored hash.
    const states = await g.jobContext.runForTenant(PROVIDER, async () => {
      const found = await g.models.InspectionSession.findAll({ where: { tenantId: PROVIDER }, skipFacilityScope: true });
      return Promise.all(found.map(async (s) => (await g.report.checkIntegrity(s as never)).integrity.state));
    });
    expect(states).toEqual(["match", "match", "match"]);
    expect(await audits()).toEqual([
      { type: "InspectionResult", n: 7, facility: true, operation: true },
      { type: "InspectionSession", n: 3, facility: true, operation: true },
    ]);
  });

  it("P25-01/P25-02 on the IPM world: the reconciliation passes on the transform role, the report counts the quarantine", async () => {
    // RUN_1 was transformed by the test above; the run row the console reads is the platform's.
    await g.models.UpstreamSqlImport.create({
      id: RUN_1,
      status: "loaded",
      transformStatus: "transformed",
      dataClass: "synthetic",
      compression: "none",
      sizeBytes: 1,
      sha256: "e".repeat(64),
      uploadedBy: null,
      notifyTenantId: PROVIDER,
      transformTenantId: PROVIDER,
      transformSummary: { durationMs: 1, steps: [] },
    });
    const reconciliation = await g.reconciliation.reconcileRun(RUN_1);
    expect(reconciliation.runChecks.filter((c) => c.status !== "manual").map((c) => [c.check, c.status])).toEqual([
      ["R-10", "pass"],
      ["R-11", "pass"],
      ["RC-F1", "pass"],
      ["RC-F2", "pass"],
      ["RC-F3", "pass"],
      ["RC-F5", "pass"],
      ["R-9", "pass"],
    ]);
    const r10 = reconciliation.runChecks.find((c) => c.check === "R-10");
    expect(r10?.expected).toBeGreaterThan(0);
    expect(r10?.quarantined).toBeGreaterThan(0);
    expect(reconciliation.facilities).toHaveLength(3);
    const checks = reconciliation.facilities.flatMap((f) => f.checks);
    expect(checks.every((c) => c.status === "pass")).toBe(true);
    // Two devices and two session headers mapped, each in its facility.
    expect(checks.filter((c) => c.check === "R-1").reduce((n, c) => n + c.actual, 0)).toBe(2);
    expect(checks.filter((c) => c.check === "R-2").reduce((n, c) => n + c.actual, 0)).toBe(2);
    // A device whose landed facility differs from the one the transform decided is caught (RC-F1, R-1 twice), then put back.
    const [mapping] = await rows(
      `SELECT m.legacy_id AS "legacyId", m.client_facility_id AS facility FROM upstream_import.id_map m
         JOIN calibration_devices d ON d.id = m.target_id WHERE m.source_table = 'trx_inventory' AND d.qr_code = 'QR-G102'`,
    );
    const setDecided = (facility: string): Promise<unknown> =>
      g.db.query(`UPDATE upstream_import.id_map SET client_facility_id = '${facility}' WHERE source_table = 'trx_inventory' AND legacy_id = '${String(mapping?.["legacyId"])}'`);
    await setDecided(SELF);
    try {
      const broken = await g.reconciliation.reconcileRun(RUN_1);
      expect(broken.runChecks.find((c) => c.check === "RC-F1")).toMatchObject({ status: "fail", actual: 1 });
      expect(broken.facilities.flatMap((f) => f.checks).filter((c) => c.status === "fail").map((c) => c.check)).toEqual(["R-1", "R-1"]);
    } finally {
      await setDecided(String(mapping?.["facility"]));
    }

    // R-3 … R-6 (2026-10-27): seven results landed (2 electrical safety, 1 performance, 2 environment, 1 consumable,
    // 1 physical). "25,5" is read with its decimal comma, humidity "150" is NULL outside its range, terukur_2 "abc" NULL.
    const total = (answer: typeof reconciliation, name: string, field: "expected" | "actual"): number =>
      answer.facilities.flatMap((f) => f.checks).filter((c) => c.check === name).reduce((n, c) => n + c[field], 0);
    expect(["R-3", "R-4", "R-5", "R-6"].map((name) => [name, total(reconciliation, name, "expected"), total(reconciliation, name, "actual")])).toEqual([
      ["R-3", 7, 7],
      ["R-4", 7, 7],
      ["R-5", 1, 1],
      ["R-6", 2, 2],
    ]);
    // A staged status, reading or environment value that no longer matches what landed fails exactly its check, then is put back.
    const plant = (table: string, column: string, value: string, where: string): Promise<unknown> =>
      g.db.query(`UPDATE upstream_import.stg_${table} SET ${column} = '${value}' WHERE import_run_id = '${RUN_1}' AND ${where}`);
    await plant("trx_pemeriksaan_fisik", "status", "1", "id = 1");
    await plant("trx_kinerja_alat", "terukur_1", "59,9", "id = 1");
    await plant("trx_kondisi_lingkungan", "value", "25.6", "id = 1");
    try {
      const drifted = await g.reconciliation.reconcileRun(RUN_1);
      expect(drifted.facilities.flatMap((f) => f.checks).filter((c) => c.status === "fail").map((c) => [c.check, c.expected, c.actual])).toEqual([
        ["R-4", 7, 6],
        ["R-5", 1, 0],
        ["R-6", 2, 1],
      ]);
    } finally {
      await plant("trx_pemeriksaan_fisik", "status", "0", "id = 1");
      await plant("trx_kinerja_alat", "terukur_1", "59.80", "id = 1");
      await plant("trx_kondisi_lingkungan", "value", "25,5", "id = 1");
    }

    // R-9 (2026-10-27): the one imported account (group admin) is a CALIBRATOR ADMIN; a staged group renamed to
    // `user` (TECHNICIAN) no longer gives that role, and R-9 fails, then the name is put back.
    expect(reconciliation.runChecks.find((c) => c.check === "R-9")).toMatchObject({ status: "pass", expected: 1, actual: 1 });
    await plant("auth_groups", "name", "user", "id = 1");
    try {
      const regrouped = await g.reconciliation.reconcileRun(RUN_1);
      expect(regrouped.runChecks.find((c) => c.check === "R-9")).toMatchObject({ status: "fail", expected: 1, actual: 0 });
    } finally {
      await plant("auth_groups", "name", "admin", "id = 1");
    }

    const report = await g.dataQuality.reportDataQuality(RUN_1);
    expect(report.facilities).toHaveLength(3);
    expect(report.totals).toEqual(
      expect.arrayContaining([
        { sourceTable: "trx_hasil_pemeriksaan", reason: "duplicate_header", rows: 1 },
        { sourceTable: "trx_hasil_pemeriksaan", reason: "no_device", rows: 1 },
        { sourceTable: "trx_rekomendasi_hasil_pekerjaan", reason: "value_out_of_range", rows: 1 },
        { sourceTable: "trx_fungsi_alat", reason: "session_not_imported", rows: 1 },
      ]),
    );
    for (const row of report.facilities) {
      expect(row.findings.filter((f) => f.status !== "manual").map((f) => [f.finding, f.status])).toEqual([
        ["Q-18", "pass"],
        ["Q-19", "pass"],
        ["Q-12", "pass"],
        ["Q-13", "pass"],
      ]);
    }
    // Counts and codes only: no staged value reaches either answer.
    const text = JSON.stringify([reconciliation, report]);
    for (const value of ["QR-G101", "QR-G102", "Pompa", "Sintetis", "teknisi.g@example.test"]) {
      expect(text).not.toContain(value);
    }
  });

  it("an issued session is out of the transform role's reach; a result cannot be added to it", async () => {
    const [session] = await rows("SELECT id, client_facility_id AS facility FROM inspection_sessions WHERE legacy_key = 'QR-G102|2025-06-01'");
    const id = String(session?.["id"]);
    expect(await errorAs(TRANSFORM_ROLE, `UPDATE inspection_sessions SET report_number = 'IPM-X-20250101-001' WHERE id = '${id}'`)).toMatch(/^42501 .*append-only/);
    expect(await errorAs(TRANSFORM_ROLE, `UPDATE inspection_sessions SET status = 'voided' WHERE id = '${id}'`)).toMatch(/^23514/);
    expect(
      await errorAs(
        TRANSFORM_ROLE,
        `INSERT INTO inspection_results (id, tenant_id, client_facility_id, session_id, section, input_kind, label_snapshot, sort_order, is_ad_hoc, warn_flag,
           disagreement_flag, created_at, updated_at)
         VALUES (gen_random_uuid(), '${PROVIDER}', '${String(session?.["facility"])}', '${id}', 'function', 'tri_state', 'x', 9, false, false, false, now(), now())`,
      ),
    ).toMatch(/^42501 .*only while it is a draft/);
  });

  it("re-runs: the same dump writes nothing; a reinserted header maps onto its session; a changed result is quarantined, the session untouched", async () => {
    const before = await rows(`SELECT id, report_content_hash AS hash FROM inspection_sessions WHERE tenant_id = '${PROVIDER}' ORDER BY id`);
    await stage(RUN_2, "same");
    const again = await transform(RUN_2);
    expect(sources(again, "inspection_sessions").map((s) => s.mapped)).toEqual([0, 0, 0, 0]);
    expect(sources(again, "inspection_results").every((s) => s.mapped === 0)).toBe(true);

    await stage(RUN_3, "changed");
    // RUN_3 also renumbers nothing: "changed" moves one environment reading only.
    const changed = await transform(RUN_3);
    expect(sources(changed, "inspection_results").find((s) => s.table === "trx_kondisi_lingkungan")).toEqual({
      table: "trx_kondisi_lingkungan", staged: 2, mapped: 0, unchanged: 2, quarantined: { session_changed_upstream: 2 },
    });
    expect(await rows(`SELECT id, report_content_hash AS hash FROM inspection_sessions WHERE tenant_id = '${PROVIDER}' ORDER BY id`)).toEqual(before);
    expect(await rows("SELECT measured_value::text AS m FROM inspection_results WHERE legacy_table = 'trx_kondisi_lingkungan' AND legacy_id = 1")).toEqual([{ m: "25.5" }]);
    expect(await audits()).toEqual([
      { type: "InspectionResult", n: 7, facility: true, operation: true },
      { type: "InspectionSession", n: 3, facility: true, operation: true },
    ]);
  });

  it("upstream's delete-and-reinsert (a new header id, the same content) maps onto the issued session", async () => {
    const run = "a2402000-0000-4000-8000-0000000000f4";
    await stage(run, "reinsert");
    const summary = await transform(run);
    expect(sources(summary, "inspection_sessions")[0]).toEqual({
      table: "trx_hasil_pemeriksaan", staged: 4, mapped: 1, unchanged: 1, quarantined: { duplicate_header: 1, no_device: 1 },
    });
    const [mapping] = await rows(
      `SELECT s.legacy_key AS key FROM upstream_import.id_map m JOIN inspection_sessions s ON s.id = m.target_id
        WHERE m.source_table = 'trx_hasil_pemeriksaan' AND m.legacy_id = '40'`,
    );
    expect(mapping).toEqual({ key: "QR-G102|2025-06-01" });
    expect(await rows(`SELECT count(*)::int AS n FROM inspection_sessions WHERE tenant_id = '${PROVIDER}'`)).toEqual([{ n: 3 }]);
  });
});
