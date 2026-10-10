/**
 * P20-09 — Phase 20's migrations as an UPGRADE BOOT on PRODUCTION-SHAPED data,
 * against a real PostgreSQL 18; the result inspected in the catalogue, not in
 * the log (docs/UPSTREAM/04 § 10, P19-04 spec § 6.2 – § 6.4).
 *
 * WHY
 *
 * upgradeBoot.am3.live proves the upgrade path on a handful of rows. Phase 20
 * back-fills `client_facility_id` through five large tables, one transaction
 * each (0118 – 0123), replaces 0057's function and adds 21 migrations to a
 * database the deployed release built. Two questions are left that a handful
 * of rows cannot answer:
 *
 *  1. Does the schema step finish inside the boot's budget when the tables are
 *     production-sized? The budget is MIGRATION_LOCK_TIMEOUT_MS (600 s,
 *     ADR-086) — a second replica waiting on the schema lock refuses after it —
 *     and the Helm startup probe (72 x 10 s) is set above it. P19-04 § 6.2: if
 *     a table takes longer, this card splits that back-fill; recorded, not
 *     assumed.
 *  2. Is the upgraded database the SAME schema a fresh install builds? An
 *     upgrade reaches it through `sync` on old tables plus ALTERs; a fresh
 *     install through `sync` on today's models plus the same migrations. Any
 *     difference in a column's type, nullability or default, a constraint, an
 *     index, a trigger, a function body, an ENUM's labels or a grant to the
 *     application role is a defect one of the two paths will show in
 *     production. The comparison reads pg_catalog on both databases.
 *
 * WHAT IT DOES
 *
 *  1. Extracts the base release's backend (`git archive`, default 3e91413 —
 *     the image the reference deployment runs since 2026-10-06, last migration
 *     0110, i.e. the release right before Phase 20) and runs ITS boot schema
 *     step (models, db.sync() + migrator.up(), schema check) on a clean
 *     scratch database.
 *  2. Seeds production-shaped volume with set-based SQL — every table a Phase
 *     20 back-fill reads or writes, at about four times the upstream's expected
 *     volume (docs/UPSTREAM/05 § 7) and with a million IoT readings. Synthetic
 *     values only (`example.test`, generated serials); nothing from upstream.
 *  3. Runs the CURRENT tree's boot schema step on it, timing every migration,
 *     then a second time (applies nothing).
 *  4. Builds a FRESH database with the current tree's schema step.
 *  5. Runs `npm run migrate:verify`'s script (src/scripts/verifySchema.ts) on
 *     the upgraded database — the operator's command, exit 0.
 *  6. Inspects: every Phase 20 column, its type and nullability; the
 *     back-fills (no NULL left, every child in its device's facility, row
 *     counts unchanged); the catalogue of the upgraded database against the
 *     fresh one.
 *
 * HOW TO RUN (a disposable PostgreSQL 18 with pgvector; never a real database)
 *
 *   docker run -d --name p2009-pg18 -e POSTGRES_PASSWORD=p2009pass \
 *     -p 127.0.0.1:55221:5432 pgvector/pgvector:pg18
 *   P2009_UPGRADE_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55221 DB_NAME=p2009_scratch \
 *     DB_USER=postgres DB_PASS=p2009pass \
 *     npm test -- src/tests/migrations/upgradeBoot.p2009.live --coverage=false
 *   docker rm -f p2009-pg18
 *
 * Options:
 *  - P2009_UPGRADE_BASE — the base revision (default 3e91413; it must predate 0111).
 *  - P2009_SCALE — multiplies every volume below (default 1; 0.01 for a quick run).
 *  - P2009_REPORT — a file to write the per-migration timings and volumes to (JSON).
 *  - P2009_KEEP_WORKDIR=1 — keep the temporary directory and its logs.
 *  - P2009_PLANT — one SQL statement run on the upgraded database after the upgrade (a
 *    planted drift, e.g. `ALTER TABLE warehouses ALTER COLUMN floor SET DEFAULT 1`), to
 *    watch the catalogue comparison fail.
 *
 * DB_NAME must contain "scratch"; the fresh database is DB_NAME + "_fresh".
 * Both are dropped and recreated. Not in `npm run test:live` (it extracts an
 * older revision, as upgradeBoot.am3 does): run by hand, scripts/live-suites.ts.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { QueryTypes, Sequelize } from "sequelize";

import { env, environment } from "../../config/env";

const live = env("P2009_UPGRADE_LIVE_TEST") === "1" ? describe : describe.skip;

const BASE = env("P2009_UPGRADE_BASE") ?? "3e91413";
const REPO = path.join(__dirname, "../../../..");
const BACKEND = path.join(__dirname, "../../..");
const STEP_TIMEOUT_MS = 30 * 60 * 1000;
/** ADR-086: MIGRATION_LOCK_TIMEOUT_MS. The upgrade's schema step must finish inside it. */
const BOOT_BUDGET_MS = 600_000;
const SCALE = Number(env("P2009_SCALE") ?? "1");

