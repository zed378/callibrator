/**
 * AM-3 against a REAL PostgreSQL 18 — an UPGRADE boot: the current tree's
 * schema step on a database the PREVIOUS release built, with no manual migrate.
 *
 * WHY
 *
 * Every other schema test starts from an EMPTY database, where `db.sync()`
 * builds each table from TODAY's models and the migrations then find their
 * work done. Production is never empty: it is a database the previous release
 * built. There `sync()` skips CREATE TABLE but still builds every model index
 * the table lacks, BEFORE the migrator runs — so a model index on a column a
 * new migration adds (0105's api_key_id) killed the boot with
 * `column "api_key_id" does not exist`, and 0105 never ran. Fresh databases
 * hid it. The static guard tests/guards/modelIndexColumns.am3.guard.test.ts
 * holds that one shape in the unit gate; THIS suite holds the whole class:
 * whatever the current tree's sync + migrations + schema check do to a
 * previous-release database, they do it here first.
 *
 * WHAT IT DOES
 *
 *  1. Extracts the previous release's backend (`git archive <base> backend/src
 *     backend/package.json`, default base ce74932 — the last deployed release,
 *     last migration 0090) into a temporary directory. Nothing is checked out.
 *  2. Drops and recreates DB_NAME (it must contain "scratch"), and runs THAT
 *     tree's boot schema step in a child process — the models barrel, then
 *     utils/migrationLock.util#runSchemaSetup (db.sync() + migrator.up(), the
 *     function backend/index.js calls) and utils/schemaVerify.util — so the
 *     database is exactly what the previous release left.
 *  3. Writes rows the previous release would hold: a tenant, role, user,
 *     device, calibration record and certificate (0096 must back-fill the
 *     certificate's token; 0105 must VALIDATE its CHECK over the record).
 *  4. Runs the CURRENT tree's same schema step against it, in a child process,
 *     with no manual migrate — and asserts it completes, applies exactly the
 *     migrations after the base's last (0091 onwards), and the schema check
 *     passes; then the 0105 and 0096 objects exist, the rows survived, and a
 *     second boot applies nothing.
 *
 * HOW TO RUN (a disposable PostgreSQL 18 with pgvector; never a real database)
 *
 *   docker run -d --name am3-pg18 -e POSTGRES_PASSWORD=am3pass \
 *     -p 127.0.0.1:55983:5432 pgvector/pgvector:pg18
 *   DB_HOST=127.0.0.1 DB_PORT=55983 DB_NAME=am3_scratch \
 *     DB_USER=postgres DB_PASS=am3pass \
 *     npm run test:live:jest -- src/tests/migrations/upgradeBoot.am3.live
 *   docker rm -f am3-pg18
 *
 * Options:
 *  - AM3_UPGRADE_BASE — the base revision (default ce74932).
 *  - AM3_BASE_NODE_MODULES — a node_modules directory for packages the base
 *    tree needs and the current tree no longer installs. ce74932 needs
 *    `cls-hooked`, `joi` and `swagger-jsdoc` (removed since that release).
 *    `npm run test:live -- --with=upgrade` installs them itself (from the
 *    base's package.json, scripts/live-suites.ts); by hand:
 *      npm install --prefix <dir> cls-hooked@^4.2.2 joi@^18.2.9 swagger-jsdoc@^6.3.0
 *      AM3_BASE_NODE_MODULES=<dir>/node_modules
 *    The base resolves every other package from the repository's node_modules.
 *
 *  - AM3_CURRENT_BACKEND — a backend directory to boot instead of this one
 *    (a scratch copy with a defect re-added, to watch this suite fail).
 *  - AM3_KEEP_WORKDIR=1 — keep the temporary directory and its logs.
 *
 * Both schema steps log every statement to files under the temporary
 * directory; a failing assertion prints where. Each run takes several minutes.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { QueryTypes, Sequelize } from "sequelize";

import { env, environment } from "../../config/env";

const BASE = env("AM3_UPGRADE_BASE") ?? "ce74932";
const REPO = path.join(__dirname, "../../../..");
/** The tree under test: this backend, unless AM3_CURRENT_BACKEND names a copy (the fail-before proof). */
const BACKEND = path.resolve(env("AM3_CURRENT_BACKEND") ?? path.join(__dirname, "../../.."));
const STEP_TIMEOUT_MS = 20 * 60 * 1000;

