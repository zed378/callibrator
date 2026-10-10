/**
 * P24-06 — the SQL-dump import on a REAL PostgreSQL 18 (and, when asked, a
 * real ClamAV), end to end, as the backend runs it: the application's
 * connection as `callibrator_app` (P6-03), the worker's staging connection as
 * `callibrator_import` (migration 0114).
 *
 *  - 0114's grants, proved AS each role (never as the owner, CLAUDE.md
 *    Evidence): `callibrator_app` can neither read nor write nor create in the
 *    `upstream_import` schema, nor DELETE a run; the import role can create
 *    and write there and reads nothing of the application's;
 *  - 0114 down / up / up on the migrated database; down refuses once runs exist;
 *  - a SYNTHETIC dump shaped like the upstream one (tests/support/
 *    syntheticUpstreamDump.ts — no real value): upload → scan → parse →
 *    staging → loaded, through the batch-job infrastructure (inline), the
 *    uploader notified (in-app row, in their home tenant), every transition
 *    audited under PLATFORM, the file deleted — and every count equal to what
 *    the GENERATOR wrote, not to what the import says of itself;
 *  - NEVER COPIED columns and NOT MIGRATED tables never reach staging, and no
 *    synthetic secret reaches the run row, an audit row or a notification;
 *  - gzip; a re-run of the same run id REPLACES its rows; a truncated dump
 *    fails with nothing staged and its file kept; a retry; a cancelled parse
 *    rolls back; the DPIA gate answers 403 and the single-active-run rule 409;
 *  - ClamAV (always; CLAMAV_LIVE_HOST/PORT): an infected file fails INFECTED and is deleted;
 *  - a reboot applies nothing and the schema check passes.
 *
 *   docker run -d --name p2406-sqlimport-pg18 -e POSTGRES_PASSWORD=p2406pass -p 127.0.0.1:55246:5432 pgvector/pgvector:pg18
 *   docker run -d --name p2406-sqlimport-clamav -p 127.0.0.1:53346:3310 clamav/clamav:stable
 *   CLAMAV_LIVE_HOST=127.0.0.1 CLAMAV_LIVE_PORT=53346 DB_HOST=127.0.0.1 DB_PORT=55246 DB_NAME=p2406_scratch \
 *     DB_USER=postgres DB_PASS=p2406pass npm run test:live:jest -- src/tests/services/upstreamSqlImport.p2406.live
 *   docker rm -f p2406-sqlimport-pg18 p2406-sqlimport-clamav
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { env, environment } from "../../config/env";
import { gzipped, syntheticUpstreamDump, SYNTHETIC_HASH_MARKER, type ExpectedTable } from "../support/syntheticUpstreamDump";

// ClamAV is not optional (2026-10-10, no skip): the suite runs against a real daemon, and fails at once without one.
const CLAMAV_HOST = env("CLAMAV_LIVE_HOST") ?? "";
const CLAMAV_PORT = env("CLAMAV_LIVE_PORT") ?? "";
if (CLAMAV_HOST === "" || CLAMAV_PORT === "") {
  throw new Error("upstreamSqlImport.p2406.live needs CLAMAV_LIVE_HOST and CLAMAV_LIVE_PORT (a ClamAV daemon; npm run test:live -- --with=clamav)");
}

const APP_ROLE = "callibrator_app";
const IMPORT_ROLE = "callibrator_import";
const PLATFORM = "00000000-0000-4000-8000-000000000001";
const TENANT = "a2406000-0000-4000-8000-0000000000a1";
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

type Row = Record<string, unknown>;
interface LiveTx {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
interface LiveDb {
  options: { logging: unknown };
  query(sql: string, options?: object): Promise<[Row[], unknown]>;
  transaction(): Promise<LiveTx>;
  close(): Promise<void>;
  sync(): Promise<unknown>;
  getQueryInterface(): unknown;
}
interface RunView {
  id: string;
  status: string;
  rowsLoaded: number;
  rowsRejected: number;
  rowsNotExtracted: number;
  tables: (ExpectedTable & { table: string; columns: number; excludedColumns: number })[];
  errorCode: string | null;
  fileRetained: boolean;
  compression: string;
  attempt: number;
  sha256: string;
}
interface Actor {
  userId: string;
  tenantId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}
interface Service {
  uploadDump(file: { path: string; size: number }, body: unknown, actor: Actor): Promise<RunView>;
  getRun(id: string): Promise<RunView>;
  cancelRun(id: string, actor: Actor): Promise<RunView>;
  retryRun(id: string, actor: Actor): Promise<RunView>;
  sweepUpstreamSqlImports(now?: Date): Promise<{ interrupted: number; purged: number; orphans: number }>;
  dumpDirectory(): string;
}
interface Pipeline {
  runPipeline(options: object): Promise<{ tables: Record<string, { rowsLoaded: number }> }>;
  ImportCancelled: new () => Error;
}
interface Loader {
  beginStaging(session: object, role: string): Promise<void>;
  purgeRun(session: object, runId: string): Promise<string[]>;
}
interface Migration {
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
}
interface Graph {
  db: LiveDb;
  migrator: { pending(): Promise<unknown[]>; up(): Promise<unknown[]> };
  migrationLock: { runSchemaSetup(options: object): Promise<unknown> };
  dbRole: { enterApplicationRole(options: object): Promise<unknown> };
  schemaVerify: { verifySchema(db: unknown): Promise<{ problems: string[] }> };
  tenantStorage: { run(context: object, fn: () => void): void };
  quarantinePath: (...parts: string[]) => string;
  service: Service;
  pipeline: Pipeline;
  loader: Loader;
  stagingDb: { createStagingDb(): LiveDb & { transaction(): Promise<LiveTx> } };
  m0114: Migration;
  /** P24-01: 0133 builds on 0114 (the run table, the schema); it is taken down first and put back last. */
  m0133: Migration;
}

