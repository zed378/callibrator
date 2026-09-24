"use strict";

/**
 * `signature_records.workflow_step_id` → `signature_workflow_steps`:
 * ON DELETE CASCADE becomes ON DELETE RESTRICT (D-18).
 *
 * WHAT WAS WRONG
 *
 * An executed electronic signature is a 21 CFR Part 11 record (11.10(c),
 * 11.70: signatures stay linked to their records). Migrations 0030 and 0037
 * made its other three foreign keys refuse a hard delete — the tenant, the
 * workflow and the signer are RESTRICT — but left the fourth, the workflow
 * STEP it executes, as `ON DELETE CASCADE` (the model attribute declared it,
 * and 0037 kept it on its "unchanged" list). A hard delete of one step row —
 * one `force: true`, one hand-run `DELETE` — silently erased every signature
 * made on it. Today nothing hard-deletes a step: steps are paranoid and
 * eSignature.service#deleteWorkflow refuses (409) a workflow with any
 * signature. The database was the one layer that would have obeyed.
 *
 * THE RULE (D-18, applied to all five evidence tables — see the ADR draft):
 * an evidence-bearing row's link to what it evidences is RESTRICT; only a
 * non-attesting operational actor may be SET NULL. After this migration the
 * rule holds with no exception:
 *   - signature_records: tenant, workflow, workflow_step, user, revoked_by —
 *     all RESTRICT (0030, 0037, this);
 *   - e_signature_records: tenant, user — RESTRICT (0030);
 *   - certificates: tenant, device, calibration_record, calibrated/approved/
 *     signed_by — RESTRICT (0030, 0037); created/updated/deleted_by NO ACTION,
 *     which refuses exactly as RESTRICT does for a non-deferrable key;
 *   - calibration_records: tenant, device, performed_by, voided_by,
 *     supersedes/superseded_by — RESTRICT (0030, 0037, P6-03 / 0057);
 *   - attachments: tenant RESTRICT; uploaded_by SET NULL (an operational
 *     actor); the polymorphic resource link has no foreign key at all (D-22).
 *
 * WHAT THIS DOES
 *
 * Every foreign key on the column is DISCOVERED from pg_constraint (never by
 * assumed name), recorded verbatim in STATE_TABLE, and replaced by exactly
 * one: `signature_records_workflow_step_id_fkey`, `ON DELETE RESTRICT ON
 * UPDATE CASCADE` — what a fresh `sync()` of the corrected model writes, so a
 * migrated database and a new one converge. A compliant column is left alone.
 *
 * REFUSE, DON'T REPAIR (the 0030/0037 pattern): when the column carries no
 * validated key to signature_workflow_steps, a signature naming a step that
 * does not exist blocks the migration, listing the rows; it changes nothing.
 *
 * ATOMIC, REVERSIBLE, IDEMPOTENT. One transaction with a lock timeout; `down`
 * restores exactly what `up` recorded; a second `up` changes nothing.
 *
 * No try/catch: every failure propagates (CLAUDE.md). Verify with psql:
 *   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
 *    WHERE conrelid = 'signature_records'::regclass AND contype = 'f';
 */

const TABLE = "signature_records";
const COLUMN = "workflow_step_id";
const REF = "signature_workflow_steps";
const ACTION = "RESTRICT";
const FK_NAME = `${TABLE}_${COLUMN}_fkey`;
const STATE_TABLE = "migration_0066_previous_foreign_keys";
const LOCK_TIMEOUT = "15s";
const SAMPLE_IDS = 5;

const qid = (name) => `"${String(name).replace(/"/g, '""')}"`;

