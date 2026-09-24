"use strict";

/**
 * Every other association foreign key: one attribute, one constraint, the
 * intended ON DELETE, NOT NULL where the model says so (A-148, A-149; the
 * rest of the A-88 shape that ADR-051 Q-16 / migration 0030 did not cover).
 *
 * WHAT WAS WRONG
 *
 *  - A-148. 64 associations named the COLUMN as their foreign key
 *    (`foreignKey: "device_id"`) instead of the attribute (`deviceId`).
 *    Sequelize then adds a second attribute on the same column, and because
 *    `sync()` builds columns from `tableAttributes` (keyed by field) the
 *    duplicate wins: every one of these columns was built NULLABLE, with the
 *    association's default action — `ON DELETE SET NULL` for most. So on
 *    every database today `calibration_records.device_id`,
 *    `certificates.device_id`, `capas.nc_id`,
 *    `sop_training_acknowledgments.document_id`, both signature `workflow_id`
 *    columns and the inventory trail are nullable, and a hard delete of the
 *    parent silently erases which device a calibration was for, which NC a
 *    CAPA answers, which SOP a training record acknowledges. The models
 *    declare these columns NOT NULL; the database never enforced it.
 *  - A-149. `signature_records.revoked_by` and
 *    `signature_workflow_steps.signer_id` have NO foreign key at all:
 *    migration 0017 created them as bare UUIDs and no model declared a
 *    reference. Who revoked a signature, and who was asked to sign, can name
 *    a user who does not exist.
 *
 * WHAT THIS DOES
 *
 * For each column on TARGETS: every foreign key on it is replaced by exactly
 * one, `<table>_<column>_fkey`, `ON DELETE <action> ON UPDATE CASCADE` — the
 * constraint a fresh `sync()` of the corrected models writes — and the column
 * becomes NOT NULL where `notNull` says so. A compliant column is left alone.
 *
 * THE DECISIONS (each with its reason on the entry below):
 *  - Nullable columns keep the action they have on every database today
 *    (SET NULL, or CASCADE for join rows), with one deliberate exception:
 *    `certificates.calibration_record_id` becomes RESTRICT — a certificate
 *    must not silently lose the calibration it certifies (ISO 17025 7.8).
 *  - A column the model declares NOT NULL cannot keep SET NULL (the action
 *    would violate the column). Each such column gets RESTRICT — the Q-16
 *    default: regulated, quality and inventory records outlive their parent —
 *    or CASCADE where the child is a pure component of the parent with no
 *    record value (kanban board contents, which 0030 already treats as
 *    throwaway; webhook delivery attempts, on 0030's cascade list).
 *  - A-149: both columns RESTRICT, nullable. The signer of a regulated
 *    record and the person who revoked a signature are 21 CFR Part 11
 *    attributions (11.50, 11.70); users are paranoid, so ordinary deletion
 *    is unaffected, and a hard delete is refused instead of leaving an
 *    unattributable signature event.
 *
 * REFUSE, DON'T REPAIR (the 0024/0026/0030 pattern). Before ANY change, if a
 * column that must become NOT NULL holds NULLs — which is exactly what a
 * SET NULL that fired leaves behind — or a column with no validated foreign
 * key holds ids that name nothing, the migration throws, listing table,
 * column, count and sample ids, and changes nothing. Which device a
 * calibration record was for is not a migration's decision.
 * Soft-deleted rows count: they are records too.
 *
 * ATOMIC, REVERSIBLE, IDEMPOTENT — as 0030: one transaction with a lock
 * timeout; every dropped constraint and every column made NOT NULL is first
 * recorded verbatim in STATE_TABLE (created only when there is something to
 * record); `down` restores exactly those; a second `up` changes nothing.
 * Constraints are DISCOVERED from pg_constraint by column, never by assumed
 * name.
 *
 * No try/catch: every failure propagates (CLAUDE.md). A TARGETS column that
 * does not exist is a refusal, not a skip. Verify with psql, not the log:
 *   SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
 *     FROM pg_constraint WHERE contype = 'f' ORDER BY 1, 2;
 * Rows that will refuse the deploy — run the day before (per column):
 *   SELECT count(*) FROM calibration_records WHERE device_id IS NULL;
 */

const STATE_TABLE = "migration_0037_previous_foreign_keys";
const LOCK_TIMEOUT = "15s";
const REPORT_LIMIT = 20;
const SAMPLE_IDS = 5;

const t = (table, column, ref, action, notNull, reason) =>
  Object.freeze({ table, column, ref, action, notNull, reason });

