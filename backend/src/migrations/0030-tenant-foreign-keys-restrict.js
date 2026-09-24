"use strict";

/**
 * Tenant and regulated-user foreign keys: NOT NULL and ON DELETE RESTRICT
 * (ADR-051 Q-16; A-88, A-122, W-20, F-6).
 *
 * WHAT WAS WRONG
 *
 *  - A-88. Most models associated to Tenant with `foreignKey: "tenant_id"`,
 *    the COLUMN name, instead of the attribute (`tenantId`). Sequelize then
 *    adds a second attribute on the same column, and because `sync()` builds
 *    columns from `tableAttributes` (keyed by field), the duplicate wins: on a
 *    database built by sync() `tenant_id` came out NULLABLE with
 *    `ON DELETE SET NULL` on 39 tables — certificates, calibration records,
 *    both signature tables, users. A deleted tenant would have left rows that
 *    belong to nobody and that no tenant predicate can match.
 *  - W-20. `audit_logs.tenant_id` is `ON DELETE CASCADE`: deleting a tenant
 *    row deletes its whole audit trail, including the record of its own
 *    offboarding.
 *  - F-6. `calibration_records.performed_by` → users. The model says NOT NULL
 *    + CASCADE; the same duplicate-attribute shape made sync() build it
 *    nullable + SET NULL. Either way a hard-deleted user took away who
 *    performed the calibration (CASCADE: the record itself).
 *
 * WHAT THIS DOES
 *
 * 1. Every single-column foreign key to `tenants` (except `tenants.parent_id`)
 *    becomes `ON DELETE RESTRICT ON UPDATE CASCADE`, except the tables on
 *    TENANT_FK_CASCADE — derived, ephemeral or pure-integration data that has
 *    no meaning without its tenant and no regulatory retention — which keep
 *    CASCADE. The tenant column becomes NOT NULL, except on TENANT_NULLABLE,
 *    where NULL is a meaning the code relies on, not an orphan.
 * 2. The user foreign keys on USER_FK_RESTRICT — who performed, signed,
 *    approved, authored or was trained, and the audit actor — become
 *    `ON DELETE RESTRICT`: a hard delete of that user is refused rather than
 *    erasing the attribution (SET NULL) or the record (CASCADE). Users are
 *    paranoid, so ordinary deletion is unaffected. `notNull` columns become
 *    NOT NULL, matching their models.
 *
 * Constraints are DISCOVERED from pg_constraint by column, never by assumed
 * name: a database built by the old sync() and one built by the new models
 * name them the same way today, but a database touched by `sync({ alter })`
 * or by hand may carry duplicates or other names. Every foreign key on the
 * column is dropped and exactly one is added, named `<table>_<column>_fkey` —
 * the name PostgreSQL gives the inline REFERENCES that sync() writes, so a
 * migrated database and a fresh one converge to the same catalog.
 *
 * REFUSE, DON'T REPAIR (the 0024/0026 pattern). Before ANY change, if a
 * column that must become NOT NULL holds NULLs — or a column with no validated
 * foreign key holds ids that name nothing — the migration throws, listing the
 * table, column, count and sample ids. Which hospital an orphaned certificate
 * belongs to, or who performed a calibration whose performer was erased, is
 * not a migration's decision. Soft-deleted rows count: they are records too.
 *
 * ATOMIC. Everything runs in one transaction: a refusal, a lock timeout or a
 * failed statement leaves the schema exactly as it was. `lock_timeout` makes
 * the migration fail fast instead of queueing an ACCESS EXCLUSIVE request
 * behind a long transaction (and every query behind it). It runs at boot, so
 * a refusal stops the backend from starting — ship it as a planned deploy
 * with the orphan query below run by hand the day before.
 *
 * REVERSIBLE. Every constraint it drops and every column it makes NOT NULL is
 * first recorded, verbatim (`pg_get_constraintdef`), in STATE_TABLE, created
 * only when there is something to record. `down` restores exactly those —
 * duplicates and original names included — and drops the table. On a fresh
 * database built by the new models nothing differs, nothing is recorded, and
 * `down` has nothing to restore: the previous state IS the new one.
 *
 * IDEMPOTENT. A compliant column is left alone; a second `up` changes nothing
 * and never overwrites what the first recorded.
 *
 * No try/catch: every failure propagates (CLAUDE.md; 0008/0013/0014). Verify
 * with psql, not the log — `\d certificates`, `\d audit_logs`, or:
 *   SELECT conrelid::regclass, conname, pg_get_constraintdef(oid)
 *     FROM pg_constraint WHERE contype = 'f' AND confrelid = 'tenants'::regclass;
 * Orphans before deploy:
 *   SELECT '<table>', count(*) FROM <table> WHERE tenant_id IS NULL;  -- per table
 */

