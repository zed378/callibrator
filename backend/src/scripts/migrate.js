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

migrator.runAsCLI();
