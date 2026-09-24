"use strict";

/**
 * Indexes on every tenant column and foreign key that had none (D-20), and
 * the per-tenant time-range indexes on `iot_readings` (D-19).
 *
 * WHAT WAS WRONG
 *
 * PostgreSQL indexes a primary key and a UNIQUE constraint; it does NOT index
 * a foreign key. Fifteen models declare no `indexes` block, and many others
 * declare one that misses their foreign keys, so on every database:
 *  - `tenant_id` — the isolation boundary every query filters on — was
 *    unindexed on capas, risks, non_conformances, maintenance_work_orders,
 *    invoices, notifications, workflows, … : each tenant's list read scanned
 *    every tenant's rows;
 *  - 60-odd foreign keys to users, devices, vendors, workflows, … were
 *    unindexed: every delete or key update of a parent row scans the child
 *    table to check RESTRICT / apply CASCADE / SET NULL, under lock;
 *  - `iot_readings` — the one table whose design is "a row per device per
 *    interval, forever" — had (tenant_id), (device_id), (timestamp) and
 *    (device_id, timestamp), but nothing serving the two shapes it is read
 *    by: tenant + device + window (predictiveMaintenance.service) and
 *    tenant + window (the retention purge, dataRetention.service).
 *
 * WHAT THIS DOES
 *
 * Creates each index on INDEXES, named as Sequelize names a model-declared
 * index (`<table>_<col>_<col>`), so a model block added later converges on
 * the same catalog instead of duplicating it. An index is SKIPPED when an
 * existing index on the table already starts with the same columns in the
 * same order (it serves every query the new one would) — e.g. a unique
 * `(tenant_id, number)` from 0024 already covers `(tenant_id)`. Every index it
 * creates is recorded in STATE_TABLE so `down` drops exactly those.
 *
 * NOT here: `audit_logs` (D-08 — its own card and owner).
 *
 * Tenant columns get `(tenant_id, status)` where the list endpoints filter by
 * status (risk / qms / maintenance / sop / workflow / invoice services); a
 * leading-column index serves tenant-only queries equally.
 *
 * LOCKING. Plain CREATE INDEX (not CONCURRENTLY — that cannot run inside the
 * transaction that makes this atomic) takes a SHARE lock: writes to the table
 * wait while it builds. Every table here is small today (iot_readings is
 * empty: A-29). On a large database run it in a maintenance window, or create
 * the same names CONCURRENTLY by hand first — this migration then skips them.
 *
 * No try/catch: every failure propagates (CLAUDE.md). A table or column on
 * INDEXES that does not exist is a refusal, not a skip. Verify with psql:
 *   SELECT tablename, indexname, indexdef FROM pg_indexes
 *    WHERE indexname = ANY (SELECT index_name FROM migration_0067_created_indexes);
 */

const STATE_TABLE = "migration_0067_created_indexes";
const LOCK_TIMEOUT = "15s";

const ix = (table, columns, reason) => Object.freeze({
  table,
  columns: Object.freeze(columns),
  name: `${table}_${columns.join("_")}`,
  reason,
});

/** The reviewed list. tests/migrations/0067-foreign-key-and-tenant-indexes.test.js
 *  holds every model foreign key to "indexed by a model or by this list". */
