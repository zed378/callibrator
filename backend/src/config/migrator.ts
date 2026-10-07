/**
 * Database migrations (Umzug)
 *
 * Versioned, ordered schema/data migrations that run in addition to the
 * model-driven `db.sync()` used for base table creation. Use migrations for the
 * things `sync` cannot safely do on an existing database: column renames,
 * custom indexes (e.g. GIN/tsvector), backfills, and constraints.
 *
 * Migration files live in `src/migrations/*.ts` (P9-23) and export:
 *   export = {
 *     up: async ({ context }: { context: QueryInterface }) => { ... },
 *     down: async ({ context }: { context: QueryInterface }) => { ... },
 *   };
 *
 * Applied migrations are tracked in the `schema_migrations` table.
 *
 * P9-21 (ADR-087): converted from migrator.js with no behaviour change. The
 * manifest keeps its one-line `[name, require(migration)]` entries
 * verbatim: the names are frozen (manifestNames.p923), the migrations load in
 * the same order, at load, and the migration tests read these lines. `export =`
 * keeps the object `require()` returned. Proved by running `up`, `down`,
 * `pending` and `executed` with both against PostgreSQL 18. It replaces
 * `migrator.d.ts`, which described the `.js` and is removed.
 */
import { Umzug, SequelizeStorage } from "umzug";
import type { MigrationParams } from "umzug";
import type { QueryInterface } from "sequelize";
import config from "./index";
import { logger } from "../middlewares/activityLog.middleware";

/** A migration module: `export = { up, down }`, each given Umzug's params with the QueryInterface as `context`. */
interface MigrationModule {
  up(params: MigrationParams<QueryInterface>): Promise<unknown>;
  down(params: MigrationParams<QueryInterface>): Promise<unknown>;
}

/** An Umzug log record, as fmt() reads it (Umzug sends these fields as strings and a number). */
interface LogRecord {
  event?: string;
  name?: string;
  durationSeconds?: number;
}

const { db } = config;

