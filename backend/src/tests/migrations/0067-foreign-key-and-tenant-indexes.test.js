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
 *    attribute, primary key) or created by a migration. The migration side is
 *    READ from every migration by tests/fixtures/migrationScan (the closed-world
 *    evaluator of the AM-3 guard): each `addIndex` and each `CREATE INDEX` a
 *    migration's `up` runs, minus a partial (`WHERE`) index and an index a later
 *    migration drops. ADR-100 Amendment 3 puts a new column's index in its
 *    migration, not its model (sync() runs before the migrator), so the model
 *    side alone cannot answer. A new foreign key with no index anywhere fails;
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
const { scanMigrations, scanMigrationSource } = require("../fixtures/migrationScan");

const { INDEXES, isCovered } = migration;
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

const sequelize = models.sequelize;
const allModels = [...new Set(Object.values(sequelize.models))];
const byTable = (table) => allModels.find((m) => m.getTableName() === table);

/**
 * Index sites of the migrations the reader cannot evaluate, each reviewed. Both
 * DROP an index whose name is read from the database; neither drops a
 * foreign-key or tenant index (a stale entry, or a new unreadable site, fails):
 */
const UNREADABLE_INDEX_SITES = Object.freeze({
  "0026-calibration-device-serial-per-tenant.ts":
    "removeIndex(TABLE, name) over globalUniques(): the legacy GLOBAL unique index on calibration_devices.serial_number, whatever it was named; the same migration adds the per-tenant (tenant_id, serial_number) index",
  "0070-custom-domain-partial-uniqueness.ts":
    'DROP INDEX "<legacy.index_name>": the legacy global unique index on custom_domains.domain; the same migration adds the partial per-tenant ones',
});

/**
 * The full (non-partial) indexes the migrations create, minus any a LATER
 * migration drops by name (a drop and re-create in one file is a rebuild).
 */
const migrationIndexes = (scan) =>
  scan.indexes.filter(
    (index) => !index.partial && !scan.dropped.some((d) => d.name === index.name && d.file > index.file),
  );

const SCAN = scanMigrations();
const MIGRATION_INDEXES = migrationIndexes(SCAN);

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

/** [table, column] for every foreign key and tenant column the given models render. */
const columnsNeedingIndex = (models) => {
  const out = [];
  for (const model of models) {
    const table = model.getTableName();
    for (const [name, attribute] of Object.entries(model.tableAttributes)) {
      const column = attribute.field || name;
      if (attribute.references || column === "tenant_id" || column === "tenantId") {
        out.push([table, column]);
      }
    }
  }
  return out;
};

/** Whether `table.column` leads an index: the model's own, 0067's list, or one a migration creates. */
const isIndexed = (model, table, column, created) => {
  const rows = [
    ...asRows(table, modelIndexes(model)),
    ...INDEXES.filter((x) => x.table === table).map((x) => ({ table_name: table, columns: x.columns })),
    ...created.filter((x) => x.table === table).map((x) => ({ table_name: table, columns: x.columns })),
  ];
  return isCovered(rows, { table, columns: [column] });
};

/** The core check: every FK / tenant column of `models` that no index leads. */
const unindexed = (models, created) =>
  columnsNeedingIndex(models)
    .filter(([table, column]) => !isIndexed(models.find((m) => m.getTableName() === table), table, column, created))
    .map(([table, column]) => `${table}.${column}`);

const indexedColumnsNeeded = columnsNeedingIndex(allModels);

describe("D-20 — every foreign key and tenant column has a leading index", () => {
  it("found them (a discovery that finds nothing tests nothing)", () => {
    expect(indexedColumnsNeeded.length).toBeGreaterThanOrEqual(150);
  });

  it.each(indexedColumnsNeeded)("%s.%s", (table, column) => {
    const indexed = isIndexed(byTable(table), table, column, MIGRATION_INDEXES);
    expect(`${table}.${column} indexed: ${indexed}`).toBe(`${table}.${column} indexed: true`);
  });
});

