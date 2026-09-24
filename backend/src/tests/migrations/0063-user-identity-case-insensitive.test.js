/**
 * Migration 0063 — users.email / users.username unique case-insensitively
 * (D-06; ADR-051 Q-18 global identity kept).
 *
 * Runs the migration against a fake QueryInterface. It proves the LOGIC: the
 * refusal names account ids and tenants — never an address — before any DDL,
 * the two expression indexes are added once, and `down` removes only them.
 *
 * The SQL was run against PostgreSQL 16.13 (not 18) on a database built by
 * db.sync() + every migration, seeded with 1,000 users across 20 tenants plus
 * one account in tenant B whose email differed from tenant A's only by case:
 * the first run REFUSED 0063 naming that pair and created nothing; after the
 * pair was resolved it created users_email_lower_unique and
 * users_username_lower_unique, and both
 *   UPDATE users SET email = 'U1@SUB1.org' …  and  … username = 'USUB1N1' …
 * then failed with a duplicate-key error on the new indexes. A re-run, and
 * down + up, converged. A fresh database built both.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0063-user-identity-case-insensitive");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0063-user-identity-case-insensitive.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const fakeQueryInterface = ({ tables = ["users"], indexes = ["users_pkey", "users_email"], collisions = {} } = {}) => {
  const state = { indexes: new Set(indexes), ddl: [] };
  const qi = {
    state,
    showAllTables: jest.fn(async () => tables),
    showIndex: jest.fn(async () => [...state.indexes].map((name) => ({ name }))),
    sequelize: {
      query: jest.fn(async (sql) => {
        const grouped = /GROUP BY lower\((\w+)\)/.exec(sql);
        if (grouped) {
          return [collisions[grouped[1]] || []];
        }
        state.ddl.push(sql);
        const created = /^CREATE UNIQUE INDEX "([^"]+)"/.exec(sql);
        if (created) {
          state.indexes.add(created[1]);
        }
        const dropped = /^DROP INDEX IF EXISTS "([^"]+)"/.exec(sql);
        if (dropped) {
          state.indexes.delete(dropped[1]);
        }
        return [[]];
      }),
    },
  };
  return qi;
};

describe("migration 0063 — user identity unique case-insensitively (D-06)", () => {
  it("is registered in the static manifest under its .js name", () => {
    expect(MANIFEST).toContain(
      '["0063-user-identity-case-insensitive.js", require("../migrations/0063-user-identity-case-insensitive")]',
    );
  });

  it("has no catch: a failure fails the migration instead of recording it as applied", () => {
    expect(SOURCE).not.toMatch(/\.catch\(/);
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });

  it("adds UNIQUE (lower(email)) and UNIQUE (lower(username))", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([
      'CREATE UNIQUE INDEX "users_email_lower_unique" ON users (lower(email))',
      'CREATE UNIQUE INDEX "users_username_lower_unique" ON users (lower(username))',
    ]);
  });

  it("REFUSES on accounts that differ only by case, naming ids and tenants — not the address — before any DDL", async () => {
    const qi = fakeQueryInterface({
      collisions: {
        email: [{ ids: ["u-1", "u-2"], tenants: ["t-a", "t-b"] }],
        username: [{ ids: ["u-3", "u-4"], tenants: ["t-a", "none"] }],
      },
    });

    const err = await migration.up({ context: qi }).catch((e) => e);

    expect(err.message).toMatch(/^Migration 0063 refused: 2 group\(s\)/);
    expect(err.message).toContain("email: accounts u-1, u-2 (tenants t-a, t-b)");
    expect(err.message).toContain("username: accounts u-3, u-4 (tenants t-a, none)");
    expect(err.message).toMatch(/Nothing was changed/);
    expect(err.message).not.toMatch(/[\w.]+@[\w-]+\.\w+/);
    expect(qi.state.ddl).toEqual([]);
    // The collision query selects ids and tenants only.
    const collisionSql = qi.sequelize.query.mock.calls.map(([sql]) => sql).filter((s) => /GROUP BY/.test(s));
    expect(collisionSql).toHaveLength(2);
    for (const sql of collisionSql) {
      expect(sql).toMatch(/SELECT array_agg\(id::text[^)]*\) AS ids,\s+array_agg\(COALESCE\(tenant_id::text/);
      expect(sql).not.toMatch(/array_agg\((email|username)/);
    }
  });

  it("summarises a long collision list", async () => {
    const many = Array.from({ length: 23 }, (_, i) => ({ ids: [`a${i}`, `b${i}`], tenants: ["t1", "t2"] }));
    const qi = fakeQueryInterface({ collisions: { email: many } });

    const err = await migration.up({ context: qi }).catch((e) => e);

    expect(err.message).toContain("… and 3 more");
    expect(err.message.match(/email: accounts/g)).toHaveLength(20);
  });

  it("a second up changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    const after = qi.state.ddl.length;

    await migration.up({ context: qi });

    expect(qi.state.ddl).toHaveLength(after);
  });

  it("a users table db.sync() has not built yet is skipped (showAllTables, not a swallowed error)", async () => {
    const qi = fakeQueryInterface({ tables: [{ tableName: "Tenants" }] });

    await migration.up({ context: qi });

    expect(qi.sequelize.query).not.toHaveBeenCalled();
    expect(qi.showIndex).not.toHaveBeenCalled();
  });

  it("a failing collision query propagates", async () => {
    const qi = fakeQueryInterface();
    qi.sequelize.query.mockRejectedValueOnce(new Error("permission denied for table users"));

    await expect(migration.up({ context: qi })).rejects.toThrow(/permission denied/);
  });

  it("down drops exactly the two indexes it added", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    qi.state.ddl.length = 0;

    await migration.down({ context: qi });

    expect(qi.state.ddl).toEqual([
      'DROP INDEX IF EXISTS "users_email_lower_unique"',
      'DROP INDEX IF EXISTS "users_username_lower_unique"',
    ]);
    expect([...qi.state.indexes]).toEqual(["users_pkey", "users_email"]);
  });
});
