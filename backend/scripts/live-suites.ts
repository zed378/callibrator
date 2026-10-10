/**
 * The live suites, every one, against REAL services (2026-10-08, A-367; no skips since 2026-10-10).
 *
 *   npm run test:live                          every suite that needs only PostgreSQL
 *   npm run test:live -- --with=mqtt,redis     also the suites that need those services
 *   npm run test:live -- --with=all            every suite (mqtt, redis, rabbitmq, s3, clamav, upgrade)
 *   npm run test:live -- --only=p6,dbA         only the suites whose id or file contains one of these
 *   npm run test:live -- --list                print the manifest and exit
 *   npm run test:live:jest -- <file>           one live file by hand (jest.live.config.js), no runner
 *
 * WHY. `*.live.test.*` suites need a database or a broker. They used to gate themselves
 * (`X_LIVE_TEST=1 ? describe : describe.skip`), so `npm test` reported ~50 of them as SKIPPED and
 * four rotted unnoticed (MEMORY/records/2026-10-08-live-suites-repair.md). Since 2026-10-10
 * (MEMORY/records/2026-10-10-no-skip-live-suites.md) there are no gates: the unit configuration
 * never loads a live suite, jest.live.config.js loads only them, and a live suite RUNS and FAILS
 * when its service is missing. This runner is what CI's `live-db` job runs.
 *
 * HOW. For each selected suite, in order, one at a time: create a FRESH database whose name
 * satisfies the suite's guard (`live_<id>_scratch`), run jest (jest.live.config.js) on that one
 * file with DB_NAME and the suite's service variables set, then drop the database `WITH (FORCE)`.
 * A suite that makes its own database (fixtures/disposableDatabase.ts) gets DB_NAME = the
 * maintenance database; a suite that needs no database (Redis, RabbitMQ, S3) gets none. A suite
 * FAILS here if any of its tests is skipped or todo, or if it ran no test at all.
 *
 * A suite whose service is not in `--with=` is NOT SELECTED, and the summary names every one, so
 * a partial run is never mistaken for a full one. The exit status is 1 if any selected suite failed.
 *
 * Needs DB_HOST, DB_PORT, DB_USER (a role with CREATEDB and CREATEROLE — the compose owner, or a
 * superuser: migration 0057 creates `callibrator_app`) and DB_PASS. The maintenance database is
 * DB_ADMIN_DATABASE or `postgres`. Each service reads its own variables (SERVICES below); the
 * runner refuses to start, naming them, when one is missing.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Sequelize } from "sequelize";

import { env, envOr, environment } from "../src/config/env";

export type Need = "mqtt" | "redis" | "rabbitmq" | "s3" | "clamav" | "upgrade";

interface Service {
  /** The variables the runner requires before it runs a suite that needs this service. */
  readonly required: readonly string[];
  /** The variables the suite sees, from the runner's environment (required ones included). */
  readonly map: (vars: NodeJS.ProcessEnv) => Readonly<Record<string, string>>;
  readonly what: string;
}

/** The named variables that are set (an unset optional one stays unset, so the suite's default applies). */
const pass = (vars: NodeJS.ProcessEnv, names: readonly string[]): Record<string, string> =>
  Object.fromEntries(names.flatMap((n) => (vars[n] === undefined ? [] : [[n, vars[n]]])));

