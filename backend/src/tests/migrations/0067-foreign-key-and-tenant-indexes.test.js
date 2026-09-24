/**
 * Migration 0067 — indexes on every tenant column and foreign key (D-20) and
 * the iot_readings time-range indexes (D-19).
 *
 * The SQL runs against a real PostgreSQL in
 * tests/services/dataLayer.dbB.live.test.js (opt-in; proven on PG16: a fresh
 * sync() + every migration leaves ZERO foreign-key columns without a leading
 * index). This suite needs no database and runs in every `make verify`:
 *
 *  - the REVIEW RULE of the card ("a model declaring tenantId and no
 *    tenant_id index fails review"), widened to every foreign key: each
 *    REFERENCES column any model renders, and each tenant column, is served by
 *    a leading-column index — declared by the model (index block, unique
 *    attribute, primary key) or created by a migration (this one, or the
 *    audit_logs ones of 0029/0062). A new foreign key with no index fails here;
 *  - every INDEXES entry names a real table and real columns, is not already
 *    served by the model (a redundant entry is a wasted write amplifier), and
 *    carries the Sequelize default name so a later model block converges;
 *  - `isCovered`, the skip rule, on its edge cases;
 *  - the migration is registered in the static manifest.
 */

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { db: new Sequelize({ dialect: "postgres", logging: false }) };
});

const fs = require("fs");
const path = require("path");
const models = require("../../models");
const migration = require("../../migrations/0067-foreign-key-and-tenant-indexes");
const m0062 = require("../../migrations/0062-audit-log-indexes");

const { INDEXES, isCovered } = migration;
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const sequelize = models.sequelize;
const allModels = [...new Set(Object.values(sequelize.models))];
const byTable = (table) => allModels.find((m) => m.getTableName() === table);

/** Indexes other migrations create, as [table, leading columns]. */
const OTHER_MIGRATIONS = [
  ["audit_logs", ["impersonator_id"]], // 0029
  ...m0062.INDEXES.map((x) => [
    m0062.TABLE,
    x.columns.split(",").map((c) => c.trim().split(" ")[0]),
  ]),
];

const fieldOf = (model, name) => (model.rawAttributes[name] && model.rawAttributes[name].field) || name;

/** Every leading-column list the MODEL itself makes PostgreSQL index. */
const modelIndexes = (model) => {
  const out = [];
  for (const index of model.options.indexes || []) {
    out.push(index.fields.map((f) => (typeof f === "string" ? fieldOf(model, f) : fieldOf(model, f.name || f.attribute))));
  }
  const uniqueGroups = {};
  for (const [name, attribute] of Object.entries(model.rawAttributes)) {
    if (attribute.primaryKey) {out.push([attribute.field || name]);}
    if (attribute.unique === true) {out.push([attribute.field || name]);}
    if (typeof attribute.unique === "string" || (attribute.unique && attribute.unique.name)) {
      const key = typeof attribute.unique === "string" ? attribute.unique : attribute.unique.name;
      (uniqueGroups[key] = uniqueGroups[key] || []).push(attribute.field || name);
    }
  }
  return out.concat(Object.values(uniqueGroups));
};

const asRows = (table, lists) => lists.map((columns) => ({ table_name: table, columns }));

/** [table, column] for every foreign key and tenant column the models render. */
const indexedColumnsNeeded = [];
for (const model of allModels) {
  const table = model.getTableName();
  for (const [name, attribute] of Object.entries(model.tableAttributes)) {
    const column = attribute.field || name;
    if (attribute.references || column === "tenant_id" || column === "tenantId") {
      indexedColumnsNeeded.push([table, column]);
    }
  }
}

describe("D-20 — every foreign key and tenant column has a leading index", () => {
  it("found them (a discovery that finds nothing tests nothing)", () => {
    expect(indexedColumnsNeeded.length).toBeGreaterThanOrEqual(150);
  });

  it.each(indexedColumnsNeeded)("%s.%s", (table, column) => {
    const model = byTable(table);
    const rows = [
      ...asRows(table, modelIndexes(model)),
      ...INDEXES.filter((x) => x.table === table).map((x) => ({ table_name: table, columns: x.columns })),
      ...OTHER_MIGRATIONS.filter(([t]) => t === table).map(([, columns]) => ({ table_name: table, columns })),
    ];
    const target = { table, columns: [column] };
    expect(`${table}.${column} indexed: ${isCovered(rows, target)}`).toBe(`${table}.${column} indexed: true`);
  });
});

describe("migration 0067 — the INDEXES list", () => {
  it.each(INDEXES.map((x) => [x.name, x]))("%s names a real table and real columns", (_n, x) => {
    const model = byTable(x.table);
    expect(model).toBeDefined();
    const fields = new Set(Object.values(model.tableAttributes).map((a) => a.field));
    for (const column of x.columns) {
      expect(`${x.table}.${column}: ${fields.has(column)}`).toBe(`${x.table}.${column}: true`);
    }
  });

  it.each(INDEXES.map((x) => [x.name, x]))("%s carries the Sequelize default index name", (_n, x) => {
    expect(x.name).toBe(`${x.table}_${x.columns.join("_")}`);
  });

  it("no entry is already served by the model on a fresh database — except the two iot_readings indexes the model also declares", () => {
    const redundant = INDEXES.filter((x) => isCovered(asRows(x.table, modelIndexes(byTable(x.table))), x)).map(
      (x) => x.name,
    );
    expect(redundant).toEqual([
      "iot_readings_tenant_id_device_id_timestamp",
      "iot_readings_tenant_id_timestamp",
    ]);
  });

  it("names are unique and audit_logs is left to D-08 (0062)", () => {
    expect(new Set(INDEXES.map((x) => x.name)).size).toBe(INDEXES.length);
    expect(INDEXES.some((x) => x.table === "audit_logs")).toBe(false);
  });
});

describe("migration 0067 — isCovered (the skip rule)", () => {
  const target = { table: "capas", columns: ["tenant_id", "status"] };
  it("an index with the same leading columns covers", () => {
    expect(isCovered([{ table_name: "capas", columns: ["tenant_id", "status", "id"] }], target)).toBe(true);
  });
  it("a shorter index does not", () => {
    expect(isCovered([{ table_name: "capas", columns: ["tenant_id"] }], target)).toBe(false);
  });
  it("the same columns in another order do not", () => {
    expect(isCovered([{ table_name: "capas", columns: ["status", "tenant_id"] }], target)).toBe(false);
  });
  it("another table's index does not", () => {
    expect(isCovered([{ table_name: "risks", columns: ["tenant_id", "status"] }], target)).toBe(false);
  });
  it("an expression index (no column names) does not", () => {
    expect(isCovered([{ table_name: "capas", columns: [null] }], target)).toBe(false);
    expect(isCovered([{ table_name: "capas", columns: null }], target)).toBe(false);
  });
});

describe("migrations 0066 and 0067 — registered", () => {
  it.each(["0066-signature-records-step-restrict", "0067-foreign-key-and-tenant-indexes"])("%s", (name) => {
    expect(MANIFEST).toContain(`["${name}.js", require("../migrations/${name}")]`);
  });
});
