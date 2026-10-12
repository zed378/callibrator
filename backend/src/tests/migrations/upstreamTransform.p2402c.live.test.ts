/**
 * P24-02c (ADR-129 Am. 5) — the transform's catalogue steps on a REAL PostgreSQL 18, on the
 * transform role's own connection:
 *
 *  - migration 0136: down / up / up rebuilds the same grants and reasons; the transform role may
 *    read, insert and update `device_types` and `inspection_item_definitions`, never delete;
 *  - device types: normalised, case/space duplicates merged, an operator-made type adopted, an
 *    empty name quarantined; global (no tenant), audited under the PLATFORM tenant;
 *  - item definitions: section, kind and outcomes by § 5.1, the limit parsed into the 0112 columns
 *    (its CHECKs accept every row), base sections retired, the recommendation quarantined;
 *  - a re-run of the same values writes nothing; a changed label updates the definition.
 *
 * Synthetic values only; nothing from upstream.
 *
 *   docker run -d --name p2402-pg18 -e POSTGRES_PASSWORD=p2402pass -p 127.0.0.1:56231:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=56231 DB_USER=postgres DB_PASS=p2402pass npm run test:live -- --only=p2402c
 *   docker rm -f p2402-pg18
 */
import type { Transaction } from "sequelize";
import { env } from "../../config/env";
import type { TransformStep } from "../../services/upstreamImport/transform/steps";
import type * as StepsModule from "../../services/upstreamImport/transform/steps";
import type * as RunnerModule from "../../services/upstreamImport/transform/runner";
import type * as ConfigModule from "../../config/upstreamImport";

const IMPORT_ROLE = "callibrator_import";
const TRANSFORM_ROLE = "callibrator_transform";
const PROVIDER = "a2402000-0000-4000-8000-0000000000a1";
const PLATFORM = "00000000-0000-4000-8000-000000000001";
const PRE_MADE = "a2402000-0000-4000-8000-0000000000b1";
const RUN_1 = "a2402000-0000-4000-8000-0000000000e1";
const RUN_2 = "a2402000-0000-4000-8000-0000000000e2";
const RUN_3 = "a2402000-0000-4000-8000-0000000000e3";

type Row = Record<string, unknown>;
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

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded after the environment is set; typed by the members used */
const load = () => ({
  db: (require("../../config") as { db: LiveDb }).db,
  models: require("../../models") as unknown,
  migrator: (require("../../config/migrator") as { migrator: { pending(): Promise<unknown[]> } }).migrator,
  migrationLock: require("../../utils/migrationLock.util") as { runSchemaSetup(options: object): Promise<unknown> },
  steps: require("../../services/upstreamImport/transform/steps") as typeof StepsModule,
  runner: require("../../services/upstreamImport/transform/runner") as typeof RunnerModule,
  config: require("../../config/upstreamImport") as typeof ConfigModule,
  m0136: require("../../migrations/0136-upstream-transform-catalogue") as Migration,
});
/* eslint-enable @typescript-eslint/no-require-imports */

