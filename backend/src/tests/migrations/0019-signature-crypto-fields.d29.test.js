/**
 * D-29 (ADR-083) — migration 0019 was reviewed line by line and found correct,
 * with two residual risks. This pins what was done about each.
 *
 *  1. `context.queryInterface || context`. Harmless because the migrator
 *     passes the QueryInterface ITSELF, which has no `.queryInterface`
 *     property, so the fallback takes the right branch. That is now a tested
 *     contract rather than an observation: the manifest passes
 *     `db.getQueryInterface()`, a real QueryInterface has no such property,
 *     and the fallback is frozen to the sixteen migrations that already carry
 *     it — a new migration uses `context` directly. The sixteen are not edited:
 *     they are applied and frozen by name, and deleting a line that is a no-op
 *     on every path changes nothing but the diff.
 *  2. `showIndex` matched on the literal index NAME only, so an index on the
 *     same column under another name (Sequelize's default for a model index,
 *     or one made by hand) would have been created a second time. It now
 *     matches by name OR by a single-column index on `signing_key_id`.
 *     Changing an applied migration changes nothing on a database that ran it;
 *     on a fresh one the behaviour is identical unless such an index exists.
 *
 * The live half (PostgreSQL 18: showIndex's real `fields` shape, and 0019's
 * `up` against a table that already carries the index under another name) is
 * in dataLayer.dbD.live.test.js.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize } = require("sequelize");

const migration = require("../../migrations/0019-add-signature-crypto-fields");

const MIGRATIONS_DIR = path.join(__dirname, "../../migrations");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const ALL_COLUMNS = ["id", "signature_value", "signing_key_id", "signature_scheme", "signature_reason"];

const fakeQueryInterface = (indexes) => ({
  describeTable: jest.fn(async () => Object.fromEntries(ALL_COLUMNS.map((c) => [c, { type: "X" }]))),
  addColumn: jest.fn(),
  showIndex: jest.fn(async () => indexes),
  addIndex: jest.fn(),
});

/** The shape Sequelize's PostgreSQL showIndex returns for one index. */
const pgIndex = (name, attributes) => ({
  name,
  primary: false,
  unique: false,
  fields: attributes.map((attribute) => ({ attribute, collate: undefined, order: undefined, length: undefined })),
});

describe("D-29 residual risk 2 — 0019 recognises an existing index by what it indexes", () => {
  it("does not create a second index when one on signing_key_id exists under another name", async () => {
    const qi = fakeQueryInterface([pgIndex("signature_records_pkey", ["id"]), pgIndex("idx_sig_key", ["signing_key_id"])]);
    await migration.up({ context: qi });
    expect(qi.addIndex).not.toHaveBeenCalled();
  });

  it("does not create it when its own name is present", async () => {
    const qi = fakeQueryInterface([pgIndex("signature_records_signing_key_id", ["signing_key_id"])]);
    await migration.up({ context: qi });
    expect(qi.addIndex).not.toHaveBeenCalled();
  });

  it("creates it under its name when no index covers the column alone — a composite does not count", async () => {
    const qi = fakeQueryInterface([
      pgIndex("signature_records_pkey", ["id"]),
      pgIndex("sig_tenant_key", ["tenant_id", "signing_key_id"]),
      { name: "odd", fields: undefined },
    ]);
    await migration.up({ context: qi });
    expect(qi.addIndex).toHaveBeenCalledWith("signature_records", ["signing_key_id"], {
      name: "signature_records_signing_key_id",
    });
  });
});

describe("D-29 residual risk 1 — the `context.queryInterface || context` fallback", () => {
  const FALLBACK = /context\.queryInterface\s*\|\|\s*context/;

  it("the migrator passes the QueryInterface itself as the context", () => {
    expect(MANIFEST).toMatch(/context:\s*db\.getQueryInterface\(\)/);
  });

  it("a real QueryInterface has no `.queryInterface`, so the fallback always takes `context`", () => {
    const qi = new Sequelize({ dialect: "postgres", logging: false }).getQueryInterface();
    expect(qi.queryInterface).toBeUndefined();
    expect(typeof qi.describeTable).toBe("function");
  });

  it("is frozen to the sixteen reviewed migrations: a new one uses `context` directly", () => {
    const carrying = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".js"))
      .filter((name) => FALLBACK.test(fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8")))
      .sort();
    expect(carrying).toEqual([
      "0011-add-esignature-records.js",
      "0012-enable-rls-policies.js",
      "0015-drop-rls-policies.js",
      "0016-add-attachment-storage-key.js",
      "0017-add-signature-workflows.js",
      "0018-add-document-chunks.js",
      "0019-add-signature-crypto-fields.js",
      "0020-backfill-role-levels.js",
      "0021-metered-billing-grants.js",
      "0022-encrypt-webhook-secrets.js",
      "0025-esignature-menu-grants.js",
      "0027-profile-page-grants.js",
      "0032-esignature-technical-roles-only.js",
      "0035-tenant-settings-secrets.js",
      "0038-ai-assistant-menu.js",
      "0054-q20-management-page-grants.js",
    ]);
  });
});
