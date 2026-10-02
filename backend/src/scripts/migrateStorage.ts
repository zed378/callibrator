/**
 * Storage migration CLI — copy legacy on-disk attachments into the configured
 * pluggable-storage backend and backfill their storage keys.
 *
 *   tsx src/scripts/migrateStorage.ts --dry-run           # report only
 *   tsx src/scripts/migrateStorage.ts                     # migrate everything
 *   tsx src/scripts/migrateStorage.ts --tenant <id>       # one tenant
 *   tsx src/scripts/migrateStorage.ts --limit 100         # a bounded batch
 *
 * Safe to interrupt and re-run: already-migrated rows are skipped, and each
 * copy is checksum-verified before its key is committed. The legacy file is
 * left in place — reclaim disk separately once you have confirmed the run.
 *
 * The migration logic itself lives in services/storageMigration (unit-tested);
 * this wrapper only parses args, prints progress, and closes the DB.
 *
 * P9-21 (ADR-087): converted from migrateStorage.js with no behaviour change —
 * the same modules load in the same order, and the progress, summary and exit
 * code are unchanged (proved by running both against PostgreSQL 18).
 */
// A-42 console-allowed: a CLI run by hand in a terminal; its console output is the operator's report, not application logging (backend/src/tests/guards/noConsole.a42.test.js).
import "../utils/env.util";
import { db } from "../config";
import storageMigration from "../services/storageMigration.service";

const { migrateAll } = storageMigration;

/** The options the CLI flags set (passed to migrateAll as the `.js` passed them). */
interface CliOptions {
  dryRun: boolean;
  tenantId?: string | undefined;
  limit?: number;
}

const parseArgs = (argv: readonly string[]): CliOptions => {
  const opts: CliOptions = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {opts.dryRun = true;}
    else if (arg === "--tenant") {opts.tenantId = argv[(i += 1)];}
    else if (arg === "--limit") {opts.limit = Number(argv[(i += 1)]);}
  }
  return opts;
};

/** A progress line, as storageMigration reports each row. */
interface Progress {
  status: string;
  id: string;
  key?: string | null;
}

/* istanbul ignore next -- CLI bootstrap; the migration logic is tested in
   services/storageMigration.service.test.js. */
const run = async (): Promise<void> => {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `Storage migration${opts.dryRun ? " (dry-run)" : ""}${opts.tenantId ? ` — tenant ${opts.tenantId}` : ""}…`,
  );

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- as built: the .js passed an absent --tenant as `tenantId: undefined` and each row as storageMigration reports it; the options are passed as written, not reshaped (ADR-087 identity)
  const summary = await migrateAll({
    ...opts,
    onProgress: (r: Progress) => {
      console.log(`  ${r.status.padEnd(15)} ${r.id}${r.key ? ` -> ${r.key}` : ""}`);
    },
  } as Parameters<typeof migrateAll>[0]);

  console.log(
    `\nDone. total=${String(summary.total)} migrated=${String(summary.migrated)} ` +
      `skipped=${String(summary.skipped)} missing=${String(summary.missingSource)} ` +
      `wouldMigrate=${String(summary.wouldMigrate)} failed=${String(summary.failed)}`,
  );
  await db.close();
  process.exit(summary.failed > 0 ? 1 : 0);
};

/* istanbul ignore next -- CLI entry point: runs on `node`, never on require */
run().catch(async (err: unknown) => {
  console.error("Storage migration crashed:", (err as { message?: unknown }).message);
  await db.close().catch(() => undefined);
  process.exit(1);
});