/**
 * The reviewed decision for every association foreign key outside 0030's
 * scope. The model DDL test (tests/models/associationForeignKeys.a148.test.js)
 * holds every model to this list, so a fresh sync() and a migrated database
 * converge on the same catalog.
 */
const TARGETS = Object.freeze([
  // ── Nullable: today's action kept ───────────────────────────────────────
  t("asset_finances", "vendor_id", "vendors", "SET NULL", false, "optional supplier link"),
  t("attachments", "uploaded_by", "users", "SET NULL", false, "operational actor (0030 note)"),
  t("batch_jobs", "user_id", "users", "SET NULL", false, "job-queue state"),
  t("calibration_devices", "location_id", "warehouses", "SET NULL", false, "a device may have no warehouse"),
  t("capas", "assigned_to", "users", "SET NULL", false, "operational assignment (0030 note)"),
  t("kanban_cards", "sprint_id", "kanban_sprints", "SET NULL", false, "deleted sprint → backlog (kanban.service#deleteSprint)"),
  t("kanban_cards", "created_by", "users", "SET NULL", false, "kanban, not a regulated record"),
  t("kanban_projects", "created_by", "users", "SET NULL", false, "kanban, not a regulated record"),
  t("kanban_project_members", "user_id", "users", "SET NULL", false, "a member is a user OR a role; kept as today"),
  t("kanban_project_members", "role_id", "roles", "SET NULL", false, "a member is a user OR a role; kept as today"),
  t("menu_groups", "parent_id", "menu_groups", "SET NULL", false, "a child menu becomes top-level"),
  t("non_conformances", "device_id", "calibration_devices", "SET NULL", false, "an NC need not concern a device"),
  t("posts", "created_by", "users", "SET NULL", false, "content authorship, not an attestation"),
  t("risks", "identified_by", "users", "SET NULL", false, "operational actor"),
  t("risks", "assigned_to", "users", "SET NULL", false, "operational assignment"),
  t("stocks", "location_id", "storage_locations", "SET NULL", false, "location is optional"),
  t("stock_adjustments", "location_id", "storage_locations", "SET NULL", false, "location is optional"),
  t("stock_transfers", "approved_by", "users", "SET NULL", false, "stock actor (0030 note)"),
  t("supplier_scorecards", "evaluated_by", "users", "SET NULL", false, "operational actor"),
  t("tickets", "created_by", "users", "SET NULL", false, "support desk actor"),
  t("tickets", "assigned_to", "users", "SET NULL", false, "support desk assignment"),
  t("ticket_comments", "user_id", "users", "SET NULL", false, "support desk actor"),
  t("users", "role_id", "roles", "SET NULL", false, "a user without a role fails every gate"),
  t("user_menu_permissions", "granted_by", "users", "SET NULL", false, "the grant survives its grantor"),

  // ── Nullable: deliberately changed ──────────────────────────────────────
  t("certificates", "calibration_record_id", "calibration_records", "RESTRICT", false,
    "a certificate must not lose the calibration it certifies (was SET NULL)"),

  // ── NOT NULL, CASCADE kept: join rows and components ────────────────────
  t("asset_finances", "device_id", "calibration_devices", "CASCADE", true, "finance row of the device; CASCADE today"),
  t("kanban_card_assignees", "card_id", "kanban_cards", "CASCADE", true, "join row"),
  t("kanban_card_assignees", "user_id", "users", "CASCADE", true, "join row"),
  t("kanban_card_labels", "card_id", "kanban_cards", "CASCADE", true, "join row"),
  t("kanban_card_labels", "label_id", "kanban_labels", "CASCADE", true, "join row (kanban.service#deleteLabel relies on it)"),
  t("kanban_project_members", "project_id", "kanban_projects", "CASCADE", true, "membership of the project"),
  t("kanban_sprints", "project_id", "kanban_projects", "CASCADE", true, "board component"),
  t("role_menu_permissions", "role_id", "roles", "CASCADE", true, "join row"),
  t("role_menu_permissions", "menu_group_id", "menu_groups", "CASCADE", true, "join row"),
  t("ticket_comments", "ticket_id", "tickets", "CASCADE", true, "comment thread of the ticket"),
  t("user_menu_permissions", "user_id", "users", "CASCADE", true, "join row"),
  t("user_menu_permissions", "menu_group_id", "menu_groups", "CASCADE", true, "join row"),

  // ── NOT NULL, was SET NULL → CASCADE: kanban board contents ─────────────
  t("kanban_cards", "project_id", "kanban_projects", "CASCADE", true, "board contents"),
  t("kanban_cards", "column_id", "kanban_columns", "CASCADE", true, "kanban.service#deleteColumn relies on it: \"cards cascade\""),
  t("kanban_card_relations", "source_card_id", "kanban_cards", "CASCADE", true, "a relation of a deleted card is meaningless"),
  t("kanban_card_relations", "target_card_id", "kanban_cards", "CASCADE", true, "a relation of a deleted card is meaningless"),
  t("kanban_columns", "project_id", "kanban_projects", "CASCADE", true, "board contents"),
  t("kanban_labels", "project_id", "kanban_projects", "CASCADE", true, "board contents"),
  t("webhook_deliveries", "webhook_id", "webhooks", "CASCADE", true, "delivery attempts; on 0030's cascade list"),

  // ── NOT NULL, was SET NULL → RESTRICT: records outlive their parent ─────
  t("calibration_records", "device_id", "calibration_devices", "RESTRICT", true, "ISO 17025: which device was calibrated"),
  t("certificates", "device_id", "calibration_devices", "RESTRICT", true, "ISO 17025: which device is certified"),
  t("iot_readings", "device_id", "calibration_devices", "RESTRICT", true, "environmental/measurement evidence of the device"),
  t("capas", "nc_id", "non_conformances", "RESTRICT", true, "ISO 13485 8.5: the NC a CAPA answers"),
  t("non_conformances", "reported_by", "users", "RESTRICT", true, "who raised a quality record"),
  t("consent_records", "user_id", "users", "RESTRICT", true, "GDPR art. 7(1): evidence of consent outlives the account"),
  t("dsar_requests", "user_id", "users", "RESTRICT", true, "GDPR art. 12: record of a handled request"),
  t("signature_records", "workflow_id", "signature_workflows", "RESTRICT", true, "Part 11: a signature's workflow"),
  t("signature_workflow_steps", "workflow_id", "signature_workflows", "RESTRICT", true, "Part 11: who was asked to sign what"),
  t("sop_training_acknowledgments", "document_id", "sop_documents", "RESTRICT", true, "training record names its SOP"),
  t("supplier_scorecards", "vendor_id", "vendors", "RESTRICT", true, "ISO 13485 7.4: supplier evaluation evidence"),
  t("stocks", "warehouse_id", "warehouses", "RESTRICT", true, "inventory is not deleted with its warehouse"),
  t("storage_locations", "warehouse_id", "warehouses", "RESTRICT", true, "inventory structure; default RESTRICT"),
  t("stock_adjustments", "warehouse_id", "warehouses", "RESTRICT", true, "inventory trail"),
  t("stock_adjustments", "adjusted_by", "users", "RESTRICT", true, "inventory trail; NOT NULL forbids SET NULL"),
  t("stock_opnames", "warehouse_id", "warehouses", "RESTRICT", true, "inventory trail"),
  t("stock_opnames", "performed_by", "users", "RESTRICT", true, "inventory trail; NOT NULL forbids SET NULL"),
  t("stock_transfers", "from_warehouse_id", "warehouses", "RESTRICT", true, "inventory trail"),
  t("stock_transfers", "to_warehouse_id", "warehouses", "RESTRICT", true, "inventory trail"),
  t("stock_transfers", "requested_by", "users", "RESTRICT", true, "inventory trail; NOT NULL forbids SET NULL"),

  // ── A-149: no foreign key at all until now ──────────────────────────────
  t("signature_records", "revoked_by", "users", "RESTRICT", false, "Part 11: who revoked a signature"),
  t("signature_workflow_steps", "signer_id", "users", "RESTRICT", false, "Part 11: the signer of a regulated record"),
]);