jest.setTimeout(3 * STEP_TIMEOUT_MS);

const TENANT = "a3a3a3a3-0000-4000-8000-000000000001";
const ROLE = "a3a3a3a3-0000-4000-8000-000000000002";
const USER = "a3a3a3a3-0000-4000-8000-000000000003";
const DEVICE = "a3a3a3a3-0000-4000-8000-000000000004";
const RECORD = "a3a3a3a3-0000-4000-8000-000000000005";
// P20-02 (0128): a device with a next calibration date and a store, as the previous release left them.
const DATED_DEVICE = "a3a3a3a3-0000-4000-8000-0000000000d2";
const STORE = "a3a3a3a3-0000-4000-8000-0000000000e1";
const CERTIFICATE = "a3a3a3a3-0000-4000-8000-000000000006";

/**
 * The boot's schema step, for the backend directory it runs in (process.cwd()):
 * the models barrel (index.js loads every model through the routes first), then
 * runSchemaSetup — db.sync() + migrator.up() under the schema lock — then the
 * schema check. One JSON line reports the outcome.
 */
const RUNNER = `"use strict";
const path = require("path");
const r = (p) => require(path.join(process.cwd(), p));
r("src/utils/env.util");
const { db } = r("src/config");
r("src/models");
const { migrator } = r("src/config/migrator");
const { runSchemaSetup } = r("src/utils/migrationLock.util");
const { logger } = r("src/middlewares/activityLog.middleware");
(async () => {
  const applied = await runSchemaSetup({ sequelize: db, migrator, logger });
  const { assertSchemaMatchesModels } = r("src/utils/schemaVerify.util");
  await assertSchemaMatchesModels({ sequelize: db, logger });
  console.log("AM3_RESULT " + JSON.stringify({ applied: applied.map((m) => m.name), verify: "passed" }));
})()
  .catch((e) => {
    const sql = e.sql || (e.parent && e.parent.sql) || null;
    console.log("AM3_ERROR " + JSON.stringify({ message: String(e.message), sql }));
    process.exitCode = 1;
  })
  .finally(() => db.close());
`;

interface StepResult {
  status: number | null;
  log: string;
  result: { applied: string[]; verify: string } | null;
  error: { message: string; sql: string | null } | null;
}

