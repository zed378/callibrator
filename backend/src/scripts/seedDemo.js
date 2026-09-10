/**
 * Demo-data seeder CLI.
 *
 *   node src/scripts/seedDemo.js
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
 */

/* istanbul ignore file -- operational seeding script, run manually */

require("../utils/env.util");
const { db } = require("../config");
const migrationService = require("../services/migration.service");

async function run() {
  const result = await migrationService.seedDemoData();

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));

  const total = Object.values(result.created).reduce((a, b) => a + b, 0);
  // eslint-disable-next-line no-console
  console.log(`\nTotal demo rows created this run: ${total}`);

  await db.close().catch(() => {});
  process.exit(result.errors.length > 0 ? 1 : 0);
}

run().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("Demo seeding crashed:", err.message);
  await db.close().catch(() => {});
  process.exit(1);
});