/** Every service a live suite may need, with the variables that reach it. */
export const SERVICES: Readonly<Record<Need, Service>> = Object.freeze({
  mqtt: {
    required: ["MQTT_LIVE_HOST", "MQTT_LIVE_PORT"],
    map: (v) => pass(v, ["MQTT_LIVE_HOST", "MQTT_LIVE_PORT"]),
    what: "an MQTT broker (eclipse-mosquitto:2 -c /mosquitto-no-auth.conf)",
  },
  redis: {
    required: ["REDIS_LIVE_URL"],
    map: (v) => ({ REDIS_URL: v["REDIS_LIVE_URL"] ?? "" }),
    what: "a throwaway Redis (redis:7-alpine)",
  },
  rabbitmq: {
    required: ["RABBITMQ_LIVE_URL", "RABBITMQ_LIVE_CONTAINER"],
    map: (v) => ({ RABBITMQ_URL: v["RABBITMQ_LIVE_URL"] ?? "", RABBITMQ_LIVE_CONTAINER: v["RABBITMQ_LIVE_CONTAINER"] ?? "" }),
    what: "a throwaway RabbitMQ container the suite may restart (rabbitmq:4-alpine)",
  },
  s3: {
    required: ["S3_LIVE_ENDPOINT", "S3_LIVE_ACCESS_KEY", "S3_LIVE_SECRET_KEY", "S3_LIVE_DEV_HOST"],
    map: (v) => pass(v, ["S3_LIVE_ENDPOINT", "S3_LIVE_ACCESS_KEY", "S3_LIVE_SECRET_KEY", "S3_LIVE_DEV_HOST", "S3_LIVE_REGION"]),
    what: "an S3-compatible server (chrislusf/seaweedfs) and a host name resolving to a private address that reaches it",
  },
  clamav: {
    required: ["CLAMAV_LIVE_HOST", "CLAMAV_LIVE_PORT"],
    map: (v) => pass(v, ["CLAMAV_LIVE_HOST", "CLAMAV_LIVE_PORT"]),
    what: "a ClamAV daemon (clamav/clamav:stable)",
  },
  upgrade: {
    required: [],
    map: (v) => ({ AM3_BASE_NODE_MODULES: v["AM3_BASE_NODE_MODULES"] ?? "" }),
    what: "git, tar and an older revision's boot (several minutes; AM3_BASE_NODE_MODULES is provisioned when unset)",
  },
});

interface Suite {
  /** A short id: the runner's database is `live_<id>_scratch`. */
  readonly id: string;
  /** Relative to backend/. */
  readonly file: string;
  /** Extra variables the suite reads (a mode, an application role) — never an opt-in flag. */
  readonly env?: Readonly<Record<string, string>>;
  /** `scratch`: the runner creates the database; `own`: the suite does (disposableDatabase); `none`: no database. */
  readonly db: "scratch" | "own" | "none";
  readonly needs?: readonly Need[];
}

