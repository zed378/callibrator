/**
 * P24-01 (G-29; threat model AM-28, FT-102) — the transform's bookkeeping and runner on a REAL
 * PostgreSQL 18, each grant proved AS its role (never as the owner, CLAUDE.md Evidence).
 *
 *  - migration 0133: down / up / up rebuilds the same objects; down refuses once a decision exists;
 *  - `callibrator_app` can neither read nor write `upstream_import.id_map` / `.quarantine` (G-29);
 *  - `callibrator_transform` reads staging (a table the import role creates LATER included —
 *    the default privileges), writes id_map (no DELETE) and quarantine (no UPDATE), creates
 *    nothing in the schema, and reads nothing in `public`;
 *  - the tables' rules: the reason vocabulary, the hex hash, no `users` values, facility needs tenant;
 *  - the runner on the transform connection (config/upstreamImport#createTransformDb) with a
 *    synthetic step over a synthetic staged table: every staged row mapped or quarantined, the
 *    counts; a second run of the same values is all `unchanged`; a changed value is `changed`;
 *    a step that leaves a row unaccounted fails TRANSFORM_INCOMPLETE and ROLLS BACK its id_map
 *    rows; a staged table no step claims fails it; the owner's connection is TRANSFORM_ROLE_INVALID.
 *
 * Synthetic values only (`P2401 Facility n`); nothing from upstream.
 *
 *   docker run -d --name p2401-pg18 -e POSTGRES_PASSWORD=p2401pass -p 127.0.0.1:55221:5432 pgvector/pgvector:pg18
 *   P2401_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55221 DB_NAME=p2401_scratch DB_USER=postgres DB_PASS=p2401pass \
 *     npm test -- src/tests/migrations/upstreamImportGrants.p2401.live --coverage=false
 *   docker rm -f p2401-pg18
 */
import { randomUUID } from "crypto";
import type { Transaction } from "sequelize";
import { env } from "../../config/env";
import type { StepContext, TransformStep } from "../../services/upstreamImport/transform/steps";
import type * as LedgerModule from "../../services/upstreamImport/transform/ledger";
import type * as RunnerModule from "../../services/upstreamImport/transform/runner";
import type * as ConfigModule from "../../config/upstreamImport";

const live = env("P2401_PG_LIVE_TEST") === "1" ? describe : describe.skip;

const APP_ROLE = "callibrator_app";
const IMPORT_ROLE = "callibrator_import";
const TRANSFORM_ROLE = "callibrator_transform";
const TENANT = "a2401000-0000-4000-8000-0000000000a1";
const RUN_1 = "a2401000-0000-4000-8000-0000000000e1";
const RUN_2 = "a2401000-0000-4000-8000-0000000000e2";
const RUN_3 = "a2401000-0000-4000-8000-0000000000e3";

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
  ledger: require("../../services/upstreamImport/transform/ledger") as typeof LedgerModule,
  runner: require("../../services/upstreamImport/transform/runner") as typeof RunnerModule,
  config: require("../../config/upstreamImport") as typeof ConfigModule,
  m0133: require("../../migrations/0133-upstream-import-transform") as Migration,
});
/* eslint-enable @typescript-eslint/no-require-imports */