describe("D-20 — the migration side is read, not listed (ADR-100 Amendment 3)", () => {
  it("reads every index site of every migration, except the reviewed unreadable ones (closed world)", () => {
    const files = [...new Set(SCAN.unresolvedIndexes.map((u) => u.split(":")[0]))].sort();
    expect(files).toEqual(Object.keys(UNREADABLE_INDEX_SITES).sort());
  });

  it("is not vacuous: it finds indexes that only a migration creates", () => {
    const keys = new Set(MIGRATION_INDEXES.map((x) => `${x.table}(${x.columns.join(",")})`));
    for (const key of [
      "calibration_records(api_key_id)", // 0105 — the Amendment 3 case: no model index
      "stock_adjustments(api_key_id)", // 0105
      "stock_transfers(api_key_id)", // 0105
      "audit_logs(impersonator_id)", // 0029
      "certificates(submitted_by)", // 0095 (ADR-101)
      "access_requests(admin_user_id)", // 0099 (P10-05), a .map over FK_COLUMNS
    ]) {
      expect(`${key}: ${keys.has(key)}`).toBe(`${key}: true`);
    }
    // 0105's api_key_id columns are indexed by the migration ALONE (no model index).
    for (const table of ["calibration_records", "stock_adjustments", "stock_transfers"]) {
      expect(isCovered(asRows(table, modelIndexes(byTable(table))), { table, columns: ["api_key_id"] })).toBe(false);
    }
  });

  // A fixture model: one foreign key (widget_id) and a tenant column, neither
  // indexed by the model. The real `isIndexed` / `unindexed` judge it.
  const fixtureModel = () => {
    const { Sequelize, DataTypes } = jest.requireActual("sequelize");
    const s = new Sequelize({ dialect: "postgres", logging: false });
    const Widget = s.define("Widget", { id: { type: DataTypes.UUID, primaryKey: true } }, { tableName: "widgets", underscored: true });
    const Gadget = s.define(
      "Gadget",
      {
        id: { type: DataTypes.UUID, primaryKey: true },
        tenantId: { type: DataTypes.UUID, field: "tenant_id" },
        widgetId: { type: DataTypes.UUID, field: "widget_id", references: { model: "widgets", key: "id" } },
      },
      { tableName: "gadgets", underscored: true },
    );
    return [Widget, Gadget];
  };
  const created = (src) => migrationIndexes(scanMigrationSource("9999-fixture.ts", src));

  it("bites: a foreign key with NO index — neither the model's nor a migration's — fails", () => {
    expect(unindexed(fixtureModel(), MIGRATION_INDEXES)).toEqual(["gadgets.tenant_id", "gadgets.widget_id"]);
  });

  it("an FK index a migration creates (Amendment 3's place for it) satisfies the rule", () => {
    const src = `
      const TABLE = "gadgets";
      export = {
        up: async ({ context }: any) => {
          await context.sequelize.query(\`CREATE INDEX IF NOT EXISTS \${TABLE}_widget_id ON \${TABLE} (widget_id)\`);
          await context.addIndex(TABLE, ["tenant_id", "widget_id"]);
        },
        down: async () => undefined,
      };`;
    expect(unindexed(fixtureModel(), created(src))).toEqual([]);
  });

  it("bites: a PARTIAL index, an index built only in `down`, and one a later migration drops do not count", () => {
    const partial = created(`
      export = { up: async ({ context }: any) => {
        await context.sequelize.query("CREATE INDEX gadgets_widget_id ON gadgets (widget_id) WHERE widget_id IS NOT NULL");
        await context.sequelize.query("CREATE INDEX gadgets_tenant_id ON gadgets (tenant_id)");
      }, down: async () => undefined };`);
    expect(unindexed(fixtureModel(), partial)).toEqual(["gadgets.widget_id"]);

    const downOnly = created(`
      export = { up: async () => undefined, down: async ({ context }: any) => {
        await context.sequelize.query("CREATE INDEX gadgets_widget_id ON gadgets (widget_id)");
      } };`);
    expect(unindexed(fixtureModel(), downOnly)).toEqual(["gadgets.tenant_id", "gadgets.widget_id"]);

    const scan1 = scanMigrationSource("9998-create.ts", `
      export = { up: async ({ context }: any) => {
        await context.sequelize.query("CREATE INDEX gadgets_widget_id ON gadgets (widget_id)");
        await context.sequelize.query("CREATE INDEX gadgets_tenant_id ON gadgets (tenant_id)");
      }, down: async () => undefined };`);
    const scan2 = scanMigrationSource("9999-drop.ts", `
      export = { up: async ({ context }: any) => { await context.removeIndex("gadgets", "gadgets_widget_id"); },
        down: async () => undefined };`);
    const merged = {
      indexes: [...scan1.indexes, ...scan2.indexes],
      dropped: [...scan1.dropped, ...scan2.dropped],
    };
    expect(unindexed(fixtureModel(), migrationIndexes(merged))).toEqual(["gadgets.widget_id"]);
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