jest.setTimeout(5 * STEP_TIMEOUT_MS);

/** Production-shaped volume (scale 1): about 4x docs/UPSTREAM/05 § 7's expected volumes, plus a million readings. */
const VOLUME = Object.freeze({
  tenants: Math.max(2, Math.round(120 * SCALE)),
  users: Math.max(2, Math.round(1_200 * SCALE)),
  devices: Math.max(10, Math.round(100_000 * SCALE)),
  records: Math.max(10, Math.round(200_000 * SCALE)),
  certificates: Math.max(10, Math.round(100_000 * SCALE)),
  workOrders: Math.max(10, Math.round(50_000 * SCALE)),
  readings: Math.max(10, Math.round(1_000_000 * SCALE)),
  attachments: Math.max(10, Math.round(60_000 * SCALE)),
  nonConformances: Math.max(10, Math.round(5_000 * SCALE)),
  auditLogs: Math.max(10, Math.round(330_000 * SCALE)),
});
const ROLE = "92009000-0000-4000-8000-000000000001";

/**
 * The seed, in the base schema's columns. Ids are md5-derived, so every row is
 * reproducible and every reference resolvable in SQL: tenant k (1..T), user u
 * in tenant 1 + (u-1) % T, device i in tenant 1 + (i-1) % T, warehouse w in
 * tenant 1 + (w-1) % T; a child row numbered n names device 1 + (n-1) % D and
 * that tenant's user number (its tenant index).
 */
