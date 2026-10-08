/**
 * The live database suites, every one, against a REAL PostgreSQL (2026-10-08, A-367).
 *
 *   npm run test:live                    every PostgreSQL-only suite
 *   npm run test:live -- --with=mqtt     also the suites that need an MQTT broker
 *   npm run test:live -- --only=p6,dbA   only the suites whose id or file contains one of these
 *   npm run test:live -- --list          print the manifest and exit
 *
 * WHY. `*.live.test.*` suites are opt-in (each behind its own `*_LIVE_TEST=1`) and need a
 * database, so `npm test` and CI's unit job skip every one of them. Four of them were found
 * failing on 2026-10-08 — one for 26 of its 26 cases since 0110 (2026-10-05) — and nobody had
 * noticed (MEMORY/records/2026-10-08-live-suites-repair.md). This runner is what CI's `live-db`
 * job runs, so a suite that breaks fails a push instead of waiting for the next person to run it.
 *
 * HOW. For each suite of the manifest, in order, one at a time: create a FRESH database whose
 * name satisfies the suite's guard (it contains "scratch"), set the suite's opt-in variable and
 * DB_NAME, run jest on that one file (no coverage), then drop the database `WITH (FORCE)`. A suite
 * that makes its own database (fixtures/disposableDatabase.ts) is run with DB_NAME pointing at the
 * maintenance database and creates and drops its own. Exit status 1 if any suite failed.
 *
 * Needs DB_HOST, DB_PORT, DB_USER (a role with CREATEDB and CREATEROLE — the compose owner, or a
 * superuser: migration 0057 creates `callibrator_app`) and DB_PASS. The maintenance database is
 * DB_ADMIN_DATABASE or `postgres`. MQTT suites read MQTT_LIVE_HOST / MQTT_LIVE_PORT.
 *
 * NOT here, each with its reason (run them by hand, as their headers say):
 *  - upgradeBoot.am3 — checks out and installs an older revision (git worktree + npm ci);
 *  - rabbitmq.w06 — stops and starts a named broker container;
 *  - storage.s3.u09 — needs an S3 endpoint and keys;
 *  - socket.redisAdapter, rateLimiter.redis, rateLimiter.fixedWindow.am5 — Redis, not a database.
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { Sequelize } from "sequelize";

import { env, envOr, environment } from "../src/config/env";

type Need = "mqtt";

interface Suite {
  /** A short id: the runner's database is `live_<id>_scratch`. */
  readonly id: string;
  /** Relative to backend/. */
  readonly file: string;
  /** The opt-in variables (and any the suite needs set). */
  readonly env: Readonly<Record<string, string>>;
  /** `scratch`: the runner creates the database; `own`: the suite does (disposableDatabase). */
  readonly db: "scratch" | "own";
  readonly needs?: readonly Need[];
}

const DATA = { DATA_PG_LIVE_TEST: "1" } as const;

