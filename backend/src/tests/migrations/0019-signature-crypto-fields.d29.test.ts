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
 *
 * P9-23: the migrations are converted to TypeScript one batch at a time, and a
 * converted file keeps the fallback line as written. So the frozen set is
 * compared by migration, not by file extension.
 */
import * as fs from "fs";
import * as path from "path";
import { Sequelize } from "sequelize";
import type { QueryInterface } from "sequelize";
import migration from "../../migrations/0019-add-signature-crypto-fields";

const MIGRATIONS_DIR = path.join(__dirname, "../../migrations");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

const ALL_COLUMNS = ["id", "signature_value", "signing_key_id", "signature_scheme", "signature_reason"];

interface PgIndex {
  name: string;
  primary?: boolean;
  unique?: boolean;
  fields: { attribute: string; collate: undefined; order: undefined; length: undefined }[] | undefined;
}

const fakeQueryInterface = (indexes: PgIndex[]) => {
  const qi = {
    describeTable: jest.fn(() => Promise.resolve(Object.fromEntries(ALL_COLUMNS.map((c) => [c, { type: "X" }])))),
    addColumn: jest.fn(),
    showIndex: jest.fn(() => Promise.resolve(indexes)),
    addIndex: jest.fn(),
  };
  return { qi, context: qi as unknown as QueryInterface };
};

/** The shape Sequelize's PostgreSQL showIndex returns for one index. */
const pgIndex = (name: string, attributes: string[]): PgIndex => ({
  name,
  primary: false,
  unique: false,
  fields: attributes.map((attribute) => ({ attribute, collate: undefined, order: undefined, length: undefined })),
});

describe("D-29 residual risk 2 — 0019 recognises an existing index by what it indexes", () => {
  it("does not create a second index when one on signing_key_id exists under another name", async () => {
    const { qi, context } = fakeQueryInterface([pgIndex("signature_records_pkey", ["id"]), pgIndex("idx_sig_key", ["signing_key_id"])]);
    await migration.up({ context });
    expect(qi.addIndex).not.toHaveBeenCalled();
  });

  it("does not create it when its own name is present", async () => {
    const { qi, context } = fakeQueryInterface([pgIndex("signature_records_signing_key_id", ["signing_key_id"])]);
    await migration.up({ context });
    expect(qi.addIndex).not.toHaveBeenCalled();
  });

  it("creates it under its name when no index covers the column alone — a composite does not count", async () => {
    const { qi, context } = fakeQueryInterface([
      pgIndex("signature_records_pkey", ["id"]),
      pgIndex("sig_tenant_key", ["tenant_id", "signing_key_id"]),
      { name: "odd", fields: undefined },
    ]);
    await migration.up({ context });
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
    const qi: QueryInterface & { queryInterface?: unknown } = new Sequelize({ dialect: "postgres", logging: false }).getQueryInterface();
    expect(qi.queryInterface).toBeUndefined();
    expect(typeof qi.describeTable).toBe("function");
  });

  it("is frozen to the sixteen reviewed migrations: a new one uses `context` directly", () => {
    const carrying = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => /\.(js|ts)$/.test(name)) // ADR-087 Amendment 4
      .filter((name) => FALLBACK.test(fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8")))
      .map((name) => name.replace(/\.(js|ts)$/, "")) // P9-23: the migration, whatever its extension
      .sort();
    expect(carrying).toEqual([
      "0011-add-esignature-records",
      "0012-enable-rls-policies",
      "0015-drop-rls-policies",
      "0016-add-attachment-storage-key",
      "0017-add-signature-workflows",
      "0018-add-document-chunks",
      "0019-add-signature-crypto-fields",
      "0020-backfill-role-levels",
      "0021-metered-billing-grants",
      "0022-encrypt-webhook-secrets",
      "0025-esignature-menu-grants",
      "0027-profile-page-grants",
      "0032-esignature-technical-roles-only",
      "0035-tenant-settings-secrets",
      "0038-ai-assistant-menu",
      "0054-q20-management-page-grants",
    ]);
  });
});
