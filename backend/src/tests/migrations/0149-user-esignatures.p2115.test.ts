/**
 * Migration 0149 (P21-15: `user_esignatures`, `esignature_applications`) — ADR-140; spec v2 § 2.
 *
 * Proves the LOGIC against a fake QueryInterface: what it issues, in ONE transaction, on a database
 * sync() built and on one where it creates the tables; that each table it creates is its model's
 * (column for column); that it throws — and so is not recorded as applied — when a prerequisite is
 * absent; that `down` refuses while a row exists; that it is registered right after 0148, has no
 * try/catch, and no model declares an index. That the triggers FIRE, the indexes refuse and the grants
 * hold as `callibrator_app` is proven on PostgreSQL 18 by userEsignatures.p2115.live.
 */
import * as fs from "fs";
import * as path from "path";
import { DataTypes, Sequelize, type QueryInterface } from "sequelize";
import m0149 from "../../migrations/0149-user-esignatures";
import defineUserEsignature from "../../models/userEsignature.model";
import defineEsignatureApplication from "../../models/esignatureApplication.model";

const PREREQUISITES = ["tenants", "users", "calibration_records", "certificates"];
const ESIG = "user_esignatures";
const APPS = "esignature_applications";

interface FakeOptions {
  tables?: string[];
  constraints?: string[];
  roleExists?: boolean;
  rows?: Record<string, number>;
}

