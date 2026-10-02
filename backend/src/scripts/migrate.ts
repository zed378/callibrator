/**
 * Migration CLI entrypoint.
 *
 *   tsx src/scripts/migrate.ts up        # apply all pending migrations
 *   tsx src/scripts/migrate.ts down      # revert the last migration
 *   tsx src/scripts/migrate.ts pending   # list pending migrations
 *   tsx src/scripts/migrate.ts executed  # list applied migrations
 *
 * npm aliases: `npm run migrate`, `npm run migrate:undo`, `npm run migrate:status`.
 *
 * P9-21 (ADR-087): converted from migrate.js with no behaviour change: the
 * same modules load in the same order, and the command, its output and its
 * exit code are unchanged (proved by running both against PostgreSQL 18).
 */
import "../utils/env.util";
import { migrator } from "../config/migrator";
import { db } from "../config";
import { withSchemaLock } from "../utils/migrationLock.util";
import { logger } from "../middlewares/activityLog.middleware";

// P8-03 (ADR-086): `up` and `down` change the schema, so they take the same
// advisory lock a booting replica takes around db.sync() + migrator.up(). An
// operator's `npm run migrate` during a rolling deploy then waits for the
// booting replica (or the replica waits for it) instead of both applying the
// same migration. `pending` and `executed` only read, and do not wait.
const MUTATING = new Set(["up", "down"]);
const run = (): Promise<boolean> => migrator.runAsCLI();
const command = process.argv[2];

// M-13 (ADR-082): umzug's CLI returns when the command is done, but the
// Sequelize pool's open connection kept the event loop — and so the process —
// alive: `npm run migrate:status` printed its result and never exited, which
// hung CI's boot-and-migrate job. Close the pool once the command finishes,
// whatever its outcome; a failed command still exits non-zero.
void (MUTATING.has(command as string) ? withSchemaLock({ sequelize: db as unknown as Parameters<typeof withSchemaLock>[0]["sequelize"], logger, fn: run }) : run())
  .then((ok) => {
    if (!ok) {
      process.exitCode = 1;
    }
  })
  .catch((err: unknown) => {
    logger.error(`migrate ${String(command)} failed`, { error: (err as { message?: unknown }).message });
    process.exitCode = 1;
  })
  .finally(() => db.close());