const INDEXES = Object.freeze([
  // ── D-19: iot_readings ─────────────────────────────────────────────────
  ix("iot_readings", ["tenant_id", "device_id", "timestamp"], "device telemetry window per tenant"),
  ix("iot_readings", ["tenant_id", "timestamp"], "retention purge / tenant time range"),

  // ── D-20: tenant columns ───────────────────────────────────────────────
  ix("batch_jobs", ["tenant_id"], "tenant boundary"),
  ix("capas", ["tenant_id", "status"], "tenant boundary; qms list filters by status"),
  ix("invoices", ["tenant_id", "status"], "tenant boundary; billing filters by status"),
  ix("maintenance_work_orders", ["tenant_id", "status"], "tenant boundary; list filters by status"),
  ix("non_conformances", ["tenant_id", "status"], "tenant boundary; qms list filters by status"),
  ix("notifications", ["tenant_id"], "tenant boundary"),
  ix("risks", ["tenant_id", "status"], "tenant boundary; risk list filters by status"),
  ix("sop_documents", ["tenant_id", "status"], "tenant boundary; sop list filters by status"),
  ix("sop_training_acknowledgments", ["tenant_id"], "tenant boundary"),
  ix("subscriptions", ["tenant_id"], "tenant boundary"),
  ix("supplier_scorecards", ["tenant_id"], "tenant boundary"),
  ix("vendors", ["tenant_id"], "tenant boundary"),
  ix("workflow_instances", ["tenant_id", "status"], "tenant boundary; instance list filters by status"),
  ix("workflows", ["tenant_id"], "tenant boundary"),

  // ── D-20: foreign keys ─────────────────────────────────────────────────
  ix("api_keys", ["created_by"], "fk users"),
  ix("asset_finances", ["vendor_id"], "fk vendors"),
  ix("attachments", ["uploaded_by"], "fk users"),
  ix("batch_jobs", ["user_id"], "fk users"),
  ix("calibration_devices", ["location_id"], "fk warehouses"),
  ix("calibration_records", ["superseded_by_id"], "fk calibration_records"),
  ix("calibration_records", ["supersedes_id"], "fk calibration_records"),
  ix("calibration_records", ["voided_by"], "fk users"),
  ix("capas", ["approved_by"], "fk users"),
  ix("capas", ["assigned_to"], "fk users"),
  ix("capas", ["nc_id"], "fk non_conformances (RESTRICT)"),
  ix("certificates", ["approved_by"], "fk users (RESTRICT)"),
  ix("certificates", ["calibrated_by"], "fk users (RESTRICT)"),
  ix("certificates", ["created_by"], "fk users"),
  ix("certificates", ["deleted_by"], "fk users"),
  ix("certificates", ["signed_by"], "fk users (RESTRICT)"),
  ix("certificates", ["updated_by"], "fk users"),
  ix("invoices", ["subscription_id"], "fk subscriptions (CASCADE)"),
  ix("kanban_card_relations", ["project_id"], "fk kanban_projects (CASCADE)"),
  ix("kanban_cards", ["created_by"], "fk users"),
  ix("kanban_cards", ["sprint_id"], "fk kanban_sprints"),
  ix("kanban_projects", ["created_by"], "fk users"),
  ix("maintenance_work_orders", ["assigned_to"], "fk users"),
  ix("maintenance_work_orders", ["device_id"], "fk calibration_devices (CASCADE)"),
  ix("maintenance_work_orders", ["vendor_id"], "fk vendors"),
  ix("non_conformances", ["device_id"], "fk calibration_devices"),
  ix("non_conformances", ["reported_by"], "fk users (RESTRICT)"),
  ix("notifications", ["user_id"], "fk users (CASCADE); a user's inbox"),
  ix("posts", ["created_by"], "fk users"),
  ix("risks", ["assigned_to"], "fk users"),
  ix("risks", ["identified_by"], "fk users"),
  ix("sessions", ["impersonator_id"], "fk users (CASCADE)"),
  ix("signature_records", ["revoked_by"], "fk users (RESTRICT)"),
  ix("signature_workflow_steps", ["signer_id"], "fk users (RESTRICT)"),
  ix("signature_workflows", ["requested_by"], "fk users (RESTRICT)"),
  ix("sop_documents", ["author_id"], "fk users (RESTRICT)"),
  ix("sop_training_acknowledgments", ["document_id"], "fk sop_documents (RESTRICT)"),
  ix("sop_training_acknowledgments", ["user_id"], "fk users (RESTRICT)"),
  ix("stock_adjustments", ["adjusted_by"], "fk users (RESTRICT)"),
  ix("stock_adjustments", ["location_id"], "fk storage_locations"),
  ix("stock_adjustments", ["stock_id"], "fk stocks"),
  ix("stock_opnames", ["performed_by"], "fk users (RESTRICT)"),
  ix("stock_transfers", ["approved_by"], "fk users"),
  ix("stock_transfers", ["requested_by"], "fk users (RESTRICT)"),
  ix("supplier_scorecards", ["evaluated_by"], "fk users"),
  ix("supplier_scorecards", ["vendor_id"], "fk vendors (RESTRICT)"),
  ix("tenant_backups", ["created_by"], "fk users"),
  ix("tenant_backups", ["deleted_by"], "fk users"),
  ix("tenants", ["parent_id"], "fk tenants (hierarchy)"),
  ix("ticket_comments", ["user_id"], "fk users"),
  ix("user_menu_permissions", ["granted_by"], "fk users"),
  ix("users", ["role_id"], "fk roles"),
  ix("webhooks", ["created_by"], "fk users"),
  ix("workflow_actions", ["instance_id"], "fk workflow_instances (CASCADE)"),
  ix("workflow_actions", ["step_id"], "fk workflow_steps (CASCADE)"),
  ix("workflow_actions", ["user_id"], "fk users"),
  ix("workflow_instances", ["workflow_id"], "fk workflows (CASCADE)"),
  ix("workflow_steps", ["role_id"], "fk roles (RESTRICT)"),
  ix("workflow_steps", ["workflow_id"], "fk workflows (CASCADE)"),
]);

