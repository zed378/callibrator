/**
 * P9-23 — the migration names are frozen.
 *
 * Umzug keys `schema_migrations` by the NAME string in `config/migrator.js`,
 * never by the file on disk. Every database migrated so far recorded names
 * ending ".js" (`0001-underscore-class-models.js` …), because the migrations
 * were JavaScript files and the manifest copied the glob resolver's names.
 * Converting a file to `.ts` must not change its name: a name that changes is
 * a migration Umzug has never seen, and it would run AGAIN against every
 * existing database.
 *
 * FROZEN below is typed by hand from the `schema_migrations` rows of a
 * database migrated by the JavaScript migrations (PostgreSQL 18, 2026-09-29,
 * P9-23 record) — NOT generated from migrator.js, which would prove only that
 * the file equals itself. It was written, and seen to fail on an altered name,
 * before any migration file was renamed.
 *
 * A migration newer than the frozen set is not listed here: its name is fixed
 * when it is first applied (new migrations are TypeScript from the start and
 * still carry a ".js" name, like 0091). The rules below hold for all of them.
 */
import * as fs from "fs";
import * as path from "path";
import type { Sequelize } from "sequelize";

// The migrator reads its Sequelize instance from config/index, which would
// validate the environment and open a pool. An unconnected PostgreSQL-dialect
// instance is enough: nothing here runs a migration.
jest.mock("../../config/index", () => {
  const { Sequelize: RealSequelize } = jest.requireActual<{ Sequelize: typeof Sequelize }>("sequelize");
  return { db: new RealSequelize({ dialect: "postgres", logging: false }) };
});

const MIGRATIONS_DIR = path.join(__dirname, "../../migrations");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

/** The 63 names recorded in `schema_migrations` by the JavaScript migrations, in order. */
const FROZEN: readonly string[] = [
  "0001-underscore-class-models.js",
  "0002-add-stripe-invoice-id.js",
  "0003-add-search-vectors.js",
  "0004-add-mfa-fields.js",
  "0005-add-batch-jobs.js",
  "0006-add-capas.js",
  "0007-add-sop-documents.js",
  "0008-extend-vendors-qualification.js",
  "0009-add-uncertainty-budgets.js",
  "0010-add-iot-fields.js",
  "0011-add-esignature-records.js",
  "0012-enable-rls-policies.js",
  "0013-add-tenant-parent-id.js",
  "0014-add-user-webauthn-fields.js",
  "0015-drop-rls-policies.js",
  "0016-add-attachment-storage-key.js",
  "0017-add-signature-workflows.js",
  "0018-add-document-chunks.js",
  "0019-add-signature-crypto-fields.js",
  "0020-backfill-role-levels.js",
  "0021-metered-billing-grants.js",
  "0022-encrypt-webhook-secrets.js",
  "0023-tenant-lifecycle-columns.js",
  "0024-qms-number-uniqueness.js",
  "0025-esignature-menu-grants.js",
  "0026-calibration-device-serial-per-tenant.js",
  "0027-profile-page-grants.js",
  "0028-user-mfa-pending-and-replay.js",
  "0029-audit-log-impersonator.js",
  "0030-tenant-foreign-keys-restrict.js",
  "0031-user-must-change-password-and-recovery-codes.js",
  "0032-esignature-technical-roles-only.js",
  "0033-audit-log-actor.js",
  "0034-platform-tenant.js",
  "0035-tenant-settings-secrets.js",
  "0036-flag-never-signed-in-admin-passwords.js",
  "0037-association-foreign-keys.js",
  "0038-ai-assistant-menu.js",
  "0039-signature-workflow-requested-by.js",
  "0040-session-impersonator.js",
  "0042-scim-groups-per-tenant.js",
  "0043-webhook-durable-delivery.js",
  "0044-iot-device-token-hash.js",
  "0047-drop-data-retention-policies.js",
  "0049-audit-actions-lockout-signature.js",
  "0052-session-auth-method.js",
  "0054-q20-management-page-grants.js",
  "0056-uploads-public-class.js",
  "0057-calibration-records-append-only.js",
  "0058-tenant-keys-kms-envelope.js",
  "0059-stock-adjustment-reason-and-item.js",
  "0060-work-order-auto-scheduled-unique.js",
  "0062-audit-log-indexes.js",
  "0063-user-identity-case-insensitive.js",
  "0066-signature-records-step-restrict.js",
  "0067-foreign-key-and-tenant-indexes.js",
  "0070-custom-domain-partial-uniqueness.js",
  "0078-user-temporary-password-expiry.js",
  "0086-user-mfa-secrets-kms-envelope.js",
  "0087-tenant-backup-path-and-expiry.js",
  "0088-attachment-file-purged-at.js",
  "0089-calibration-device-retired-terminal.js",
  "0090-webhook-secret-rotation-overlap.js",
];

/** `[name, module]` for every manifest entry, read from the source text. */
const manifestEntries = (): [string, string][] =>
  [...MANIFEST.matchAll(/\[\s*"([^"]+)"\s*,\s*require\("\.\.\/migrations\/([^"]+)"\)\s*\]/g)].map(
    ([, name = "", module = ""]) => [name, module],
  );

/** Migration files on disk (`NNNN-*.js` / `NNNN-*.ts`), without the extension. */
const filesOnDisk = (): string[] =>
  fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d{4}-.+\.(js|ts)$/.test(file) && !file.endsWith(".d.ts"))
    .map((file) => file.replace(/\.(js|ts)$/, ""));

interface Migrator {
  migrations: () => Promise<readonly { name: string }[]>;
}

describe("P9-23 — migration names are frozen", () => {
  it("the frozen list is the 63 historical names, each ending .js, strictly ascending", () => {
    expect(FROZEN).toHaveLength(63);
    for (const name of FROZEN) {
      expect(name).toMatch(/^\d{4}-[a-z0-9-]+\.js$/);
    }
    expect([...FROZEN].sort()).toEqual(FROZEN);
    expect(new Set(FROZEN).size).toBe(FROZEN.length);
  });

  it("the migrator registers the frozen names first, in order, exactly as recorded", async () => {
    const { migrator } = jest.requireActual<{ migrator: Migrator }>("../../config/migrator");
    const names = (await migrator.migrations()).map((m) => m.name);
    expect(names.slice(0, FROZEN.length)).toEqual(FROZEN);
  });

  it("every name — frozen or newer — ends .js and is its module's path plus .js, whatever the file's extension", () => {
    const entries = manifestEntries();
    expect(entries.length).toBeGreaterThanOrEqual(FROZEN.length);
    for (const [name, module] of entries) {
      expect(name).toBe(`${module}.js`);
    }
    const names = entries.map(([name]) => name);
    expect([...names].sort()).toEqual(names);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every registered module exists on disk exactly once, as .js or .ts, and every file on disk is registered", () => {
    const modules = manifestEntries().map(([, module]) => module);
    for (const module of modules) {
      const present = [".js", ".ts"].filter((ext) => fs.existsSync(path.join(MIGRATIONS_DIR, `${module}${ext}`)));
      expect({ module, present: present.length }).toEqual({ module, present: 1 });
    }
    expect(filesOnDisk().sort()).toEqual([...modules].sort());
  });

  it("the context Umzug passes is the QueryInterface itself, not { queryInterface } (0008/0013/0014)", () => {
    expect(MANIFEST).toMatch(/context:\s*db\.getQueryInterface\(\)/);
    expect(MANIFEST).not.toMatch(/context:\s*\{\s*queryInterface/);
  });
});
