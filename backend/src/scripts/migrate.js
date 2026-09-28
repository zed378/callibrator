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

// M-13 (ADR-082): umzug's CLI returns when the command is done, but the
// Sequelize pool's open connection kept the event loop — and so the process —
// alive: `npm run migrate:status` printed its result and never exited, which
// hung CI's boot-and-migrate job. Close the pool once the command finishes,
// whatever its outcome; a failed command still exits non-zero.
migrator
  .runAsCLI()
  .then((ok) => {
    if (!ok) {
      process.exitCode = 1;
    }
  })
  .finally(() => db.close());
