/**
 * A-88 / ADR-051 Q-16 — tenant and regulated-user foreign keys, as the models
 * declare them to sync().
 *
 * DATA-DRIVEN over every model in the REAL barrel, on an unconnected
 * PostgreSQL-dialect Sequelize. For each model it renders the column DDL
 * exactly as `Model.sync()` does (`tableAttributes` → `normalizeAttribute` →
 * `queryGenerator.attributesToSQL`, the path in QueryInterface#createTable),
 * and asserts, for every column that REFERENCES "tenants":
 *   - it is the model's tenant ATTRIBUTE, and no second attribute maps to the
 *     same column (the A-88 duplicate that made sync() build it nullable +
 *     SET NULL);
 *   - NOT NULL, unless the table is on migration 0030's TENANT_NULLABLE;
 *   - ON DELETE RESTRICT, or CASCADE for migration 0030's TENANT_FK_CASCADE;
 *   - ON UPDATE CASCADE (what every association-built FK carries, so a fresh
 *     sync() and a migrated database have the same catalog).
 * The same for every column on 0030's USER_FK_RESTRICT, and every
 * association to or from Tenant (and each named user association) must use the
 * attribute foreign key with the intended onDelete explicitly.
 *
 * Why this is not "a test generated from the code it tests" (CLAUDE.md,
 * Evidence): the expectations are the reviewed lists in migration 0030 — the
 * decision — and the subject is the DDL Sequelize itself renders from the
 * models. Revert any model to `foreignKey: "tenant_id"` and that table's
 * column renders nullable + ON DELETE SET NULL; revert audit_logs to CASCADE
 * and its DDL says so.
 *
 * Proven against PostgreSQL too (pgvector/pgvector:pg18, 18.6): a database
 * built by the pre-change models' sync() plus migrations 0001–0030, and one
 * built by these models' sync() alone, have the same tenant and user foreign
 * keys, constraint for constraint.
 */

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async () => [];
  return { db };
});

const models = require("../../models");
const migration = require("../../migrations/0030-tenant-foreign-keys-restrict");

const { TENANT_FK_CASCADE, TENANT_NULLABLE, USER_FK_RESTRICT, tenantAction } = migration;

const sequelize = models.sequelize;
const queryGenerator = sequelize.getQueryInterface().queryGenerator;

// The barrel exports some models under two keys; walk each once.
const allModels = [...new Set(Object.values(sequelize.models))];

/** { field: "<column DDL>" } exactly as createTable renders it. */
const columnDdl = (model) => {
  const attributes = {};
  for (const [field, attribute] of Object.entries(model.tableAttributes)) {
    attributes[field] = sequelize.normalizeAttribute(attribute);
  }
  return queryGenerator.attributesToSQL(attributes, {
    table: model.getTableName(),
    context: "createTable",
  });
};

/** Attributes (by name) whose column is `field`. */
const attributesOn = (model, field) =>
  Object.entries(model.rawAttributes)
    .filter(([name, attribute]) => (attribute.field || name) === field)
    .map(([name]) => name);

const tenantColumns = [];
for (const model of allModels) {
  for (const [field, ddl] of Object.entries(columnDdl(model))) {
    if (/REFERENCES "tenants"/.test(ddl) && model.getTableName() !== "tenants") {
      tenantColumns.push([model.getTableName(), field, model, ddl]);
    }
  }
}

const byTable = (table) => allModels.find((m) => m.getTableName() === table);

