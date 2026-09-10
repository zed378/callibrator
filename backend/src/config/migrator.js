/**
 * Database migrations (Umzug)
 *
 * Versioned, ordered schema/data migrations that run in addition to the
 * model-driven `db.sync()` used for base table creation. Use migrations for the
 * things `sync` cannot safely do on an existing database: column renames,
 * custom indexes (e.g. GIN/tsvector), backfills, and constraints.
 *
 * Migration files live in `src/migrations/*.js` and export:
 *   module.exports = {
 *     async up({ context })   { // context = Sequelize QueryInterface },
 *     async down({ context }) { ... },
 *   };
 *
 * Applied migrations are tracked in the `schema_migrations` table.
 */
const { Umzug, SequelizeStorage } = require("umzug");
const { db } = require("./index");
const { logger } = require("../middlewares/activityLog.middleware");

function fmt(o) {
  if (typeof o === "string") {
    return o;
  }
  if (o && o.event) {
    const dur = o.durationSeconds ? ` (${o.durationSeconds}s)` : "";
    const name = o.name ? ` ${o.name}` : "";
    return `${o.event}${name}${dur}`;
  }
  return JSON.stringify(o);
}

// Static migration manifest — one require() per file. Umzug's `glob` resolver
// (fast-glob over the real FS) finds NOTHING inside a compiled single-file
// binary (@yao-pkg/pkg, bun --compile), so every versioned migration would
// silently no-op while db.sync() still creates base tables. Listing them
// statically keeps them visible to the bundler and actually runs them.
//
// Names keep the ".js" suffix to match the entries Umzug's glob resolver
// previously wrote to `schema_migrations`, so existing databases treat them as
// already-applied instead of re-running them.
const migrationModules = [
  ["0001-underscore-class-models.js", require("../migrations/0001-underscore-class-models")],
  ["0002-add-stripe-invoice-id.js", require("../migrations/0002-add-stripe-invoice-id")],
  ["0003-add-search-vectors.js", require("../migrations/0003-add-search-vectors")],
  ["0004-add-mfa-fields.js", require("../migrations/0004-add-mfa-fields")],
  ["0005-add-batch-jobs.js", require("../migrations/0005-add-batch-jobs")],
  ["0006-add-capas.js", require("../migrations/0006-add-capas")],
  ["0007-add-sop-documents.js", require("../migrations/0007-add-sop-documents")],
  ["0008-extend-vendors-qualification.js", require("../migrations/0008-extend-vendors-qualification")],
  ["0009-add-uncertainty-budgets.js", require("../migrations/0009-add-uncertainty-budgets")],
  ["0010-add-iot-fields.js", require("../migrations/0010-add-iot-fields")],
  ["0011-add-esignature-records.js", require("../migrations/0011-add-esignature-records")],
  ["0012-enable-rls-policies.js", require("../migrations/0012-enable-rls-policies")],
  ["0013-add-tenant-parent-id.js", require("../migrations/0013-add-tenant-parent-id")],
  ["0014-add-user-webauthn-fields.js", require("../migrations/0014-add-user-webauthn-fields")],
  ["0015-drop-rls-policies.js", require("../migrations/0015-drop-rls-policies")],
  ["0016-add-attachment-storage-key.js", require("../migrations/0016-add-attachment-storage-key")],
  ["0017-add-signature-workflows.js", require("../migrations/0017-add-signature-workflows")],
  ["0018-add-document-chunks.js", require("../migrations/0018-add-document-chunks")],
];

const migrator = new Umzug({
  migrations: migrationModules.map(([name, mod]) => ({
    name,
    up: (params) => mod.up(params),
    down: (params) => mod.down(params),
  })),
  // Umzug v3 passes this straight through as `context` to each handler.
  //
  // This MUST be the QueryInterface itself, not { queryInterface }. It was
  // previously wrapped, so every migration written as `context.describeTable(...)`
  // — i.e. all but one — hit `undefined`, threw, and had the throw swallowed by
  // its own `try { ... } catch { return }` table-not-present guard. Umzug then
  // recorded the migration as applied while it had done nothing, which is how
  // 0008/0013/0014 came to be marked done with their columns absent.
  context: db.getQueryInterface(),
  storage: new SequelizeStorage({
    sequelize: db,
    tableName: "schema_migrations",
  }),
  logger: {
    info: (o) => logger.info(`[migrate] ${fmt(o)}`),
    warn: (o) => logger.warn(`[migrate] ${fmt(o)}`),
    error: (o) => logger.error(`[migrate] ${fmt(o)}`),
    debug: () => {},
  },
});

module.exports = { migrator };