/** Every live suite this runner runs. A new `*.live.test.*` is added here or to the header's list. */
export const SUITES: readonly Suite[] = Object.freeze([
  { id: "p6", file: "src/tests/services/dataIntegrity.p6.live.test.js", env: DATA, db: "scratch" },
  { id: "p613", file: "src/tests/migrations/0090-webhook-secret-rotation-overlap.p613.live.test.js", env: DATA, db: "scratch" },
  { id: "dba", file: "src/tests/migrations/dataIdentity.dbA.live.test.js", env: DATA, db: "scratch" },
  { id: "dbb", file: "src/tests/services/dataLayer.dbB.live.test.js", env: DATA, db: "scratch" },
  { id: "dbc", file: "src/tests/services/dataLayer.dbC.live.test.js", env: { ...DATA, DB_APP_ROLE: "callibrator_app" }, db: "scratch" },
  { id: "dbd", file: "src/tests/services/dataLayer.dbD.live.test.js", env: { ...DATA, DB_APP_ROLE: "dbd_fresh_app" }, db: "scratch" },
  { id: "a215", file: "src/tests/services/authCards.a215.live.test.js", env: DATA, db: "scratch" },
  { id: "s08", file: "src/tests/services/keyRotation.s08.live.test.js", env: DATA, db: "scratch" },
  { id: "s20", file: "src/tests/services/secretsAtRest.s20.live.test.js", env: { ...DATA, DB_APP_ROLE: "callibrator_app" }, db: "scratch" },
  { id: "p918kr", file: "src/tests/services/keyRotation.predicates.p918.live.test.ts", env: DATA, db: "own" },
  { id: "q51", file: "src/tests/migrations/apiKeyActor.q51.live.test.ts", env: { Q51_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "p2007", file: "src/tests/migrations/clientFacilities.p2007.live.test.ts", env: { P2007_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "p2007move", file: "src/tests/migrations/deviceMove.p2007.live.test.ts", env: { P2007_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "p2003", file: "src/tests/migrations/inspectionCatalogue.p2003.live.test.ts", env: { P2003_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "uifix", file: "src/tests/migrations/uiCorrectness.adr101adr102.live.test.ts", env: { UIFIX_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "p1005", file: "src/tests/services/accessRequest.p1005.live.test.ts", env: { P1005_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "p918att", file: "src/tests/services/attachmentService.p918.live.test.ts", env: { P918_ATT_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "p918", file: "src/tests/services/auditService.p918.live.test.ts", env: { P918_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "p918seed", file: "src/tests/services/migrationService.p918.live.test.ts", env: { P918_SEED_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "q34u", file: "src/tests/services/auditLogAppendOnly.q34.live.test.ts", env: { Q34_PG_LIVE_TEST: "1", Q34_MODE: "upgrade" }, db: "scratch" },
  { id: "q34f", file: "src/tests/services/auditLogAppendOnly.q34.live.test.ts", env: { Q34_PG_LIVE_TEST: "1", Q34_MODE: "fresh" }, db: "scratch" },
  { id: "p611", file: "src/tests/services/auditRollback.p611.live.test.ts", env: { P611_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "q84", file: "src/tests/services/calibrationDevice.retired.q02.live.test.js", env: { Q84_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "p804", file: "src/tests/services/queryCount.p804.live.test.ts", env: { P804_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "w34", file: "src/tests/services/tenantHookless.w34.live.test.js", env: { W34_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "p2406", file: "src/tests/services/upstreamSqlImport.p2406.live.test.ts", env: { P2406_PG_LIVE_TEST: "1" }, db: "scratch" },
  { id: "p803", file: "src/tests/utils/migrationLock.p803.live.test.js", env: { MIGRATION_LOCK_LIVE_TEST: "1" }, db: "scratch" },
  { id: "w03", file: "src/tests/services/calibrationScheduler.w03.live.test.js", env: { CALIBRATION_PG_LIVE_TEST: "1" }, db: "own" },
  { id: "w07", file: "src/tests/services/batchJob.w07.live.test.js", env: { BATCHJOB_PG_LIVE_TEST: "1" }, db: "own" },
  { id: "w12", file: "src/tests/services/backgroundJobs.w12.live.test.js", env: { BACKGROUND_JOBS_PG_LIVE_TEST: "1" }, db: "own" },
  { id: "w15", file: "src/tests/services/retentionExports.w15w16.live.test.js", env: { W15W16_PG_LIVE_TEST: "1" }, db: "own" },
  { id: "w17", file: "src/tests/services/calibrationScheduler.batch.w17.live.test.js", env: { CALIBRATION_BATCH_PG_LIVE_TEST: "1" }, db: "own" },
  { id: "w20", file: "src/tests/services/tenantHardDelete.w20.live.test.js", env: { W20_PG_LIVE_TEST: "1" }, db: "own" },
  { id: "w33", file: "src/tests/services/bulkDestroyRoutes.w33.live.test.js", env: { W33_PG_LIVE_TEST: "1" }, db: "own" },
  { id: "a10", file: "src/tests/services/webhook.durable.a10.live.test.js", env: { WEBHOOK_PG_LIVE_TEST: "1" }, db: "own" },
  { id: "w14", file: "src/tests/services/iot.sharedSubscription.w14.live.test.js", env: { W14_MQTT_LIVE_TEST: "1" }, db: "own", needs: ["mqtt"] },
]);

/** The live suites deliberately left to a by-hand run (the header says why). */
export const NOT_RUN: readonly string[] = Object.freeze([
  "src/tests/migrations/upgradeBoot.am3.live.test.ts",
  "src/tests/services/rabbitmq.w06.live.test.js",
  "src/tests/services/storage.s3.u09.live.test.ts",
  "src/tests/config/socket.redisAdapter.live.test.js",
  "src/tests/services/rateLimiter.redis.live.test.js",
  "src/tests/services/rateLimiter.fixedWindow.am5.live.test.ts",
]);

const BACKEND = path.resolve(__dirname, "..");
const JEST = path.resolve(BACKEND, "..", "node_modules", "jest", "bin", "jest.js");

const required = (name: string): string => {
  const value = env(name);
  if (value === undefined || value === "") {
    throw new Error(`live-suites: ${name} is not set`);
  }
  return value;
};

/** Run one statement on the maintenance database. */
const maintenance = async (statement: string): Promise<void> => {
  const db = new Sequelize(envOr("DB_ADMIN_DATABASE", "postgres"), required("DB_USER"), required("DB_PASS"), {
    host: required("DB_HOST"),
    port: Number(required("DB_PORT")),
    dialect: "postgres",
    logging: false,
  });
  try {
    // eslint-disable-next-line no-restricted-syntax -- DDL on the maintenance database (CREATE/DROP DATABASE): no tenant, and an identifier cannot be bound; the name is `live_<manifest id>_scratch`, ids held to [a-z0-9] by liveSuites.a367.guard
    await db.query(statement);
  } finally {
    await db.close();
  }
};

/** `--name=a,b` → ["a", "b"]; absent → null. */
const listArg = (args: readonly string[], name: string): string[] | null => {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3).split(",").filter((s) => s !== "") : null;
};

interface Outcome {
  readonly id: string;
  readonly passed: boolean;
  readonly seconds: number;
}

const runSuite = async (suite: Suite): Promise<Outcome> => {
  const started = Date.now();
  const dbName = `live_${suite.id}_scratch`;
  if (suite.db === "scratch") {
    await maintenance(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance(`CREATE DATABASE "${dbName}"`);
  }
  process.stdout.write(`\n=== ${suite.id}: ${suite.file}\n`);
  const result = spawnSync(
    process.execPath,
    ["--experimental-vm-modules", "--disable-warning=ExperimentalWarning", JEST, "--forceExit", "--ci", "--coverage=false", suite.file],
    {
      cwd: BACKEND,
      stdio: "inherit",
      env: {
        ...environment(),
        ...suite.env,
        DB_NAME: suite.db === "scratch" ? dbName : envOr("DB_ADMIN_DATABASE", "postgres"),
      },
    },
  );
  if (suite.db === "scratch") {
    await maintenance(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  }
  return { id: suite.id, passed: result.status === 0, seconds: Math.round((Date.now() - started) / 1000) };
};

const main = async (): Promise<number> => {
  const args = process.argv.slice(2);
  const only = listArg(args, "only");
  const withNeeds = new Set(listArg(args, "with") ?? []);
  const selected = SUITES.filter(
    (s) =>
      (s.needs ?? []).every((n) => withNeeds.has(n)) &&
      (only === null || only.some((o) => s.id === o || s.file.includes(o))),
  );
  if (args.includes("--list")) {
    for (const s of SUITES) {
      process.stdout.write(`${s.id.padEnd(10)} ${s.db.padEnd(8)} ${(s.needs ?? []).join(",").padEnd(5)} ${s.file}\n`);
    }
    return 0;
  }
  if (selected.length === 0) {
    process.stderr.write("live-suites: no suite selected\n");
    return 1;
  }
  const outcomes: Outcome[] = [];
  for (const suite of selected) {
    outcomes.push(await runSuite(suite));
  }
  process.stdout.write("\nlive suites:\n");
  for (const o of outcomes) {
    process.stdout.write(`  ${o.passed ? "PASS" : "FAIL"}  ${o.id.padEnd(10)} ${String(o.seconds)} s\n`);
  }
  const failed = outcomes.filter((o) => !o.passed);
  process.stdout.write(`${String(outcomes.length - failed.length)} of ${String(outcomes.length)} suites passed\n`);
  return failed.length === 0 ? 0 : 1;
};

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`live-suites: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