live("P24-01 — the transform's grants, bookkeeping and runner on live PostgreSQL 18", () => {
  jest.setTimeout(300_000);
  let g: ReturnType<typeof load>;
  let transformDb: LiveDb;

  const rows = async (sql: string, replacements: object = {}): Promise<Row[]> => (await g.db.query(sql, { replacements }))[0];

  /** The PostgreSQL error `sql` raises AS `role` (inside a rolled-back transaction), or null. */
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

  /** Statements run AS the import role (the staging schema's owner), committed. */
  const asImport = async (...statements: string[]): Promise<void> => {
    const t = await g.db.transaction();
    await g.db.query(`SET LOCAL ROLE ${IMPORT_ROLE}`, { transaction: t });
    for (const statement of statements) {
      await g.db.query(statement, { transaction: t });
    }
    await t.commit();
  };

  /** Stage synthetic facilities for `run`: ids 1..n, names "P2401 Facility <id><suffix>". */
  const stage = (run: string, n: number, suffix = ""): Promise<void> =>
    asImport(
      `INSERT INTO upstream_import.stg_mst_faskes (import_run_id, source_row_number, id, nama_faskes, kota)
       SELECT '${run}'::uuid, i, i, 'P2401 Facility ' || i || '${suffix}', NULL FROM generate_series(1, ${String(n)}) i`,
    );

  /** A synthetic step over stg_mst_faskes: every row mapped, except odd ids above `quarantineAbove` (quarantined no_device). */
  const facilityStep = (quarantineAbove: number, leaveOut: number | null = null): TransformStep => ({
    id: "client_facilities",
    writes: ["client_facilities"],
    sources: [{ table: "mst_faskes", legacyId: 's."id"::text' }],
    run: async (context: StepContext) => {
      const source = { table: "mst_faskes", legacyId: 's."id"::text' };
      const rowsOf = await g.ledger.classify(context, source);
      const quarantined = rowsOf.filter((r) => Number(r.legacyId) > quarantineAbove && Number(r.legacyId) % 2 === 1);
      await g.ledger.quarantineRows(
        context,
        quarantined.map((r) => ({ sourceTable: "mst_faskes", sourceRowNumber: r.sourceRowNumber, legacyId: r.legacyId, reason: "no_device" as const })),
      );
      const toMap = rowsOf.filter((r) => !quarantined.includes(r) && r.decision !== "unchanged" && Number(r.legacyId) !== leaveOut);
      await g.ledger.recordMappings(
        context,
        toMap.map((r) => ({
          sourceTable: "mst_faskes",
          legacyId: r.legacyId,
          targetTable: "client_facilities",
          targetId: r.targetId ?? randomUUID(),
          tenantId: TENANT,
          clientFacilityId: null,
          rowHash: r.rowHash,
          sourceValues: r.decision === "changed" ? { changed: true } : null,
        })),
      );
    },
  });

  const transform = (runId: string, steps: TransformStep[], db: LiveDb = transformDb, role = TRANSFORM_ROLE) =>
    g.runner.runTransform({ runId, db, runner: db, role, steps });

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = load();
    g.db.options.logging = false;
    await g.migrationLock.runSchemaSetup({ sequelize: g.db, migrator: g.migrator, logger });
    expect(await g.migrator.pending()).toEqual([]);
    await asImport(
      `CREATE TABLE IF NOT EXISTS upstream_import.stg_mst_faskes (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL,
         id integer, nama_faskes text, kota text, PRIMARY KEY (import_run_id, source_row_number))`,
    );
    transformDb = g.config.createTransformDb() as unknown as LiveDb;
  });

  afterAll(async () => {
    await transformDb.close();
    await g.db.close();
  });

  it("0133: down / up / up on the migrated database rebuilds the same objects", async () => {
    const objects = async (): Promise<Row[]> =>
      rows(
        `SELECT 'c:' || conname AS o FROM pg_constraint WHERE conrelid IN ('upstream_sql_imports'::regclass, 'upstream_import.id_map'::regclass, 'upstream_import.quarantine'::regclass)
         UNION ALL SELECT 'i:' || indexname FROM pg_indexes WHERE tablename IN ('upstream_sql_imports', 'id_map', 'quarantine')
         UNION ALL SELECT 'g:' || table_name || ':' || privilege_type FROM information_schema.role_table_grants
                    WHERE grantee = '${TRANSFORM_ROLE}' AND table_schema = 'upstream_import'
         UNION ALL SELECT 'col:' || column_name FROM information_schema.columns WHERE table_name = 'upstream_sql_imports' AND column_name LIKE 'transform%'
         ORDER BY 1`,
      );
    const before = await objects();
    expect(before.map((r) => r["o"])).toEqual(
      expect.arrayContaining([
        "c:upstream_sql_imports_transform_after_load",
        "c:upstream_sql_imports_transform_error_when_failed",
        "c:id_map_no_user_values",
        "c:quarantine_reason_vocabulary",
        "i:upstream_sql_imports_one_transforming",
        "g:id_map:INSERT",
        "g:quarantine:DELETE",
        "g:stg_mst_faskes:SELECT",
        "col:transform_summary",
      ]),
    );
    await g.m0133.down({ context: g.db.getQueryInterface() });
    expect(await rows("SELECT to_regclass('upstream_import.id_map') AS m, to_regclass('upstream_import.quarantine') AS q")).toEqual([{ m: null, q: null }]);
    await g.m0133.up({ context: g.db.getQueryInterface() });
    await g.m0133.up({ context: g.db.getQueryInterface() });
    expect(await objects()).toEqual(before);
  });

  it("G-29: callibrator_app can neither read nor write id_map or quarantine", async () => {
    for (const table of ["upstream_import.id_map", "upstream_import.quarantine"]) {
      expect(await errorAs(APP_ROLE, `SELECT * FROM ${table}`)).toMatch(/^42501 permission denied for schema upstream_import/);
      expect(await errorAs(APP_ROLE, `DELETE FROM ${table}`)).toMatch(/^42501/);
    }
    expect(await rows(`SELECT has_schema_privilege('${APP_ROLE}', 'upstream_import', 'USAGE') AS u`)).toEqual([{ u: false }]);
  });

  it("the transform role: staging read-only (a table created later too), id_map without DELETE, quarantine without UPDATE, nothing in public", async () => {
    await asImport("CREATE TABLE upstream_import.stg_probe_later (import_run_id uuid, v text)");
    expect(await errorAs(TRANSFORM_ROLE, "SELECT * FROM upstream_import.stg_probe_later")).toBeNull();
    expect(await errorAs(TRANSFORM_ROLE, "INSERT INTO upstream_import.stg_probe_later VALUES (gen_random_uuid(), 'x')")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM upstream_import.stg_mst_faskes")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "CREATE TABLE upstream_import.stg_transform (id int)")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "SELECT * FROM upstream_import.id_map")).toBeNull();
    expect(await errorAs(TRANSFORM_ROLE, "UPDATE upstream_import.id_map SET updated_at = now()")).toBeNull();
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM upstream_import.id_map")).toMatch(/^42501 permission denied for table id_map/);
    expect(await errorAs(TRANSFORM_ROLE, "TRUNCATE upstream_import.id_map")).toMatch(/^42501/);
    expect(await errorAs(TRANSFORM_ROLE, "DELETE FROM upstream_import.quarantine")).toBeNull();
    expect(await errorAs(TRANSFORM_ROLE, "UPDATE upstream_import.quarantine SET reason = 'no_device'")).toMatch(/^42501 permission denied for table quarantine/);
    for (const table of ["tenants", "users", "client_facilities", "calibration_devices", "audit_logs", "upstream_sql_imports"]) {
      expect([table, await errorAs(TRANSFORM_ROLE, `SELECT 1 FROM ${table} LIMIT 1`)]).toEqual([table, expect.stringMatching(/^42501/)]);
    }
    const [role] = await rows(
      `SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolcanlogin OR rolbypassrls AS powerful FROM pg_roles WHERE rolname = '${TRANSFORM_ROLE}'`,
    );
    expect(role).toEqual({ powerful: false });
    await asImport("DROP TABLE upstream_import.stg_probe_later");
  });

  it("the tables' rules: reason vocabulary, hex hash, no users values, facility needs tenant", async () => {
    const insertMap = (values: string): Promise<string | null> =>
      errorAs(
        TRANSFORM_ROLE,
        `INSERT INTO upstream_import.id_map (source_table, legacy_id, target_table, target_id, tenant_id, client_facility_id, import_run_id, source_row_hash, source_values) VALUES (${values})`,
      );
    const hash = `'${"a".repeat(64)}'`;
    expect(await insertMap(`'users', '1', 'users', gen_random_uuid(), '${TENANT}', NULL, gen_random_uuid(), ${hash}, '{"x":1}'`)).toMatch(/^23514 .*id_map_no_user_values/);
    expect(await insertMap(`'users', '1', 'users', gen_random_uuid(), '${TENANT}', NULL, gen_random_uuid(), ${hash}, NULL`)).toBeNull();
    expect(await insertMap(`'mst_faskes', '1', 'client_facilities', gen_random_uuid(), NULL, gen_random_uuid(), gen_random_uuid(), ${hash}, NULL`)).toMatch(/^23514 .*id_map_facility_needs_tenant/);
    expect(await insertMap("'mst_faskes', '1', 'client_facilities', gen_random_uuid(), NULL, NULL, gen_random_uuid(), 'ABC', NULL")).toMatch(/^23514 .*id_map_source_row_hash_hex/);
    expect(await insertMap(`'Bad Table', '1', 'x', gen_random_uuid(), NULL, NULL, gen_random_uuid(), ${hash}, NULL`)).toMatch(/^23514 .*id_map_source_table_name/);
    expect(
      await errorAs(TRANSFORM_ROLE, "INSERT INTO upstream_import.quarantine (import_run_id, source_table, source_row_number, reason) VALUES (gen_random_uuid(), 'mst_faskes', 1, 'dropped')"),
    ).toMatch(/^23514 .*quarantine_reason_vocabulary/);
  });

  it("the runner: every staged row mapped or quarantined, counted; the same values again are all unchanged; a changed value is changed", async () => {
    await stage(RUN_1, 10);
    const first = await transform(RUN_1, [facilityStep(6)]);
    expect(first.steps).toEqual([
      { step: "client_facilities", durationMs: expect.any(Number) as number, sources: [{ table: "mst_faskes", staged: 10, mapped: 8, unchanged: 0, quarantined: { no_device: 2 } }] },
    ]);
    expect(await rows("SELECT count(*)::int AS n, count(DISTINCT target_id)::int AS targets FROM upstream_import.id_map WHERE source_table = 'mst_faskes'")).toEqual([
      { n: 8, targets: 8 },
    ]);
    // The hash is PostgreSQL's, 64 hex, the same for the same values.
    const [one] = await rows("SELECT source_row_hash AS h FROM upstream_import.id_map WHERE source_table = 'mst_faskes' AND legacy_id = '1'");
    expect(String(one?.["h"])).toMatch(/^[0-9a-f]{64}$/);

    // Run 2 stages the SAME values: nothing new to write; quarantine is the run's own.
    await stage(RUN_2, 10);
    const second = await transform(RUN_2, [facilityStep(6)]);
    expect(second.steps[0]?.sources[0]).toEqual({ table: "mst_faskes", staged: 10, mapped: 0, unchanged: 8, quarantined: { no_device: 2 } });
    expect(await rows("SELECT import_run_id AS r, count(*)::int AS n FROM upstream_import.quarantine GROUP BY 1 ORDER BY 1")).toEqual([
      { r: RUN_1, n: 2 },
      { r: RUN_2, n: 2 },
    ]);

    // Run 3 changes every name: every mapped row is `changed`, keeps its target, carries the run.
    await stage(RUN_3, 10, " (renamed)");
    const before = await rows("SELECT legacy_id, target_id FROM upstream_import.id_map WHERE source_table = 'mst_faskes' ORDER BY legacy_id");
    const third = await transform(RUN_3, [facilityStep(6)]);
    expect(third.steps[0]?.sources[0]).toEqual({ table: "mst_faskes", staged: 10, mapped: 8, unchanged: 0, quarantined: { no_device: 2 } });
    expect(await rows("SELECT legacy_id, target_id FROM upstream_import.id_map WHERE source_table = 'mst_faskes' ORDER BY legacy_id")).toEqual(before);
    expect(await rows("SELECT DISTINCT import_run_id AS r, source_values AS v FROM upstream_import.id_map WHERE source_table = 'mst_faskes'")).toEqual([
      { r: RUN_3, v: { changed: true } },
    ]);

    // Re-running run 1 replaces ITS quarantine, not another run's.
    await transform(RUN_1, [facilityStep(8)]);
    expect(await rows("SELECT import_run_id AS r, count(*)::int AS n FROM upstream_import.quarantine GROUP BY 1 ORDER BY 1")).toEqual([
      { r: RUN_1, n: 1 },
      { r: RUN_2, n: 2 },
      { r: RUN_3, n: 2 },
    ]);
  });

  it("a row left unaccounted fails TRANSFORM_INCOMPLETE and rolls back everything the step wrote", async () => {
    const run = randomUUID();
    await asImport(
      `INSERT INTO upstream_import.stg_mst_faskes (import_run_id, source_row_number, id, nama_faskes)
       SELECT '${run}'::uuid, i, 100 + i, 'P2401 Facility new ' || i FROM generate_series(1, 4) i`,
    );
    const mapsBefore = await rows("SELECT count(*)::int AS n FROM upstream_import.id_map");
    const err = (await transform(run, [facilityStep(1000, 102)]).catch((e: unknown) => e)) as RunnerModule.TransformFailure;
    expect(err.code).toBe("TRANSFORM_INCOMPLETE");
    expect(err.message).toBe("step client_facilities: 1 staged row(s) of mst_faskes are neither mapped nor quarantined");
    expect(await rows("SELECT count(*)::int AS n FROM upstream_import.id_map")).toEqual(mapsBefore);
    expect(await rows(`SELECT count(*)::int AS n FROM upstream_import.quarantine WHERE import_run_id = '${run}'`)).toEqual([{ n: 0 }]);
  });

  it("a staged table of the run that no step claims fails it; the owner's connection is TRANSFORM_ROLE_INVALID", async () => {
    await asImport(
      "CREATE TABLE upstream_import.stg_trx_inventory (import_run_id uuid NOT NULL, source_row_number bigint NOT NULL, id integer, PRIMARY KEY (import_run_id, source_row_number))",
      `INSERT INTO upstream_import.stg_trx_inventory VALUES ('${RUN_1}', 1, 1)`,
    );
    const err = (await transform(RUN_1, [facilityStep(6)]).catch((e: unknown) => e)) as RunnerModule.TransformFailure;
    expect([err.code, err.message]).toEqual(["TRANSFORM_INCOMPLETE", "no step accounts for the staged table(s) trx_inventory"]);
    // Another run's rows there do not concern run 2.
    expect((await transform(RUN_2, [facilityStep(6)])).steps).toHaveLength(1);
    await asImport("DROP TABLE upstream_import.stg_trx_inventory");

    const owner = (await transform(RUN_1, [facilityStep(6)], g.db).catch((e: unknown) => e)) as RunnerModule.TransformFailure;
    expect(owner.code).toBe("TRANSFORM_ROLE_INVALID");
  });

  it("0133 down refuses once a decision exists", async () => {
    await expect(g.m0133.down({ context: g.db.getQueryInterface() })).rejects.toThrow("holds the import's decisions");
  });
});
