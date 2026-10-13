/**
 * Migration 0137 (P21-08: `public_device_tokens`) — ADR-138 § 1 – 2, Am. 1; spec
 * MEMORY/specs/P19-07-public-device-page.md § 5.
 *
 * Proves the LOGIC against a fake QueryInterface: what it issues, in ONE transaction, on a database
 * sync() built and on one where it creates the table; that the table it creates is the model's
 * (column for column); that it throws — and so is not recorded as applied — when a prerequisite is
 * absent; that `down` refuses while a row exists. That the triggers FIRE, the indexes refuse and the
 * grants hold as `callibrator_app` (and the owner is bound too) is proven on PostgreSQL 18 by
 * publicDeviceTokens.p2108.live.
 */
import { DataTypes, Sequelize, type QueryInterface } from "sequelize";
import m0137 from "../../migrations/0137-public-device-tokens";
import definePublicDeviceToken from "../../models/publicDeviceToken.model";

const PREREQUISITES = ["tenants", "users", "calibration_devices"];
const TABLE = "public_device_tokens";

interface FakeOptions {
  tables?: string[];
  constraints?: string[];
  roleExists?: boolean;
  rows?: number;
}

const fake = ({ tables = [...PREREQUISITES, TABLE], constraints = [], roleExists = true, rows = 0 }: FakeOptions = {}) => {
  const state = { statements: [] as string[], transactions: 0, created: [] as string[] };
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
      if (sql === `SELECT count(*)::int AS n FROM ${TABLE}`) {
        return Promise.resolve([[{ n: rows }], null]);
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
    return Promise.resolve(attributes);
  });
  return { state, createTable, context: { sequelize, createTable } as unknown as QueryInterface };
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

const model = definePublicDeviceToken(new Sequelize({ dialect: "postgres", logging: false }), DataTypes);
const modelColumns = Object.fromEntries(
  Object.entries(model.getAttributes() as unknown as Record<string, AttributeLike>)
    .map(([name, a]) => [a.field ?? name, shape(a)] as const)
    .filter(([column]) => column !== "created_at"),
);

describe("migration 0137 — public_device_tokens (P21-08)", () => {
  it("creates exactly the model's table when absent — column for column; created_at NOT NULL; no updated_at", async () => {
    const qi = fake({ tables: PREREQUISITES });
    await m0137.up({ context: qi.context });
    expect(qi.state.created).toEqual([TABLE]);
    const attributes = (qi.createTable.mock.calls[0]?.[1] ?? {}) as Record<string, AttributeLike>;
    const created = Object.fromEntries(Object.entries(attributes).filter(([c]) => c !== "created_at").map(([c, a]) => [c, shape(a)]));
    expect(created).toEqual(modelColumns);
    expect(attributes["created_at"]).toMatchObject({ allowNull: false });
    expect(Object.keys(attributes)).not.toContain("updated_at");
  });

  it("on a database sync() built: the default, CHECKs, indexes, functions, ENABLE ALWAYS triggers, grants — one transaction", async () => {
    const qi = fake();
    await m0137.up({ context: qi.context });
    const s = qi.state.statements;
    expect([qi.state.transactions, qi.state.created, s[0]]).toEqual([1, [], "SET LOCAL lock_timeout = '10s'"]);
    expect(s).toContain(`ALTER TABLE ${TABLE} ALTER COLUMN created_at SET DEFAULT now()`);
    for (const name of Object.keys(m0137.CHECKS)) {
      expect(s.some((x) => x.includes(`ADD CONSTRAINT ${name} CHECK`))).toBe(true);
    }
    expect(s.filter((x) => x.includes("INDEX IF NOT EXISTS"))).toEqual([...m0137.INDEX_SQL]);
    expect(m0137.INDEX_SQL.map((x) => /INDEX IF NOT EXISTS (\w+)/.exec(x)?.[1])).toEqual([...m0137.INDEX_NAMES]);
    // ADR-138 § 2: the hash is unique GLOBALLY (no tenant column); one active link per device.
    expect(m0137.INDEX_SQL[0]).toBe(`CREATE UNIQUE INDEX IF NOT EXISTS public_device_tokens_token_hash_unique ON ${TABLE} (token_hash)`);
    expect(m0137.INDEX_SQL[1]).toMatch(/UNIQUE INDEX .* \(tenant_id, device_id\) WHERE revoked_at IS NULL$/);
    for (const [table, name] of m0137.TRIGGERS) {
      expect(s).toContain(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${name}`);
    }
    expect(s).toContain(`REVOKE UPDATE ON ${TABLE} FROM callibrator_app`);
    expect(s).toContain(`GRANT SELECT, INSERT, UPDATE (revoked_at, revoked_by, revoked_reason) ON ${TABLE} TO callibrator_app`);
    expect(s).toContain(`REVOKE DELETE, TRUNCATE ON ${TABLE} FROM callibrator_app`);
  });

  it("is idempotent: an existing CHECK is not added again", async () => {
    const qi = fake({ constraints: Object.keys(m0137.CHECKS) });
    await m0137.up({ context: qi.context });
    expect(qi.state.statements.some((x) => x.includes("ADD CONSTRAINT"))).toBe(false);
  });

  it("throws — and so is not recorded as applied — when a table it references or the application role is absent", async () => {
    await expect(m0137.up({ context: fake({ tables: ["tenants", "users"] }).context })).rejects.toThrow(/calibration_devices/);
    await expect(m0137.up({ context: fake({ roleExists: false }).context })).rejects.toThrow(/application role "callibrator_app" does not exist/);
  });

  it("down refuses while a link exists; otherwise drops the table and its functions", async () => {
    await expect(m0137.down({ context: fake({ rows: 2 }).context })).rejects.toThrow(/2 public device link\(s\)/);
    const qi = fake();
    await m0137.down({ context: qi.context });
    expect(qi.state.statements).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      `DROP TABLE IF EXISTS ${TABLE}`,
      "DROP FUNCTION IF EXISTS public_device_tokens_append_only()",
      "DROP FUNCTION IF EXISTS public_device_tokens_same_tenant()",
    ]);
    const absent = fake({ tables: PREREQUISITES });
    await m0137.down({ context: absent.context });
    expect(absent.state.statements).toContain(`DROP TABLE IF EXISTS ${TABLE}`);
  });
});