const SEED: readonly string[] = [
  `INSERT INTO roles (id, name, created_at, updated_at) VALUES ('${ROLE}', 'P2009 ROLE', now(), now())`,
  `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
     SELECT md5('p2009-tenant-' || k)::uuid, 'P2009 Hospital ' || k, 'p2009-' || k, 'p2009-' || k || '@example.test', now(), now()
       FROM generate_series(1, :tenants) k`,
  `INSERT INTO users (id, tenant_id, role_id, username, email, password, first_name, last_name, created_at, updated_at)
     SELECT md5('p2009-user-' || u)::uuid, md5('p2009-tenant-' || (1 + (u - 1) % :tenants))::uuid, '${ROLE}',
            'p2009u' || u, 'p2009u' || u || '@example.test', 'x', 'User', 'U' || u, now(), now()
       FROM generate_series(1, :users) u`,
  `INSERT INTO warehouses (id, tenant_id, name, code, created_at, updated_at)
     SELECT md5('p2009-wh-' || w)::uuid, md5('p2009-tenant-' || (1 + (w - 1) % :tenants))::uuid, 'Store ' || w, 'W' || w, now(), now()
       FROM generate_series(1, 2 * :tenants) w`,
  `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, next_calibration_date, location_id, created_at, updated_at)
     SELECT md5('p2009-dev-' || i)::uuid, md5('p2009-tenant-' || (1 + (i - 1) % :tenants))::uuid, 'Device ' || i, 'SN-' || i,
            CASE WHEN i % 2 = 0 THEN now() + make_interval(days => i % 365) END,
            CASE WHEN i % 3 = 0 THEN md5('p2009-wh-' || (1 + (i - 1) % :tenants))::uuid END,
            now(), now()
       FROM generate_series(1, :devices) i`,
  `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, created_at, updated_at)
     SELECT md5('p2009-rec-' || r)::uuid, md5('p2009-tenant-' || (1 + ((r - 1) % :devices) % :tenants))::uuid,
            md5('p2009-dev-' || (1 + (r - 1) % :devices))::uuid, md5('p2009-user-' || (1 + ((r - 1) % :devices) % :tenants))::uuid,
            now() - make_interval(secs => r), now(), now()
       FROM generate_series(1, :records) r`,
  `INSERT INTO certificates (id, tenant_id, device_id, calibration_record_id, certificate_number, verification_token, created_at, updated_at)
     SELECT md5('p2009-cert-' || c)::uuid, md5('p2009-tenant-' || (1 + ((c - 1) % :devices) % :tenants))::uuid,
            md5('p2009-dev-' || (1 + (c - 1) % :devices))::uuid, md5('p2009-rec-' || c)::uuid,
            'P2009-' || c, substr(md5('p2009-token-' || c), 1, 32), now(), now()
       FROM generate_series(1, :certificates) c`,
  `INSERT INTO maintenance_work_orders (id, tenant_id, device_id, title, created_at, updated_at)
     SELECT md5('p2009-wo-' || o)::uuid, md5('p2009-tenant-' || (1 + ((o - 1) % :devices) % :tenants))::uuid,
            md5('p2009-dev-' || (1 + (o - 1) % :devices))::uuid, 'Work order ' || o, now(), now()
       FROM generate_series(1, :workOrders) o`,
  `INSERT INTO iot_readings (id, tenant_id, device_id, "timestamp", metrics, created_at)
     SELECT md5('p2009-read-' || n)::uuid, md5('p2009-tenant-' || (1 + ((n - 1) % :devices) % :tenants))::uuid,
            md5('p2009-dev-' || (1 + (n - 1) % :devices))::uuid, now() - make_interval(secs => n), '{"t": 21.5}'::jsonb, now()
       FROM generate_series(1, :readings) n`,
  // Five kinds in turn: four that name a facility resource (device, record, certificate, work order),
  // one that does not (a vendor document) and must stay without a facility. A work-order file past the
  // last work order names a resource that no longer exists — production holds such files (a resource
  // removed under its attachment); 0123 must keep them, in the tenant's self facility.
  `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, file_name, original_name, created_at, updated_at)
     SELECT md5('p2009-att-' || a)::uuid, md5('p2009-tenant-' || (1 + ((a - 1) % :devices) % :tenants))::uuid,
            (ARRAY['device', 'calibration', 'certificate', 'workorder', 'vendor'])[1 + a % 5],
            CASE 1 + a % 5
              WHEN 1 THEN md5('p2009-dev-' || (1 + (a - 1) % :devices))::uuid
              WHEN 2 THEN md5('p2009-rec-' || (1 + (a - 1) % :devices))::uuid
              WHEN 3 THEN md5('p2009-cert-' || (1 + (a - 1) % :devices))::uuid
              WHEN 4 THEN md5('p2009-wo-' || (1 + (a - 1) % :devices))::uuid
              ELSE md5('p2009-vendor-' || a)::uuid END,
            'f' || a || '.pdf', 'file-' || a || '.pdf', now(), now()
       FROM generate_series(1, :attachments) a`,
  `INSERT INTO non_conformances (id, tenant_id, nc_number, title, description, reported_by, device_id, date_identified, created_at, updated_at)
     SELECT md5('p2009-nc-' || k)::uuid, md5('p2009-tenant-' || (1 + ((k - 1) % :devices) % :tenants))::uuid, 'NC-' || k,
            'Finding ' || k, 'Synthetic finding', md5('p2009-user-' || (1 + ((k - 1) % :devices) % :tenants))::uuid,
            CASE WHEN k % 2 = 0 THEN md5('p2009-dev-' || (1 + (k - 1) % :devices))::uuid END, now(), now(), now()
       FROM generate_series(1, :nonConformances) k`,
  `INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, action, resource_type, resource_id, created_at)
     SELECT md5('p2009-audit-' || g)::uuid, md5('p2009-tenant-' || (1 + ((g - 1) % :devices) % :tenants))::uuid,
            md5('p2009-user-' || (1 + ((g - 1) % :devices) % :tenants))::uuid, 'user', 'UPDATE', 'CalibrationDevice',
            md5('p2009-dev-' || (1 + (g - 1) % :devices))::text, now() - make_interval(secs => g)
       FROM generate_series(1, :auditLogs) g`,
];