/** Every live suite. A new `*.live.test.*` is added here (liveSuites.a367.guard fails otherwise). */
export const SUITES: readonly Suite[] = Object.freeze([
  { id: "p6", file: "src/tests/services/dataIntegrity.p6.live.test.js", db: "scratch" },
  { id: "p613", file: "src/tests/migrations/0090-webhook-secret-rotation-overlap.p613.live.test.js", db: "scratch" },
  { id: "dba", file: "src/tests/migrations/dataIdentity.dbA.live.test.js", db: "scratch" },
  { id: "dbb", file: "src/tests/services/dataLayer.dbB.live.test.js", db: "scratch" },
  { id: "dbc", file: "src/tests/services/dataLayer.dbC.live.test.js", env: { DB_APP_ROLE: "callibrator_app" }, db: "scratch" },
  { id: "dbd", file: "src/tests/services/dataLayer.dbD.live.test.js", env: { DB_APP_ROLE: "dbd_fresh_app" }, db: "scratch" },
  { id: "a215", file: "src/tests/services/authCards.a215.live.test.js", db: "scratch" },
  { id: "s08", file: "src/tests/services/keyRotation.s08.live.test.js", db: "scratch" },
  { id: "s20", file: "src/tests/services/secretsAtRest.s20.live.test.js", env: { DB_APP_ROLE: "callibrator_app" }, db: "scratch" },
  { id: "p918kr", file: "src/tests/services/keyRotation.predicates.p918.live.test.ts", db: "own" },
  { id: "q51", file: "src/tests/migrations/apiKeyActor.q51.live.test.ts", db: "scratch" },
  { id: "p2007", file: "src/tests/migrations/clientFacilities.p2007.live.test.ts", db: "scratch" },
  { id: "p2007move", file: "src/tests/migrations/deviceMove.p2007.live.test.ts", db: "scratch" },
  { id: "p2006", file: "src/tests/migrations/menuGrants.p2006.live.test.ts", db: "scratch" },
  { id: "p2003", file: "src/tests/migrations/inspectionCatalogue.p2003.live.test.ts", db: "scratch" },
  { id: "p2101", file: "src/tests/migrations/inspectionCatalogue.p2101.live.test.ts", db: "scratch" },
  { id: "p2004", file: "src/tests/migrations/inspectionSessions.p2004.live.test.ts", db: "scratch" },
  { id: "p2005", file: "src/tests/migrations/inspectionImmutable.p2005.live.test.ts", db: "scratch" },
  { id: "p2103", file: "src/tests/services/ipmSessions.p2103.live.test.ts", db: "scratch" },
  { id: "p2104", file: "src/tests/services/ipmSubmit.p2104.live.test.ts", db: "scratch" },
  { id: "p2002", file: "src/tests/migrations/deviceExtensions.p2002.live.test.ts", db: "scratch" },
  { id: "p2105", file: "src/tests/services/deviceRegister.p2105.live.test.ts", db: "scratch" },
  { id: "p2102b", file: "src/tests/services/devicePhoto.p2102b.live.test.ts", db: "scratch" },
  { id: "p2106", file: "src/tests/services/calibrationRecap.p2106.live.test.ts", db: "scratch" },
  { id: "p2107", file: "src/tests/services/dashboard.twoFacility.p2107.live.test.ts", db: "scratch" },
  { id: "uifix", file: "src/tests/migrations/uiCorrectness.adr101adr102.live.test.ts", db: "scratch" },
  { id: "p1005", file: "src/tests/services/accessRequest.p1005.live.test.ts", db: "scratch" },
  { id: "p918att", file: "src/tests/services/attachmentService.p918.live.test.ts", db: "scratch" },
  { id: "p918", file: "src/tests/services/auditService.p918.live.test.ts", db: "scratch" },
  { id: "p918seed", file: "src/tests/services/migrationService.p918.live.test.ts", db: "scratch" },
  { id: "q34u", file: "src/tests/services/auditLogAppendOnly.q34.live.test.ts", env: { Q34_MODE: "upgrade" }, db: "scratch" },
  { id: "q34f", file: "src/tests/services/auditLogAppendOnly.q34.live.test.ts", env: { Q34_MODE: "fresh" }, db: "scratch" },
  { id: "p611", file: "src/tests/services/auditRollback.p611.live.test.ts", db: "scratch" },
  { id: "q84", file: "src/tests/services/calibrationDevice.retired.q02.live.test.js", db: "scratch" },
  { id: "p804", file: "src/tests/services/queryCount.p804.live.test.ts", db: "scratch" },
  { id: "w34", file: "src/tests/services/tenantHookless.w34.live.test.js", db: "scratch" },
  { id: "p2401", file: "src/tests/migrations/upstreamImportGrants.p2401.live.test.ts", db: "scratch" },
  { id: "p803", file: "src/tests/utils/migrationLock.p803.live.test.js", db: "scratch" },
  { id: "w03", file: "src/tests/services/calibrationScheduler.w03.live.test.js", db: "own" },
  { id: "w07", file: "src/tests/services/batchJob.w07.live.test.js", db: "own" },
  { id: "w12", file: "src/tests/services/backgroundJobs.w12.live.test.js", db: "own" },
  { id: "w15", file: "src/tests/services/retentionExports.w15w16.live.test.js", db: "own" },
  { id: "w17", file: "src/tests/services/calibrationScheduler.batch.w17.live.test.js", db: "own" },
  { id: "w20", file: "src/tests/services/tenantHardDelete.w20.live.test.js", db: "own" },
  { id: "w33", file: "src/tests/services/bulkDestroyRoutes.w33.live.test.js", db: "own" },
  { id: "a10", file: "src/tests/services/webhook.durable.a10.live.test.js", db: "own" },
  { id: "w14", file: "src/tests/services/iot.sharedSubscription.w14.live.test.js", db: "own", needs: ["mqtt"] },
  { id: "p2406", file: "src/tests/services/upstreamSqlImport.p2406.live.test.ts", db: "scratch", needs: ["clamav"] },
  { id: "a30", file: "src/tests/services/rateLimiter.redis.live.test.js", db: "none", needs: ["redis"] },
  { id: "a54", file: "src/tests/config/socket.redisAdapter.live.test.js", db: "none", needs: ["redis"] },
  { id: "am5", file: "src/tests/services/rateLimiter.fixedWindow.am5.live.test.ts", db: "none", needs: ["redis"] },
  { id: "w06", file: "src/tests/services/rabbitmq.w06.live.test.js", db: "none", needs: ["rabbitmq"] },
  { id: "u09", file: "src/tests/services/storage.s3.u09.live.test.ts", db: "none", needs: ["s3"] },
  { id: "am3", file: "src/tests/migrations/upgradeBoot.am3.live.test.ts", db: "scratch", needs: ["upgrade"] },
  { id: "p2009", file: "src/tests/migrations/upgradeBoot.p2009.live.test.ts", db: "scratch", needs: ["upgrade"] },
]);