const TENANTS = "tenants";
const USERS = "users";
const STATE_TABLE = "migration_0030_previous_foreign_keys";
const LOCK_TIMEOUT = "15s";

/** How many offending columns a refusal lists before summarising. */
const REPORT_LIMIT = 20;
/** How many sample ids per offending column. */
const SAMPLE_IDS = 5;

/**
 * Tenant-owned tables whose rows are deleted with their tenant. Each is
 * derived, ephemeral or integration configuration — nothing a regulator,
 * auditor or the tenant's own legal hold needs after the tenant is gone.
 * Every table NOT listed here is RESTRICT.
 */
const TENANT_FK_CASCADE = Object.freeze([
  "sessions", // login sessions; meaningless without the tenant, and should die with it
  "notifications", // transient in-app messages
  "UsageMetrics", // metered-usage counters; the invoices built from them are RESTRICT
  "usage_alerts", // derived threshold alerts over UsageMetrics
  "plan_quotas", // plan-derived limits, recomputable
  "document_chunks", // derived RAG index over documents that are themselves retained
  "batch_jobs", // job-queue state; the records a job produces are separate rows
  "webhooks", // integration endpoints; nothing should keep firing for a deleted tenant
  "webhook_deliveries", // delivery attempts log for those endpoints
  "api_keys", // credentials; must not outlive the tenant
  "custom_domains", // DNS/TLS routing configuration
  "kanban_projects", // internal project tracker, not a regulated record
  "kanban_cards", // ditto
  "ticket_counters", // a sequence counter; the tickets themselves are RESTRICT
  "qms_counters", // ditto for NC/CAPA numbers (migration 0024; no model)
]);

/**
 * Tenant columns that stay NULLABLE because NULL means something:
 *  - users: a tenant-less principal (platform operator created without a
 *    tenant; user.service#createUser lets a super admin do this, and
 *    auth.service / auth.middleware treat `!user.tenantId` explicitly);
 *  - sessions: the sessions of such a principal;
 *  - data_retention_policies: a NULL tenant is a global default policy. Q-10
 *    removes global policy rows (A-121); until it lands, NULL is by design.
 */
const TENANT_NULLABLE = Object.freeze(["users", "sessions", "data_retention_policies"]);

/**
 * User foreign keys on regulated records that become ON DELETE RESTRICT.
 * `notNull` mirrors the model attribute's allowNull: false.
 *
 * Not here, deliberately:
 *  - certificates.created_by / updated_by / deleted_by and
 *    tenant_backups.deleted_by are already NO ACTION, which for a
 *    non-deferrable constraint refuses the delete exactly as RESTRICT does;
 *  - operational references (assigned_to, uploaded_by, reported_by, ticket and
 *    stock actors, backup creator, …) keep SET NULL: the record survives and
 *    the reference is not an attestation.
 */
const USER_FK_RESTRICT = Object.freeze([
  Object.freeze({ table: "calibration_records", column: "performed_by", notNull: true }), // F-6
  Object.freeze({ table: "certificates", column: "calibrated_by", notNull: false }),
  Object.freeze({ table: "certificates", column: "approved_by", notNull: false }),
  Object.freeze({ table: "certificates", column: "signed_by", notNull: false }),
  Object.freeze({ table: "e_signature_records", column: "user_id", notNull: true }),
  Object.freeze({ table: "signature_records", column: "user_id", notNull: true }),
  Object.freeze({ table: "audit_logs", column: "user_id", notNull: false }), // nullable: system actor (Q-13)
  Object.freeze({ table: "audit_logs", column: "impersonator_id", notNull: false }), // F-8, 0029 deferred to Q-16
  Object.freeze({ table: "sop_training_acknowledgments", column: "user_id", notNull: true }),
  Object.freeze({ table: "sop_documents", column: "author_id", notNull: true }),
  Object.freeze({ table: "capas", column: "approved_by", notNull: false }),
]);