const ACTION_CODE = Object.freeze({ RESTRICT: "r", CASCADE: "c", "SET NULL": "n", "NO ACTION": "a" });

const qid = (name) => `"${String(name).replace(/"/g, '""')}"`;
const fkName = (table, column) => `${table}_${column}_fkey`;
const keyOf = (table, column) => `${table}.${column}`;

/** Every single-column FK on a TARGETS column, whatever it references. */
const listForeignKeys = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT cl.relname AS table_name,
            a.attname AS column_name,
            rf.relname AS ref_table,
            c.conname AS name,
            pg_get_constraintdef(c.oid) AS definition,
            c.confdeltype AS on_delete,
            c.confupdtype AS on_update,
            c.convalidated AS validated
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       JOIN pg_class rf ON rf.oid = c.confrelid
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND n.nspname = current_schema()
        AND cardinality(c.conkey) = 1
        AND (cl.relname || '.' || a.attname) IN (:keys)
      ORDER BY cl.relname, a.attname, c.conname`,
    { replacements: { keys: TARGETS.map((x) => keyOf(x.table, x.column)) }, transaction },
  );
  return rows;
};

/** { "table.column": attnotnull } for every TARGETS column that exists. */
const listColumns = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT cl.relname AS table_name, a.attname AS column_name, a.attnotnull AS not_null
       FROM pg_attribute a
       JOIN pg_class cl ON cl.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE n.nspname = current_schema()
        AND cl.relkind = 'r'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND (cl.relname || '.' || a.attname) IN (:keys)`,
    { replacements: { keys: TARGETS.map((x) => keyOf(x.table, x.column)) }, transaction },
  );
  return new Map(rows.map((r) => [keyOf(r.table_name, r.column_name), r.not_null]));
};

