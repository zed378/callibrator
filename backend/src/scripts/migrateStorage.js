/**
 * Storage migration CLI — copy legacy on-disk attachments into the configured
 * pluggable-storage backend and backfill their storage keys.
 *
 *   node src/scripts/migrateStorage.js --dry-run           # report only
 *   node src/scripts/migrateStorage.js                     # migrate everything
 *   node src/scripts/migrateStorage.js --tenant <id>       # one tenant
 *   node src/scripts/migrateStorage.js --limit 100         # a bounded batch
 *
 * Safe to interrupt and re-run: already-migrated rows are skipped, and each
 * copy is checksum-verified before its key is committed. The legacy file is
 * left in place — reclaim disk separately once you have confirmed the run.
 *
 * The migration logic itself lives in services/storageMigration (unit-tested);
 * this wrapper only parses args, prints progress, and closes the DB.
 */
require("../utils/env.util");
const { db } = require("../config");
const { migrateAll } = require("../services/storageMigration.service");

const parseArgs = (argv) => {
  const opts = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {opts.dryRun = true;}
    else if (arg === "--tenant") {opts.tenantId = argv[(i += 1)];}
    else if (arg === "--limit") {opts.limit = Number(argv[(i += 1)]);}
  }
  return opts;
};

/* istanbul ignore next -- CLI bootstrap; the migration logic is tested in
   services/storageMigration.service.test.js. */
const run = async () => {
  const opts = parseArgs(process.argv.slice(2));
  // eslint-disable-next-line no-console
  console.log(
    `Storage migration${opts.dryRun ? " (dry-run)" : ""}${opts.tenantId ? ` — tenant ${opts.tenantId}` : ""}…`,
  );

  const summary = await migrateAll({
    ...opts,
    onProgress: (r) =>
      // eslint-disable-next-line no-console
      console.log(`  ${r.status.padEnd(15)} ${r.id}${r.key ? ` -> ${r.key}` : ""}`),
  });

  // eslint-disable-next-line no-console
  console.log(
    `\nDone. total=${summary.total} migrated=${summary.migrated} ` +
      `skipped=${summary.skipped} missing=${summary.missingSource} ` +
      `wouldMigrate=${summary.wouldMigrate} failed=${summary.failed}`,
  );
  await db.close();
  process.exit(summary.failed > 0 ? 1 : 0);
};

/* istanbul ignore next */
run().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error("Storage migration crashed:", err.message);
  await db.close().catch(() => {});
  process.exit(1);
});