/** The tables the seed fills, each with its row count after the seed (checked unchanged after the upgrade). */
const COUNTED = Object.freeze([
  "tenants",
  "users",
  "warehouses",
  "calibration_devices",
  "calibration_records",
  "certificates",
  "maintenance_work_orders",
  "iot_readings",
  "attachments",
  "non_conformances",
]);

/** The boot's schema step (as upgradeBoot.am3), with every migration timed. One JSON line reports it. */
const RUNNER = `"use strict";
const path = require("path");
const r = (p) => require(path.join(process.cwd(), p));
r("src/utils/env.util");
const { db } = r("src/config");
r("src/models");
const { migrator } = r("src/config/migrator");
const { runSchemaSetup } = r("src/utils/migrationLock.util");
const { logger } = r("src/middlewares/activityLog.middleware");
const started = {};
const ms = {};
migrator.on("migrating", (e) => { started[e.name] = Date.now(); });
migrator.on("migrated", (e) => { ms[e.name] = Date.now() - started[e.name]; });
(async () => {
  const t0 = Date.now();
  const applied = await runSchemaSetup({ sequelize: db, migrator, logger });
  const setupMs = Date.now() - t0;
  const { assertSchemaMatchesModels } = r("src/utils/schemaVerify.util");
  await assertSchemaMatchesModels({ sequelize: db, logger });
  console.log("P2009_RESULT " + JSON.stringify({ applied: applied.map((m) => m.name), ms, setupMs, verify: "passed" }));
})()
  .catch((e) => {
    const sql = e.sql || (e.parent && e.parent.sql) || null;
    console.log("P2009_ERROR " + JSON.stringify({ message: String(e.message), sql }));
    process.exitCode = 1;
  })
  .finally(() => db.close());
`;

interface StepOutcome {
  applied: string[];
  ms: Record<string, number>;
  setupMs: number;
  verify: string;
}

interface StepResult {
  status: number | null;
  log: string;
  result: StepOutcome | null;
  error: { message: string; sql: string | null } | null;
}

/**
 * One catalogue snapshot: every line describes one object of the public schema
 * in a form that does not depend on the path that built it (column ORDER is
 * left out — an ALTER appends, sync follows the model).
 */
const CATALOGUE: Readonly<Record<string, string>> = Object.freeze({
  columns: `SELECT c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                   || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                   || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') AS line
              FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
              LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped`,
  constraints: `SELECT c.conrelid::regclass::text || ' ' || c.conname || ' ' || pg_get_constraintdef(c.oid) AS line
                  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
                 WHERE n.nspname = 'public' AND c.contype <> 'n'`,
  indexes: "SELECT tablename || ' ' || indexdef AS line FROM pg_indexes WHERE schemaname = 'public'",
  triggers: `SELECT c.relname || ' ' || t.tgenabled::text || ' ' || pg_get_triggerdef(t.oid) AS line
               FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND NOT t.tgisinternal`,
  functions: `SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') ' || md5(pg_get_functiondef(p.oid)) AS line
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.prokind = 'f'
                 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')`,
  enums: `SELECT t.typname || ': ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS line
            FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' GROUP BY t.typname`,
  grants: `SELECT table_name || ' ' || string_agg(privilege_type, ',' ORDER BY privilege_type) AS line
             FROM information_schema.role_table_grants
            WHERE grantee = 'callibrator_app' AND table_schema = 'public' GROUP BY table_name`,
  columnGrants: `SELECT table_name || '.' || column_name || ' ' || string_agg(privilege_type, ',' ORDER BY privilege_type) AS line
                   FROM information_schema.column_privileges
                  WHERE grantee = 'callibrator_app' AND table_schema = 'public'
                    AND (table_name, privilege_type) NOT IN (SELECT table_name, privilege_type FROM information_schema.role_table_grants
                                                              WHERE grantee = 'callibrator_app' AND table_schema = 'public')
                  GROUP BY table_name, column_name`,
});

