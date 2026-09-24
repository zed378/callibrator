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
  ["0019-add-signature-crypto-fields.js", require("../migrations/0019-add-signature-crypto-fields")],
  ["0020-backfill-role-levels.js", require("../migrations/0020-backfill-role-levels")],
  ["0021-metered-billing-grants.js", require("../migrations/0021-metered-billing-grants")],
  ["0022-encrypt-webhook-secrets.js", require("../migrations/0022-encrypt-webhook-secrets")],
  ["0023-tenant-lifecycle-columns.js", require("../migrations/0023-tenant-lifecycle-columns")],
  ["0024-qms-number-uniqueness.js", require("../migrations/0024-qms-number-uniqueness")],
  ["0025-esignature-menu-grants.js", require("../migrations/0025-esignature-menu-grants")],
  ["0026-calibration-device-serial-per-tenant.js", require("../migrations/0026-calibration-device-serial-per-tenant")],
  ["0027-profile-page-grants.js", require("../migrations/0027-profile-page-grants")],
  ["0028-user-mfa-pending-and-replay.js", require("../migrations/0028-user-mfa-pending-and-replay")],
  ["0029-audit-log-impersonator.js", require("../migrations/0029-audit-log-impersonator")],
  ["0030-tenant-foreign-keys-restrict.js", require("../migrations/0030-tenant-foreign-keys-restrict")],
  ["0031-user-must-change-password-and-recovery-codes.js", require("../migrations/0031-user-must-change-password-and-recovery-codes")],
  ["0032-esignature-technical-roles-only.js", require("../migrations/0032-esignature-technical-roles-only")],
  ["0033-audit-log-actor.js", require("../migrations/0033-audit-log-actor")],
  ["0034-platform-tenant.js", require("../migrations/0034-platform-tenant")],
  ["0035-tenant-settings-secrets.js", require("../migrations/0035-tenant-settings-secrets")],
  ["0036-flag-never-signed-in-admin-passwords.js", require("../migrations/0036-flag-never-signed-in-admin-passwords")],
  ["0037-association-foreign-keys.js", require("../migrations/0037-association-foreign-keys")],
  ["0038-ai-assistant-menu.js", require("../migrations/0038-ai-assistant-menu")],
  ["0039-signature-workflow-requested-by.js", require("../migrations/0039-signature-workflow-requested-by")],
  ["0040-session-impersonator.js", require("../migrations/0040-session-impersonator")],
  ["0042-scim-groups-per-tenant.js", require("../migrations/0042-scim-groups-per-tenant")],
  ["0043-webhook-durable-delivery.js", require("../migrations/0043-webhook-durable-delivery")],
  ["0044-iot-device-token-hash.js", require("../migrations/0044-iot-device-token-hash")],
  ["0047-drop-data-retention-policies.js", require("../migrations/0047-drop-data-retention-policies")],
  ["0049-audit-actions-lockout-signature.js", require("../migrations/0049-audit-actions-lockout-signature")],
  ["0052-session-auth-method.js", require("../migrations/0052-session-auth-method")],
  ["0054-q20-management-page-grants.js", require("../migrations/0054-q20-management-page-grants")],
  ["0056-uploads-public-class.js", require("../migrations/0056-uploads-public-class")],
  ["0057-calibration-records-append-only.js", require("../migrations/0057-calibration-records-append-only")],
  ["0058-tenant-keys-kms-envelope.js", require("../migrations/0058-tenant-keys-kms-envelope")],
  ["0059-stock-adjustment-reason-and-item.js", require("../migrations/0059-stock-adjustment-reason-and-item")],
  ["0060-work-order-auto-scheduled-unique.js", require("../migrations/0060-work-order-auto-scheduled-unique")],
  ["0062-audit-log-indexes.js", require("../migrations/0062-audit-log-indexes")],
  ["0063-user-identity-case-insensitive.js", require("../migrations/0063-user-identity-case-insensitive")],
  ["0066-signature-records-step-restrict.js", require("../migrations/0066-signature-records-step-restrict")],
  ["0067-foreign-key-and-tenant-indexes.js", require("../migrations/0067-foreign-key-and-tenant-indexes")],
  ["0070-custom-domain-partial-uniqueness.js", require("../migrations/0070-custom-domain-partial-uniqueness")],
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
