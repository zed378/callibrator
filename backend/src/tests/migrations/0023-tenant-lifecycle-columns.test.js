/**
 * Migration 0023 — the tenant-lifecycle columns (W-01).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC: which columns it adds, under which names,
 * that it is idempotent and reversible, and — the trap this codebase has hit
 * three times (0008/0013/0014) — that a real failure is NOT swallowed and
 * recorded as applied. It does not prove the DDL runs on PostgreSQL: that was
 * checked with `\d tenants` against pgvector/pgvector:pg18 (see the record).
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const migration = require("../../migrations/0023-tenant-lifecycle-columns");

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0023-tenant-lifecycle-columns.js"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/** The REAL Tenant model on an unconnected PostgreSQL-dialect Sequelize. */
const Tenant = require("../../models/tenant.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

const LIFECYCLE_ATTRIBUTES = [
  "suspensionReason",
  "suspendedAt",
  "suspendedBy",
  "gracePeriodExpiresAt",
  "offboardedAt",
  "offboardRetentionExpiresAt",
];

const BASE_COLUMNS = ["id", "name", "status", "is_deleted", "created_at"];

/** A QueryInterface stand-in over one table. Unknown calls are not defined, so they throw. */
const fakeQueryInterface = ({ columns = BASE_COLUMNS, indexes = [], describeError = null } = {}) => {
  const state = { columns: new Set(columns), indexes: new Set(indexes), added: [], removed: [] };
  const qi = {
    state,
    sequelize: { Sequelize },
    describeTable: jest.fn(async (table) => {
      expect(table).toBe("tenants");
      if (describeError) {throw describeError;}
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table, column, spec) => {
      expect(table).toBe("tenants");
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

describe("migration 0023 — tenant lifecycle columns", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0023-tenant-lifecycle-columns.js", require("../migrations/0023-tenant-lifecycle-columns")]',
    );
  });

  it("adds exactly the columns the model maps its lifecycle attributes to (underscored)", () => {
    // Derived from the MODEL's own field mapping, so a camelCase column name
    // here — the trap on this table — cannot pass.
    const modelFields = LIFECYCLE_ATTRIBUTES.map((a) => Tenant.rawAttributes[a].field).sort();
    expect(Object.keys(migration.COLUMNS).sort()).toEqual(modelFields);
    expect(modelFields).toEqual([
      "grace_period_expires_at",
      "offboard_retention_expires_at",
      "offboarded_at",
      "suspended_at",
      "suspended_by",
      "suspension_reason",
    ]);
  });

  it("gives each column the model's type, nullable", () => {
    for (const attribute of LIFECYCLE_ATTRIBUTES) {
      const modelAttr = Tenant.rawAttributes[attribute];
      const spec = migration.COLUMNS[modelAttr.field](DataTypes);
      expect({ attribute, type: spec.type.key, allowNull: spec.allowNull }).toEqual({
        attribute,
        type: modelAttr.type.key,
        allowNull: true,
      });
    }
  });

  it("up adds every missing column and the scheduler's index", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.state.added.map((a) => a.column).sort()).toEqual(Object.keys(migration.COLUMNS).sort());
    expect(qi.addIndex).toHaveBeenCalledWith(
      "tenants",
      ["status", "grace_period_expires_at"],
      { name: "tenants_status_grace_period_expires_at" },
    );
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
    const qi = fakeQueryInterface({ describeError: new Error('No description found for "tenants" table.') });

    await expect(migration.up({ context: qi })).resolves.toBeUndefined();
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("up does NOT swallow any other failure — Umzug must not record it as applied", async () => {
    const qi = fakeQueryInterface({ describeError: new TypeError("context.describeTable is not a function") });

    await expect(migration.up({ context: qi })).rejects.toThrow("describeTable is not a function");
  });

  it("an addColumn failure propagates", async () => {
    const qi = fakeQueryInterface();
    qi.addColumn.mockRejectedValueOnce(new Error("permission denied for table tenants"));

    await expect(migration.up({ context: qi })).rejects.toThrow("permission denied");
  });

  it("down removes the index and the columns, and is idempotent", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });

    await migration.down({ context: qi });
    expect(qi.state.removed.sort()).toEqual(Object.keys(migration.COLUMNS).sort());
    expect(qi.state.indexes.size).toBe(0);
    expect([...qi.state.columns].sort()).toEqual([...BASE_COLUMNS].sort());

    qi.removeColumn.mockClear();
    await migration.down({ context: qi });
    expect(qi.removeColumn).not.toHaveBeenCalled();
    expect(qi.removeIndex).toHaveBeenCalledTimes(1);
  });

  it("down skips when the table is absent, and propagates anything else", async () => {
    await expect(
      migration.down({ context: fakeQueryInterface({ describeError: new Error('relation "tenants" does not exist') }) }),
    ).resolves.toBeUndefined();
    await expect(
      migration.down({ context: fakeQueryInterface({ describeError: new Error("connection reset") }) }),
    ).rejects.toThrow("connection reset");
  });

  describe("no blanket catch (CLAUDE.md traps table)", () => {
    // Code only: the header comment names the anti-pattern it avoids.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    it("has no `catch {` — a catch that cannot even look at what it caught", () => {
      expect(code).not.toMatch(/catch\s*\{/);
    });

    it("has exactly one catch, and it re-throws what it does not recognise", () => {
      const catches = [...code.matchAll(/catch\s*\(\s*(\w+)\s*\)/g)];
      expect(catches).toHaveLength(1);
      const [match, name] = catches[0];
      const start = code.indexOf(match);
      // From the catch to the end of its enclosing top-level function.
      const body = code.slice(start, code.indexOf("\n};", start));
      expect(body).toContain(`throw ${name};`);
    });
  });
});
