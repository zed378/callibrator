/**
 * Demo-data seeder CLI.
 *
 *   tsx src/scripts/seedDemo.ts
 *
 * Loads env + models, runs migrationService.seedDemoData() against the live
 * database configured in .env (connects lazily on first query), prints a JSON
 * summary of rows created per module, and exits.
 *
 * Idempotent: re-running creates nothing new (all counts 0) and never raises
 * duplicate-key errors. Exits 0 on success, 1 if the seeder reported errors.
 *
 * The seeding logic lives in services/migration.service.js (seedDemoData); this
 * wrapper only bootstraps env/DB, prints the summary, and closes the pool.
 *
 * P9-21 (ADR-087): converted from seedDemo.js with no behaviour change — the
 * same modules load in the same order, and the summary and exit code are
 * unchanged (proved by running both against PostgreSQL 18).
 */
// A-42 console-allowed: a CLI run by hand in a terminal; its console output is the operator's report, not application logging (backend/src/tests/guards/noConsole.a42.test.js).

/* istanbul ignore file -- operational seeding script, run manually */

import "../utils/env.util";
import { db } from "../config";
import migrationService from "../services/migration.service";

async function run(): Promise<void> {
  const result = await migrationService.seedDemoData();

  console.log(JSON.stringify(result, null, 2));

  const total = Object.values(result.created).reduce((a, b) => a + b, 0);
  console.log(`\nTotal demo rows created this run: ${String(total)}`);

  await db.close().catch(() => undefined);
  process.exit(result.errors.length > 0 ? 1 : 0);
}

run().catch(async (err: unknown) => {
  console.error("Demo seeding crashed:", (err as { message?: unknown }).message);
  await db.close().catch(() => undefined);
  process.exit(1);
});
