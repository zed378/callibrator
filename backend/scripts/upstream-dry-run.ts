/**
 * P24-05 — the dry run of a REAL upstream dump on a throwaway PostgreSQL 18 (docs/UPSTREAM/05 § 8,
 * TASKS/RUNBOOK-UPSTREAM-CUTOVER.md § 3): the whole pipeline as the backend runs it — upload →
 * ClamAV scan → parse → staging → transform into a provider tenant → reconciliation (P25-01) and
 * data-quality report (P25-02) — every stage timed.
 *
 * NEVER IN CI, NEVER ON A SHARED DATABASE. It refuses a DB_NAME without "scratch". It processes real
 * personal data on this workstation only (the owner's decision 2026-10-28, UD-18), and WRITES NOTHING
 * BUT COUNTS, CODES AND DURATIONS: the summary carries the run's own aggregates (the transform summary,
 * the reconciliation, the data-quality report — each counts and fixed codes by contract, ADR-129), never
 * a staged value, a name, a serial or a hash. Drop the database and the container after it.
 *
 *   docker run -d --name p2405-pg18 -e POSTGRES_PASSWORD=<pw> -p 127.0.0.1:55405:5432 pgvector/pgvector:pg18
 *   docker run -d --name p2405-clamav -p 127.0.0.1:53405:3310 clamav/clamav:1.4
 *   (create the database p2405_scratch)
 *   DB_HOST=127.0.0.1 DB_PORT=55405 DB_NAME=p2405_scratch DB_USER=postgres DB_PASS=<pw> \
 *     CLAMAV_LIVE_HOST=127.0.0.1 CLAMAV_LIVE_PORT=53405 \
 *     npx tsx scripts/upstream-dry-run.ts <dump.sql> <summary.json>
 *   docker rm -f p2405-pg18 p2405-clamav
 */
/* eslint-disable @typescript-eslint/no-require-imports -- the graph loads after the environment is set; typed by the members used */
import fs from "fs";
import path from "path";

const [dumpArg, outArg] = process.argv.slice(2);
if (dumpArg === undefined || outArg === undefined) {
  throw new Error("usage: tsx scripts/upstream-dry-run.ts <dump.sql> <summary.json>");
}
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
};
if (!required("DB_NAME").includes("scratch")) {
  throw new Error(`Refusing DB_NAME="${required("DB_NAME")}": the dry run runs on a throwaway database whose name contains "scratch"`);
}
Object.assign(process.env, {
  NODE_ENV: "development",
  BATCH_JOBS_INLINE: "true",
  UPSTREAM_REAL_DATA_ALLOWED: "true",
  VIRUS_SCAN_PROVIDER: "clamav",
  CLAMAV_ENABLED: "true",
  CLAMAV_HOST: required("CLAMAV_LIVE_HOST"),
  CLAMAV_PORT: required("CLAMAV_LIVE_PORT"),
  CLAMAV_TIMEOUT: "300000",
  UPSTREAM_SOURCE_TIMEZONE: "Asia/Jakarta",
});

const PROVIDER = "a2405000-0000-4000-8000-0000000000c7";
const SIGN_OFF = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

interface Logger {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
  debug(...a: unknown[]): void;
}
const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };
const say = (line: string): void => {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
};