function fmt(o: unknown): string {
  if (typeof o === "string") {
    return o;
  }
  const record = o as LogRecord | null | undefined;
  if (record?.event) {
    const dur = record.durationSeconds ? ` (${String(record.durationSeconds)}s)` : "";
    const name = record.name ? ` ${record.name}` : "";
    return `${record.event}${name}${dur}`;
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
//
// P9-23: the files are TypeScript now and the names did NOT change. A name is
// `<module path>.js` whatever the file's extension, frozen when first applied;
// the require stays extensionless (tsx/jest resolve the .ts, dist/ the compiled
// .js). manifestNames.p923.test.ts holds the historical names, typed by hand.
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment -- as built: one
   require() per migration, in manifest order, at load (an import would hoist them, and the migration tests read
   these lines as text); each module is `export = { up, down }`. */
const migrationModules: [string, MigrationModule][] = [
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
  ["0078-user-temporary-password-expiry.js", require("../migrations/0078-user-temporary-password-expiry")],
  ["0086-user-mfa-secrets-kms-envelope.js", require("../migrations/0086-user-mfa-secrets-kms-envelope")],
  ["0087-tenant-backup-path-and-expiry.js", require("../migrations/0087-tenant-backup-path-and-expiry")],
  ["0088-attachment-file-purged-at.js", require("../migrations/0088-attachment-file-purged-at")],
  ["0089-calibration-device-retired-terminal.js", require("../migrations/0089-calibration-device-retired-terminal")],
  ["0090-webhook-secret-rotation-overlap.js", require("../migrations/0090-webhook-secret-rotation-overlap")],
  // Q-34 (ADR-095): the first TypeScript migration. Its manifest name keeps the
  // ".js" suffix like every other entry (P9-23), so a later rename cannot re-run it.
  ["0091-audit-logs-append-only.js", require("../migrations/0091-audit-logs-append-only")],
  // P8-04 (ADR-096): per-tenant ORDER BY indexes for the lists, built CONCURRENTLY.
  ["0093-list-order-indexes.js", require("../migrations/0093-list-order-indexes")],
  // P10-16 (ADR-099): users.password_one_time — the bootstrap super admin's one-time password.
  ["0094-user-password-one-time.js", require("../migrations/0094-user-password-one-time")],
  // ADR-101: certificates.submitted_by — separation of duties on certificate approval.
  ["0095-certificate-submitted-by.js", require("../migrations/0095-certificate-submitted-by")],
  // A-293 (ADR-100): certificates.verification_token — the QR code's secret; back-filled, NOT NULL, UNIQUE.
  ["0096-certificate-verification-token.js", require("../migrations/0096-certificate-verification-token")],
  // ADR-102: the Stock and Object Storage menu entries, and the grants the effective-permission sidebar needs.
  ["0097-menu-effective-access.js", require("../migrations/0097-menu-effective-access")],
  // Q-38 (ADR-100): HEALTHCARE ADMIN may set its own tenant's allowlist and geofence (network-security write).
  ["0098-network-security-tenant-admin-write.js", require("../migrations/0098-network-security-tenant-admin-write")],
  // P10-05 (ADR-098 §6): access_requests — the public intake and the super admin's queue.
  ["0099-access-requests.js", require("../migrations/0099-access-requests")],
  // P10-10 (ADR-098 §5): users.webauthn_credential_id unique. Inert since 0104 moved the credentials to
  // webauthn_credentials (the sign-in reads that table); dropped by the pending legacy-columns migration.
  ["0100-user-webauthn-credential-unique.js", require("../migrations/0100-user-webauthn-credential-unique")],
  // P10-07 (ADR-098 §6): the access-requests menu entry and its SUPERADMIN grant.
  ["0101-access-requests-menu.js", require("../migrations/0101-access-requests-menu")],
  // A-303: the tenant profile columns (address and contact; ISO/IEC 17025 7.8.2 issuer on certificates).
  ["0102-tenant-profile-columns.js", require("../migrations/0102-tenant-profile-columns")],
  // ADR-107 (Q-50): certificates.signed_snapshot — what a signed certificate prints, fixed at signing (the v3 hash binds it).
  ["0103-certificate-signed-snapshot.js", require("../migrations/0103-certificate-signed-snapshot")],
  // ADR-108 Amendment 1: several passkeys per user — webauthn_credentials, the old one-per-user columns moved in.
  ["0104-webauthn-credentials.js", require("../migrations/0104-webauthn-credentials")],
  // Q-51: an API key may be the actor of a calibration record, stock adjustment or transfer request — api_key_id + an exactly-one CHECK.
  ["0105-api-key-actor-columns.js", require("../migrations/0105-api-key-actor-columns")],
  // Q-52 (ADR-109 §6): vendors.notes — accepted by the API, now stored.
  ["0106-vendor-notes.js", require("../migrations/0106-vendor-notes")],
  // Q-55 (ADR-097 Am. 4): maintenance_work_orders schedule, cost and resolution columns — accepted by the API, now stored.
  ["0107-work-order-schedule-cost.js", require("../migrations/0107-work-order-schedule-cost")],
  // A-363: tenant_backups.name / .description — required/accepted by the API, now stored.
  ["0108-tenant-backup-name-description.js", require("../migrations/0108-tenant-backup-name-description")],
  // U-06 (ADR-119): a partial covering index of the live calibration records — the record counts become index-only.
  ["0109-calibration-records-live-index.js", require("../migrations/0109-calibration-records-live-index")],
  // U-06b (ADR-120): the full-text search GIN indexes are per tenant (btree_gin), replacing 0003's.
  ["0110-search-tenant-gin.js", require("../migrations/0110-search-tenant-gin")],
  // P20-01 (ADR-125 Am. 1): device_types (global catalogue) and calibration_devices.device_type_id (RESTRICT).
  ["0111-device-types.js", require("../migrations/0111-device-types")],
  // P20-03 (ADR-125 Am. 1, Am. 2): the inspection catalogue tables, immutability triggers, grants and base checklist v1.
  ["0112-inspection-catalogue.js", require("../migrations/0112-inspection-catalogue")],
  // The rsync image import (upstream adoption): upstream_file_imports, its tenant FK, the credential-erasure CHECK.
  ["0113-upstream-file-imports.js", require("../migrations/0113-upstream-file-imports")],
  // P24-06: the SQL-dump import — upstream_sql_imports, the import role and the upstream_import staging schema closed to the app role.
  ["0114-upstream-sql-imports.js", require("../migrations/0114-upstream-sql-imports")],
  // The rsync image import: the upstream-import menu entry and its SUPERADMIN grant (as 0101).
  ["0115-upstream-import-menu.js", require("../migrations/0115-upstream-import-menu")],
  // P24-06: the upstream-sql-import menu entry and its SUPERADMIN grant (as 0101, 0115).
  ["0116-upstream-sql-import-menu.js", require("../migrations/0116-upstream-sql-import-menu")],
];
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment */

const migrator = new Umzug<QueryInterface>({
  migrations: migrationModules.map(([name, mod]) => ({
    name,
    up: (params: MigrationParams<QueryInterface>) => mod.up(params),
    down: (params: MigrationParams<QueryInterface>) => mod.down(params),
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
    info: (o) => {
      logger.info(`[migrate] ${fmt(o)}`);
    },
    warn: (o) => {
      logger.warn(`[migrate] ${fmt(o)}`);
    },
    error: (o) => {
      logger.error(`[migrate] ${fmt(o)}`);
    },
    debug: () => undefined,
  },
});

export = { migrator };