const plan = (fks, columns) => {
  const missing = TARGETS.filter((x) => !columns.has(keyOf(x.table, x.column)));
  if (missing.length) {
    throw new Error(
      `Migration 0037 refused: ${missing.length} column(s) it must constrain do not exist: ` +
        `${missing.map((x) => keyOf(x.table, x.column)).join(", ")}. Nothing was changed. ` +
        "The schema is not the one the models describe; find out why before re-running.",
    );
  }
  return TARGETS.map((x) => ({
    ...x,
    existing: fks.filter((fk) => fk.table_name === x.table && fk.column_name === x.column),
    isNotNull: columns.get(keyOf(x.table, x.column)),
  }));
};

const isCompliant = (target) =>
  target.existing.length === 1 &&
  target.existing[0].ref_table === target.ref &&
  target.existing[0].on_delete === ACTION_CODE[target.action] &&
  target.existing[0].on_update === "c" &&
  target.existing[0].validated;

const needsNotNull = (target) => target.notNull && !target.isNotNull;

/** Validated FKs to the intended table vouch for every non-NULL id. */
const vouched = (target) => target.existing.some((fk) => fk.validated && fk.ref_table === target.ref);

const findOrphans = async (sequelize, transaction, targets) => {
  const problems = [];
  for (const x of targets) {
    if (needsNotNull(x)) {
      const [[row]] = await sequelize.query(
        `SELECT count(*)::int AS n,
                (array_agg(to_jsonb(r) ->> 'id'))[1:${SAMPLE_IDS}] AS sample
           FROM ${qid(x.table)} r
          WHERE r.${qid(x.column)} IS NULL`,
        { transaction },
      );
      if (row.n > 0) {
        problems.push({ ...x, kind: "NULL", n: row.n, sample: row.sample || [] });
      }
    }
    if (!vouched(x)) {
      const [[row]] = await sequelize.query(
        `SELECT count(*)::int AS n,
                (array_agg(to_jsonb(r) ->> 'id'))[1:${SAMPLE_IDS}] AS sample
           FROM ${qid(x.table)} r
          WHERE r.${qid(x.column)} IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM ${qid(x.ref)} p WHERE p.id = r.${qid(x.column)})`,
        { transaction },
      );
      if (row.n > 0) {
        problems.push({ ...x, kind: "dangling", n: row.n, sample: row.sample || [] });
      }
    }
  }
  return problems;
};

const orphanError = (problems) => {
  const lines = problems.slice(0, REPORT_LIMIT).map((p) => {
    const what = p.kind === "NULL" ? `${p.column} IS NULL` : `${p.column} names no ${p.ref} row`;
    return `  ${p.table}: ${p.n} row(s) where ${what} — e.g. id ${p.sample.join(", ")}`;
  });
  if (problems.length > REPORT_LIMIT) {
    lines.push(`  … and ${problems.length - REPORT_LIMIT} more`);
  }
  return new Error(
    `Migration 0037 refused: ${problems.length} column(s) hold rows whose reference is missing, ` +
      "so NOT NULL / the foreign key cannot be enforced. Nothing was changed. This migration " +
      "will not delete these rows or point them at another row on its own authority (A-148, A-149).\n" +
      `${lines.join("\n")}\n` +
      "Resolve each deliberately (restore the reference the row belongs to, or archive and remove " +
      "it with a recorded reason), then re-run.",
  );
};

const ensureStateTable = (sequelize, transaction) =>
  sequelize.query(
    `CREATE TABLE IF NOT EXISTS ${qid(STATE_TABLE)} (
       table_name text NOT NULL,
       column_name text NOT NULL,
       kind text NOT NULL CHECK (kind IN ('replaced', 'constraint', 'nullable')),
       constraint_name text NOT NULL DEFAULT '',
       definition text,
       recorded_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (table_name, column_name, kind, constraint_name)
     )`,
    { transaction },
  );