const BACKEND = path.resolve(__dirname, "..");
const JEST = path.resolve(BACKEND, "..", "node_modules", "jest", "bin", "jest.js");
const LIVE_CONFIG = path.join(BACKEND, "jest.live.config.js");
/** upgradeBoot.am3's base revision (its own default; AM3_UPGRADE_BASE overrides both). */
const AM3_DEFAULT_BASE = "ce74932";
const REPO = path.resolve(BACKEND, "..");

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

/** `--with=` → the services; `all` names every one; an unknown name is refused. */
export const parseWith = (values: readonly string[] | null): Set<Need> => {
  const known = Object.keys(SERVICES) as Need[];
  const out = new Set<Need>();
  for (const v of values ?? []) {
    if (v === "all") {
      known.forEach((k) => out.add(k));
    } else if ((known as string[]).includes(v)) {
      out.add(v as Need);
    } else {
      throw new Error(`live-suites: unknown --with=${v} (known: ${known.join(", ")}, all)`);
    }
  }
  return out;
};

/**
 * The base's runtime dependencies that the repository's node_modules no longer holds, as `name@range`
 * from the base's own backend/package.json (for ce74932: cls-hooked, joi and swagger-jsdoc).
 */
export const missingBasePackages = (baseRevision: string): string[] => {
  const shown = spawnSync("git", ["show", `${baseRevision}:backend/package.json`], { cwd: REPO, encoding: "utf8" });
  if (shown.status !== 0) {
    throw new Error(`live-suites: git show ${baseRevision}:backend/package.json failed (a shallow clone? fetch the history): ${shown.stderr}`);
  }
  const deps = (JSON.parse(shown.stdout) as { dependencies?: Record<string, string> }).dependencies ?? {};
  const present = (name: string): boolean =>
    [path.join(REPO, "node_modules"), path.join(BACKEND, "node_modules")].some((d) => fs.existsSync(path.join(d, name, "package.json")));
  return Object.entries(deps)
    .filter(([name]) => !present(name))
    .map(([name, range]) => `${name}@${range}`)
    .sort();
};

/** upgradeBoot.am3's base needs packages the current tree dropped: install them once, outside the repository. */
const provisionAm3Modules = (): string => {
  const given = env("AM3_BASE_NODE_MODULES");
  if (given !== undefined && given !== "") {
    return given;
  }
  const packages = missingBasePackages(envOr("AM3_UPGRADE_BASE", AM3_DEFAULT_BASE));
  const dir = path.join(os.tmpdir(), "callibrator-live-am3-base");
  const modules = path.join(dir, "node_modules");
  const missing = packages.filter((p) => !fs.existsSync(path.join(modules, p.slice(0, p.lastIndexOf("@")), "package.json")));
  if (missing.length > 0) {
    fs.mkdirSync(dir, { recursive: true });
    process.stdout.write(`live-suites: installing ${missing.join(" ")} into ${dir} for upgradeBoot.am3's base\n`);
    const npm = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--prefix", dir, "--no-audit", "--no-fund", ...missing], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (npm.status !== 0) {
      throw new Error(`live-suites: npm install of ${missing.join(" ")} failed; set AM3_BASE_NODE_MODULES`);
    }
  }
  return modules;
};