/* eslint-disable @typescript-eslint/no-require-imports -- the graph is loaded per "process" with jest.isolateModules; typed by the members used */
const load = (): Graph => {
  const db = (require("../../config") as { db: LiveDb }).db;
  db.options.logging = false;
  require("../../models");
  return {
    db,
    migrator: (require("../../config/migrator") as { migrator: Graph["migrator"] }).migrator,
    migrationLock: require("../../utils/migrationLock.util") as Graph["migrationLock"],
    dbRole: require("../../utils/dbRole.util") as Graph["dbRole"],
    schemaVerify: require("../../utils/schemaVerify.util") as Graph["schemaVerify"],
    tenantStorage: (require("../../middlewares/tenantContext.middleware") as { tenantStorage: Graph["tenantStorage"] }).tenantStorage,
    quarantinePath: (require("../../utils/upload.util") as { quarantinePath: Graph["quarantinePath"] }).quarantinePath,
    service: require("../../services/upstreamSqlImport.service") as Service,
    pipeline: require("../../services/upstreamImport/importPipeline") as Pipeline,
    loader: require("../../services/upstreamImport/stagingLoader") as Loader,
    stagingDb: require("../../config/upstreamImport") as Graph["stagingDb"],
    m0114: require("../../migrations/0114-upstream-sql-imports") as Migration,
    m0133: require("../../migrations/0133-upstream-import-transform") as Migration,
  };
};

/**
 * A second "process" on the same database. The APPLICATION's graph is the main module registry,
 * not an isolated one: the worker builds its staging Sequelize instance at RUN time, and a
 * Sequelize built outside `isolateModules` loads its dialect from the main registry — whose
 * Transaction class an isolated instance's transactions are not instances of.
 */
