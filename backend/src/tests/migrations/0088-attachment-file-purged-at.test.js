/**
 * Migration 0088 — attachments.file_purged_at (D-22, ADR-083).
 *
 * Runs the migration against a fake QueryInterface over an in-memory table
 * description. It proves the LOGIC: the column it adds and under which name
 * (taken from the Attachment MODEL), that it is idempotent and reversible, and
 * that a failure is NOT swallowed and recorded as applied (D-14: no try/catch
 * at all). The DDL itself was run on PostgreSQL 18 — fresh boot and upgrade —
 * by dataLayer.dbD.live.test.js.
 */
const fs = require("fs");
const path = require("path");
const { Sequelize, DataTypes } = require("sequelize");

const migration = require("../../migrations/0088-attachment-file-purged-at");

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0088-attachment-file-purged-at.js"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/** The REAL Attachment model on an unconnected PostgreSQL-dialect Sequelize. */
const Attachment = require("../../models/attachment.model")(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

const fakeQueryInterface = ({ columns = ["id", "tenant_id", "is_deleted"], describeError = null } = {}) => {
  const state = { columns: new Set(columns), added: [], removed: [] };
  return {
    state,
    sequelize: { Sequelize },
    describeTable: jest.fn(async (table) => {
      expect(table).toBe("attachments");
      if (describeError) {
        throw describeError;
      }
      return Object.fromEntries([...state.columns].map((c) => [c, { type: "X" }]));
    }),
    addColumn: jest.fn(async (table, column, spec) => {
      expect(table).toBe("attachments");
      if (state.columns.has(column)) {
        throw new Error(`column "${column}" already exists`);
      }
      state.columns.add(column);
      state.added.push({ column, spec });
    }),
    removeColumn: jest.fn(async (table, column) => {
      state.columns.delete(column);
      state.removed.push(column);
    }),
  };
};

describe("migration 0088 — attachments.file_purged_at", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0088-attachment-file-purged-at.js", require("../migrations/0088-attachment-file-purged-at")]',
    );
  });

  it("adds the column the Attachment model declares — a nullable timestamp, no default", async () => {
    const attribute = Attachment.getAttributes().filePurgedAt;
    expect(attribute.field).toBe("file_purged_at");
    expect(migration.COLUMN).toBe(attribute.field);
    expect(attribute.allowNull).toBe(true);

    const qi = fakeQueryInterface();
    await migration.up({ context: qi });

    expect(qi.state.added).toHaveLength(1);
    const { column, spec } = qi.state.added[0];
    expect(column).toBe("file_purged_at");
    expect(spec.allowNull).toBe(true);
    expect(spec.defaultValue).toBeNull();
    expect(spec.type.key).toBe(attribute.type.key);
    expect(spec.type.key).toBe("DATE");
  });

  it("the model declares no index on it: sync() runs first and would fail on an upgraded database", () => {
    const indexed = (Attachment.options.indexes || []).flatMap((index) => index.fields);
    expect(indexed).not.toContain("file_purged_at");
    expect(indexed).not.toContain("filePurgedAt");
  });

  it("is idempotent: on a fresh database (the column already made by sync) it does nothing", async () => {
    const qi = fakeQueryInterface({ columns: ["id", "file_purged_at"] });
    await migration.up({ context: qi });
    expect(qi.addColumn).not.toHaveBeenCalled();
  });

  it("is reversible, and down on a database without the column does nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    await migration.down({ context: qi });
    expect(qi.state.removed).toEqual(["file_purged_at"]);
    await migration.down({ context: qi });
    expect(qi.removeColumn).toHaveBeenCalledTimes(1);
  });

  it("a failure fails the migration — nothing is swallowed and recorded as applied (D-14)", async () => {
    const qi = fakeQueryInterface({ describeError: new Error("Connection terminated unexpectedly") });
    await expect(migration.up({ context: qi })).rejects.toThrow("Connection terminated unexpectedly");
    // The header explains why there is no try/catch; the CODE must have none.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bcatch\b/);
  });
});
