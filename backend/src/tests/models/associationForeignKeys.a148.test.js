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
// Q-51 (migration 0105): these user columns became nullable — an API key's row
// names the key in api_key_id instead, and a CHECK holds exactly one set.
const Q51_USER_COLUMNS = new Set(
  require("../../migrations/0105-api-key-actor-columns").TARGETS.map((t) => `${t.table}.${t.userColumn}`),
);
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
  // ADR-101 (migration 0095): who submitted it for approval; RESTRICT, as approved_by/signed_by.
  "certificates.submitted_by": "users RESTRICT",
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
  // P10-05 (migration 0099, ADR-098 §6): the platform's access-request queue.
  // SET NULL — the invited administrator or the deciding super admin may be
  // deleted; the request is history, not a regulated record.
  "access_requests.admin_user_id": "users SET NULL",
  "access_requests.decided_by": "users SET NULL",
  // ADR-108 Amendment 1 (migration 0104): a passkey goes with its user.
  "webauthn_credentials.user_id": "users CASCADE",
  // The rsync image import (migration 0113): a platform row. SET NULL — the requesting or
  // cancelling super admin may be deleted and the batch job purged; the import's history stays.
  // (target_tenant_id → tenants CASCADE is the migration's, not the model's: Q-16.)
  "upstream_file_imports.requested_by": "users SET NULL",
  "upstream_file_imports.cancelled_by": "users SET NULL",
  "upstream_file_imports.batch_job_id": "batch_jobs SET NULL",
  // The SQL-dump import (P24-06, migration 0114): a platform row, likewise. SET NULL — the
  // uploading or cancelling super admin may be deleted and the batch job purged; the run's
  // record stays. (notify_tenant_id is a routing hint with no key at all: Q-16.)
  "upstream_sql_imports.uploaded_by": "users SET NULL",
  "upstream_sql_imports.cancelled_by": "users SET NULL",
  "upstream_sql_imports.batch_job_id": "batch_jobs SET NULL",
  // P24-01 (migration 0133): the transform's requester and its job — the same reasoning.
  "upstream_sql_imports.transform_requested_by": "users SET NULL",
  "upstream_sql_imports.transform_batch_job_id": "batch_jobs SET NULL",

  // Added by concurrent work (2026-09-24), each with its own migration; they
  // are that work's decisions, recorded here so this list stays complete.
  "signature_workflows.requested_by": "users RESTRICT", // A-170
  "sessions.impersonator_id": "users CASCADE",
  "scim_groups.role_id": "roles RESTRICT",
  // P6-03 (migration 0057): the correction/void lifecycle. RESTRICT — a
  // record that corrects, or was corrected by, another cannot lose the link,
  // and who voided a record is a Part 11 attribution.
  "calibration_records.supersedes_id": "calibration_records RESTRICT",
  "calibration_records.superseded_by_id": "calibration_records RESTRICT",
  "calibration_records.voided_by": "users RESTRICT",
  // P6-09 (migration 0059): which item an adjustment moved outlives nothing.
  "stock_adjustments.stock_id": "stocks RESTRICT",
  // Q-51 (migration 0105): the API key that acted (the row's user column is
  // then NULL; a CHECK holds exactly one of the two set). Target api_keys.
  // ON DELETE RESTRICT, as the user column beside it (F-6: who performed a
  // record outlives the actor's row) — and SET NULL would leave a row naming
  // no actor, which the CHECK refuses. Keys are revoked by soft delete, so
  // RESTRICT blocks no normal operation. Tenant: a key belongs to one tenant
  // (api_keys.tenant_id); the row's tenant_id is stamped from the request's
  // tenant context, which for a key principal IS the key's tenant
  // (auth.middleware#tryApiKeyAuth), and the id is taken from that principal
  // (auditPrincipal), never the body — so row and key share a tenant. This is
  // enforced by the application, not by a composite FK, exactly as for the
  // user columns.
  "calibration_records.api_key_id": "api_keys RESTRICT",
  "stock_adjustments.api_key_id": "api_keys RESTRICT",
  "stock_transfers.api_key_id": "api_keys RESTRICT",
  // P20-01 / P20-03 (migrations 0111, 0112; ADR-125 Am. 1): the inspection
  // catalogue is NEVER deleted (no-delete triggers, no DELETE grant), so every
  // key into it is RESTRICT — G-5 for the device's type (not 04's SET NULL),
  // and a version, its items, its template and its base cannot lose a link a
  // session or result pins. Who created, published, retired or decided is a
  // Part 11 attribution: RESTRICT, as calibration_records.voided_by.
  "calibration_devices.device_type_id": "device_types RESTRICT",
  "device_types.created_by": "users RESTRICT",
  "device_types.updated_by": "users RESTRICT",
  "inspection_item_definitions.created_by": "users RESTRICT",
  "inspection_item_definitions.updated_by": "users RESTRICT",
  "inspection_templates.device_type_id": "device_types RESTRICT",
  "inspection_templates.created_by": "users RESTRICT",
  "inspection_templates.updated_by": "users RESTRICT",
  "inspection_template_versions.template_id": "inspection_templates RESTRICT",
  "inspection_template_versions.base_version_id": "inspection_template_versions RESTRICT",
  "inspection_template_versions.rebased_from_version_id": "inspection_template_versions RESTRICT",
  "inspection_template_versions.published_by": "users RESTRICT",
  "inspection_template_versions.retired_by": "users RESTRICT",
  "inspection_template_versions.discarded_by": "users RESTRICT",
  "inspection_template_versions.created_by": "users RESTRICT",
  "inspection_template_versions.updated_by": "users RESTRICT",
  "inspection_template_items.version_id": "inspection_template_versions RESTRICT",
  "inspection_template_items.item_definition_id": "inspection_item_definitions RESTRICT",
  "inspection_template_proposals.device_type_id": "device_types RESTRICT",
  "inspection_template_proposals.based_on_version_id": "inspection_template_versions RESTRICT",
  "inspection_template_proposals.resulting_version_id": "inspection_template_versions RESTRICT",
  "inspection_template_proposals.submitted_by": "users RESTRICT",
  "inspection_template_proposals.decided_by": "users RESTRICT",
  "inspection_template_proposals.withdrawn_by": "users RESTRICT",
  // P20-07 (migration 0117; ADR-124 Am. 2): who created, edited or changed the status of a client
  // facility, and who moved a device between facilities, are Part 11 attributions — RESTRICT, as the
  // catalogue's. (The tenant keys are 0030's rule; the composite facility and device keys are the
  // migration's own, which Sequelize cannot express.)
  "client_facilities.status_changed_by": "users RESTRICT",
  "client_facilities.created_by": "users RESTRICT",
  "client_facilities.updated_by": "users RESTRICT",
  "client_facility_moves.moved_by": "users RESTRICT",
  // P20-04 (migration 0126; ADR-126 Am. 1–2): the IPM aggregate's single-column keys. Every person
  // (creator, editor, performer, submitter, voider, discarder, signer, key owner) is a Part 11
  // attribution — RESTRICT; the pinned catalogue rows and the visit's work orders are RESTRICT (a
  // record never loses what it pinned); a session's own chain is RESTRICT; the draft's chosen room
  // is SET NULL (spec § 4.1: the room is snapshotted at submit). The composite device and session
  // keys are the migration's (Sequelize cannot express them).
  "inspection_sessions.template_version_id": "inspection_template_versions RESTRICT",
  "inspection_sessions.supersedes_id": "inspection_sessions RESTRICT",
  "inspection_sessions.superseded_by_id": "inspection_sessions RESTRICT",
  "inspection_sessions.created_by": "users RESTRICT",
  "inspection_sessions.updated_by": "users RESTRICT",
  "inspection_sessions.performed_by": "users RESTRICT",
  "inspection_sessions.submitted_by": "users RESTRICT",
  "inspection_sessions.location_id": "warehouses SET NULL",
  "inspection_sessions.work_order_id": "maintenance_work_orders RESTRICT",
  "inspection_sessions.follow_up_work_order_id": "maintenance_work_orders RESTRICT",
  "inspection_sessions.voided_by": "users RESTRICT",
  "inspection_sessions.discarded_by": "users RESTRICT",
  "inspection_results.template_item_id": "inspection_template_items RESTRICT",
  "inspection_results.item_definition_id": "inspection_item_definitions RESTRICT",
  "inspection_session_signatures.signer_id": "users RESTRICT",
  "idempotency_keys.user_id": "users RESTRICT",
  "idempotency_keys.api_key_id": "api_keys RESTRICT",
  // P20-02 (migration 0128; ADR-132 § 4, ADR-133 § 3): the device's usual laboratory and a record's
  // laboratory are SET NULL (the name is kept as recorded — external_lab_name; vendors are paranoid,
  // so only a hard delete reaches it, and on a record the append-only trigger then refuses it); the
  // registrant is a Part 11 attribution — RESTRICT. The request's session key is the migration's.
  "calibration_devices.calibration_vendor_id": "vendors SET NULL",
  "calibration_devices.created_by": "users RESTRICT",
  "calibration_records.calibration_vendor_id": "vendors SET NULL",
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

    const notNull = target.notNull && !Q51_USER_COLUMNS.has(`${table}.${column}`);
    it(notNull ? "is NOT NULL" : "is nullable (0037, or Q-51 / 0105)", () => {
      expect(/NOT NULL/.test(columnDdl(model)[column])).toBe(notNull);
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