const startProcess = (isolated = true): Graph => {
  if (!isolated) {
    return load();
  }
  let graph: Graph | undefined;
  jest.isolateModules(() => {
    graph = load();
  });
  if (!graph) {
    throw new Error("the module graph did not load");
  }
  return graph;
};
/* eslint-enable @typescript-eslint/no-require-imports */

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe("P24-06 — the SQL-dump import on live PostgreSQL 18", () => {
  jest.setTimeout(600_000);
  let owner: Graph;
  let app: Graph;
  let actor: Actor;
  const written: string[] = [];

  const rows = async (sql: string, replacements: object = {}): Promise<Row[]> => (await owner.db.query(sql, { replacements }))[0];

  /** The PostgreSQL error `sql` raises AS `role` (inside a rolled-back transaction), or null. */
  const errorAs = async (role: string, sql: string): Promise<string | null> => {
    const t = await owner.db.transaction();
    try {
      await owner.db.query(`SET LOCAL ROLE ${role}`, { transaction: t });
      await owner.db.query(sql, { transaction: t });
      return null;
    } catch (err) {
      const e = err as { parent?: { code?: string; message?: string } };
      return `${e.parent?.code ?? "?"} ${e.parent?.message ?? String(err)}`;
    } finally {
      await t.rollback();
    }
  };

  const asSuperAdmin = <T>(work: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      app.tenantStorage.run({ tenantId: null, isSuperAdmin: true, isSystemTask: false }, () => {
        work().then(resolve, reject);
      });
    });

  /** A dump as multer leaves it: in the quarantine directory. */
  const quarantined = (name: string, body: string | Buffer): { path: string; size: number } => {
    const full = app.quarantinePath(`p2406-${String(Date.now())}-${String(Math.random()).slice(2, 8)}-${name}`);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    written.push(full);
    return { path: full, size: fs.statSync(full).size };
  };

  /** Poll until the run leaves uploaded / scanning / parsing. */
  const settled = async (id: string): Promise<RunView> => {
    for (let i = 0; i < 600; i++) {
      const run = await app.service.getRun(id);
      if (!["uploaded", "scanning", "parsing"].includes(run.status)) {
        return run;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`run ${id} did not settle`);
  };

  const upload = async (name: string, body: string | Buffer, dataClass = "synthetic"): Promise<RunView> =>
    asSuperAdmin(() => app.service.uploadDump(quarantined(name, body), { dataClass }, actor));

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to build a schema in DB_NAME="${name}": use a scratch database (see the header)`);
    }
    const vars = environment();
    vars["BATCH_JOBS_INLINE"] = "true";
    vars["UPSTREAM_REAL_DATA_ALLOWED"] = "false";
    vars["VIRUS_SCAN_PROVIDER"] = "clamav";
    vars["CLAMAV_ENABLED"] = "true";
    vars["CLAMAV_HOST"] = CLAMAV_HOST;
    vars["CLAMAV_PORT"] = CLAMAV_PORT;
    vars["CLAMAV_TIMEOUT"] = "60000";
    owner = startProcess();
    await owner.migrationLock.runSchemaSetup({ sequelize: owner.db, migrator: owner.migrator, logger });
    expect(await owner.migrator.pending()).toEqual([]);

    await owner.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
       VALUES (:id, 'P2406 Home', 'p2406home', 'p2406@live.test', now(), now()) ON CONFLICT (id) DO NOTHING`,
      { replacements: { id: TENANT } },
    );
    const [made] = await rows(
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                          status, is_active, must_change_password, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, :h, :e, 'x', 'P2406', 'Operator', 'default.svg', 'ACTIVE', true, false, false, now(), now())
       RETURNING id`,
      { t: TENANT, h: `p2406-op-${String(Date.now())}`, e: `p2406-op-${String(Date.now())}@live.test` },
    );
    actor = { userId: String(made?.["id"]), tenantId: TENANT, ipAddress: "203.0.113.46", userAgent: "p2406-live" };

    app = startProcess(false);
    await app.dbRole.enterApplicationRole({ sequelize: app.db, logger, env: { DB_APP_ROLE: APP_ROLE } });
    const [who] = (await app.db.query("SELECT current_user AS u"))[0];
    expect(who).toEqual({ u: APP_ROLE });
  });

  afterAll(async () => {
    for (const file of written) {
      fs.rmSync(file, { force: true });
    }
    await app.db.close();
    await owner.db.close();
  });

  it("0114: down / up / up on the migrated database rebuilds the same objects", async () => {
    const objects = async (): Promise<Row[]> =>
      rows(
        `SELECT 'c:' || conname AS o FROM pg_constraint WHERE conrelid = 'upstream_sql_imports'::regclass
         UNION ALL SELECT 'i:' || indexname FROM pg_indexes WHERE tablename = 'upstream_sql_imports'
         UNION ALL SELECT 's:' || nspname || ':' || pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'upstream_import'
         ORDER BY 1`,
      );
    const before = await objects();
    expect(before.map((r) => r["o"])).toEqual(
      expect.arrayContaining([
        "c:upstream_sql_imports_error_when_failed",
        "c:upstream_sql_imports_file_minimised",
        "c:upstream_sql_imports_sha256_hex",
        "i:upstream_sql_imports_one_active",
        `s:upstream_import:${IMPORT_ROLE}`,
      ]),
    );
    await owner.m0133.down({ context: owner.db.getQueryInterface() });
    await owner.m0114.down({ context: owner.db.getQueryInterface() });
    expect(await rows("SELECT to_regclass('upstream_sql_imports') AS t, to_regnamespace('upstream_import') AS s")).toEqual([{ t: null, s: null }]);
    await owner.m0114.up({ context: owner.db.getQueryInterface() });
    await owner.m0114.up({ context: owner.db.getQueryInterface() });
    await owner.m0133.up({ context: owner.db.getQueryInterface() });
    expect(await objects()).toEqual(before);
  });

  it("0114 grants: callibrator_app cannot read, write or create in upstream_import, nor DELETE a run; the import role works only there", async () => {
    // A staging table, made by the import role (its owner).
    const t = await owner.db.transaction();
    await owner.db.query(`SET LOCAL ROLE ${IMPORT_ROLE}`, { transaction: t });
    await owner.db.query("CREATE TABLE upstream_import.stg_probe (import_run_id uuid, v text)", { transaction: t });
    await owner.db.query("INSERT INTO upstream_import.stg_probe VALUES (gen_random_uuid(), 'synthetic')", { transaction: t });
    await t.commit();

    expect(await errorAs(APP_ROLE, "SELECT * FROM upstream_import.stg_probe")).toMatch(/^42501 permission denied for schema upstream_import/);
    expect(await errorAs(APP_ROLE, "INSERT INTO upstream_import.stg_probe VALUES (gen_random_uuid(), 'x')")).toMatch(/^42501/);
    expect(await errorAs(APP_ROLE, "CREATE TABLE upstream_import.stg_app (id int)")).toMatch(/^42501/);
    expect(await errorAs(APP_ROLE, "DELETE FROM upstream_sql_imports")).toMatch(/^42501 permission denied for table upstream_sql_imports/);
    expect(await errorAs(APP_ROLE, "TRUNCATE upstream_sql_imports")).toMatch(/^42501/);
    expect(await errorAs(APP_ROLE, "SELECT count(*) FROM upstream_sql_imports")).toBeNull();
    const [privileges] = await rows(
      `SELECT has_schema_privilege(:app, 'upstream_import', 'USAGE') AS app_usage,
              has_schema_privilege(:app, 'upstream_import', 'CREATE') AS app_create,
              has_schema_privilege('public', 'upstream_import', 'USAGE') IS NOT NULL AS checked,
              (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolcanlogin OR rolbypassrls FROM pg_roles WHERE rolname = :imp) AS import_powerful`,
      { app: APP_ROLE, imp: IMPORT_ROLE },
    );
    expect(privileges).toEqual({ app_usage: false, app_create: false, checked: true, import_powerful: false });

    // The import role: its own schema yes; the application's tables no.
    expect(await errorAs(IMPORT_ROLE, "SELECT * FROM upstream_import.stg_probe")).toBeNull();
    expect(await errorAs(IMPORT_ROLE, "SELECT * FROM users")).toMatch(/^42501 permission denied for table users/);
    expect(await errorAs(IMPORT_ROLE, "SELECT * FROM upstream_sql_imports")).toMatch(/^42501/);
    expect(await errorAs(IMPORT_ROLE, "INSERT INTO audit_logs (id) VALUES (gen_random_uuid())")).toMatch(/^42501/);
    await owner.db.query("DROP TABLE upstream_import.stg_probe");
  });

  let loadedRun: RunView;
  const dump = syntheticUpstreamDump({ facilities: 12, devices: 120, rowsPerInsert: 25 });

  it("a synthetic dump: upload → scan → parse → staging → loaded; counts equal the generator's", async () => {
    const queued = await upload("synthetic.sql", dump.sql);
    expect(["uploaded", "scanning", "parsing"]).toContain(queued.status);
    expect(queued).toMatchObject({ compression: "none", attempt: 1 });
    expect(queued.sha256).toBe(createHash("sha256").update(dump.sql).digest("hex"));
    loadedRun = await settled(queued.id);
    expect(loadedRun).toMatchObject({ status: "loaded", errorCode: null, fileRetained: false });
    const byTable = Object.fromEntries(loadedRun.tables.map((t) => [t.table, t]));
    for (const [table, want] of Object.entries(dump.expected)) {
      expect({ table, ...byTable[table] }).toMatchObject({ table, ...want });
    }
    const sum = (key: "rowsLoaded" | "rowsRejected" | "rowsNotExtracted"): number => Object.values(dump.expected).reduce((s, t) => s + t[key], 0);
    expect(loadedRun.rowsLoaded).toBe(sum("rowsLoaded"));
    expect(loadedRun.rowsRejected).toBe(sum("rowsRejected"));
    expect(loadedRun.rowsNotExtracted).toBe(sum("rowsNotExtracted"));
    // The batch job that ran it: the PLATFORM tenant's, COMPLETED — the runner marks it a moment
    // after the handler has moved the run to loaded.
    let job: Row | undefined;
    for (let i = 0; i < 50 && job?.["status"] !== "COMPLETED"; i++) {
      [job] = await rows("SELECT j.status::text AS status, j.tenant_id FROM batch_jobs j JOIN upstream_sql_imports r ON r.batch_job_id = j.id WHERE r.id = :id", {
        id: loadedRun.id,
      });
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(job).toEqual({ status: "COMPLETED", tenant_id: PLATFORM });
  });

  it("the staged rows are the dump's rows; credentials and not-migrated tables never reach staging", async () => {
    const id = loadedRun.id;
    const counts = await rows(
      `SELECT (SELECT count(*)::int FROM upstream_import.stg_users WHERE import_run_id = :id) AS users,
              (SELECT count(*)::int FROM upstream_import.stg_trx_inventory WHERE import_run_id = :id) AS inventory,
              (SELECT count(*)::int FROM upstream_import.stg_mst_faskes WHERE import_run_id = :id) AS faskes`,
      { id },
    );
    expect(counts).toEqual([{ users: 6, inventory: 119, faskes: 12 }]);
    const userColumns = (await rows("SELECT attname FROM pg_attribute WHERE attrelid = 'upstream_import.stg_users'::regclass AND attnum > 0 AND NOT attisdropped")).map(
      (r) => r["attname"],
    );
    expect(userColumns).toEqual(expect.arrayContaining(["import_run_id", "source_row_number", "email", "username", "fullname", "active"]));
    for (const never of ["password_hash", "reset_hash", "activate_hash", "user_image", "force_pass_reset"]) {
      expect(userColumns).not.toContain(never);
    }
    expect(await rows("SELECT to_regclass('upstream_import.stg_auth_logins') AS t, to_regclass('upstream_import.stg_migrations') AS m, to_regclass('upstream_import.stg_synthetic_unknown_table') AS u")).toEqual([
      { t: null, m: null, u: null },
    ]);
    // Values as the dump wrote them: the escaped name, the zero date as NULL, a typed date, the row numbers.
    const [two] = await rows("SELECT name_faskes, created_at FROM upstream_import.stg_mst_faskes WHERE import_run_id = :id AND source_row_number = 2", { id });
    expect(two?.["name_faskes"]).toBe("Synthetic Facility 0002 \"North\" O'Neil\\Wing");
    const [one] = await rows("SELECT created_at FROM upstream_import.stg_mst_faskes WHERE import_run_id = :id AND source_row_number = 1", { id });
    expect(one?.["created_at"]).toBeNull();
    const [types] = await rows(
      "SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute WHERE attrelid = 'upstream_import.stg_trx_inventory'::regclass AND attname = 'tgl_inventory'",
    );
    expect(types).toEqual({ t: "date" });
    const [note] = await rows("SELECT description FROM upstream_import.stg_trx_catatan WHERE import_run_id = :id AND source_row_number = 4", { id });
    expect(note?.["description"]).toBe("Synthetic note line 1\nline 2\twith a tab");
    // The trigger's INSERT in the DELIMITER region was discarded, never executed.
    expect(await rows("SELECT count(*)::int AS n FROM upstream_import.stg_mst_alat WHERE import_run_id = :id AND id = 999", { id })).toEqual([{ n: 0 }]);
    // Row 3 of trx_inventory (2024-02-30) was rejected: its number is absent.
    expect(await rows("SELECT count(*)::int AS n FROM upstream_import.stg_trx_inventory WHERE import_run_id = :id AND source_row_number = 3", { id })).toEqual([{ n: 0 }]);
  });

  it("no synthetic secret or value leaves the import: not the run row, not an audit row, not a notification; the file is gone", async () => {
    const id = loadedRun.id;
    const [run] = await rows("SELECT row_to_json(r)::text AS j, file_path, file_deleted_at FROM upstream_sql_imports r WHERE id = :id", { id });
    expect(run?.["file_path"]).toBeNull();
    expect(run?.["file_deleted_at"]).not.toBeNull();
    const audits = await rows(
      "SELECT tenant_id, actor_type::text AS actor_type, actor_name, user_id, changes::text AS c FROM audit_logs WHERE resource_id = :id ORDER BY created_at",
      { id },
    );
    expect(audits.map((a) => (JSON.parse(String(a["c"])) as { after: { status: string } }).after.status)).toEqual(["uploaded", "scanning", "parsing", "loaded"]);
    expect(audits.every((a) => a["tenant_id"] === PLATFORM)).toBe(true);
    expect(audits[0]).toMatchObject({ actor_type: "user", user_id: actor.userId });
    expect(audits.slice(1).every((a) => a["actor_name"] === "system:upstream-sql-import")).toBe(true);
    const notifications = await rows("SELECT tenant_id, user_id, title, message, type::text AS type FROM notifications WHERE action_url LIKE :u", {
      u: `%run=${id}`,
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ tenant_id: TENANT, user_id: actor.userId, title: "SQL dump import loaded", type: "SYSTEM" });
    const said = [String(run?.["j"]), ...audits.map((a) => String(a["c"])), String(notifications[0]?.["message"])].join("\n");
    for (const secret of dump.secrets) {
      expect(said).not.toContain(secret);
    }
    expect(String(notifications[0]?.["message"])).toContain(loadedRun.sha256);
    const leftovers = fs.existsSync(app.service.dumpDirectory()) ? fs.readdirSync(app.service.dumpDirectory()) : [];
    expect(leftovers.filter((f) => f.startsWith(id))).toEqual([]);
  });

  it("a gzip dump loads the same rows; the pipeline run twice for one run id REPLACES its rows", async () => {
    const run = await settled((await upload("synthetic.sql.gz", gzipped(dump.sql))).id);
    expect(run).toMatchObject({ status: "loaded", compression: "gzip", rowsLoaded: loadedRun.rowsLoaded, rowsRejected: loadedRun.rowsRejected });

    // Idempotency, on the staging connection itself: the same run id, twice.
    const file = quarantined("rerun.sql", dump.sql);
    const runId = "a2406000-0000-4000-8000-0000000000f1";
    for (let pass = 0; pass < 2; pass++) {
      const staging = app.stagingDb.createStagingDb();
      const transaction = await staging.transaction();
      const session = { runner: staging, transaction };
      await app.loader.beginStaging(session, IMPORT_ROLE);
      await app.loader.purgeRun(session, runId);
      await app.pipeline.runPipeline({ filePath: file.path, compression: "none", maxUncompressedBytes: 10_000_000, session, runId, onProgress: () => Promise.resolve(false) });
      await transaction.commit();
      await staging.close();
    }
    expect(await rows("SELECT count(*)::int AS n FROM upstream_import.stg_trx_inventory WHERE import_run_id = :runId", { runId })).toEqual([{ n: 119 }]);
  });

  it("a cancelled parse rolls its staging back: nothing of the run remains", async () => {
    const file = quarantined("cancel.sql", dump.sql);
    const runId = "a2406000-0000-4000-8000-0000000000f2";
    const staging = app.stagingDb.createStagingDb();
    const transaction = await staging.transaction();
    const session = { runner: staging, transaction };
    await app.loader.beginStaging(session, IMPORT_ROLE);
    await expect(
      app.pipeline.runPipeline({ filePath: file.path, compression: "none", maxUncompressedBytes: 10_000_000, session, runId, progressEveryMs: 0, onProgress: () => Promise.resolve(true) }),
    ).rejects.toBeInstanceOf(app.pipeline.ImportCancelled);
    await transaction.rollback();
    await staging.close();
    expect(await rows("SELECT count(*)::int AS n FROM upstream_import.stg_users WHERE import_run_id = :runId", { runId })).toEqual([{ n: 0 }]);
  });

  let truncatedId = "";
  it("a truncated dump fails TRUNCATED_INPUT with nothing staged, keeps its file, and is notified; a retry fails the same way", async () => {
    const run = await settled((await upload("truncated.sql", syntheticUpstreamDump({ devices: 30, truncate: true }).sql)).id);
    truncatedId = run.id;
    expect(run).toMatchObject({ status: "failed", errorCode: "TRUNCATED_INPUT", fileRetained: true, rowsLoaded: 0 });
    expect(await rows("SELECT count(*)::int AS n FROM upstream_import.stg_users WHERE import_run_id = :id", { id: run.id })).toEqual([{ n: 0 }]);
    const retried = await asSuperAdmin(() => app.service.retryRun(run.id, actor));
    expect(retried.attempt).toBe(2);
    expect(await settled(run.id)).toMatchObject({ status: "failed", errorCode: "TRUNCATED_INPUT", attempt: 2 });
    const titles = (await rows("SELECT title FROM notifications WHERE action_url LIKE :u", { u: `%run=${run.id}` })).map((r) => r["title"]);
    expect(titles).toEqual(["SQL dump import failed", "SQL dump import failed"]);
  });

  it("the DPIA gate: a file declared real is a 403 while UPSTREAM_REAL_DATA_ALLOWED is off, and its file is deleted", async () => {
    const before = fs.existsSync(app.service.dumpDirectory()) ? fs.readdirSync(app.service.dumpDirectory()).length : 0;
    const refused = await upload("real.sql", dump.sql, "real").catch((err: unknown) => err as Error & { status?: number });
    expect((refused as { status?: number }).status).toBe(403);
    expect((refused as Error).message).toContain("UPSTREAM_REAL_DATA_ALLOWED");
    expect(fs.existsSync(written[written.length - 1] as string)).toBe(false);
    expect(fs.existsSync(app.service.dumpDirectory()) ? fs.readdirSync(app.service.dumpDirectory()).length : 0).toBe(before);
  });

  it("one active run at a time: the partial unique index refuses a second, even past the service", async () => {
    const [{ id } = {}] = await rows(
      `INSERT INTO upstream_sql_imports (id, status, data_class, compression, size_bytes, sha256, notify_tenant_id, created_at, updated_at)
       VALUES (gen_random_uuid(), 'uploaded', 'synthetic', 'none', 1, repeat('a', 64), :t, now(), now()) RETURNING id`,
      { t: TENANT },
    );
    await expect(upload("busy.sql", dump.sql)).rejects.toThrow(/Another import is in progress/);
    await expect(
      owner.db.query(
        `INSERT INTO upstream_sql_imports (id, status, data_class, compression, size_bytes, sha256, notify_tenant_id, created_at, updated_at)
         VALUES (gen_random_uuid(), 'parsing', 'synthetic', 'none', 1, repeat('b', 64), :t, now(), now())`,
        { replacements: { t: TENANT } },
      ),
    ).rejects.toMatchObject({ parent: { code: "23505" } });
    // A queued run is cancelled at once by the operator.
    const cancelled = await asSuperAdmin(() => app.service.cancelRun(String(id), actor));
    expect(cancelled).toMatchObject({ status: "cancelled", fileRetained: false });
    await expect(asSuperAdmin(() => app.service.cancelRun(String(id), actor))).rejects.toMatchObject({ status: 409 });
  });

  it("ClamAV: an infected file fails INFECTED before it is parsed, and is deleted", async () => {
    // Upload a clean dump, then — as an attacker with disk access would — swap the quarantined
    // bytes for the EICAR test file and the recorded checksum for its own (the scan, not the
    // checksum, must stop it).
    const queued = await upload("eicar.sql", `-- synthetic\n${dump.sql}`);
    const run = await settled(queued.id);
    expect(run.status).toBe("loaded");
    const id = "a2406000-0000-4000-8000-0000000000e1";
    const file = path.join(app.service.dumpDirectory(), `${id}.dump`);
    fs.writeFileSync(file, EICAR);
    written.push(file);
    await owner.db.query(
      `INSERT INTO upstream_sql_imports (id, status, data_class, compression, size_bytes, sha256, file_path, notify_tenant_id, uploaded_by, created_at, updated_at)
       VALUES (:id, 'uploaded', 'synthetic', 'none', :size, :sha, :file, :t, :u, now(), now())`,
      { replacements: { id, size: EICAR.length, sha: createHash("sha256").update(EICAR).digest("hex"), file, t: TENANT, u: actor.userId } },
    );
    const service = app.service as unknown as { runImportJob(job: { id: string }): Promise<unknown> };
    const jobId = "a2406000-0000-4000-8000-0000000000e2";
    await owner.db.query(
      "INSERT INTO batch_jobs (id, tenant_id, user_id, type, status, progress, created_at, updated_at) VALUES (:j, :p, :u, 'upstream-sql-import', 'PROCESSING', 0, now(), now())",
      { replacements: { j: jobId, p: PLATFORM, u: actor.userId } },
    );
    await expect(
      new Promise((resolve, reject) => {
        app.tenantStorage.run({ tenantId: PLATFORM, isSuperAdmin: false, isSystemTask: false }, () => {
          service.runImportJob({ id: jobId }).then(resolve, reject);
        });
      }),
    ).rejects.toThrow(/INFECTED/);
    expect(await app.service.getRun(id)).toMatchObject({ status: "failed", errorCode: "INFECTED", fileRetained: false });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("the sweep deletes a failed run's file once its retention has ended", async () => {
    const summary = await app.service.sweepUpstreamSqlImports(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
    expect(summary.purged).toBeGreaterThanOrEqual(1);
    expect(await app.service.getRun(truncatedId)).toMatchObject({ status: "failed", fileRetained: false, retryable: false });
  });

  it("a reboot applies nothing and the schema check passes; 0114 down now refuses (runs exist)", async () => {
    const again = startProcess();
    try {
      await again.migrationLock.runSchemaSetup({ sequelize: again.db, migrator: again.migrator, logger });
      expect(await again.migrator.pending()).toEqual([]);
      expect((await again.schemaVerify.verifySchema(again.db)).problems).toEqual([]);
      await expect(again.m0114.down({ context: again.db.getQueryInterface() })).rejects.toThrow(/holds import runs/);
    } finally {
      await again.db.close();
    }
    // The hash marker is nowhere in the database but nowhere at all — not even staged.
    const [hit] = await rows("SELECT count(*)::int AS n FROM upstream_import.stg_users WHERE row_to_json(stg_users)::text LIKE :m", { m: `%${SYNTHETIC_HASH_MARKER.slice(8, 30)}%` });
    expect(hit).toEqual({ n: 0 });
  });
});
