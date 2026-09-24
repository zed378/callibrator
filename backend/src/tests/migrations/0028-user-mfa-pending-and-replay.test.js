/**
 * Migration 0028 — the TOTP enrolment and replay columns on `users`
 * (A-114, A-115).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC: which columns it adds, under which names
 * (the model's own `field`s — the camelCase-vs-snake_case trap), that it is
 * idempotent and reversible, and that a real failure is NOT swallowed and
 * recorded as applied (0008/0013/0014). It does not prove the DDL runs on
 * PostgreSQL.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const migration = require("../../migrations/0028-user-mfa-pending-and-replay");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0028-user-mfa-pending-and-replay.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/** The REAL User model on an unconnected PostgreSQL-dialect Sequelize. */
const User = require("../../models/user.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

const ATTRIBUTES = ["mfaPendingSecret", "mfaPendingCreatedAt", "mfaLastUsedStep"];
const BASE_COLUMNS = ["id", "username", "email", "mfa_enabled", "mfa_secret", "created_at"];

const fakeQueryInterface = ({ columns = BASE_COLUMNS, describeError = null } = {}) => {
  const state = { columns: new Set(columns), added: [], removed: [] };
  return {
    state,
    sequelize: { Sequelize },
    describeTable: jest.fn(async (table) => {
      expect(table).toBe("users");
      if (describeError) {throw describeError;}
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table, column, spec) => {
      expect(table).toBe("users");
      if (state.columns.has(column)) {throw new Error(`column "${column}" already exists`);}
      state.columns.add(column);
      state.added.push({ column, spec });
    }),
    removeColumn: jest.fn(async (table, column) => {
      state.columns.delete(column);
      state.removed.push(column);
    }),
  };
};

describe("migration 0028 — users MFA pending secret and replay step", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0028-user-mfa-pending-and-replay.js", require("../migrations/0028-user-mfa-pending-and-replay")]',
    );
  });

  it("adds exactly the columns the model maps its attributes to (underscored)", () => {
    const modelFields = ATTRIBUTES.map((a) => User.rawAttributes[a].field).sort();
    expect(Object.keys(migration.COLUMNS).sort()).toEqual(modelFields);
    expect(modelFields).toEqual(["mfa_last_used_step", "mfa_pending_created_at", "mfa_pending_secret"]);
  });

  it("gives each column the model's type, nullable", () => {
    for (const attribute of ATTRIBUTES) {
      const modelAttr = User.rawAttributes[attribute];
      const spec = migration.COLUMNS[modelAttr.field](DataTypes);
      expect({ attribute, type: spec.type.key, allowNull: spec.allowNull }).toEqual({
        attribute,
        type: modelAttr.type.key,
        allowNull: true,
      });
    }
  });

  it("up adds every missing column, and a second run changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    expect(qi.state.added.map((a) => a.column).sort()).toEqual(Object.keys(migration.COLUMNS).sort());

    qi.addColumn.mockClear();
    await migration.up({ context: qi });
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("up leaves mfa_secret — the live factor — alone", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    expect(qi.removeColumn).not.toHaveBeenCalled();
    expect(qi.state.columns.has("mfa_secret")).toBe(true);
  });

  it("up skips cleanly when the table does not exist yet", async () => {
    const qi = fakeQueryInterface({ describeError: new Error('No description found for "users" table.') });
    await expect(migration.up({ context: qi })).resolves.toBeUndefined();
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("up does NOT swallow any other failure — Umzug must not record it as applied", async () => {
    const qi = fakeQueryInterface({ describeError: new TypeError("context.describeTable is not a function") });
    await expect(migration.up({ context: qi })).rejects.toThrow("describeTable is not a function");
  });

  it("an addColumn failure propagates", async () => {
    const qi = fakeQueryInterface();
    qi.addColumn.mockRejectedValueOnce(new Error("permission denied for table users"));
    await expect(migration.up({ context: qi })).rejects.toThrow("permission denied");
  });

  it("down removes the three columns only, and is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });

    await migration.down({ context: qi });
    expect(qi.state.removed.sort()).toEqual(Object.keys(migration.COLUMNS).sort());
    expect([...qi.state.columns].sort()).toEqual([...BASE_COLUMNS].sort());

    qi.removeColumn.mockClear();
    await migration.down({ context: qi });
    expect(qi.removeColumn).not.toHaveBeenCalled();
  });

  it("down skips when the table is absent, and propagates anything else", async () => {
    await expect(
      migration.down({ context: fakeQueryInterface({ describeError: new Error('relation "users" does not exist') }) }),
    ).resolves.toBeUndefined();
    await expect(
      migration.down({ context: fakeQueryInterface({ describeError: new Error("connection reset") }) }),
    ).rejects.toThrow("connection reset");
  });

  describe("no blanket catch (CLAUDE.md traps table)", () => {
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    it("has no `catch {`", () => {
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
