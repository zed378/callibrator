/**
 * A-148 / A-149 — every association foreign key, as the models declare them
 * to sync(). The rest of the A-88 shape, after tenantForeignKeys.a88.test.js
 * covered the tenant and regulated-user keys (ADR-051 Q-16, migration 0030).
 *
 * Same technique: DATA-DRIVEN over every model in the REAL barrel, on an
 * unconnected PostgreSQL-dialect Sequelize, rendering each column's DDL
 * exactly as `Model.sync()` does (`tableAttributes` → `normalizeAttribute` →
 * `queryGenerator.attributesToSQL`, the path in QueryInterface#createTable).
 *
 * What it holds, for ALL models and ALL associations:
 *  - no model has two attributes on one column — the A-88 duplicate that an
 *    association naming the COLUMN (`foreignKey: "device_id"`) adds, and that
 *    made sync() build the column nullable with the association's default
 *    action (SET NULL) whatever the model declared;
 *  - every association's foreignKey (and a belongsToMany's otherKey) is an
 *    ATTRIBUTE of the model that holds the key;
 *  - every column on migration 0037's TARGETS renders exactly the reviewed
 *    decision: `REFERENCES "<ref>" ("id") ON DELETE <action> ON UPDATE
 *    CASCADE`, NOT NULL exactly when `notNull` — so a fresh sync() builds what
 *    0037 converges a migrated database to;
 *  - every association on a TARGETS column states that onDelete explicitly;
 *  - every REFERENCES column any model renders is a reviewed decision: on
 *    TARGETS, under 0030 (tenant keys, USER_FK_RESTRICT), or on UNCHANGED
 *    below with the action it has today. A new foreign key fails here until
 *    someone decides its ON DELETE.
 *
 * Not "a test generated from the code it tests" (CLAUDE.md, Evidence): the
 * expectations are the reviewed list in migration 0037 — the decision — and
 * the subject is the DDL Sequelize renders from the models. Against the
 * pre-A-148 models, 64 columns carry a duplicate attribute and render
 * nullable + SET NULL; the two A-149 columns render no REFERENCES at all.
 *
 * Proven against PostgreSQL 18 too (pgvector/pgvector:pg18): a database built
 * by the pre-change models' sync() + migrations 0001–0034 with a row in every
 * table, migrated by 0037, and a database built by these models' sync() +
 * every migration have identical foreign-key catalogs (156) and identical
 * nullability on every column.
 */

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async () => [];
  return { db };
});

const models = require("../../models");
const { TARGETS } = require("../../migrations/0037-association-foreign-keys");
const q16 = require("../../migrations/0030-tenant-foreign-keys-restrict");

const sequelize = models.sequelize;
const queryGenerator = sequelize.getQueryInterface().queryGenerator;
const allModels = [...new Set(Object.values(sequelize.models))];
const byTable = (table) => allModels.find((m) => m.getTableName() === table);

/**
 * Foreign keys outside A-148/A-149 and outside 0030, reviewed and left as
 * they are on every database today (none was an A-88 duplicate). Listed so a
 * NEW foreign key cannot appear without a decision.
 */
const UNCHANGED = Object.freeze({
  "api_keys.created_by": "users SET NULL",
  "certificates.created_by": "users NO ACTION",
  "certificates.updated_by": "users NO ACTION",
  "certificates.deleted_by": "users NO ACTION",
  "invoices.subscription_id": "subscriptions CASCADE",
  "kanban_card_relations.project_id": "kanban_projects CASCADE",
  "maintenance_work_orders.device_id": "calibration_devices CASCADE",
  "maintenance_work_orders.vendor_id": "vendors SET NULL",
  "maintenance_work_orders.assigned_to": "users SET NULL",
  "notifications.user_id": "users CASCADE",
  "notification_states.notification_id": "notifications CASCADE",
  "notification_states.user_id": "users CASCADE",
  "post_categories.post_id": "posts CASCADE",
  "post_categories.category_id": "categories CASCADE",
  "sessions.user_id": "users CASCADE",
  "signature_records.workflow_step_id": "signature_workflow_steps RESTRICT", // D-18, migration 0066
  "tenant_backups.created_by": "users SET NULL",
  "tenant_backups.deleted_by": "users NO ACTION",
  "webhooks.created_by": "users SET NULL",
  "workflow_actions.instance_id": "workflow_instances CASCADE",
  "workflow_actions.step_id": "workflow_steps CASCADE",
  "workflow_actions.user_id": "users SET NULL",
  "workflow_instances.workflow_id": "workflows CASCADE",
  "workflow_steps.workflow_id": "workflows CASCADE",
  "workflow_steps.role_id": "roles RESTRICT",

  // Added by concurrent work (2026-09-24), each with its own migration; they
  // are that work's decisions, recorded here so this list stays complete.
  "signature_workflows.requested_by": "users RESTRICT", // A-170
  "sessions.impersonator_id": "users CASCADE",
  "scim_groups.role_id": "roles RESTRICT",
});

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

/** Attribute names whose column is `field`. */
const attributesOn = (model, field) =>
  Object.entries(model.rawAttributes)
    .filter(([name, attribute]) => (attribute.field || name) === field)
    .map(([name]) => name);