const record = (sequelize, transaction, row) =>
  sequelize.query(
    `INSERT INTO ${qid(STATE_TABLE)} (table_name, column_name, kind, constraint_name, definition)
     VALUES (:table, :column, :kind, :name, :definition)
     ON CONFLICT DO NOTHING`,
    { replacements: row, transaction },
  );

const stateTableExists = async (sequelize, transaction) => {
  const [[row]] = await sequelize.query(
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { replacements: { table: STATE_TABLE }, transaction },
  );
  return row.present;
};

module.exports = {
  TARGETS,
  STATE_TABLE,
  fkName,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });

      const targets = plan(
        await listForeignKeys(sequelize, transaction),
        await listColumns(sequelize, transaction),
      );

      // 1. Refuse on orphans — before ANY change.
      const problems = await findOrphans(sequelize, transaction, targets);
      if (problems.length) {
        throw orphanError(problems);
      }

      const pending = targets.filter((x) => !isCompliant(x) || needsNotNull(x));
      if (!pending.length) {
        return; // fresh database from the current models, or a second run
      }
      await ensureStateTable(sequelize, transaction);

      for (const x of pending) {
        // 2. Record, then replace, every foreign key on the column.
        if (!isCompliant(x)) {
          // 'replaced' marks the column even when it had no foreign key
          // before (A-149), so `down` knows to drop the one added here.
          await record(sequelize, transaction, {
            table: x.table,
            column: x.column,
            kind: "replaced",
            name: "",
            definition: null,
          });
          for (const fk of x.existing) {
            await record(sequelize, transaction, {
              table: x.table,
              column: x.column,
              kind: "constraint",
              name: fk.name,
              definition: fk.definition,
            });
            await sequelize.query(`ALTER TABLE ${qid(x.table)} DROP CONSTRAINT ${qid(fk.name)}`, {
              transaction,
            });
          }
          await sequelize.query(
            `ALTER TABLE ${qid(x.table)} ADD CONSTRAINT ${qid(fkName(x.table, x.column))} ` +
              `FOREIGN KEY (${qid(x.column)}) REFERENCES ${qid(x.ref)} ("id") ` +
              `ON DELETE ${x.action} ON UPDATE CASCADE`,
            { transaction },
          );
        }

        // 3. NOT NULL where the model says so.
        if (needsNotNull(x)) {
          await record(sequelize, transaction, {
            table: x.table,
            column: x.column,
            kind: "nullable",
            name: "",
            definition: null,
          });
          await sequelize.query(
            `ALTER TABLE ${qid(x.table)} ALTER COLUMN ${qid(x.column)} SET NOT NULL`,
            { transaction },
          );
        }
      }
    });
  },

  down: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      if (!(await stateTableExists(sequelize, transaction))) {
        return; // up recorded nothing: the previous state is the current one
      }
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });

      const [rows] = await sequelize.query(
        `SELECT table_name, column_name, kind, constraint_name, definition
           FROM ${qid(STATE_TABLE)}
          ORDER BY table_name, column_name, kind, constraint_name`,
        { transaction },
      );
      const current = await listForeignKeys(sequelize, transaction);

      // Every column whose constraints up replaced: drop what is there now
      // (the one up added), then put back what was there before — which, for
      // an A-149 column, is nothing.
      const replaced = new Set(
        rows.filter((r) => r.kind === "replaced").map((r) => keyOf(r.table_name, r.column_name)),
      );
      for (const fk of current.filter((f) => replaced.has(keyOf(f.table_name, f.column_name)))) {
        await sequelize.query(`ALTER TABLE ${qid(fk.table_name)} DROP CONSTRAINT ${qid(fk.name)}`, {
          transaction,
        });
      }
      for (const row of rows.filter((r) => r.kind === "constraint")) {
        await sequelize.query(
          `ALTER TABLE ${qid(row.table_name)} ADD CONSTRAINT ${qid(row.constraint_name)} ${row.definition}`,
          { transaction },
        );
      }
      for (const row of rows.filter((r) => r.kind === "nullable")) {
        await sequelize.query(
          `ALTER TABLE ${qid(row.table_name)} ALTER COLUMN ${qid(row.column_name)} DROP NOT NULL`,
          { transaction },
        );
      }
      await sequelize.query(`DROP TABLE ${qid(STATE_TABLE)}`, { transaction });
    });
  },
};