const main = async (): Promise<void> => {
  const { db } = require("../src/config") as {
    db: { options: { logging: unknown }; query(sql: string, o?: object): Promise<[Record<string, unknown>[], unknown]>; close(): Promise<void> };
  };
  // No SQL in the log: a replacement-inlined statement would carry staged values (development logs every query).
  db.options.logging = false;
  require("../src/models");
  const { migrator } = require("../src/config/migrator") as { migrator: { pending(): Promise<unknown[]> } };
  const migrationLock = require("../src/utils/migrationLock.util") as { runSchemaSetup(o: object): Promise<unknown> };
  const { tenantStorage } = require("../src/middlewares/tenantContext.middleware") as {
    tenantStorage: { run<T>(ctx: object, fn: () => T): T };
  };
  const { quarantinePath } = require("../src/utils/upload.util") as { quarantinePath(name: string): string };
  const importService = require("../src/services/upstreamSqlImport.service") as {
    uploadDump(file: { path: string; size: number }, body: unknown, actor: object): Promise<{ id: string }>;
    getRun(id: string): Promise<Record<string, unknown>>;
  };
  const transformService = require("../src/services/upstreamSqlTransform.service") as {
    requestTransform(id: string, input: { providerTenantId: string }, actor: object): Promise<void>;
  };
  const { provisionImportKey } = require("../src/services/upstreamImport/importKey") as {
    provisionImportKey(tenantId: string, input: { signOffDate: string; dataClass: string }, actor: { userId: string }): Promise<unknown>;
  };
  const { createSelfFacility } = require("../src/services/clientFacility.service") as {
    createSelfFacility(tenant: object): Promise<unknown>;
  };
  const reconciliation = require("../src/services/upstreamReconciliation.service") as { reconcileRun(id: string): Promise<unknown> };
  const dataQuality = require("../src/services/upstreamDataQuality.service") as { reportDataQuality(id: string): Promise<unknown> };

  const asSuperAdmin = <T>(work: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      tenantStorage.run({ tenantId: null, isSuperAdmin: true, isSystemTask: false }, () => {
        work().then(resolve, reject);
      });
    });
  const timed = async <T>(label: string, work: () => Promise<T>): Promise<[T, number]> => {
    const started = Date.now();
    const result = await work();
    const ms = Date.now() - started;
    say(`${label}: ${String(ms)} ms`);
    return [result, ms];
  };
  const until = async (id: string, field: string, busy: readonly string[]): Promise<Record<string, unknown>> => {
    for (;;) {
      const run = await asSuperAdmin(() => importService.getRun(id));
      if (!busy.includes(String(run[field]))) {
        return run;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  /**
   * The job records only TRANSFORM_FAILED (by design: no value leaves through a run or an audit row). Run the
   * same transform again, directly, each step tagged, and keep only what names the failure — the step, the
   * error class, PostgreSQL's SQLSTATE, constraint, table, column and routine — with every literal and every
   * `Key (...)=(...)` value in the message redacted. The transaction rolls back as in the job.
   */
  const diagnose = async (runId: string): Promise<Record<string, unknown>> => {
    const { runTransform } = require("../src/services/upstreamImport/transform/runner") as { runTransform(o: object): Promise<unknown> };
    const { TRANSFORM_STEPS } = require("../src/services/upstreamImport/transform/steps") as {
      TRANSFORM_STEPS: readonly { id: string; run: ((c: unknown) => Promise<void>) | null }[];
    };
    const config = require("../src/config/upstreamImport") as {
      createTransformDb(): { close(): Promise<void> };
      transformRoleName(): string;
      sourceTimeZone(): string;
    };
    const { loadTransformFiles, settleTransformFiles } = require("../src/services/upstreamImport/transformFiles") as {
      loadTransformFiles(t: string): Promise<unknown>;
      settleTransformFiles(f: unknown, committed: boolean): Promise<unknown>;
    };
    let failedStep: string | null = null;
    const steps = TRANSFORM_STEPS.map((s) => ({
      ...s,
      run: async (context: unknown): Promise<void> => {
        try {
          await (s.run as (c: unknown) => Promise<void>)(context);
        } catch (err) {
          failedStep ??= s.id;
          throw err;
        }
      },
    }));
    const connection = config.createTransformDb();
    const files = await loadTransformFiles(PROVIDER);
    try {
      await runTransform({
        runId,
        db: connection,
        runner: connection,
        role: config.transformRoleName(),
        tenantId: PROVIDER,
        sourceZone: config.sourceTimeZone(),
        files,
        steps,
      });
      return { reproduced: false };
    } catch (err) {
      const e = err as { name?: string; code?: string; message?: string; parent?: Record<string, unknown> };
      const p = e.parent ?? {};
      const redact = (text: unknown): string =>
        String(text ?? "")
          .replace(/\)=\([^)]*\)/g, ")=(<redacted>)")
          .replace(/'[^']{0,500}'/g, "'<v>'")
          .replace(/"[^"]{0,200}"/g, (m) => (/^"[a-z_][a-z0-9_]*"$/.test(m) ? m : '"<v>"'))
          .slice(0, 400);
      return {
        reproduced: true,
        step: failedStep,
        name: e.name ?? null,
        transformCode: e.code ?? null,
        sqlState: p["code"] ?? null,
        constraint: p["constraint"] ?? null,
        table: p["table"] ?? null,
        column: p["column"] ?? null,
        routine: p["routine"] ?? null,
        message: redact(p["message"] ?? e.message),
      };
    } finally {
      await settleTransformFiles(files, false);
      await connection.close();
    }
  };

  const summary: Record<string, unknown> = { dump: { name: path.basename(dumpArg), bytes: fs.statSync(dumpArg).size } };
  try {
    const [, migrateMs] = await timed("migrations", () => migrationLock.runSchemaSetup({ sequelize: db, migrator, logger: quiet }));
    if ((await migrator.pending()).length > 0) {
      throw new Error("migrations still pending");
    }

    // The seeded roles, as on a deployed database (the users step refuses to run without them). Roles only:
    // seedAll would also create a super admin and write its one-time password to a file.
    const migrationService = require("../src/services/migration.service") as { seedAllRoles(): Promise<unknown> };
    await asSuperAdmin(() => migrationService.seedAllRoles());

    // The provider tenant (the calibration company), its self facility, an operator, and the import key.
    await db.query(
      `INSERT INTO tenants (id, name, subdomain, email, status, created_at, updated_at)
       VALUES (:id, 'Dry Run Provider', 'p2405provider', 'p2405@dryrun.invalid', 'active', now(), now()) ON CONFLICT (id) DO NOTHING`,
      { replacements: { id: PROVIDER } },
    );
    await asSuperAdmin(() => createSelfFacility({ id: PROVIDER, name: "Dry Run Provider" }));
    const [operator] = (
      await db.query(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url, status, is_active,
                            must_change_password, is_deleted, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'p2405-operator', 'p2405-operator@dryrun.invalid', 'x', 'Dry', 'Run', 'default.svg', 'ACTIVE', true,
                 false, false, now(), now()) RETURNING id`,
        { replacements: { t: PROVIDER } },
      )
    )[0];
    const actor = { userId: String(operator?.["id"]), tenantId: PROVIDER, ipAddress: "127.0.0.1", userAgent: "p2405-dry-run" };
    await asSuperAdmin(() => provisionImportKey(PROVIDER, { signOffDate: SIGN_OFF, dataClass: "real" }, actor));

    // Stage 1: upload (a copy, as multer leaves it in the quarantine) → scan → parse → staging.
    const copy = quarantinePath(`p2405-${String(Date.now())}-dump.sql`);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(dumpArg, copy);
    const [loaded, stageMs] = await timed("upload + scan + parse + staging", async () => {
      const run = await asSuperAdmin(() => importService.uploadDump({ path: copy, size: fs.statSync(copy).size }, { dataClass: "real" }, actor));
      return until(run.id, "status", ["uploaded", "scanning", "parsing"]);
    });
    summary["stage1"] = {
      status: loaded["status"],
      errorCode: loaded["errorCode"] ?? null,
      ms: stageMs,
      runDurationMs: loaded["durationMs"] ?? null,
      uncompressedBytes: loaded["uncompressedBytes"] ?? null,
      rowsLoaded: loaded["rowsLoaded"] ?? null,
      rowsRejected: loaded["rowsRejected"] ?? null,
      rowsNotExtracted: loaded["rowsNotExtracted"] ?? null,
      tables: loaded["tables"] ?? null,
      parseSummary: loaded["parseSummary"] ?? null,
    };
    if (loaded["status"] !== "loaded") {
      throw new Error(`stage 1 ended ${String(loaded["status"])} (${String(loaded["errorCode"])})`);
    }
    const runId = String(loaded["id"]);

    // Stage 2: the transform into the provider tenant.
    const [transformed, transformMs] = await timed("transform", async () => {
      await asSuperAdmin(() => transformService.requestTransform(runId, { providerTenantId: PROVIDER }, actor));
      return until(runId, "transformStatus", ["transform_requested", "transforming"]);
    });
    summary["stage2"] = {
      transformStatus: transformed["transformStatus"],
      errorCode: transformed["transformErrorCode"] ?? null,
      ms: transformMs,
      summary: transformed["transformSummary"] ?? null,
    };
    if (transformed["transformStatus"] !== "transformed") {
      summary["diagnosis"] = await diagnose(runId);
      throw new Error(`the transform ended ${String(transformed["transformStatus"])} (${String(transformed["transformErrorCode"])})`);
    }

    // P25-01 and P25-02 on real volumes.
    const [reconciled, reconcileMs] = await timed("reconciliation", () => asSuperAdmin(() => reconciliation.reconcileRun(runId)));
    const [quality, qualityMs] = await timed("data quality", () => asSuperAdmin(() => dataQuality.reportDataQuality(runId)));
    summary["reconciliation"] = { ms: reconcileMs, answer: reconciled };
    summary["dataQuality"] = { ms: qualityMs, answer: quality };
    summary["timingsMs"] = { migrations: migrateMs, stage1: stageMs, transform: transformMs, reconciliation: reconcileMs, dataQuality: qualityMs };
  } catch (err) {
    summary["failure"] = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    fs.writeFileSync(outArg, `${JSON.stringify(summary, null, 2)}\n`);
    say(`summary written to ${outArg}`);
    await db.close();
  }
};

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  },
);