const listForeignKeys = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT c.conname AS name,
            rf.relname AS ref_table,
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
        AND cl.relname = :table
        AND a.attname = :column
      ORDER BY c.conname`,
    { replacements: { table: TABLE, column: COLUMN }, transaction },
  );
  return rows;
};

const columnExists = async (sequelize, transaction) => {
  const [[row]] = await sequelize.query(
    `SELECT count(*)::int AS n
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column`,
    { replacements: { table: TABLE, column: COLUMN }, transaction },
  );
  return row.n > 0;
};

const isCompliant = (fks) =>
  fks.length === 1 &&
  fks[0].ref_table === REF &&
  fks[0].on_delete === "r" &&
  fks[0].on_update === "c" &&
  fks[0].validated;

const stateTableExists = async (sequelize, transaction) => {
  const [[row]] = await sequelize.query(
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { replacements: { table: STATE_TABLE }, transaction },
  );
  return row.present;
};

module.exports = {
  TABLE,
  COLUMN,
  REF,
  ACTION,
  FK_NAME,
  STATE_TABLE,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });

      if (!(await columnExists(sequelize, transaction))) {
        throw new Error(
          `Migration 0066 refused: ${TABLE}.${COLUMN} does not exist. Nothing was changed. ` +
            "The schema is not the one the models describe; find out why before re-running.",
        );
      }

      const fks = await listForeignKeys(sequelize, transaction);
      if (isCompliant(fks)) {
        return; // fresh database from the current model, or a second run
      }

      // A validated key to the step table already vouches for every id.
      if (!fks.some((fk) => fk.validated && fk.ref_table === REF)) {
        const [[row]] = await sequelize.query(
          `SELECT count(*)::int AS n, (array_agg(r.id::text))[1:${SAMPLE_IDS}] AS sample
             FROM ${qid(TABLE)} r
            WHERE r.${qid(COLUMN)} IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM ${qid(REF)} s WHERE s.id = r.${qid(COLUMN)})`,
          { transaction },
        );
        if (row.n > 0) {
          throw new Error(
            `Migration 0066 refused: ${row.n} signature record(s) name a workflow step that does ` +
              `not exist (e.g. id ${(row.sample || []).join(", ")}), so the foreign key cannot be ` +
              "enforced. Nothing was changed. A signature is Part 11 evidence: restore the step it " +
              "was made on, or archive the record with a recorded reason, then re-run.",
          );
        }
      }

      await sequelize.query(
        `CREATE TABLE IF NOT EXISTS ${qid(STATE_TABLE)} (
           constraint_name text PRIMARY KEY,
           definition text NOT NULL,
           recorded_at timestamptz NOT NULL DEFAULT now()
         )`,
        { transaction },
      );
      for (const fk of fks) {
        await sequelize.query(
          `INSERT INTO ${qid(STATE_TABLE)} (constraint_name, definition) VALUES (:name, :definition)
           ON CONFLICT DO NOTHING`,
          { replacements: { name: fk.name, definition: fk.definition }, transaction },
        );
        await sequelize.query(`ALTER TABLE ${qid(TABLE)} DROP CONSTRAINT ${qid(fk.name)}`, {
          transaction,
        });
      }
      await sequelize.query(
        `ALTER TABLE ${qid(TABLE)} ADD CONSTRAINT ${qid(FK_NAME)} ` +
          `FOREIGN KEY (${qid(COLUMN)}) REFERENCES ${qid(REF)} ("id") ` +
          `ON DELETE ${ACTION} ON UPDATE CASCADE`,
        { transaction },
      );
    });
  },

  down: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      if (!(await stateTableExists(sequelize, transaction))) {
        return; // up changed nothing: the previous state is the current one
      }
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      const [previous] = await sequelize.query(
        `SELECT constraint_name, definition FROM ${qid(STATE_TABLE)} ORDER BY constraint_name`,
        { transaction },
      );
      for (const fk of await listForeignKeys(sequelize, transaction)) {
        await sequelize.query(`ALTER TABLE ${qid(TABLE)} DROP CONSTRAINT ${qid(fk.name)}`, {
          transaction,
        });
      }
      for (const row of previous) {
        await sequelize.query(
          `ALTER TABLE ${qid(TABLE)} ADD CONSTRAINT ${qid(row.constraint_name)} ${row.definition}`,
          { transaction },
        );
      }
      await sequelize.query(`DROP TABLE ${qid(STATE_TABLE)}`, { transaction });
    });
  },
};