interface JestCounts {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

interface Outcome {
  readonly id: string;
  readonly passed: boolean;
  readonly seconds: number;
  readonly counts: JestCounts | null;
}

const readCounts = (file: string): JestCounts | null => {
  if (!fs.existsSync(file)) {
    return null;
  }
  const json = JSON.parse(fs.readFileSync(file, "utf8")) as {
    numPassedTests: number;
    numFailedTests: number;
    numPendingTests: number;
    numTodoTests: number;
  };
  return { passed: json.numPassedTests, failed: json.numFailedTests, skipped: json.numPendingTests + json.numTodoTests };
};

const runSuite = async (suite: Suite, serviceEnv: Readonly<Record<string, string>>): Promise<Outcome> => {
  const started = Date.now();
  const dbName = `live_${suite.id}_scratch`;
  if (suite.db === "scratch") {
    await maintenance(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance(`CREATE DATABASE "${dbName}"`);
  }
  process.stdout.write(`\n=== ${suite.id}: ${suite.file}\n`);
  const report = path.join(os.tmpdir(), `callibrator-live-${suite.id}-${String(process.pid)}.json`);
  fs.rmSync(report, { force: true });
  const dbEnv: Record<string, string> =
    suite.db === "scratch" ? { DB_NAME: dbName } : suite.db === "own" ? { DB_NAME: envOr("DB_ADMIN_DATABASE", "postgres") } : {};
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-vm-modules",
      "--disable-warning=ExperimentalWarning",
      JEST,
      "--config",
      LIVE_CONFIG,
      "--forceExit",
      "--ci",
      "--json",
      "--outputFile",
      report,
      suite.file,
    ],
    {
      cwd: BACKEND,
      stdio: "inherit",
      env: { ...environment(), ...serviceEnv, ...(suite.env ?? {}), ...dbEnv },
    },
  );
  if (suite.db === "scratch") {
    await maintenance(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  }
  const counts = readCounts(report);
  fs.rmSync(report, { force: true });
  // Never a skip: a skipped or todo test, or a suite that ran nothing, fails the suite.
  const passed = result.status === 0 && counts !== null && counts.skipped === 0 && counts.passed > 0;
  return { id: suite.id, passed, seconds: Math.round((Date.now() - started) / 1000), counts };
};

const main = async (): Promise<number> => {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    for (const s of SUITES) {
      process.stdout.write(`${s.id.padEnd(10)} ${s.db.padEnd(8)} ${(s.needs ?? []).join(",").padEnd(9)} ${s.file}\n`);
    }
    return 0;
  }
  const only = listArg(args, "only");
  const withNeeds = parseWith(listArg(args, "with"));
  const matches = (s: Suite): boolean => only === null || only.some((o) => s.id === o || s.file.includes(o));
  const selected = SUITES.filter((s) => matches(s) && (s.needs ?? []).every((n) => withNeeds.has(n)));
  const unselected = SUITES.filter((s) => matches(s) && !(s.needs ?? []).every((n) => withNeeds.has(n)));
  if (selected.length === 0) {
    process.stderr.write("live-suites: no suite selected\n");
    return 1;
  }
  // Every variable the selected suites' services need, checked before anything runs.
  const needed = new Set(selected.flatMap((s) => s.needs ?? []));
  const missing = [...needed].flatMap((n) => SERVICES[n].required.filter((v) => (env(v) ?? "") === "").map((v) => `${v} (${n})`));
  if (missing.length > 0) {
    throw new Error(`live-suites: not set: ${missing.join(", ")}`);
  }
  const vars = environment();
  if (needed.has("upgrade")) {
    vars["AM3_BASE_NODE_MODULES"] = provisionAm3Modules();
  }
  const outcomes: Outcome[] = [];
  for (const suite of selected) {
    const serviceEnv = Object.assign({}, ...(suite.needs ?? []).map((n) => SERVICES[n].map(vars))) as Record<string, string>;
    outcomes.push(await runSuite(suite, serviceEnv));
  }
  process.stdout.write("\nlive suites:\n");
  for (const o of outcomes) {
    const c = o.counts ? `${String(o.counts.passed)} passed, ${String(o.counts.failed)} failed, ${String(o.counts.skipped)} skipped` : "no report";
    process.stdout.write(`  ${o.passed ? "PASS" : "FAIL"}  ${o.id.padEnd(10)} ${String(o.seconds).padStart(4)} s  ${c}\n`);
  }
  for (const s of unselected) {
    process.stdout.write(`  NOT SELECTED  ${s.id.padEnd(10)} needs --with=${(s.needs ?? []).join(",")}\n`);
  }
  const failed = outcomes.filter((o) => !o.passed);
  const sum = (k: keyof JestCounts): number => outcomes.reduce((n, o) => n + (o.counts?.[k] ?? 0), 0);
  process.stdout.write(
    `${String(outcomes.length - failed.length)} of ${String(outcomes.length)} suites passed; ` +
      `tests: ${String(sum("passed"))} passed, ${String(sum("failed"))} failed, ${String(sum("skipped"))} skipped; ` +
      `${String(unselected.length)} suite(s) not selected\n`,
  );
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