/** pg_constraint.confdeltype codes. */
const ACTION_CODE = Object.freeze({ RESTRICT: "r", CASCADE: "c", "SET NULL": "n", "NO ACTION": "a" });

const qid = (name) => `"${String(name).replace(/"/g, '""')}"`;

/** The intended ON DELETE for a tenant foreign key on `table`. */
const tenantAction = (table) => (TENANT_FK_CASCADE.includes(table) ? "CASCADE" : "RESTRICT");

/** Every single-column FK to tenants/users in the current schema. */
const listForeignKeys = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT cl.relname AS table_name,
            a.attname AS column_name,
            rf.relname AS ref_table,
            c.conname AS name,
            pg_get_constraintdef(c.oid) AS definition,
            c.confdeltype AS on_delete,
            c.confupdtype AS on_update,
            c.convalidated AS validated,
            a.attnotnull AS not_null
       FROM pg_constraint c
       JOIN pg_class cl ON cl.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       JOIN pg_class rf ON rf.oid = c.confrelid AND rf.relnamespace = n.oid
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND n.nspname = current_schema()
        AND rf.relname IN (:refs)
        AND cardinality(c.conkey) = 1
        AND c.conrelid <> c.confrelid
      ORDER BY cl.relname, a.attname, c.conname`,
    { replacements: { refs: [TENANTS, USERS] }, transaction },
  );
  return rows;
};

/**
 * The columns this migration owns, each with its intended state and the
 * foreign keys it has now.
 */
const planTargets = (fks) => {
  const byColumn = new Map();
  for (const fk of fks) {
    const key = `${fk.table_name}.${fk.column_name}.${fk.ref_table}`;
    if (!byColumn.has(key)) {
      byColumn.set(key, []);
    }
    byColumn.get(key).push(fk);
  }

  const targets = [];
  for (const [key, existing] of byColumn) {
    const { table_name: table, column_name: column, ref_table: ref } = existing[0];
    if (ref === TENANTS) {
      targets.push({
        key,
        table,
        column,
        ref,
        action: tenantAction(table),
        notNull: !TENANT_NULLABLE.includes(table),
        existing,
      });
      continue;
    }
    const named = USER_FK_RESTRICT.find((u) => u.table === table && u.column === column);
    if (named) {
      targets.push({ key, table, column, ref, action: "RESTRICT", notNull: named.notNull, existing });
    }
  }
  return targets;
};

const isCompliant = (target) =>
  target.existing.length === 1 &&
  target.existing[0].on_delete === ACTION_CODE[target.action] &&
  target.existing[0].on_update === "c" &&
  target.existing[0].validated;

const needsNotNull = (target) => target.notNull && !target.existing[0].not_null;

/** NULLs where NOT NULL is coming, and dangling ids where no FK vouches for them. */
const findOrphans = async (sequelize, transaction, targets) => {
  const problems = [];
  for (const t of targets) {
    if (needsNotNull(t)) {
      const [[row]] = await sequelize.query(
        `SELECT count(*)::int AS n,
                (array_agg(to_jsonb(x) ->> 'id'))[1:${SAMPLE_IDS}] AS sample
           FROM ${qid(t.table)} x
          WHERE x.${qid(t.column)} IS NULL`,
        { transaction },
      );
      if (row.n > 0) {
        problems.push({ ...t, kind: "NULL", n: row.n, sample: row.sample || [] });
      }
    }
    if (!t.existing.some((fk) => fk.validated)) {
      const [[row]] = await sequelize.query(
        `SELECT count(*)::int AS n,
                (array_agg(to_jsonb(x) ->> 'id'))[1:${SAMPLE_IDS}] AS sample
           FROM ${qid(t.table)} x
          WHERE x.${qid(t.column)} IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM ${qid(t.ref)} r WHERE r.id = x.${qid(t.column)})`,
        { transaction },
      );
      if (row.n > 0) {
        problems.push({ ...t, kind: "dangling", n: row.n, sample: row.sample || [] });
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
    `Migration 0030 refused: ${problems.length} column(s) hold rows that belong to no ` +
      "tenant or no user, so NOT NULL / the foreign key cannot be enforced. Nothing was changed. " +
      "This migration will not delete these rows or assign them to a tenant or a user on its own " +
      "authority (ADR-051 Q-16).\n" +
      `${lines.join("\n")}\n` +
      "Resolve each deliberately (assign the row to the tenant or person it belongs to, or " +
      "archive and remove it with a recorded reason), then re-run.",
  );
};

const ensureStateTable = (sequelize, transaction) =>
  sequelize.query(
    `CREATE TABLE IF NOT EXISTS ${qid(STATE_TABLE)} (
       table_name text NOT NULL,
       column_name text NOT NULL,
       kind text NOT NULL CHECK (kind IN ('constraint', 'nullable')),
       constraint_name text NOT NULL DEFAULT '',
       ref_table text,
       definition text,
       recorded_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (table_name, column_name, kind, constraint_name)
     )`,
    { transaction },
  );

const record = (sequelize, transaction, row) =>
  sequelize.query(
    `INSERT INTO ${qid(STATE_TABLE)}
       (table_name, column_name, kind, constraint_name, ref_table, definition)
     VALUES (:table, :column, :kind, :name, :ref, :definition)
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