describe("A-88 / Q-16 — tenant foreign keys as sync() builds them", () => {
  it("covers every tenant-owned table (the barrel loaded)", () => {
    expect(tenantColumns.length).toBeGreaterThanOrEqual(52);
  });

  it("every name on 0030's lists is a real table (a typo would silently mean RESTRICT)", () => {
    const tables = new Set(allModels.map((m) => m.getTableName()));
    // qms_counters has no model: migration 0024 creates it.
    for (const table of TENANT_FK_CASCADE.filter((t) => t !== "qms_counters")) {
      expect(tables.has(table)).toBe(true);
    }
    // data_retention_policies has no model any more: migration 0047 (A-137)
    // drops it. 0030 keeps naming it because 0030 still runs, before 0047, on
    // a database that has the table; on one without it the name matches no
    // constraint and is inert.
    const droppedLater = require("../../migrations/0047-drop-data-retention-policies").TABLE;
    expect(TENANT_NULLABLE).toContain(droppedLater);
    for (const table of TENANT_NULLABLE.filter((t) => t !== droppedLater)) {
      expect(tables.has(table)).toBe(true);
    }
    for (const { table } of USER_FK_RESTRICT) {
      expect(tables.has(table)).toBe(true);
    }
  });

  describe.each(tenantColumns)("%s.%s", (table, field, model, ddl) => {
    it("is the model's one tenant attribute — no duplicate (A-88)", () => {
      const names = attributesOn(model, field);
      expect(names).toHaveLength(1);
      // Session is the one model whose attribute is snake_case (G-04).
      expect(names[0]).toBe(table === "sessions" ? "tenant_id" : "tenantId");
    });

    it(`is ON DELETE ${tenantAction(table)} ON UPDATE CASCADE`, () => {
      expect(ddl).toMatch(new RegExp(`ON DELETE ${tenantAction(table)} ON UPDATE CASCADE`));
    });

    it(TENANT_NULLABLE.includes(table) ? "stays nullable (NULL is a meaning)" : "is NOT NULL", () => {
      expect(/NOT NULL/.test(ddl)).toBe(!TENANT_NULLABLE.includes(table));
    });
  });

  it("audit_logs.tenant_id no longer cascades (W-20)", () => {
    const [, , , ddl] = tenantColumns.find(([t]) => t === "audit_logs");
    expect(ddl).toContain("ON DELETE RESTRICT");
  });
});

describe("Q-16 — user foreign keys on regulated records", () => {
  describe.each(USER_FK_RESTRICT.map((u) => [u.table, u.column, u]))("%s.%s", (table, column, spec) => {
    const model = byTable(table);

    it("has exactly one attribute on the column", () => {
      expect(attributesOn(model, column)).toHaveLength(1);
    });

    it(`references users ON DELETE RESTRICT${spec.notNull ? ", NOT NULL" : ""}`, () => {
      const ddl = columnDdl(model)[column];
      expect(ddl).toMatch(/REFERENCES "users" \("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/);
      expect(/NOT NULL/.test(ddl)).toBe(spec.notNull);
    });
  });

  it("calibration_records.performed_by is RESTRICT, not CASCADE (F-6)", () => {
    expect(columnDdl(byTable("calibration_records")).performed_by).not.toMatch(/CASCADE ON UPDATE|DELETE CASCADE|SET NULL/);
  });
});

describe("Q-16 — associations name the attribute and the intended onDelete", () => {
  const tenantAssociations = [];
  for (const model of allModels) {
    for (const association of Object.values(model.associations)) {
      const touchesTenant = association.target.name === "Tenant" || model.name === "Tenant";
      if (touchesTenant && association.target !== association.source) {
        tenantAssociations.push([`${model.name}.${association.as}`, association]);
      }
    }
  }

  it("found the tenant associations", () => {
    expect(tenantAssociations.length).toBeGreaterThanOrEqual(50);
  });

  it.each(tenantAssociations)("%s", (_name, association) => {
    // The FK lives on the child: the source of a belongsTo, the target of a hasMany.
    const child = association.associationType === "BelongsTo" ? association.source : association.target;
    const table = child.getTableName();
    expect(association.foreignKey).toBe(table === "sessions" ? "tenant_id" : "tenantId");
    expect(child.rawAttributes[association.foreignKey]).toBeDefined();
    expect(association.options.onDelete).toBe(tenantAction(table));
  });

  it.each(USER_FK_RESTRICT.map((u) => [`${u.table}.${u.column}`, u]))(
    "every association on %s uses the attribute and RESTRICT",
    (_name, { table, column }) => {
      const found = [];
      for (const model of allModels) {
        for (const association of Object.values(model.associations)) {
          const child = association.associationType === "BelongsTo" ? association.source : association.target;
          const attribute = child.rawAttributes[association.foreignKey];
          if (child.getTableName() === table && attribute && attribute.field === column) {
            found.push(association);
          }
        }
      }
      expect(found.length).toBeGreaterThan(0);
      for (const association of found) {
        // The attribute name, never the column name (the A-88 shape).
        expect(association.foreignKey).not.toBe(column);
        expect(association.options.onDelete).toBe("RESTRICT");
      }
    },
  );
});
