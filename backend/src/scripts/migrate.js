/**
 * Migration CLI entrypoint.
 *
 *   node src/scripts/migrate.js up        # apply all pending migrations
 *   node src/scripts/migrate.js down      # revert the last migration
 *   node src/scripts/migrate.js pending   # list pending migrations
 *   node src/scripts/migrate.js executed  # list applied migrations
 *
 * npm aliases: `npm run migrate`, `npm run migrate:undo`, `npm run migrate:status`.
 */
require("../utils/env.util");
const { migrator } = require("../config/migrator");
const { db } = require("../config");
const { withSchemaLock } = require("../utils/migrationLock.util");
const { logger } = require("../middlewares/activityLog.middleware");

// P8-03 (ADR-086): `up` and `down` change the schema, so they take the same
// advisory lock a booting replica takes around db.sync() + migrator.up(). An
// operator's `npm run migrate` during a rolling deploy then waits for the
// booting replica (or the replica waits for it) instead of both applying the
// same migration. `pending` and `executed` only read, and do not wait.
const MUTATING = new Set(["up", "down"]);
const run = () => migrator.runAsCLI();
const command = process.argv[2];

// M-13 (ADR-082): umzug's CLI returns when the command is done, but the
// Sequelize pool's open connection kept the event loop — and so the process —
// alive: `npm run migrate:status` printed its result and never exited, which
// hung CI's boot-and-migrate job. Close the pool once the command finishes,
// whatever its outcome; a failed command still exits non-zero.
(MUTATING.has(command) ? withSchemaLock({ sequelize: db, logger, fn: run }) : run())
  .then((ok) => {
    if (!ok) {
      process.exitCode = 1;
    }
  })
  .catch((err) => {
    logger.error(`migrate ${command} failed`, { error: err.message });
    process.exitCode = 1;
  })
  .finally(() => db.close());
