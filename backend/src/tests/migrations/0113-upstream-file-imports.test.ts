/**
 * Migration 0113 — `upstream_file_imports` (the rsync image import).
 *
 * Proves the LOGIC against a fake QueryInterface: everything in ONE transaction; on a fresh
 * database (sync() made the table) only the constraints and indexes; on an upgraded one the table
 * too, column for column the model's; idempotent (an existing constraint is not added twice);
 * nothing swallowed (a failure propagates, so Umzug does not record it applied); `down` drops the
 * table and its ENUM type; the manifest registers it in order. The CHECK that a terminal row holds
 * no credential is asserted as SQL here; the boot on PostgreSQL 18 is the live check's.
 */
import * as fs from "fs";
import * as path from "path";
import { DataTypes, Sequelize, type QueryInterface } from "sequelize";
import migration from "../../migrations/0113-upstream-file-imports";
import defineUpstreamFileImport from "../../models/upstreamFileImport.model";

const read = (relative: string): string => fs.readFileSync(path.join(__dirname, relative), "utf8");

interface FakeOptions {
  tableExists?: boolean;
  constraints?: string[];
  failOn?: RegExp | null;
}

const fake = ({ tableExists = false, constraints = [], failOn = null }: FakeOptions = {}) => {
  const state = { statements: [] as string[], created: null as Record<string, { type: { key: string }; allowNull?: boolean }> | null, transactions: 0 };
  const sequelize = {
    query: jest.fn((sql: string, options: { transaction?: unknown; replacements?: Record<string, unknown> } = {}) => {
      expect(options.transaction).toBeDefined();
      if (failOn?.test(sql)) {
        return Promise.reject(new Error(`boom: ${sql.slice(0, 30)}`));
      }
      if (sql.includes("to_regclass")) {
        return Promise.resolve([[{ present: tableExists }], null]);
      }
      if (sql.includes("pg_constraint")) {
        return Promise.resolve([constraints.includes(String(options.replacements?.["name"])) ? [{ "?column?": 1 }] : [], null]);
      }
      state.statements.push(sql);
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn(async (fn: (t: object) => Promise<void>) => {
      state.transactions += 1;
      await fn({ id: "tx" });
    }),
  };
  const context = {
    sequelize,
    createTable: jest.fn((table: string, attributes: Record<string, { type: { key: string } }>, options: { transaction?: unknown }) => {
      expect(table).toBe("upstream_file_imports");
      expect(options.transaction).toBeDefined();
      state.created = attributes;
      return Promise.resolve();
    }),
  } as unknown as QueryInterface;
  return { context, state };
};

describe("migration 0113 — upstream_file_imports", () => {
  it("on an upgraded database: the table, the tenant FK, both CHECKs and every index — one transaction", async () => {
    const { context, state } = fake();
    await migration.up({ context });
    expect(state.transactions).toBe(1);
    expect(state.created).not.toBeNull();
    expect(state.statements).toEqual([migration.STATEMENTS.tenantFk, migration.STATEMENTS.checkSecret, migration.STATEMENTS.checkClass, ...migration.INDEX_SQL]);
    expect(migration.STATEMENTS.tenantFk).toMatch(/REFERENCES tenants \(id\) ON DELETE CASCADE/);
    expect(migration.STATEMENTS.checkSecret).toBe(
      "ALTER TABLE upstream_file_imports ADD CONSTRAINT upstream_file_imports_secret_only_while_live " +
        "CHECK (status IN ('pending', 'transferring', 'ingesting') OR secret_ciphertext IS NULL)",
    );
    expect(migration.INDEX_SQL).toEqual([
      "CREATE INDEX IF NOT EXISTS upstream_file_imports_created_at ON upstream_file_imports (created_at DESC, id DESC)",
      ...["target_tenant_id", "requested_by", "batch_job_id", "cancelled_by"].map(
        (c) => `CREATE INDEX IF NOT EXISTS upstream_file_imports_${c} ON upstream_file_imports (${c})`,
      ),
    ]);
  });

  it("the table it creates is the model's, column for column (type and nullability)", async () => {
    const { context, state } = fake();
    await migration.up({ context });
    const model = defineUpstreamFileImport(new Sequelize({ dialect: "postgres", logging: false }), DataTypes);
    const fromModel = Object.fromEntries(
      Object.values(model.getAttributes()).map((a) => [String(a.field), { key: (a.type as { key: string }).key, allowNull: a.allowNull !== false && a.primaryKey !== true }]),
    );
    const fromMigration = Object.fromEntries(
      Object.entries(state.created ?? {}).map(([column, a]) => [column, { key: a.type.key, allowNull: a.allowNull !== false }]),
    );
    expect(fromMigration).toEqual(fromModel);
  });

  it("on a fresh database (sync() made the table) and on a re-run: no table, no constraint twice", async () => {
    const { context, state } = fake({
      tableExists: true,
      constraints: [migration.TENANT_FK, migration.CHECK_SECRET, migration.CHECK_CLASS],
    });
    await migration.up({ context });
    expect(state.created).toBeNull();
    expect(state.statements).toEqual([...migration.INDEX_SQL]);
  });

  it("propagates a failure (never recorded as applied while doing nothing)", async () => {
    const { context } = fake({ failOn: /ADD CONSTRAINT upstream_file_imports_some_class/ });
    await expect(migration.up({ context })).rejects.toThrow("boom");
  });

  it("down drops the table and its ENUM type, in one transaction", async () => {
    const { context, state } = fake();
    await migration.down({ context });
    expect(state.statements).toEqual(["DROP TABLE IF EXISTS upstream_file_imports", "DROP TYPE IF EXISTS enum_upstream_file_imports_status"]);
    expect(state.transactions).toBe(1);
  });

  it("has no blanket try/catch and is registered in the manifest after 0112", () => {
    expect(read("../../migrations/0113-upstream-file-imports.ts")).not.toMatch(/\btry\s*\{/);
    const manifest = read("../../config/migrator.ts");
    const at = manifest.indexOf('"0113-upstream-file-imports.js"');
    expect(at).toBeGreaterThan(manifest.indexOf('"0112-inspection-catalogue.js"'));
  });
});
