/**
 * Migration 0078 — users.temporary_password_expires_at (A-215, ADR-068).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC: the column it adds and under which name
 * (taken from the User MODEL), the backfill it runs, that it is idempotent
 * and reversible, and that a failure is NOT swallowed and recorded as applied
 * (D-14: no try/catch at all). The DDL itself was run on PostgreSQL 18 — fresh
 * boot and upgrade — by authCards.a215.live.test.js.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const migration = require("../../migrations/0078-user-temporary-password-expiry");

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0078-user-temporary-password-expiry.js"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/** The REAL User model on an unconnected PostgreSQL-dialect Sequelize. */
const User = require("../../models/user.model")(new Sequelize({ dialect: "postgres", logging: false }), DataTypes);

const BASE_COLUMNS = ["id", "tenant_id", "password", "must_change_password"];

const fakeQueryInterface = ({ columns = BASE_COLUMNS, describeError = null } = {}) => {
  const state = { columns: new Set(columns), added: [], removed: [], queries: [] };
  return {
    state,
    sequelize: {
      Sequelize,
      query: jest.fn(async (sql) => {
        state.queries.push(sql);
      }),
    },
    describeTable: jest.fn(async (table) => {
      expect(table).toBe("users");
      if (describeError) {
        throw describeError;
      }
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table, column, spec) => {
      expect(table).toBe("users");
      if (state.columns.has(column)) {
        throw new Error(`column "${column}" already exists`);
      }
      state.columns.add(column);
      state.added.push({ column, spec });
    }),
    removeColumn: jest.fn(async (table, column) => {
      expect(table).toBe("users");
      state.columns.delete(column);
      state.removed.push(column);
    }),
  };
};

describe("migration 0078 — users.temporary_password_expires_at", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0078-user-temporary-password-expiry.js", require("../migrations/0078-user-temporary-password-expiry")]',
    );
  });

  it("adds the column the User model declares — a nullable timestamp", async () => {
    const attribute = User.getAttributes().temporaryPasswordExpiresAt;
    expect(attribute.field).toBe("temporary_password_expires_at");
    expect(migration.COLUMN).toBe(attribute.field);
    expect(attribute.allowNull).toBe(true);

    const qi = fakeQueryInterface();
    await migration.up({ context: qi });

    expect(qi.state.added).toHaveLength(1);
    const { column, spec } = qi.state.added[0];
    expect(column).toBe("temporary_password_expires_at");
    expect(spec.allowNull).toBe(true);
    // DATE is Sequelize's timestamp with time zone on PostgreSQL.
    expect(spec.type.key).toBe(attribute.type.key);
    expect(spec.type.key).toBe("DATE");
  });

  it("starts the clock for passwords issued before it: flagged rows with no expiry get 72 hours from now", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });

    expect(qi.state.queries).toEqual([migration.BACKFILL_SQL]);
    const sql = migration.BACKFILL_SQL.replace(/\s+/g, " ");
    expect(sql).toContain("SET \"temporary_password_expires_at\" = now() + interval '72 hours'");
    expect(sql).toContain("WHERE must_change_password = true");
    expect(sql).toContain("AND \"temporary_password_expires_at\" IS NULL");
  });

  it("is idempotent: a re-run, or an up on a database db.sync() built, adds nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    await migration.up({ context: qi });
    expect(qi.addColumn).toHaveBeenCalledTimes(1);

    const fresh = fakeQueryInterface({ columns: [...BASE_COLUMNS, "temporary_password_expires_at"] });
    await migration.up({ context: fresh });
    expect(fresh.addColumn).not.toHaveBeenCalled();
    // The backfill is itself idempotent (only NULL expiries); it still runs.
    expect(fresh.state.queries).toEqual([migration.BACKFILL_SQL]);
  });

  it("is reversible, and down is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    await migration.down({ context: qi });
    await migration.down({ context: qi });

    expect(qi.state.removed).toEqual(["temporary_password_expires_at"]);
    expect(qi.state.columns.has("temporary_password_expires_at")).toBe(false);
  });

  it("D-14: no try/catch; every failure propagates and is never recorded as applied", async () => {
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
    expect(SOURCE).not.toMatch(/\}\s*catch\b/);
    expect(SOURCE).not.toMatch(/\.catch\(/);

    const lost = fakeQueryInterface({ describeError: new Error("Connection terminated unexpectedly") });
    await expect(migration.up({ context: lost })).rejects.toThrow("Connection terminated");
    await expect(migration.down({ context: lost })).rejects.toThrow("Connection terminated");
    expect(lost.addColumn).not.toHaveBeenCalled();

    const failingBackfill = fakeQueryInterface();
    failingBackfill.sequelize.query.mockRejectedValueOnce(new Error("lock timeout"));
    await expect(migration.up({ context: failingBackfill })).rejects.toThrow("lock timeout");
  });

  it("declares no index, so db.sync() before the migrator creates nothing only the migration should", () => {
    expect(SOURCE).not.toMatch(/addIndex|CREATE\s+(UNIQUE\s+)?INDEX/i);
  });
});