const fake = ({ tables = [...PREREQUISITES, ESIG, APPS], constraints = [], roleExists = true, rows = {} }: FakeOptions = {}) => {
  const attributes: Record<string, Record<string, unknown>> = {};
  const state = { statements: [] as string[], transactions: 0, created: [] as string[], attributes };
  const sequelize = {
    query: jest.fn((sql: string, options: { transaction?: unknown; replacements?: Record<string, unknown> } = {}) => {
      expect(options.transaction).toBeDefined();
      const r = options.replacements ?? {};
      if (sql.includes("to_regclass")) {
        return Promise.resolve([[{ present: tables.includes(String(r["table"])) }], null]);
      }
      if (sql.startsWith("SELECT conname FROM pg_constraint")) {
        return Promise.resolve([constraints.map((conname) => ({ conname })), null]);
      }
      if (sql.includes("FROM pg_roles")) {
        return Promise.resolve([[{ exists: roleExists }], null]);
      }
      const count = /^SELECT count\(\*\)::int AS n FROM (\w+)$/.exec(sql);
      if (count) {
        return Promise.resolve([[{ n: rows[count[1] as string] ?? 0 }], null]);
      }
      state.statements.push(sql);
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn(async (work: (t: unknown) => Promise<void>) => {
      state.transactions += 1;
      await work({ id: "tx" });
    }),
  };
  const createTable = jest.fn((table: string, attributes: Record<string, unknown>, options: { transaction?: unknown }) => {
    expect(options.transaction).toBeDefined();
    state.created.push(table);
    state.attributes[table] = attributes;
    return Promise.resolve(attributes);
  });
  return { state, context: { sequelize, createTable } as unknown as QueryInterface };
};

interface AttributeLike {
  type: { key: string; options?: { length?: number } };
  allowNull?: boolean;
  primaryKey?: boolean;
  references?: { model: string; key: string };
  onDelete?: string;
  field?: string;
}

const shape = (a: AttributeLike) => ({
  type: a.type.key,
  length: a.type.options?.length,
  allowNull: a.primaryKey !== true && a.allowNull !== false,
  primaryKey: a.primaryKey === true,
  references: a.references ? `${a.references.model}.${a.references.key}` : undefined,
  onDelete: a.onDelete,
});

const db = new Sequelize({ dialect: "postgres", logging: false });
const models = { [ESIG]: defineUserEsignature(db, DataTypes), [APPS]: defineEsignatureApplication(db, DataTypes) };
const columnsOf = (attributes: Record<string, AttributeLike>, byField: boolean) =>
  Object.fromEntries(
    Object.entries(attributes)
      .map(([name, a]) => [byField ? (a.field ?? name) : name, shape(a)] as const)
      .filter(([column]) => column !== "created_at"),
  );

describe("migration 0149 — user_esignatures + esignature_applications (P21-15)", () => {
  it("creates exactly each model's table when absent — column for column; created_at NOT NULL; no updated_at", async () => {
    const qi = fake({ tables: PREREQUISITES });
    await m0149.up({ context: qi.context });
    expect(qi.state.created).toEqual([ESIG, APPS]);
    for (const table of [ESIG, APPS] as const) {
      const attributes = qi.state.attributes[table] as Record<string, AttributeLike>;
      expect(columnsOf(attributes, false)).toEqual(columnsOf((models[table] as unknown as { getAttributes(): Record<string, AttributeLike> }).getAttributes(), true));
      expect(attributes["created_at"]).toMatchObject({ allowNull: false });
      expect(Object.keys(attributes)).not.toContain("updated_at");
    }
  });

  it("on a database sync() built: the defaults, CHECKs, indexes, functions, ENABLE ALWAYS triggers and grants — one transaction", async () => {
    const qi = fake();
    await m0149.up({ context: qi.context });
    const s = qi.state.statements;
    expect([qi.state.transactions, qi.state.created, s[0]]).toEqual([1, [], "SET LOCAL lock_timeout = '10s'"]);
    for (const table of [ESIG, APPS]) {
      expect(s).toContain(`ALTER TABLE ${table} ALTER COLUMN created_at SET DEFAULT now()`);
    }
    for (const [table, name] of m0149.CHECKS) {
      expect(s.some((x) => x.startsWith(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK`))).toBe(true);
    }
    expect(Object.fromEntries(m0149.CHECKS.map(([, name, predicate]) => [name, predicate]))).toMatchObject({
      user_esignatures_status: "status IN ('active', 'superseded', 'revoked')",
      esignature_applications_meaning: "meaning IN ('performed', 'reviewed', 'approved', 'authored', 'acknowledged')",
      esignature_applications_document_id: "(document_type = 'document') = (document_id IS NULL)",
    });
    expect(s.filter((x) => x.includes("INDEX IF NOT EXISTS"))).toEqual([...m0149.INDEX_SQL]);
    expect(m0149.INDEX_SQL.map((x) => /INDEX IF NOT EXISTS (\w+)/.exec(x)?.[1])).toEqual([...m0149.INDEX_NAMES]);
    expect(m0149.INDEX_SQL[0]).toBe(`CREATE UNIQUE INDEX IF NOT EXISTS user_esignatures_one_active_per_user ON ${ESIG} (user_id) WHERE status = 'active'`);
    expect(m0149.INDEX_SQL[3]).toBe(`CREATE UNIQUE INDEX IF NOT EXISTS esignature_applications_token_unique ON ${APPS} (verification_token)`);
    expect(m0149.INDEX_SQL[4]).toMatch(/UNIQUE INDEX .* \(document_type, document_id, signer_user_id, meaning\) WHERE document_id IS NOT NULL$/);
    for (const [table, name] of m0149.TRIGGERS) {
      expect(s).toContain(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${name}`);
    }
    expect(s.slice(-6)).toEqual([
      `REVOKE UPDATE ON ${ESIG} FROM callibrator_app`,
      `GRANT SELECT, INSERT, UPDATE (status, superseded_at, revoked_at, revoked_reason) ON ${ESIG} TO callibrator_app`,
      `REVOKE DELETE, TRUNCATE ON ${ESIG} FROM callibrator_app`,
      `REVOKE UPDATE ON ${APPS} FROM callibrator_app`,
      `GRANT SELECT, INSERT ON ${APPS} TO callibrator_app`,
      `REVOKE UPDATE, DELETE, TRUNCATE ON ${APPS} FROM callibrator_app`,
    ]);
  });

  it("is idempotent: an existing CHECK is not added again", async () => {
    const qi = fake({ constraints: m0149.CHECKS.map(([, name]) => name) });
    await m0149.up({ context: qi.context });
    expect(qi.state.statements.some((x) => x.includes("ADD CONSTRAINT"))).toBe(false);
  });

  it("throws — and so is not recorded as applied — when a table it references or the application role is absent", async () => {
    await expect(m0149.up({ context: fake({ tables: ["tenants", "users", "calibration_records"] }).context })).rejects.toThrow(/certificates/);
    await expect(m0149.up({ context: fake({ roleExists: false }).context })).rejects.toThrow(/application role "callibrator_app" does not exist/);
  });

  it("down refuses while either table holds a row; otherwise drops both tables and the functions", async () => {
    await expect(m0149.down({ context: fake({ rows: { [APPS]: 2 } }).context })).rejects.toThrow(/esignature_applications holds 2 row\(s\)/);
    await expect(m0149.down({ context: fake({ rows: { [ESIG]: 1 } }).context })).rejects.toThrow(/user_esignatures holds 1 row\(s\)/);
    const qi = fake();
    await m0149.down({ context: qi.context });
    expect(qi.state.statements).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      `DROP TABLE IF EXISTS ${APPS}`,
      `DROP TABLE IF EXISTS ${ESIG}`,
      ...m0149.FUNCTIONS.map(([name]) => `DROP FUNCTION IF EXISTS ${name}()`),
    ]);
    const absent = fake({ tables: PREREQUISITES });
    await m0149.down({ context: absent.context });
    expect(absent.state.statements).toContain(`DROP TABLE IF EXISTS ${ESIG}`);
  });

  it("is registered right after 0148, has no try/catch, and neither model declares an index", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    const names = [...manifest.matchAll(/\["(\d{4}-[\w.-]+\.js)"/g)].map((m) => m[1]);
    expect(names.indexOf("0149-user-esignatures.js")).toBe(names.indexOf("0148-device-text-search-trgm.js") + 1);
    expect(fs.readFileSync(path.join(__dirname, "../../migrations/0149-user-esignatures.ts"), "utf8")).not.toMatch(/\btry\s*\{/);
    expect([models[ESIG].options.indexes ?? [], models[APPS].options.indexes ?? []]).toEqual([[], []]);
  });
});
