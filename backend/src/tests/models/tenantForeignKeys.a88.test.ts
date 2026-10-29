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
import type * as ModelsModule from "../../models";
import type { Sequelize as SequelizeType } from "sequelize";

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<{ Sequelize: typeof SequelizeType }>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = (() => Promise.resolve([])) as unknown as typeof db.query;
  return { db };
});

/* eslint-disable @typescript-eslint/no-require-imports */
const models = require("../../models") as typeof ModelsModule;
const migration = require("../../migrations/0030-tenant-foreign-keys-restrict") as {
  TENANT_FK_CASCADE: string[];
  TENANT_NULLABLE: string[];
  USER_FK_RESTRICT: { table: string; column: string; notNull?: boolean }[];
  tenantAction: (table: string) => string;
};
const q51Targets = require("../../migrations/0105-api-key-actor-columns") as {
  TARGETS: { table: string; userColumn: string }[];
};
/* eslint-enable @typescript-eslint/no-require-imports */

const { TENANT_FK_CASCADE, TENANT_NULLABLE, USER_FK_RESTRICT, tenantAction } = migration;
// Q-51 (migration 0105): these user columns became nullable — an API key's row
// names the key in api_key_id instead, and a CHECK holds exactly one set.
const Q51_USER_COLUMNS = new Set(
  q51Targets.TARGETS.map((t) => `${t.table}.${t.userColumn}`),
);

const sequelize = models.sequelize;
interface QueryGeneratorLike {
  attributesToSQL(attrs: unknown, opts: unknown): Record<string, string>;
}
const queryGenerator = (sequelize.getQueryInterface() as unknown as { queryGenerator: QueryGeneratorLike }).queryGenerator;

interface ModelWithAttrs {
  getTableName(): string;
  tableAttributes: Record<string, unknown>;
  rawAttributes: Record<string, { field?: string }>;
  associations: Record<string, AssociationLike>;
  name: string;
}

interface AssociationLike {
  as: string;
  associationType: string;
  source: ModelWithAttrs;
  target: ModelWithAttrs;
  foreignKey: string;
  options: {
    onDelete?: string;
  };
}

// The barrel exports some models under two keys; walk each once.
const allModels = [...new Set(Object.values(sequelize.models))] as unknown as ModelWithAttrs[];

/** { field: "<column DDL>" } exactly as createTable renders it. */
const columnDdl = (model: ModelWithAttrs): Record<string, string> => {
  const attributes: Record<string, unknown> = {};
  for (const [field, attribute] of Object.entries(model.tableAttributes)) {
    attributes[field] = (sequelize as unknown as { normalizeAttribute(a: unknown): unknown }).normalizeAttribute(attribute);
  }
  return queryGenerator.attributesToSQL(attributes, {
    table: model.getTableName(),
    context: "createTable",
  });
};

/** Attributes (by name) whose column is `field`. */
const attributesOn = (model: ModelWithAttrs, field: string): string[] =>
  Object.entries(model.rawAttributes)
    .filter(([name, attribute]) => (attribute.field ?? name) === field)
    .map(([name]) => name);

const tenantColumns: [string, string, ModelWithAttrs, string][] = [];
for (const model of allModels) {
  for (const [field, ddl] of Object.entries(columnDdl(model))) {
    if (ddl.includes('REFERENCES "tenants"') && model.getTableName() !== "tenants") {
      tenantColumns.push([model.getTableName(), field, model, ddl]);
    }
  }
}

const byTable = (table: string): ModelWithAttrs => {
  const found = allModels.find((m) => m.getTableName() === table);
  if (!found) {
    throw new Error(`Model not found for table ${table}`);
  }
  return found;
};

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
    /* eslint-disable @typescript-eslint/no-require-imports */
    const droppedLater = (require("../../migrations/0047-drop-data-retention-policies") as { TABLE: string }).TABLE;
    /* eslint-enable @typescript-eslint/no-require-imports */
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
      expect(names[0] as string).toBe(table === "sessions" ? "tenant_id" : "tenantId");
    });

    it(`is ON DELETE ${tenantAction(table)} ON UPDATE CASCADE`, () => {
      expect(ddl).toMatch(new RegExp(`ON DELETE ${tenantAction(table)} ON UPDATE CASCADE`));
    });

    it(TENANT_NULLABLE.includes(table) ? "stays nullable (NULL is a meaning)" : "is NOT NULL", () => {
      expect(ddl.includes("NOT NULL")).toBe(!TENANT_NULLABLE.includes(table));
    });
  });

  it("audit_logs.tenant_id no longer cascades (W-20)", () => {
    const col = tenantColumns.find(([t]) => t === "audit_logs");
    const ddl = col ? col[3] : "";
    expect(ddl).toContain("ON DELETE RESTRICT");
  });
});

describe("Q-16 — user foreign keys on regulated records", () => {
  describe.each(USER_FK_RESTRICT.map((u) => [u.table, u.column, u] as const))("%s.%s", (table, column, spec) => {
    const model = byTable(table);

    it("has exactly one attribute on the column", () => {
      expect(attributesOn(model, column)).toHaveLength(1);
    });

    const notNull = Boolean(spec.notNull && !Q51_USER_COLUMNS.has(`${table}.${column}`));
    it(`references users ON DELETE RESTRICT${notNull ? ", NOT NULL" : ""}`, () => {
      const ddl = columnDdl(model)[column] as string;
      expect(ddl).toMatch(/REFERENCES "users" \("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/);
      expect(ddl.includes("NOT NULL")).toBe(notNull);
    });
  });

  it("calibration_records.performed_by is RESTRICT, not CASCADE (F-6)", () => {
    expect(columnDdl(byTable("calibration_records"))["performed_by"]).not.toMatch(/CASCADE ON UPDATE|DELETE CASCADE|SET NULL/);
  });
});

describe("Q-16 — associations name the attribute and the intended onDelete", () => {
  const tenantAssociations: [string, AssociationLike][] = [];
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

  it.each(USER_FK_RESTRICT.map((u) => [`${u.table}.${u.column}`, u] as const))(
    "every association on %s uses the attribute and RESTRICT",
    (_name, { table, column }) => {
      const found: AssociationLike[] = [];
      for (const model of allModels) {
        for (const association of Object.values(model.associations)) {
          const child = association.associationType === "BelongsTo" ? association.source : association.target;
          const attribute = child.rawAttributes[association.foreignKey];
          if (child.getTableName() === table && attribute?.field === column) {
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