/** [table, column, referenced table, action or "NO ACTION"] for every REFERENCES. */
const references = [];
for (const model of allModels) {
  for (const [field, ddl] of Object.entries(columnDdl(model))) {
    const m = /REFERENCES "([^"]+)" \("id"\)(?: ON DELETE (RESTRICT|CASCADE|SET NULL|NO ACTION))?/.exec(ddl);
    if (m) {
      references.push([model.getTableName(), field, m[1], m[2] || "NO ACTION"]);
    }
  }
}

/** Every [label, association] in the barrel. */
const associations = [];
for (const model of allModels) {
  for (const association of Object.values(model.associations)) {
    associations.push([`${model.name}.${association.as}`, association]);
  }
}

/** The model that holds the association's foreign key. */
const holderOf = (association) => {
  if (association.associationType === "BelongsTo") {
    return association.source;
  }
  if (association.associationType === "BelongsToMany") {
    return association.through.model;
  }
  return association.target;
};

describe("A-148 — no model carries a second attribute on one column", () => {
  it.each(allModels.map((m) => [m.getTableName(), m]))("%s", (_table, model) => {
    const duplicated = Object.keys(model.tableAttributes).filter((field) => attributesOn(model, field).length > 1);
    expect(duplicated).toEqual([]);
  });
});

describe("A-148 — every association names an attribute, never a column", () => {
  it("found the associations", () => {
    expect(associations.length).toBeGreaterThanOrEqual(180);
  });

  it.each(associations)("%s", (_name, association) => {
    const holder = holderOf(association);
    const keys = [association.foreignKey];
    if (association.associationType === "BelongsToMany") {
      keys.push(association.otherKey);
    }
    for (const key of keys) {
      const attribute = holder.rawAttributes[key];
      expect(attribute).toBeDefined();
      // One attribute on its column: the key is not a column name that
      // shadows a camelCase attribute.
      expect(attributesOn(holder, attribute.field || key)).toEqual([key]);
    }
  });
});

describe("A-148 / A-149 — each 0037 decision is what sync() builds", () => {
  it("every TARGETS entry names a real table (a typo would test nothing)", () => {
    for (const { table } of TARGETS) {
      expect(byTable(table)).toBeDefined();
    }
  });

  describe.each(TARGETS.map((t) => [t.table, t.column, t]))("%s.%s", (table, column, target) => {
    const model = byTable(table);

    it(`references ${target.ref} ON DELETE ${target.action} ON UPDATE CASCADE`, () => {
      expect(columnDdl(model)[column]).toContain(
        `REFERENCES "${target.ref}" ("id") ON DELETE ${target.action} ON UPDATE CASCADE`,
      );
    });

    it(target.notNull ? "is NOT NULL" : "stays nullable", () => {
      expect(/NOT NULL/.test(columnDdl(model)[column])).toBe(target.notNull);
    });

    it("every association on the column states that onDelete", () => {
      const found = associations
        .map(([, a]) => a)
        .filter((a) => a.associationType !== "BelongsToMany")
        .filter((a) => {
          const holder = holderOf(a);
          const attribute = holder.rawAttributes[a.foreignKey];
          return holder.getTableName() === table && attribute && (attribute.field || a.foreignKey) === column;
        });
      for (const association of found) {
        expect(association.options.onDelete).toBe(target.action);
      }
    });
  });

  it("the regulated links are RESTRICT, not CASCADE or SET NULL", () => {
    const ddl = (table, column) => columnDdl(byTable(table))[column];
    expect(ddl("calibration_records", "device_id")).toMatch(/NOT NULL REFERENCES .* ON DELETE RESTRICT/);
    expect(ddl("certificates", "calibration_record_id")).toMatch(/ON DELETE RESTRICT/);
    expect(ddl("capas", "nc_id")).toMatch(/NOT NULL REFERENCES .* ON DELETE RESTRICT/);
    expect(ddl("signature_workflow_steps", "signer_id")).toMatch(/REFERENCES "users" \("id"\) ON DELETE RESTRICT/);
    expect(ddl("signature_records", "revoked_by")).toMatch(/REFERENCES "users" \("id"\) ON DELETE RESTRICT/);
  });
});

describe("every foreign key any model renders is a reviewed decision", () => {
  it("found them", () => {
    expect(references.length).toBeGreaterThanOrEqual(150);
  });

  it.each(references)("%s.%s → %s", (table, column, ref, action) => {
    const target = TARGETS.find((t) => t.table === table && t.column === column);
    if (target) {
      expect([ref, action]).toEqual([target.ref, target.action]);
      return;
    }
    if (ref === "tenants" && table !== "tenants") {
      expect(action).toBe(q16.tenantAction(table));
      return;
    }
    if (q16.USER_FK_RESTRICT.some((u) => u.table === table && u.column === column)) {
      expect([ref, action]).toEqual(["users", "RESTRICT"]);
      return;
    }
    if (table === "tenants" && column === "parent_id") {
      return; // the tenant hierarchy, outside Q-16 (0030) and A-148
    }
    expect(`${ref} ${action}`).toBe(UNCHANGED[`${table}.${column}`]);
  });
});