const qid = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** { table: [[col, col, …] per existing index] } for the INDEXES tables. */
const existingIndexes = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT t.relname AS table_name,
            i.relname AS index_name,
            array(SELECT a.attname
                    FROM unnest(x.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                   ORDER BY k.ord) AS columns
       FROM pg_index x
       JOIN pg_class t ON t.oid = x.indrelid
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = current_schema()
        AND t.relname IN (:tables)
        AND x.indisvalid          -- a failed CONCURRENTLY build serves nothing
        AND x.indpred IS NULL     -- a partial index does not serve every query`,
    { replacements: { tables: [...new Set(INDEXES.map((x) => x.table))] }, transaction },
  );
  return rows;
};

const existingColumns = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name IN (:tables)`,
    { replacements: { tables: [...new Set(INDEXES.map((x) => x.table))] }, transaction },
  );
  return new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
};

/** An existing index whose leading columns are `columns` serves every query the new one would. */
const isCovered = (indexes, target) =>
  indexes.some(
    (row) =>
      row.table_name === target.table &&
      target.columns.every((column, i) => (row.columns || [])[i] === column),
  );

const stateTableExists = async (sequelize, transaction) => {
  const [[row]] = await sequelize.query(
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { replacements: { table: STATE_TABLE }, transaction },
  );
  return row.present;
};

module.exports = {
  INDEXES,
  STATE_TABLE,
  isCovered,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });

      const columns = await existingColumns(sequelize, transaction);
      const missing = INDEXES.flatMap((x) => x.columns.map((c) => `${x.table}.${c}`)).filter(
        (key) => !columns.has(key),
      );
      if (missing.length) {
        throw new Error(
          `Migration 0067 refused: ${missing.length} column(s) it must index do not exist: ` +
            `${[...new Set(missing)].join(", ")}. Nothing was changed. The schema is not the one ` +
            "the models describe; find out why before re-running.",
        );
      }

      const indexes = await existingIndexes(sequelize, transaction);
      const pending = INDEXES.filter((x) => !isCovered(indexes, x));
      if (!pending.length) {
        return; // every one already served: a second run, or created by hand
      }

      await sequelize.query(
        `CREATE TABLE IF NOT EXISTS ${qid(STATE_TABLE)} (
           index_name text PRIMARY KEY,
           table_name text NOT NULL,
           recorded_at timestamptz NOT NULL DEFAULT now()
         )`,
        { transaction },
      );
      for (const x of pending) {
        await sequelize.query(
          `CREATE INDEX ${qid(x.name)} ON ${qid(x.table)} (${x.columns.map(qid).join(", ")})`,
          { transaction },
        );
        await sequelize.query(
          `INSERT INTO ${qid(STATE_TABLE)} (index_name, table_name) VALUES (:name, :table)`,
          { replacements: { name: x.name, table: x.table }, transaction },
        );
      }
    });
  },

  down: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      if (!(await stateTableExists(sequelize, transaction))) {
        return; // up created nothing
      }
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      const [rows] = await sequelize.query(
        `SELECT index_name FROM ${qid(STATE_TABLE)} ORDER BY index_name`,
        { transaction },
      );
      for (const row of rows) {
        await sequelize.query(`DROP INDEX IF EXISTS ${qid(row.index_name)}`, { transaction });
      }
      await sequelize.query(`DROP TABLE ${qid(STATE_TABLE)}`, { transaction });
    });
  },
};