/**
 * The one known path-dependent value: 0091's audit_logs_actor_check bounds the
 * legacy `unknown` actor by the moment it ran (`created_at <= '<now>'`), so it
 * differs between ANY two databases by design. The timestamp is masked; the
 * rest of the CHECK is compared.
 */
const normalise = (line: string): string =>
  line.startsWith("audit_logs audit_logs_actor_check ")
    ? line.replace(/'\d{4}-\d{2}-\d{2} [\d:.]+\+00'/, "'<0091 run time>'")
    : line;

/** The Phase 20 columns (P20-01 … P20-08), with the type and nullability the upgraded database must have. */
const PHASE_20_COLUMNS: readonly (readonly [table: string, column: string, type: string, nullable: "YES" | "NO"])[] = [
  ["calibration_devices", "device_type_id", "uuid", "YES"],
  ["calibration_devices", "client_facility_id", "uuid", "NO"],
  ["calibration_records", "client_facility_id", "uuid", "NO"],
  ["certificates", "client_facility_id", "uuid", "NO"],
  ["maintenance_work_orders", "client_facility_id", "uuid", "NO"],
  ["iot_readings", "client_facility_id", "uuid", "NO"],
  ["attachments", "client_facility_id", "uuid", "YES"],
  ["attachments", "rekey_pending", "boolean", "NO"],
  ["non_conformances", "client_facility_id", "uuid", "YES"],
  ["warehouses", "client_facility_id", "uuid", "YES"],
  ["users", "client_facility_id", "uuid", "YES"],
  ["users", "facility_binding_pending", "boolean", "NO"],
  ["audit_logs", "client_facility_id", "uuid", "YES"],
  ["calibration_devices", "qr_code", "character varying", "YES"],
  ["calibration_devices", "condition", "USER-DEFINED", "YES"],
  ["calibration_devices", "next_calibration_date_source", "USER-DEFINED", "YES"],
  ["calibration_records", "entry_kind", "USER-DEFINED", "NO"],
  ["warehouses", "kind", "USER-DEFINED", "NO"],
];

/** The children a facility back-fill copies from the device (0119 – 0122): none may disagree with its device. */
const DEVICE_CHILDREN = Object.freeze(["calibration_records", "certificates", "maintenance_work_orders", "iot_readings"]);

