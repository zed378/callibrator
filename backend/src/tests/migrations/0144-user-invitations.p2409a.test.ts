/**
 * Migration 0144 (P24-09a: `user_invitations`) — ADR-139 § 3 – § 4.
 *
 * Proves the LOGIC against a fake QueryInterface: what it issues, in ONE transaction, on a database
 * sync() built and on one where it creates the table; that the table it creates is the model's
 * (column for column); that it throws — and so is not recorded as applied — when a prerequisite is
 * absent; that `down` refuses while a row exists. That the triggers FIRE, the indexes refuse and the
 * grants hold as `callibrator_app` (and the owner is bound too) is proven on PostgreSQL 18 by
 * userInvitations.p2409a.live.
 */
import { DataTypes, Sequelize, type QueryInterface } from "sequelize";
import m0144 from "../../migrations/0144-user-invitations";
import defineUserInvitation from "../../models/userInvitation.model";

const PREREQUISITES = ["tenants", "users"];
const TABLE = "user_invitations";

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

const model = defineUserInvitation(new Sequelize({ dialect: "postgres", logging: false }), DataTypes);
const modelColumns = Object.fromEntries(
  Object.entries(model.getAttributes() as unknown as Record<string, AttributeLike>)
    .map(([name, a]) => [a.field ?? name, shape(a)] as const)
    .filter(([column]) => column !== "created_at"),
);

describe("migration 0144 — user_invitations (P24-09a)", () => {
  it("creates exactly the model's table when absent — column for column; created_at NOT NULL; no updated_at", async () => {
    const qi = fake({ tables: PREREQUISITES });
    await m0144.up({ context: qi.context });
    expect(qi.state.created).toEqual([TABLE]);
    const attributes = (qi.createTable.mock.calls[0]?.[1] ?? {}) as Record<string, AttributeLike>;
    const created = Object.fromEntries(Object.entries(attributes).filter(([c]) => c !== "created_at").map(([c, a]) => [c, shape(a)]));
    expect(created).toEqual(modelColumns);
    expect(attributes["created_at"]).toMatchObject({ allowNull: false });
    expect(Object.keys(attributes)).not.toContain("updated_at");
  });

  it("on a database sync() built: the default, CHECKs, indexes, functions, ENABLE ALWAYS triggers, grants — one transaction", async () => {
    const qi = fake();
    await m0144.up({ context: qi.context });
    const s = qi.state.statements;
    expect([qi.state.transactions, qi.state.created, s[0]]).toEqual([1, [], "SET LOCAL lock_timeout = '10s'"]);
    expect(s).toContain(`ALTER TABLE ${TABLE} ALTER COLUMN created_at SET DEFAULT now()`);
    for (const name of Object.keys(m0144.CHECKS)) {
      expect(s.some((x) => x.includes(`ADD CONSTRAINT ${name} CHECK`))).toBe(true);
    }
    expect(s.filter((x) => x.includes("INDEX IF NOT EXISTS"))).toEqual([...m0144.INDEX_SQL]);
    expect(m0144.INDEX_SQL.map((x) => /INDEX IF NOT EXISTS (\w+)/.exec(x)?.[1])).toEqual([...m0144.INDEX_NAMES]);
    // The hash is unique GLOBALLY (the acceptance has no tenant); one live invitation per user.
    expect(m0144.INDEX_SQL[0]).toBe(`CREATE UNIQUE INDEX IF NOT EXISTS user_invitations_token_hash_unique ON ${TABLE} (token_hash)`);
    expect(m0144.INDEX_SQL[1]).toMatch(/UNIQUE INDEX .* \(tenant_id, user_id\) WHERE accepted_at IS NULL AND revoked_at IS NULL$/);
    for (const [table, name] of m0144.TRIGGERS) {
      expect(s).toContain(`ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${name}`);
    }
    expect(s).toContain(`REVOKE UPDATE ON ${TABLE} FROM callibrator_app`);
    expect(s).toContain(`GRANT SELECT, INSERT, UPDATE (accepted_at, revoked_at, revoked_by, revoked_reason) ON ${TABLE} TO callibrator_app`);
    expect(s).toContain(`REVOKE DELETE, TRUNCATE ON ${TABLE} FROM callibrator_app`);
  });

  it("is idempotent: an existing CHECK is not added again", async () => {
    const qi = fake({ constraints: Object.keys(m0144.CHECKS) });
    await m0144.up({ context: qi.context });
    expect(qi.state.statements.some((x) => x.includes("ADD CONSTRAINT"))).toBe(false);
  });

  it("throws — and so is not recorded as applied — when a table it references or the application role is absent", async () => {
    await expect(m0144.up({ context: fake({ tables: ["tenants"] }).context })).rejects.toThrow(/users/);
    await expect(m0144.up({ context: fake({ roleExists: false }).context })).rejects.toThrow(/application role "callibrator_app" does not exist/);
  });

  it("down refuses while an invitation exists; otherwise drops the table and its functions", async () => {
    await expect(m0144.down({ context: fake({ rows: 2 }).context })).rejects.toThrow(/2 user invitation\(s\)/);
    const qi = fake();
    await m0144.down({ context: qi.context });
    expect(qi.state.statements).toEqual([
      "SET LOCAL lock_timeout = '10s'",
      `DROP TABLE IF EXISTS ${TABLE}`,
      "DROP FUNCTION IF EXISTS user_invitations_append_only()",
      "DROP FUNCTION IF EXISTS user_invitations_same_tenant()",
    ]);
    const absent = fake({ tables: PREREQUISITES });
    await m0144.down({ context: absent.context });
    expect(absent.state.statements).toContain(`DROP TABLE IF EXISTS ${TABLE}`);
  });
});
