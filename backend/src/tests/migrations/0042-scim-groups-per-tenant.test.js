/**
 * Migration 0042 — scim_groups, owned by a tenant (ADR-053; A-38, A-39, A-49).
 *
 * Runs the migration against a fake QueryInterface. It proves the LOGIC: the
 * table is created only when absent, duplicates refuse the run before any
 * index is built (naming them), both unique indexes are created once and a
 * re-run creates nothing, `down` drops the table, and nothing is swallowed.
 *
 * The SQL itself was run against pgvector/pgvector:pg18 — up, re-run, down,
 * and the pg_indexes catalog — recorded on the A-38 card.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0042-scim-groups-per-tenant");

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0042-scim-groups-per-tenant.js"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const fakeQueryInterface = ({ tables = [], indexes = [], nameDuplicates = [], roleDuplicates = [] } = {}) => {
  const state = { tables: new Set(tables), indexes: new Set(indexes), ddl: [] };
  const qi = {
    state,
    showAllTables: jest.fn(async () => [...state.tables]),
    createTable: jest.fn(async (table) => {
      state.tables.add(table);
      state.ddl.push(`createTable ${table}`);
    }),
    addIndex: jest.fn(async (table, fields) => state.ddl.push(`addIndex ${fields.join(",")}`)),
    dropTable: jest.fn(async (table) => {
      state.tables.delete(table);
      state.ddl.push(`dropTable ${table}`);
    }),
    sequelize: {
      query: jest.fn(async (sql) => {
        if (/FROM pg_indexes/.test(sql)) {
          return [[...state.indexes].map((indexname) => ({ indexname }))];
        }
        if (/lower\(display_name\) AS key/.test(sql)) {
          return [nameDuplicates];
        }
        if (/role_id::text AS key/.test(sql)) {
          return [roleDuplicates];
        }
        const created = sql.match(/CREATE UNIQUE INDEX "([^"]+)"/);
        if (created) {
          state.indexes.add(created[1]);
          state.ddl.push(`createUniqueIndex ${created[1]}`);
          return [[]];
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    },
  };
  return qi;
};

describe("migration 0042 — scim_groups per tenant", () => {
  it("is registered in the static manifest", () => {
    expect(MANIFEST).toContain('["0042-scim-groups-per-tenant.js", require("../migrations/0042-scim-groups-per-tenant")]');
  });

  it("has no try/catch — a failure is never recorded as applied (CLAUDE.md)", () => {
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
    expect(SOURCE).not.toMatch(/\.catch\(/);
  });

  it("creates the table when absent, then both unique indexes, case-insensitive on the name", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([
      "createTable scim_groups",
      "addIndex tenant_id",
      "addIndex role_id",
      `createUniqueIndex ${migration.NAME_INDEX}`,
      `createUniqueIndex ${migration.ROLE_INDEX}`,
    ]);
    const sql = qi.sequelize.query.mock.calls.map(([s]) => s).join("\n");
    expect(sql).toContain("ON \"scim_groups\" (tenant_id, lower(display_name))");
    expect(sql).toContain("ON \"scim_groups\" (tenant_id, role_id)");
    const [, columns] = qi.createTable.mock.calls[0];
    expect(columns.tenant_id).toMatchObject({ allowNull: false, onDelete: "RESTRICT", references: { model: "tenants" } });
    expect(columns.role_id).toMatchObject({ allowNull: true, onDelete: "RESTRICT", references: { model: "roles" } });
  });

  it("leaves a table db.sync() already created, and only adds the indexes", async () => {
    const qi = fakeQueryInterface({ tables: ["scim_groups"] });

    await migration.up({ context: qi });

    expect(qi.createTable).not.toHaveBeenCalled();
    expect(qi.state.ddl).toEqual([`createUniqueIndex ${migration.NAME_INDEX}`, `createUniqueIndex ${migration.ROLE_INDEX}`]);
  });

  it("a second run changes nothing", async () => {
    const qi = fakeQueryInterface({ tables: ["scim_groups"], indexes: [migration.NAME_INDEX, migration.ROLE_INDEX] });

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([]);
  });

  it("refuses, naming them, while a tenant holds two groups whose names differ only in case — before any index", async () => {
    const qi = fakeQueryInterface({
      tables: ["scim_groups"],
      nameDuplicates: [{ tenant_id: "t-a", key: "engineers", n: 2 }],
    });

    await expect(migration.up({ context: qi })).rejects.toThrow(/tenant t-a: display name "engineers" × 2/);
    expect(qi.state.ddl).toEqual([]);
  });

  it("refuses while a tenant maps one role to two groups, and summarises a long list", async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ tenant_id: `t-${i}`, key: "role-x", n: 2 }));
    const qi = fakeQueryInterface({ tables: ["scim_groups"], roleDuplicates: many });

    await expect(migration.up({ context: qi })).rejects.toThrow(/role "role-x" × 2[\s\S]*… and more/);
    expect(qi.state.ddl).toEqual([]);
  });

  it("down drops the table, and is a no-op when it is already gone", async () => {
    const qi = fakeQueryInterface({ tables: ["scim_groups"] });

    await migration.down({ context: qi });
    await migration.down({ context: qi });

    expect(qi.state.ddl).toEqual(["dropTable scim_groups"]);
  });
});