describe("P24-02c — the catalogue steps on live PostgreSQL 18, as the transform role", () => {
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

  const lit = (value: string | number | null): string => (value === null ? "NULL" : typeof value === "number" ? String(value) : `'${value.replace(/'/g, "''")}'`);
  const values = (run: string, list: readonly (readonly (string | number | null)[])[]): string =>
    list.map((r, i) => `('${run}', ${String(i + 1)}, ${r.map(lit).join(", ")})`).join(", ");

  /** Stage the synthetic catalogue for `run`; `relabel` renames completeness item 1. */
  const stage = (run: string, relabel: string | null = null): Promise<void> =>
    asImport(
      `INSERT INTO upstream_import.stg_mst_alat (import_run_id, source_row_number, id, nama_alat) VALUES
         ${values(run, [[1, "Pompa Infus Sintetis"], [2, "pompa  INFUS sintetis"], [3, "Monitor Sintetis"], [4, "   "], [5, "Buatan Operator"]])}`,
      `INSERT INTO upstream_import.stg_mst_kelengkapan_alat (import_run_id, source_row_number, id, description, status, notes, flag) VALUES
         ${values(run, [[1, relabel ?? "Kabel daya sintetis", "0,1,-1", "catatan operator", 0], [2, " ", "0,1", null, 0]])}`,
      `INSERT INTO upstream_import.stg_mst_pemeriksaan_kinerja_alat (import_run_id, source_row_number, id, description, status, symbol, setting, nilai_acuan) VALUES
         ${values(run, [[1, "Laju aliran sintetis", "0,1", "Q", "N mL/h", "± 10 %"], [2, "Tekanan sintetis", "0,1", "P", "N mmHg", "± 5 mmHg"], [3, "Resolusi sintetis", "0,1", null, null, "≤ 2 × resolution"]])}`,
      `INSERT INTO upstream_import.stg_mst_pemeriksaan_keamanan_listrik (import_run_id, source_row_number, id, description, status, symbol, flag) VALUES
         ${values(run, [[1, "Arus bocor sintetis", "1,-1", "I", 1]])}`,
      `INSERT INTO upstream_import.stg_mst_kondisi_lingkungan (import_run_id, source_row_number, id, description, status) VALUES ${values(run, [[1, "Suhu sintetis", null]])}`,
      `INSERT INTO upstream_import.stg_mst_rekomendasi_hasil_pekerjaan (import_run_id, source_row_number, id, description, status) VALUES
         ${values(run, [[1, "Laik pakai", "1"], [2, "Perlu kalibrasi", "0"]])}`,
    );

  const steps = (): TransformStep[] =>
    ["device_types", "inspection_item_definitions", "audit_logs"].map((id) => g.steps.TRANSFORM_STEPS.find((s) => s.id === id) as TransformStep);

  const transform = (runId: string) =>
    g.runner.runTransform({ runId, db: transformDb, runner: transformDb, role: TRANSFORM_ROLE, tenantId: PROVIDER, sourceZone: "UTC", steps: steps() });

  const auditCount = async (): Promise<number> =>
    Number((await rows("SELECT count(*)::int AS n FROM audit_logs WHERE actor_name = 'system:upstream-transform'"))[0]?.["n"]);

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = load();
    g.db.options.logging = false;
    await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    expect(await g.migrator.pending()).toEqual([]);
    await g.db.query(`INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES ('${PROVIDER}', 'Penyedia Sintetis', 'p2402c', 'p@example.test', now(), now())`);
    await g.db.query(`INSERT INTO client_facilities (id, tenant_id, name, code, is_self, created_at, updated_at) VALUES (gen_random_uuid(), '${PROVIDER}', 'Penyedia Sintetis', 'SELF', true, now(), now())`);
    await g.db.query(`INSERT INTO device_types (id, name, status, created_at, updated_at) VALUES ('${PRE_MADE}', 'Buatan Operator', 'retired', now(), now())`);
    const common = "import_run_id uuid NOT NULL, source_row_number bigint NOT NULL, id integer";
    const pk = "PRIMARY KEY (import_run_id, source_row_number)";
    await asImport(
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_alat (${common}, nama_alat varchar(255), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_kelengkapan_alat (${common}, description varchar(255), status varchar(50), notes text, flag smallint, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_pemeriksaan_kinerja_alat (${common}, description varchar(255), status varchar(50), symbol varchar(50),
         setting varchar(50), nilai_acuan varchar(50), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_pemeriksaan_keamanan_listrik (${common}, description varchar(255), status varchar(50), symbol varchar(50), flag smallint, ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_kondisi_lingkungan (${common}, description varchar(255), status varchar(50), ${pk})`,
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_rekomendasi_hasil_pekerjaan (${common}, description varchar(255), status varchar(50), ${pk})`,
    );
    transformDb = g.config.createTransformDb() as unknown as LiveDb;
  });

  afterAll(async () => {
    await transformDb.close();
    await g.db.close();
  });

  it("0136: down / up / up rebuilds the same grants and reasons; no DELETE on either table", async () => {
    const objects = (): Promise<Row[]> =>
      rows(
        `SELECT table_name || ':' || privilege_type AS o FROM information_schema.role_table_grants
          WHERE grantee = '${TRANSFORM_ROLE}' AND table_name IN ('device_types', 'inspection_item_definitions')
         UNION ALL SELECT 'c:' || pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'quarantine_reason_vocabulary'
         ORDER BY 1`,
      );
    const before = await objects();
    expect(before.map((r) => String(r["o"])).filter((o) => !o.startsWith("c:"))).toEqual([
      "device_types:INSERT",
      "device_types:SELECT",
      "device_types:UPDATE",
      "inspection_item_definitions:INSERT",
      "inspection_item_definitions:SELECT",
      "inspection_item_definitions:UPDATE",
    ]);
    expect(String(before.find((r) => String(r["o"]).startsWith("c:"))?.["o"])).toContain("'session_header_value'");
    await g.m0136.down({ context: g.db.getQueryInterface() });
    await g.m0136.up({ context: g.db.getQueryInterface() });
    await g.m0136.up({ context: g.db.getQueryInterface() });
    expect(await objects()).toEqual(before);
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM device_types WHERE false")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM inspection_item_definitions WHERE false")).toMatch(/^42501/);
  });

  it("the first transform: types merged and adopted, definitions typed and parsed, base sections retired, the recommendation quarantined", async () => {
    await stage(RUN_1);
    const summary = await transform(RUN_1);
    expect(summary.steps.find((s) => s.step === "device_types")?.sources).toEqual([
      { table: "mst_alat", staged: 5, mapped: 4, unchanged: 0, quarantined: { value_out_of_range: 1 } },
    ]);
    const defSources = summary.steps.find((s) => s.step === "inspection_item_definitions")?.sources.filter((s) => s.staged > 0);
    expect(defSources?.map((s) => [s.table, s.mapped, s.quarantined])).toEqual([
      ["mst_kelengkapan_alat", 1, { value_out_of_range: 1 }],
      ["mst_pemeriksaan_kinerja_alat", 3, {}],
      ["mst_pemeriksaan_keamanan_listrik", 1, {}],
      ["mst_kondisi_lingkungan", 1, {}],
      ["mst_rekomendasi_hasil_pekerjaan", 0, { session_header_value: 2 }],
    ]);
    expect(await rows("SELECT name, status::text AS status, legacy_id FROM device_types ORDER BY name")).toEqual([
      { name: "Buatan Operator", status: "retired", legacy_id: 5 },
      { name: "Monitor Sintetis", status: "active", legacy_id: 3 },
      { name: "Pompa Infus Sintetis", status: "active", legacy_id: 1 },
    ]);
    expect(await rows("SELECT m.legacy_id, t.name FROM upstream_import.id_map m JOIN device_types t ON t.id = m.target_id WHERE m.source_table = 'mst_alat' ORDER BY 1")).toEqual([
      { legacy_id: "1", name: "Pompa Infus Sintetis" },
      { legacy_id: "2", name: "Pompa Infus Sintetis" },
      { legacy_id: "3", name: "Monitor Sintetis" },
      { legacy_id: "5", name: "Buatan Operator" },
    ]);
    expect(
      await rows(
        `SELECT legacy_table, legacy_id, section::text AS section, input_kind::text AS kind, label, unit, setting_text, limit_op::text AS op,
                limit_tolerance::text AS tol, limit_text, allowed_outcomes::text AS outcomes, notes, status::text AS status
           FROM inspection_item_definitions WHERE legacy_table IS NOT NULL ORDER BY legacy_table, legacy_id`,
      ),
    ).toEqual([
      { legacy_table: "mst_kelengkapan_alat", legacy_id: 1, section: "completeness", kind: "tri_state", label: "Kabel daya sintetis", unit: null, setting_text: null, op: null, tol: null, limit_text: null, outcomes: "{pass,fail,not_applicable}", notes: "catatan operator", status: "active" },
      { legacy_table: "mst_kondisi_lingkungan", legacy_id: 1, section: "environment", kind: "measured", label: "Suhu sintetis", unit: null, setting_text: null, op: null, tol: null, limit_text: null, outcomes: "{}", notes: null, status: "retired" },
      { legacy_table: "mst_pemeriksaan_keamanan_listrik", legacy_id: 1, section: "electrical_safety", kind: "measured_with_limit", label: "Arus bocor sintetis", unit: null, setting_text: null, op: null, tol: null, limit_text: null, outcomes: "{pass,fail,not_applicable}", notes: null, status: "active" },
      { legacy_table: "mst_pemeriksaan_kinerja_alat", legacy_id: 1, section: "performance", kind: "setting_measured_reference", label: "Laju aliran sintetis", unit: null, setting_text: "N mL/h", op: "plus_minus_pct", tol: "10", limit_text: "± 10 %", outcomes: "{pass,fail}", notes: null, status: "active" },
      { legacy_table: "mst_pemeriksaan_kinerja_alat", legacy_id: 2, section: "performance", kind: "setting_measured_reference", label: "Tekanan sintetis", unit: "mmHg", setting_text: "N mmHg", op: "plus_minus", tol: "5", limit_text: "± 5 mmHg", outcomes: "{pass,fail}", notes: null, status: "active" },
      { legacy_table: "mst_pemeriksaan_kinerja_alat", legacy_id: 3, section: "performance", kind: "setting_measured_reference", label: "Resolusi sintetis", unit: null, setting_text: null, op: "text", tol: null, limit_text: "≤ 2 × resolution", outcomes: "{pass,fail}", notes: null, status: "active" },
    ]);
    const audits = await rows(
      `SELECT resource_type, count(*)::int AS n, bool_and(tenant_id = '${PLATFORM}') AS platform, bool_and(client_facility_id IS NULL) AS no_facility
         FROM audit_logs WHERE actor_name = 'system:upstream-transform' GROUP BY 1 ORDER BY 1`,
    );
    expect(audits).toEqual([
      { resource_type: "DeviceType", n: 3, platform: true, no_facility: true },
      { resource_type: "InspectionItemDefinition", n: 6, platform: true, no_facility: true },
    ]);
  });

  it("the same values again write nothing; a changed label updates its definition and writes one UPDATE row", async () => {
    const before = await auditCount();
    await stage(RUN_2);
    const again = await transform(RUN_2);
    expect(again.steps.find((s) => s.step === "device_types")?.sources[0]).toMatchObject({ mapped: 0, unchanged: 4 });
    expect(await auditCount()).toBe(before);
    await stage(RUN_3, "Kabel daya sintetis baru");
    await transform(RUN_3);
    expect(await rows("SELECT label FROM inspection_item_definitions WHERE legacy_table = 'mst_kelengkapan_alat' AND legacy_id = 1")).toEqual([{ label: "Kabel daya sintetis baru" }]);
    expect(await auditCount()).toBe(before + 1);
  });

});
