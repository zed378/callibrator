/**
 * Migration 0052 — sessions.auth_method (A-160).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC: the column it adds and under which name
 * (taken from the Session MODEL's attribute — snake_case, as every column of
 * that model), that it is idempotent and reversible, and that a real failure
 * is NOT swallowed and recorded as applied (0008/0013/0014). The DDL itself was
 * run on PostgreSQL 16 (not 18 — no PostgreSQL 18 was reachable); see the
 * agent report for the psql transcript.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const migration = require("../../migrations/0052-session-auth-method");

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0052-session-auth-method.js"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/** The REAL Session model on an unconnected PostgreSQL-dialect Sequelize. */
const Session = require("../../models/session.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

const BASE_COLUMNS = ["id", "user_id", "tenant_id", "impersonator_id", "token_hash", "expired_at"];

const fakeQueryInterface = ({ columns = BASE_COLUMNS, describeError = null } = {}) => {
  const state = { columns: new Set(columns), added: [], removed: [] };
  return {
    state,
    sequelize: { Sequelize },
    describeTable: jest.fn(async (table) => {
      expect(table).toBe("sessions");
      if (describeError) {
        throw describeError;
      }
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table, column, spec) => {
      expect(table).toBe("sessions");
      if (state.columns.has(column)) {
        throw new Error(`column "${column}" already exists`);
      }
      state.columns.add(column);
      state.added.push({ column, spec });
    }),
    removeColumn: jest.fn(async (table, column) => {
      expect(table).toBe("sessions");
      state.columns.delete(column);
      state.removed.push(column);
    }),
  };
};

describe("migration 0052 — sessions.auth_method", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain('["0052-session-auth-method.js", require("../migrations/0052-session-auth-method")]');
  });

  it("adds the column the Session model declares — snake_case, a nullable VARCHAR(32)", async () => {
    const attribute = Session.getAttributes().auth_method;
    expect(attribute.field).toBe(migration.COLUMN);
    expect(migration.COLUMN).toBe("auth_method");
    expect(attribute.allowNull).toBe(true);
    // The sessions model has no tenantId attribute (CLAUDE.md traps table).
    expect(Session.getAttributes().tenantId).toBeUndefined();

    const qi = fakeQueryInterface();
    await migration.up({ context: qi });

    expect(qi.state.added).toHaveLength(1);
    const { column, spec } = qi.state.added[0];
    expect(column).toBe("auth_method");
    expect(spec.allowNull).toBe(true);
    expect(spec.type.toString()).toBe(attribute.type.toString());
    expect(spec.type.toString()).toBe("VARCHAR(32)");
  });

  it("is idempotent: a second up, or an up on a database db.sync() built, changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    await migration.up({ context: qi });
    expect(qi.addColumn).toHaveBeenCalledTimes(1);

    const fresh = fakeQueryInterface({ columns: [...BASE_COLUMNS, "auth_method"] });
    await migration.up({ context: fresh });
    expect(fresh.addColumn).not.toHaveBeenCalled();
  });

  it("is reversible, and down is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    await migration.down({ context: qi });
    await migration.down({ context: qi });

    expect(qi.state.removed).toEqual(["auth_method"]);
    expect(qi.state.columns.has("auth_method")).toBe(false);
  });

  it("skips (up and down) only when the sessions table does not exist yet", async () => {
    for (const message of ['relation "sessions" does not exist', "No description found for sessions table"]) {
      const qi = fakeQueryInterface({ describeError: new Error(message) });
      await expect(migration.up({ context: qi })).resolves.toBeUndefined();
      await expect(migration.down({ context: qi })).resolves.toBeUndefined();
      expect(qi.addColumn).not.toHaveBeenCalled();
      expect(qi.removeColumn).not.toHaveBeenCalled();
    }
  });

  it("any other failure propagates — never recorded as applied", async () => {
    const qi = fakeQueryInterface({ describeError: new Error("permission denied for table sessions") });
    await expect(migration.up({ context: qi })).rejects.toThrow("permission denied");
    await expect(migration.down({ context: qi })).rejects.toThrow("permission denied");

    const failingAdd = fakeQueryInterface();
    failingAdd.addColumn.mockRejectedValueOnce(new Error("lock timeout"));
    await expect(migration.up({ context: failingAdd })).rejects.toThrow("lock timeout");
  });

  it("has no blanket try/catch — the only catch is the table-existence probe", () => {
    expect(SOURCE.match(/\bcatch\s*\(/g)).toHaveLength(1);
  });
});