const manifest = (backendDir: string): string[] => {
  const text = fs.readFileSync(path.join(backendDir, "src/config/migrator.ts"), "utf8");
  return [...text.matchAll(/\["(\d{4}-[\w.-]+\.js)",\s*require\(/g)].map((m) => m[1] ?? "");
};

const run = (command: string, args: string[], cwd: string): void => {
  const out = spawnSync(command, args, { cwd, encoding: "utf8", timeout: STEP_TIMEOUT_MS });
  if (out.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${String(out.status)}): ${out.stderr || String(out.error)}`);
  }
};

live("P20-09 — Phase 20 as an upgrade boot on production-shaped data (PostgreSQL 18)", () => {
  const name = env("DB_NAME") ?? "";
  const freshName = `${name}_fresh`;
  let work: string;
  let baseBackend: string;
  let runner: string;
  let base: StepResult;
  let upgrade: StepResult;
  let again: StepResult;
  let fresh: StepResult;
  let verifyCli: { status: number | null; out: string };
  let seedMs = 0;
  const seededCounts: Record<string, number> = {};
  let admin: Sequelize | undefined;
  let db: Sequelize | undefined;
  let freshDb: Sequelize | undefined;

  const connect = (database: string): Sequelize =>
    new Sequelize(database, env("DB_USER") ?? "", env("DB_PASS") ?? "", {
      host: env("DB_HOST") ?? "",
      port: Number(env("DB_PORT") ?? "5432"),
      dialect: "postgres",
      logging: false,
    });

  const dbEnv = (database: string): Record<string, string> => ({
    DB_HOST: env("DB_HOST") ?? "",
    DB_PORT: env("DB_PORT") ?? "",
    DB_NAME: database,
    DB_USER: env("DB_USER") ?? "",
    DB_PASS: env("DB_PASS") ?? "",
  });

  const schemaStep = (backendDir: string, database: string, label: string): StepResult => {
    const logFile = path.join(work, `${label}.log`);
    const fd = fs.openSync(logFile, "w");
    let status: number | null;
    try {
      const out = spawnSync(process.execPath, ["--import", "tsx", runner], {
        cwd: backendDir,
        env: { ...environment(), NODE_ENV: "development", ...dbEnv(database) },
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
    const result = line("P2009_RESULT");
    const error = line("P2009_ERROR");
    return {
      status,
      log: logFile,
      result: result ? (JSON.parse(result) as StepOutcome) : null,
      error: error ? (JSON.parse(error) as StepResult["error"]) : null,
    };
  };

  const rows = <T extends object>(on: Sequelize | undefined, sql: string, replacements: Record<string, unknown> = {}): Promise<T[]> => {
    if (!on) {
      throw new Error("beforeAll did not open the database");
    }
    return on.query<T>(sql, { type: QueryTypes.SELECT, replacements });
  };

  const catalogue = async (on: Sequelize | undefined): Promise<Record<string, string[]>> => {
    const out: Record<string, string[]> = {};
    for (const [kind, sql] of Object.entries(CATALOGUE)) {
      const found = await rows<{ line: string }>(on, sql);
      out[kind] = found.map((r) => normalise(r.line)).sort();
    }
    return out;
  };

  beforeAll(async () => {
    if (!name.includes("scratch")) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    work = fs.mkdtempSync(path.join(os.tmpdir(), "p2009-upgrade-"));
    run("git", ["archive", "--format=tar", "-o", path.join(work, "base.tar"), BASE, "backend/src", "backend/package.json"], REPO);
    run("tar", ["-xf", "base.tar"], work);
    baseBackend = path.join(work, "backend");
    fs.symlinkSync(path.join(REPO, "node_modules"), path.join(work, "node_modules"), "junction");
    runner = path.join(work, "runner.cjs");
    fs.writeFileSync(runner, RUNNER);
    if (manifest(baseBackend).some((m) => m >= "0111")) {
      throw new Error(`the base ${BASE} already has Phase 20's migrations: choose a revision before 0111`);
    }

    admin = connect("postgres");
    for (const database of [name, freshName]) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${database}"`);
    }

    // 1. The base release's schema.
    base = schemaStep(baseBackend, name, "base");
    if (base.status !== 0) {
      throw new Error(`the base tree (${BASE}) did not build its schema: ${JSON.stringify(base.error)} — log ${base.log}`);
    }

    // 2. Production-shaped volume, in the base schema.
    db = connect(name);
    const t0 = Date.now();
    for (const sql of SEED) {
      await db.query(sql, { replacements: VOLUME }).catch((e: unknown) => {
        const parent = (e as { parent?: { message?: string } }).parent;
        throw new Error(`seed failed on the base schema: ${parent?.message ?? String(e)} — ${sql}`);
      });
    }
    await db.query("ANALYZE");
    seedMs = Date.now() - t0;
    for (const table of COUNTED) {
      const [count] = await rows<{ n: number }>(db, `SELECT count(*)::int AS n FROM ${table}`);
      seededCounts[table] = count?.n ?? -1;
    }

    // 3. The current tree's boot schema step on it — no manual migrate — then once more.
    upgrade = schemaStep(BACKEND, name, "upgrade");
    again = upgrade.status === 0 ? schemaStep(BACKEND, name, "again") : upgrade;
    const plant = env("P2009_PLANT");
    if (plant) {
      await db.query(plant);
    }

    // 4. A fresh install of the current tree, for the catalogue comparison.
    fresh = schemaStep(BACKEND, freshName, "fresh");
    freshDb = connect(freshName);

    // 5. The operator's command (npm run migrate:verify) on the upgraded database.
    const cli = spawnSync(process.execPath, ["--import", "tsx", "src/scripts/verifySchema.ts"], {
      cwd: BACKEND,
      env: { ...environment(), NODE_ENV: "development", ...dbEnv(name) },
      encoding: "utf8",
      timeout: STEP_TIMEOUT_MS,
    });
    verifyCli = { status: cli.status, out: `${cli.stdout}\n${cli.stderr}` };

    const report = env("P2009_REPORT");
    if (report) {
      fs.writeFileSync(
        report,
        JSON.stringify(
          { base: BASE, volume: VOLUME, seedMs, seededCounts, upgrade: upgrade.result, fresh: fresh.result, verifyCli: verifyCli.out.trim() },
          null,
          2,
        ),
      );
    }
  });

  afterAll(async () => {
    await db?.close();
    await freshDb?.close();
    if (admin) {
      for (const database of [name, freshName]) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      }
      await admin.close();
    }
    if (work && env("P2009_KEEP_WORKDIR") !== "1") {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });

  it("the base built its own schema (every migration up to 0110) and passed its schema check", () => {
    expect(base.result?.applied).toEqual(manifest(baseBackend));
    expect(base.result?.verify).toBe("passed");
  });

  it("the seed holds production-shaped volume in every table a Phase 20 back-fill touches", () => {
    expect(seededCounts).toEqual({
      tenants: VOLUME.tenants + 1, // + the platform tenant the base boot creates
      users: VOLUME.users,
      warehouses: 2 * VOLUME.tenants,
      calibration_devices: VOLUME.devices,
      calibration_records: VOLUME.records,
      certificates: VOLUME.certificates,
      maintenance_work_orders: VOLUME.workOrders,
      iot_readings: VOLUME.readings,
      attachments: VOLUME.attachments,
      non_conformances: VOLUME.nonConformances,
    });
  });

  it("the current tree upgrades it with no manual migrate: exactly 0111 onwards, in order, and the schema check passes", () => {
    expect({ status: upgrade.status, error: upgrade.error, log: upgrade.log }).toEqual({ status: 0, error: null, log: upgrade.log });
    const already = new Set(manifest(baseBackend));
    const expected = manifest(BACKEND).filter((m) => !already.has(m));
    expect(expected[0]).toBe("0111-device-types.js");
    expect(upgrade.result?.applied).toEqual(expected);
    expect(upgrade.result?.verify).toBe("passed");
  });

  it(`the upgrade's schema step finishes inside the boot budget (${String(BOOT_BUDGET_MS / 1000)} s, MIGRATION_LOCK_TIMEOUT_MS)`, () => {
    expect(upgrade.result?.setupMs).toBeLessThan(BOOT_BUDGET_MS);
    // Every applied migration was timed.
    expect(Object.keys(upgrade.result?.ms ?? {}).sort()).toEqual([...(upgrade.result?.applied ?? [])].sort());
  });

  it("a second boot applies nothing and still passes; a fresh install of the same tree passes too", () => {
    expect(again.status).toBe(0);
    expect(again.result?.applied).toEqual([]);
    expect(again.result?.verify).toBe("passed");
    expect({ status: fresh.status, error: fresh.error }).toEqual({ status: 0, error: null });
    expect(fresh.result?.applied).toEqual(manifest(BACKEND));
  });

  it("npm run migrate:verify (src/scripts/verifySchema.ts) on the upgraded database: exit 0, OK", () => {
    expect({ status: verifyCli.status, ok: /\[schema-verify\] OK: \d+ tables/.test(verifyCli.out) }).toEqual({ status: 0, ok: true });
    expect(verifyCli.out).not.toMatch(/MISMATCH/);
  });

  it("every Phase 20 column exists with its type and nullability — read from information_schema", async () => {
    const found = await rows<{ t: string; c: string; type: string; nullable: string }>(
      db,
      `SELECT table_name AS t, column_name AS c, data_type AS type, is_nullable AS nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (${PHASE_20_COLUMNS.map((_c, i) => `(:t${String(i)}, :c${String(i)})`).join(", ")})`,
      Object.fromEntries(PHASE_20_COLUMNS.flatMap(([t, c], i) => [[`t${String(i)}`, t], [`c${String(i)}`, c]])),
    );
    const key = (t: string, c: string): string => `${t}.${c}`;
    expect(Object.fromEntries(found.map((r) => [key(r.t, r.c), `${r.type} ${r.nullable}`]))).toEqual(
      Object.fromEntries(PHASE_20_COLUMNS.map(([t, c, type, nullable]) => [key(t, c), `${type} ${nullable}`])),
    );
  });

  it("the back-fills: one self facility per tenant, every device in it, no child outside its device's facility, no row lost", async () => {
    const [facilities] = await rows<{ tenants: number; selfs: number; others: number }>(
      db,
      `SELECT (SELECT count(*)::int FROM tenants) AS tenants,
              (SELECT count(*)::int FROM client_facilities WHERE is_self) AS selfs,
              (SELECT count(*)::int FROM client_facilities WHERE NOT is_self) AS others`,
    );
    expect(facilities).toEqual({ tenants: VOLUME.tenants + 1, selfs: VOLUME.tenants + 1, others: 0 });
    const [devices] = await rows<{ n: number }>(
      db,
      "SELECT count(*)::int AS n FROM calibration_devices d JOIN client_facilities f ON f.id = d.client_facility_id AND f.tenant_id = d.tenant_id AND f.is_self",
    );
    expect(devices).toEqual({ n: VOLUME.devices });
    for (const table of DEVICE_CHILDREN) {
      const [stray] = await rows<{ n: number }>(
        db,
        `SELECT count(*)::int AS n FROM ${table} x LEFT JOIN calibration_devices d ON d.id = x.device_id
          WHERE x.client_facility_id IS DISTINCT FROM d.client_facility_id`,
      );
      expect([table, stray?.n]).toEqual([table, 0]);
    }
    const [nc] = await rows<{ n: number }>(
      db,
      `SELECT count(*)::int AS n FROM non_conformances x LEFT JOIN calibration_devices d ON d.id = x.device_id
        WHERE x.client_facility_id IS DISTINCT FROM d.client_facility_id`,
    );
    expect(nc).toEqual({ n: 0 });
    const [att] = await rows<{ facility_kinds_without: number; other_with: number }>(
      db,
      `SELECT count(*) FILTER (WHERE resource_type <> 'vendor' AND client_facility_id IS NULL)::int AS facility_kinds_without,
              count(*) FILTER (WHERE resource_type = 'vendor' AND client_facility_id IS NOT NULL)::int AS other_with
         FROM attachments`,
    );
    expect(att).toEqual({ facility_kinds_without: 0, other_with: 0 });
    const [orphans] = await rows<{ n: number; outside_self: number }>(
      db,
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT f.is_self OR f.tenant_id <> a.tenant_id)::int AS outside_self
         FROM attachments a JOIN client_facilities f ON f.id = a.client_facility_id
        WHERE a.resource_type = 'workorder' AND NOT EXISTS (SELECT 1 FROM maintenance_work_orders w WHERE w.id = a.resource_id)`,
    );
    expect(orphans?.outside_self).toBe(0);
    expect(orphans?.n).toBeGreaterThan(0);
    const counts: Record<string, number> = {};
    for (const table of COUNTED) {
      const [count] = await rows<{ n: number }>(db, `SELECT count(*)::int AS n FROM ${table}`);
      counts[table] = count?.n ?? -1;
    }
    expect(counts).toEqual(seededCounts);
  });

  it("the upgraded catalogue IS the fresh install's: columns, constraints, indexes, triggers, functions, ENUMs, grants", async () => {
    const upgraded = await catalogue(db);
    const installed = await catalogue(freshDb);
    const diff: Record<string, { onlyUpgrade: string[]; onlyFresh: string[] }> = {};
    for (const kind of Object.keys(CATALOGUE)) {
      const u = new Set(upgraded[kind]);
      const f = new Set(installed[kind]);
      const onlyUpgrade = [...u].filter((l) => !f.has(l));
      const onlyFresh = [...f].filter((l) => !u.has(l));
      if (onlyUpgrade.length > 0 || onlyFresh.length > 0) {
        diff[kind] = { onlyUpgrade, onlyFresh };
      }
    }
    expect(diff).toEqual({});
    // The comparison is not vacuous.
    expect(upgraded["columns"]?.length).toBeGreaterThan(1000);
    expect(upgraded["triggers"]?.length).toBeGreaterThan(50);
  });
});