/** The manifest names a tree's config/migrator lists, in order (migrator.ts since P9-21; migrator.js in an older tree). */
const manifest = (backendDir: string): string[] => {
  const ts = path.join(backendDir, "src/config/migrator.ts");
  const text = fs.readFileSync(fs.existsSync(ts) ? ts : path.join(backendDir, "src/config/migrator.js"), "utf8");
  return [...text.matchAll(/\["(\d{4}-[\w.-]+\.js)",\s*require\(/g)].map((m) => m[1] ?? "");
};

const run = (command: string, args: string[], cwd: string): void => {
  const out = spawnSync(command, args, { cwd, encoding: "utf8", timeout: STEP_TIMEOUT_MS });
  if (out.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${String(out.status)}): ${out.stderr || String(out.error)}`);
  }
};

describe("AM-3 — the current tree boots on a database the previous release built (PostgreSQL 18)", () => {
  let work: string;
  let baseBackend: string;
  let runner: string;
  let base: StepResult;
  let upgrade: StepResult;
  let again: StepResult;
  let admin: Sequelize | undefined;
  let db: Sequelize | undefined;

  const dbEnv = (): Record<string, string> => ({
    DB_HOST: env("DB_HOST") ?? "",
    DB_PORT: env("DB_PORT") ?? "",
    DB_NAME: env("DB_NAME") ?? "",
    DB_USER: env("DB_USER") ?? "",
    DB_PASS: env("DB_PASS") ?? "",
  });

  /** The schema step of the tree in `backendDir`, as a child process, its output in `<name>.log`. */
  const schemaStep = (backendDir: string, name: string): StepResult => {
    const logFile = path.join(work, `${name}.log`);
    const fd = fs.openSync(logFile, "w");
    let status: number | null;
    try {
      const out = spawnSync(process.execPath, ["--import", "tsx", runner], {
        cwd: backendDir,
        env: { ...environment(), NODE_ENV: "development", ...dbEnv() },
        stdio: ["ignore", fd, fd],
        timeout: STEP_TIMEOUT_MS,
      });
      status = out.status;
    } finally {
      fs.closeSync(fd);
    }
    const log = fs.readFileSync(logFile, "utf8");
    const line = (tag: string): string | undefined =>
      log.split(/\r?\n/).find((l) => l.startsWith(`${tag} `))?.slice(tag.length + 1);
    const result = line("AM3_RESULT");
    const error = line("AM3_ERROR");
    return {
      status,
      log: logFile,
      result: result ? (JSON.parse(result) as StepResult["result"]) : null,
      error: error ? (JSON.parse(error) as StepResult["error"]) : null,
    };
  };

  const rows = <T extends object>(sql: string, replacements: Record<string, unknown> = {}): Promise<T[]> => {
    if (!db) {
      throw new Error("beforeAll did not open the database");
    }
    return db.query<T>(sql, { type: QueryTypes.SELECT, replacements });
  };

  beforeAll(async () => {
    const name = env("DB_NAME") ?? "";
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }

    // 1. The previous release's backend, from git — nothing checked out.
    work = fs.mkdtempSync(path.join(os.tmpdir(), "am3-upgrade-"));
    const tar = path.join(work, "base.tar");
    run("git", ["archive", "--format=tar", "-o", tar, BASE, "backend/src", "backend/package.json"], REPO);
    // Relative, in cwd: GNU tar (Git for Windows) reads "C:\..." as a remote host.
    run("tar", ["-xf", "base.tar"], work);
    baseBackend = path.join(work, "backend");
    // Packages resolve from the repository's node_modules (a junction: removing
    // the temporary directory removes the link, never its target), plus any the
    // base needs that the current tree no longer installs.
    fs.symlinkSync(path.join(REPO, "node_modules"), path.join(work, "node_modules"), "junction");
    const extra = env("AM3_BASE_NODE_MODULES");
    if (extra) {
      fs.symlinkSync(path.resolve(extra), path.join(baseBackend, "node_modules"), "junction");
    }
    runner = path.join(work, "runner.cjs");
    fs.writeFileSync(runner, RUNNER);

    // 2. A clean scratch database, built by the base's own boot schema step.
    admin = new Sequelize("postgres", env("DB_USER") ?? "", env("DB_PASS") ?? "", {
      host: env("DB_HOST") ?? "",
      port: Number(env("DB_PORT") ?? "5432"),
      dialect: "postgres",
      logging: false,
    });
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
    base = schemaStep(baseBackend, "base");
    if (base.status !== 0) {
      const missing = /Cannot find module '([^']+)'/.exec(fs.readFileSync(base.log, "utf8"))?.[1];
      throw new Error(
        `the base tree (${BASE}) did not build its schema: ${JSON.stringify(base.error)} — log ${base.log}` +
          (missing ? `. It needs '${missing}': set AM3_BASE_NODE_MODULES (see the header).` : ""),
      );
    }

    // 3. Rows the previous release would hold.
    db = new Sequelize(name, env("DB_USER") ?? "", env("DB_PASS") ?? "", {
      host: env("DB_HOST") ?? "",
      port: Number(env("DB_PORT") ?? "5432"),
      dialect: "postgres",
      logging: false,
    });
    const seed: [string, Record<string, unknown>][] = [
      [
        "INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES (:id, 'AM3 Hospital', 'am3', 'am3@example.test', now(), now())",
        { id: TENANT },
      ],
      ["INSERT INTO roles (id, name, created_at, updated_at) VALUES (:id, 'AM3 ROLE', now(), now())", { id: ROLE }],
      [
        "INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, created_at, updated_at) " +
          "VALUES (:id, :tenant, :role, 'am3user', 'am3user@example.test', 'x', 'A', 'M', now(), now())",
        { id: USER, tenant: TENANT, role: ROLE },
      ],
      [
        "INSERT INTO calibration_devices (id, tenant_id, name, created_at, updated_at) VALUES (:id, :tenant, 'AM3 device', now(), now())",
        { id: DEVICE, tenant: TENANT },
      ],
      [
        "INSERT INTO calibration_devices (id, tenant_id, name, serial_number, next_calibration_date, created_at, updated_at) " +
          "VALUES (:id, :tenant, 'AM3 dated device', 'AM3-SN-2', now() + interval '1 year', now(), now())",
        { id: DATED_DEVICE, tenant: TENANT },
      ],
      [
        "INSERT INTO warehouses (id, tenant_id, name, code, created_at, updated_at) VALUES (:id, :tenant, 'AM3 store', 'AM3-G', now(), now())",
        { id: STORE, tenant: TENANT },
      ],
      [
        "INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, created_at, updated_at) " +
          "VALUES (:id, :tenant, :device, :user, now(), now(), now())",
        { id: RECORD, tenant: TENANT, device: DEVICE, user: USER },
      ],
      [
        "INSERT INTO certificates (id, tenant_id, device_id, certificate_number, created_at, updated_at) " +
          "VALUES (:id, :tenant, :device, 'CERT-AM3-0001', now(), now())",
        { id: CERTIFICATE, tenant: TENANT, device: DEVICE },
      ],
    ];
    // A base after 0096 (AM3_UPGRADE_BASE=25521ff, P20-01/03) already requires a certificate's
    // verification token: the certificate row carries one when the column exists.
    const [tokenColumn] = await rows<{ n: number }>(
      "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'certificates' AND column_name = 'verification_token'",
    );
    if ((tokenColumn?.n ?? 0) > 0) {
      const last = seed[seed.length - 1];
      if (last) {
        seed[seed.length - 1] = [
          "INSERT INTO certificates (id, tenant_id, device_id, certificate_number, verification_token, created_at, updated_at) " +
            "VALUES (:id, :tenant, :device, 'CERT-AM3-0001', 'am3am3am3am3am3am3am3am3am3am3a3', now(), now())",
          last[1],
        ];
      }
    }
    for (const [sql, replacements] of seed) {
      await db.query(sql, { replacements }).catch((e: unknown) => {
        const parent = (e as { parent?: { message?: string } }).parent;
        throw new Error(`seed row failed on the base schema: ${parent?.message ?? String(e)} — ${sql}`);
      });
    }

    // 4. The CURRENT tree's boot schema step — no manual migrate — then once more.
    upgrade = schemaStep(BACKEND, "upgrade");
    again = upgrade.status === 0 ? schemaStep(BACKEND, "again") : upgrade;
  });

  afterAll(async () => {
    await db?.close();
    await admin?.close();
    // fs.rmSync unlinks a junction without following it (lstat), so node_modules survive.
    if (work && env("AM3_KEEP_WORKDIR") !== "1") {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("the base tree built its own schema: every one of its migrations applied, its schema check passed", () => {
    expect(base.result?.applied).toEqual(manifest(baseBackend));
    expect(base.result?.verify).toBe("passed");
  });

  it("the current tree boots on it: sync + migrator + schema check complete, with no manual migrate", () => {
    // On failure: the first statement that failed, and the log to read.
    expect({ status: upgrade.status, error: upgrade.error, log: upgrade.log }).toEqual({
      status: 0,
      error: null,
      log: upgrade.log,
    });
    expect(upgrade.result?.verify).toBe("passed");
  });

  it("applies exactly the migrations after the base's last, in order (0091 onwards for ce74932)", () => {
    const already = new Set(manifest(baseBackend));
    const expected = manifest(BACKEND).filter((n) => !already.has(n));
    expect(expected.length).toBeGreaterThan(0);
    expect(upgrade.result?.applied).toEqual(expected);
    if (BASE === "ce74932") {
      expect(expected[0]).toBe("0091-audit-logs-append-only.js");
    }
  });

  it("0105: api_key_id, its index and the VALIDATED exactly-one CHECK on all three tables", async () => {
    const tables = ["calibration_records", "stock_adjustments", "stock_transfers"];
    const columns = await rows<{ table_name: string; data_type: string }>(
      `SELECT table_name, data_type FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'api_key_id' AND table_name IN (:tables)
        ORDER BY table_name`,
      { tables },
    );
    expect(columns).toEqual(tables.map((t) => ({ table_name: t, data_type: "uuid" })));
    const indexes = await rows<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname IN (:names) ORDER BY indexname",
      { names: tables.map((t) => `${t}_api_key_id`) },
    );
    expect(indexes.map((i) => i.indexname)).toEqual(tables.map((t) => `${t}_api_key_id`));
    const checks = await rows<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
        WHERE conname IN ('calibration_records_actor_exactly_one', 'stock_adjustments_actor_exactly_one',
                          'stock_transfers_requester_exactly_one')
        ORDER BY conname`,
    );
    expect(checks).toEqual([
      { conname: "calibration_records_actor_exactly_one", convalidated: true },
      { conname: "stock_adjustments_actor_exactly_one", convalidated: true },
      { conname: "stock_transfers_requester_exactly_one", convalidated: true },
    ]);
  });

  it("0096: certificates.verification_token is NOT NULL, UNIQUE, and back-filled on the pre-existing certificate", async () => {
    const [column] = await rows<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'certificates' AND column_name = 'verification_token'`,
    );
    expect(column).toEqual({ is_nullable: "NO" });
    const [index] = await rows<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'certificates_verification_token_unique'",
    );
    expect(index?.indexdef).toMatch(/CREATE UNIQUE INDEX .*\(verification_token\)/);
    const [cert] = await rows<{ verification_token: string }>(
      "SELECT verification_token FROM certificates WHERE id = :id",
      { id: CERTIFICATE },
    );
    expect(cert?.verification_token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("the previous release's calibration record survived, still naming its user and no key", async () => {
    const [record] = await rows<{ performed_by: string; api_key_id: string | null }>(
      "SELECT performed_by, api_key_id FROM calibration_records WHERE id = :id",
      { id: RECORD },
    );
    expect(record).toEqual({ performed_by: USER, api_key_id: null });
  });

  it("P20-01 / P20-03 (0111, 0112): the catalogue's triggers ENABLE ALWAYS, the device's RESTRICT key, base checklist v1", async () => {
    const triggers = await rows<{ t: string }>(
      `SELECT c.relname || ':' || t.tgname || ':' || t.tgenabled::text AS t FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND (c.relname = 'device_types' OR c.relname LIKE 'inspection_%')
          AND c.relname NOT IN ('inspection_sessions', 'inspection_results', 'inspection_session_signatures')`, // the catalogue's, not the IPM aggregate's (0126, 0127)
    );
    expect(triggers).toHaveLength(12);
    expect(triggers.filter((r) => !r.t.endsWith(":A"))).toEqual([]);
    const [fk] = await rows<{ confdeltype: string }>(
      "SELECT confdeltype::text AS confdeltype FROM pg_constraint WHERE conname = 'calibration_devices_device_type_id_fkey'",
    );
    expect(fk).toEqual({ confdeltype: "r" });
    const [base] = await rows<{ status: string; version_number: number; published_by_system: string }>(
      "SELECT status::text AS status, version_number, published_by_system FROM inspection_template_versions WHERE id = '5eedca7a-0000-4000-8000-000000000002'",
    );
    expect(base).toEqual({ status: "published", version_number: 1, published_by_system: "system:catalogue-seed" });
    // The previous release's device survived, with no type.
    const [device] = await rows<{ device_type_id: string | null }>("SELECT device_type_id FROM calibration_devices WHERE id = :id", {
      id: DEVICE,
    });
    expect(device).toEqual({ device_type_id: null });
  });

  it("P20-07 (0117 – 0123): every tenant got its self facility; the old device, record and certificate are in it; the controls are ENABLE ALWAYS", async () => {
    const facilities = await rows<{ tenant_id: string; code: string; is_self: boolean; n: number }>(
      "SELECT tenant_id, code, is_self, count(*) OVER (PARTITION BY tenant_id)::int AS n FROM client_facilities ORDER BY tenant_id",
    );
    expect(facilities).toEqual([
      { tenant_id: "00000000-0000-4000-8000-000000000001", code: "SELF", is_self: true, n: 1 },
      { tenant_id: TENANT, code: "SELF", is_self: true, n: 1 },
    ]);
    const [own] = await rows<{ id: string }>("SELECT id FROM client_facilities WHERE tenant_id = :t", { t: TENANT });
    for (const [table, rowId] of [["calibration_devices", DEVICE], ["calibration_records", RECORD], ["certificates", CERTIFICATE]] as const) {
      const [row] = await rows<{ f: string }>(`SELECT client_facility_id AS f FROM ${table} WHERE id = :id`, { id: rowId });
      expect([table, row?.f]).toEqual([table, own?.id]);
    }
    const [user] = await rows<{ f: string | null }>("SELECT client_facility_id AS f FROM users WHERE id = :id", { id: USER });
    expect(user).toEqual({ f: null });
    const triggers = await rows<{ e: string }>(
      `SELECT t.tgenabled::text AS e FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND (t.tgname LIKE '%facilit%' OR c.relname LIKE 'client_facilit%')
          AND c.relname NOT IN ('inspection_sessions', 'inspection_results', 'inspection_session_signatures')
          AND t.tgname NOT IN ('calibration_devices_location_facility', 'warehouses_room_devices_facility')`, // 0126's are P20-04's, 0128's P20-02's — not P20-07's
    );
    expect(triggers).toHaveLength(31);
    expect(triggers.filter((r) => r.e !== "A")).toEqual([]);
    const [audit] = await rows<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_logs WHERE resource_type = 'ClientFacility' AND actor_name = 'system:client-facility-backfill'",
    );
    expect(audit).toEqual({ n: 2 });
  });

  it("P20-02 / P20-08 (0128, 0129): an existing store stays a store, an existing date is labelled 'manual', a record is a full record; nothing else is filled", async () => {
    expect(await rows("SELECT id, kind::text AS kind, floor FROM warehouses WHERE id = :id", { id: STORE })).toEqual([{ id: STORE, kind: "store", floor: null }]);
    expect(
      await rows(
        `SELECT id, next_calibration_date_source::text AS s, qr_code, "condition"::text AS c, created_by FROM calibration_devices
          WHERE id IN (:ids) ORDER BY id`,
        { ids: [DEVICE, DATED_DEVICE] },
      ),
    ).toEqual(
      [
        { id: DEVICE, s: null, qr_code: null, c: null, created_by: null },
        { id: DATED_DEVICE, s: "manual", qr_code: null, c: null, created_by: null },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    );
    expect(await rows("SELECT entry_kind::text AS k, performer_snapshot FROM calibration_records WHERE id = :id", { id: RECORD })).toEqual([
      { k: "full_record", performer_snapshot: null },
    ]);
    expect(await rows("SELECT count(*)::int AS n FROM attachments WHERE purpose IS NOT NULL")).toEqual([{ n: 0 }]);
  });

  it("a second boot on the upgraded database applies nothing and still passes the schema check", () => {
    expect(again.status).toBe(0);
    expect(again.result).toEqual({ applied: [], verify: "passed" });
  });
});
