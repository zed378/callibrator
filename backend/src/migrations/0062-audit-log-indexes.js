"use strict";

/**
 * `audit_logs` indexes (D-08).
 *
 * The table had no index but its primary key (a random UUID) plus the two
 * narrow ones 0029 and 0033 added (impersonator_id; actor_type, actor_name).
 * Every read of the trail was a sequential scan over EVERY tenant's rows:
 *
 *  - audit.service#fetchAuditLogs — `WHERE tenant_id = ? [AND …]
 *    ORDER BY created_at DESC LIMIT n`, the audit list;
 *  - gdpr.service#exportAuditLogs / maskAuditTrail — `WHERE tenant_id = ?
 *    AND (user_id … OR resource_type = 'User' AND resource_id …)`;
 *  - every ON DELETE RESTRICT check from users → audit_logs.user_id (0030):
 *    a user delete scanned the whole trail to prove no row referenced it.
 *
 * `audit_logs` is the one table that grows with every mutation, by design
 * (CLAUDE.md), and is never purged (ADR-051 Q-12). It is the largest table
 * and the one whose natural filters are the most selective.
 *
 * Indexes added:
 *   audit_logs_tenant_id_created_at   (tenant_id, created_at DESC) — the list, newest first
 *   audit_logs_tenant_id_resource     (tenant_id, resource_type, resource_id) — "what happened to X"
 *   audit_logs_user_id                (user_id) — "what did this user do", and the FK check
 *
 * CONCURRENTLY, so the build does not block writes: every mutation in the
 * application writes an audit row, and a plain CREATE INDEX would hold a SHARE
 * lock on the table — stalling every write in every tenant — for as long as
 * the build takes on the largest table in the schema. Umzug does not wrap a
 * migration in a transaction, which CONCURRENTLY requires.
 *
 * A concurrent build that fails part-way leaves an INVALID index behind, and
 * `IF NOT EXISTS` would then silently keep it. So an invalid index of the same
 * name is dropped and rebuilt, never accepted.
 *
 * The indexes live only here, not on the model: db.sync() never adds an index
 * to an existing table (D-13), and on a fresh database this migration builds
 * them on the empty table the same way. No try/catch: every failure
 * propagates and the migration is not recorded as applied (CLAUDE.md).
 *
 * Verify with psql, not the log:
 *   SELECT indexname FROM pg_indexes WHERE tablename = 'audit_logs';
 *   EXPLAIN SELECT * FROM audit_logs WHERE tenant_id = '<uuid>'
 *     ORDER BY created_at DESC LIMIT 50;       -- Index Scan using audit_logs_tenant_id_created_at
 *
 * Idempotent + reversible.
 */

const TABLE = "audit_logs";

const INDEXES = Object.freeze([
  Object.freeze({ name: "audit_logs_tenant_id_created_at", columns: "tenant_id, created_at DESC" }),
  Object.freeze({ name: "audit_logs_tenant_id_resource", columns: "tenant_id, resource_type, resource_id" }),
  Object.freeze({ name: "audit_logs_user_id", columns: "user_id" }),
]);

/** @returns {Promise<Map<string, boolean>>} index name → indisvalid, for this table's indexes */
const existing = async (queryInterface) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT i.relname AS name, ix.indisvalid AS valid
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE t.relname = :table AND n.nspname = current_schema()`,
    { replacements: { table: TABLE } },
  );
  return new Map(rows.map((r) => [r.name, r.valid]));
};

module.exports = {
  TABLE,
  INDEXES,

  up: async ({ context }) => {
    const present = await existing(context);
    for (const { name, columns } of INDEXES) {
      if (present.get(name) === true) {
        continue;
      }
      if (present.has(name)) {
        // Left INVALID by an interrupted concurrent build: rebuild it.
        await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
      }
      await context.sequelize.query(`CREATE INDEX CONCURRENTLY "${name}" ON ${TABLE} (${columns})`);
    }
  },

  down: async ({ context }) => {
    for (const { name } of INDEXES) {
      await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
    }
  },
};
