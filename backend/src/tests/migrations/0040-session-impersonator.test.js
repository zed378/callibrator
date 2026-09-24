/**
 * Migration 0040 — sessions.impersonator_id (A-146).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC: the column it adds and under which name
 * (taken from the Session MODEL's attribute — snake_case, as every column of
 * that model), that it is idempotent and reversible, that `down` revokes open
 * impersonation sessions before it forgets them, and that a real failure is
 * NOT swallowed and recorded as applied (0008/0013/0014). It does not prove the
 * DDL runs on PostgreSQL — that was checked on a PostgreSQL 18 container (the
 * A-146 section of TASKS/AUDIT-2026-09-REMEDIATION.md).
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const migration = require("../../migrations/0040-session-impersonator");

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0040-session-impersonator.js"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/** The REAL Session model on an unconnected PostgreSQL-dialect Sequelize. */
const Session = require("../../models/session.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

const BASE_COLUMNS = ["id", "user_id", "tenant_id", "token_hash", "expired_at", "is_revoked"];

const fakeQueryInterface = ({ columns = BASE_COLUMNS, indexes = [], describeError = null } = {}) => {
  const state = { columns: new Set(columns), indexes: new Set(indexes), added: [], removed: [], queries: [] };
  const qi = {
    state,
    sequelize: {
      Sequelize,
      query: jest.fn(async (sql) => {
        state.queries.push(sql);
        return [[], 0];
      }),
    },
    describeTable: jest.fn(async (table) => {
      expect(table).toBe("sessions");
      if (describeError) {throw describeError;}
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table, column, spec) => {
      expect(table).toBe("sessions");
      if (state.columns.has(column)) {throw new Error(`column "${column}" already exists`);}
      state.columns.add(column);
      state.added.push({ column, spec });
    }),
    removeColumn: jest.fn(async (table, column) => {
      state.columns.delete(column);
      state.removed.push(column);
    }),
    showIndex: jest.fn(async () => [...state.indexes].map((name) => ({ name }))),
    addIndex: jest.fn(async (table, fields, { name }) => {
      if (state.indexes.has(name)) {throw new Error(`relation "${name}" already exists`);}
      for (const f of fields) {
        if (!state.columns.has(f)) {throw new Error(`column "${f}" does not exist`);}
      }
      state.indexes.add(name);
    }),
    removeIndex: jest.fn(async (table, name) => {
      state.indexes.delete(name);
    }),
  };
  return qi;
};

describe("migration 0040 — sessions.impersonator_id", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain('["0040-session-impersonator.js", require("../migrations/0040-session-impersonator")]');
  });

  it("adds the column the Session model declares — snake_case, nullable, a CASCADE foreign key to users", () => {
    const attribute = Session.getAttributes().impersonator_id;
    expect(attribute.field).toBe(migration.COLUMN);
    expect(migration.COLUMN).toBe("impersonator_id");
    // The sessions model has no tenantId attribute (CLAUDE.md traps table).
    expect(Session.getAttributes().tenantId).toBeUndefined();
    const spec = migration.columnSpec(DataTypes);
    expect(spec.type.key).toBe(attribute.type.key);
    expect(spec.allowNull).toBe(true);
    expect(attribute.allowNull).toBe(true);
    expect(spec.references).toEqual({ model: "users", key: "id" });
    expect(attribute.references).toEqual({ model: "users", key: "id" });
    expect(spec.onDelete).toBe("CASCADE");
    expect(attribute.onDelete).toBe("CASCADE");
  });

  it("up adds the column and its index", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.state.added.map((a) => a.column)).toEqual(["impersonator_id"]);
    expect(qi.addIndex).toHaveBeenCalledWith("sessions", ["impersonator_id"], { name: "sessions_impersonator_id" });
  });

  it("up is idempotent — a second run (or a fresh db.sync()'d table) changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    qi.addColumn.mockClear();
    qi.addIndex.mockClear();

    await migration.up({ context: qi });

    expect(qi.addColumn).not.toHaveBeenCalled();
    expect(qi.addIndex).not.toHaveBeenCalled();
  });

  it("up skips cleanly when the table does not exist yet", async () => {
    const qi = fakeQueryInterface({ describeError: new Error('No description found for "sessions" table.') });

    await expect(migration.up({ context: qi })).resolves.toBeUndefined();
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("up does NOT swallow any other failure — Umzug must not record it as applied", async () => {
    const qi = fakeQueryInterface({ describeError: new TypeError("context.describeTable is not a function") });

    await expect(migration.up({ context: qi })).rejects.toThrow("describeTable is not a function");
  });

  it("an addColumn failure propagates", async () => {
    const qi = fakeQueryInterface();
    qi.addColumn.mockRejectedValueOnce(new Error("permission denied for table sessions"));

    await expect(migration.up({ context: qi })).rejects.toThrow("permission denied");
  });

  it("down revokes every open impersonation session, then removes the index and the column", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });

    await migration.down({ context: qi });

    expect(qi.state.queries).toEqual([migration.REVOKE_IMPERSONATION_SESSIONS]);
    expect(migration.REVOKE_IMPERSONATION_SESSIONS).toBe(
      "UPDATE sessions SET is_revoked = true, is_active = false, revoked_at = now(), " +
        "revoked_reason = 'MIGRATION_0040_DOWN' WHERE impersonator_id IS NOT NULL AND is_revoked = false",
    );
    expect(qi.state.removed).toEqual(["impersonator_id"]);
    expect(qi.state.indexes.size).toBe(0);
    expect([...qi.state.columns].sort()).toEqual([...BASE_COLUMNS].sort());
  });

  it("down is idempotent — without the column it revokes and removes nothing", async () => {
    const qi = fakeQueryInterface();

    await migration.down({ context: qi });

    expect(qi.sequelize.query).not.toHaveBeenCalled();
    expect(qi.removeColumn).not.toHaveBeenCalled();
    expect(qi.removeIndex).not.toHaveBeenCalled();
  });

  it("down skips when the table is absent, and propagates anything else", async () => {
    await expect(
      migration.down({ context: fakeQueryInterface({ describeError: new Error('relation "sessions" does not exist') }) }),
    ).resolves.toBeUndefined();
    await expect(
      migration.down({ context: fakeQueryInterface({ describeError: new Error("connection reset") }) }),
    ).rejects.toThrow("connection reset");
  });

  it("a failed error is not swallowed by an err without a message", async () => {
    const qi = fakeQueryInterface({ describeError: {} });

    await expect(migration.up({ context: qi })).rejects.toEqual({});
  });

  describe("no blanket catch (CLAUDE.md traps table)", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    it("has no `catch {` — a catch that cannot even look at what it caught", () => {
      expect(code).not.toMatch(/catch\s*\{/);
    });

    it("has exactly one catch, and it re-throws what it does not recognise", () => {
      const catches = [...code.matchAll(/catch\s*\(\s*(\w+)\s*\)/g)];
      expect(catches).toHaveLength(1);
      const [match, name] = catches[0];
      const start = code.indexOf(match);
      const body = code.slice(start, code.indexOf("\n};", start));
      expect(body).toContain(`throw ${name};`);
    });
  });
});