const fkName = (table, column) => `${table}_${column}_fkey`;

module.exports = {
  TENANT_FK_CASCADE,
  TENANT_NULLABLE,
  USER_FK_RESTRICT,
  STATE_TABLE,
  tenantAction,
  fkName,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });

      const targets = planTargets(await listForeignKeys(sequelize, transaction));

      // 1. Refuse on orphans — before ANY change.
      const problems = await findOrphans(sequelize, transaction, targets);
      if (problems.length) {
        throw orphanError(problems);
      }

      const pending = targets.filter((t) => !isCompliant(t) || needsNotNull(t));
      if (!pending.length) {
        return; // fresh database from the current models, or a second run
      }
      await ensureStateTable(sequelize, transaction);

      for (const t of pending) {
        // 2. Record, then replace, every foreign key on the column.
        if (!isCompliant(t)) {
          for (const fk of t.existing) {
            await record(sequelize, transaction, {
              table: t.table,
              column: t.column,
              kind: "constraint",
              name: fk.name,
              ref: t.ref,
              definition: fk.definition,
            });
            await sequelize.query(
              `ALTER TABLE ${qid(t.table)} DROP CONSTRAINT ${qid(fk.name)}`,
              { transaction },
            );
          }
          await sequelize.query(
            `ALTER TABLE ${qid(t.table)} ADD CONSTRAINT ${qid(fkName(t.table, t.column))} ` +
              `FOREIGN KEY (${qid(t.column)}) REFERENCES ${qid(t.ref)} ("id") ` +
              `ON DELETE ${t.action} ON UPDATE CASCADE`,
            { transaction },
          );
        }

        // 3. NOT NULL where the model says so.
        if (needsNotNull(t)) {
          await record(sequelize, transaction, {
            table: t.table,
            column: t.column,
            kind: "nullable",
            name: "",
            ref: t.ref,
            definition: null,
          });
          await sequelize.query(
            `ALTER TABLE ${qid(t.table)} ALTER COLUMN ${qid(t.column)} SET NOT NULL`,
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
        `SELECT table_name, column_name, kind, constraint_name, ref_table, definition
           FROM ${qid(STATE_TABLE)}
          ORDER BY table_name, column_name, kind, constraint_name`,
        { transaction },
      );
      const current = await listForeignKeys(sequelize, transaction);

      const restored = new Set();
      for (const row of rows.filter((r) => r.kind === "constraint")) {
        const key = `${row.table_name}.${row.column_name}.${row.ref_table}`;
        if (!restored.has(key)) {
          restored.add(key);
          const now = current.filter(
            (fk) =>
              fk.table_name === row.table_name &&
              fk.column_name === row.column_name &&
              fk.ref_table === row.ref_table,
          );
          for (const fk of now) {
            await sequelize.query(
              `ALTER TABLE ${qid(fk.table_name)} DROP CONSTRAINT ${qid(fk.name)}`,
              { transaction },
            );
          }
        }
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
