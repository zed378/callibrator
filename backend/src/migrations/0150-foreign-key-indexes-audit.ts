/**
 * Migration 0150 — the foreign-key indexes the audit found missing (DB-01).
 *
 * WHAT WAS WRONG
 *
 * PostgreSQL indexes a primary key and a UNIQUE constraint; it does NOT index
 * a foreign key. The platform filters and joins on `(tenant_id, <fk>)` in
 * nearly every query, so an unindexed foreign key turns a per-tenant read
 * into a sequential scan of every tenant's rows — and turns every DELETE or
 * key UPDATE of a parent row into a scan of the child table to satisfy the
 * RESTRICT / CASCADE / SET NULL check, under lock.
 *
 * The audit (TASKS/AUDIT-2026-11-COMPREHENSIVE.md, DB-01) named seven tables.
 * Four of the seven are already covered by an earlier migration and are NOT
 * repeated here:
 *
 *   audit_logs (client_facility_id)      — 0117: (tenant_id, client_facility_id)
 *   calibration_records (client_facility_id, device_id)
 *                                          — 0119: (tenant_id, client_facility_id, device_id)
 *   inspection_results (client_facility_id, session_id)
 *                                          — 0126: (tenant_id, client_facility_id, session_id)
 *   workflow_actions (instance_id, step_id, user_id)
 *                                          — 0067
 *
 * Two of those cover only the three-column shape, so the two-column read
 * ("this tenant's records for this device", "this tenant's results for this
 * session") is still a scan: in a composite index the leading column decides
 * whether the index can be used, and `client_facility_id` sits between
 * `tenant_id` and the foreign key. Those two are added here as well.
 *
 * WHAT THIS DOES
 *
 *   ticket_comments    (ticket_id)                       — the comments of one ticket
 *   ticket_comments    (user_id, created_at)             — 0067 indexes user_id alone;
 *                                                          a user's own comment feed is
 *                                                          "my comments, newest first"
 *   webhook_deliveries (tenant_id, webhook_id)           — one webhook's delivery history
 *   webhook_deliveries (tenant_id, status, next_attempt_at)
 *                                                        — the dispatcher's claim query
 *   stocks             (tenant_id, warehouse_id)         — a warehouse's stock
 *   stocks             (tenant_id, location_id)          — a location's stock
 *   calibration_records (tenant_id, device_id)           — a device's calibration history
 *   inspection_results (tenant_id, session_id)           — one inspection session's results
 *
 * CONCURRENTLY, as 0062, 0093 and 0109 build theirs: every one of these
 * tables takes writes in every tenant, and a plain CREATE INDEX holds a
 * SHARE lock for the build. Umzug does not wrap a migration in a transaction,
 * which CONCURRENTLY requires. An INVALID index of the same name (an
 * interrupted concurrent build) is dropped and rebuilt, never accepted.
 *
 * The indexes live only here, never on a model: db.sync() runs first and
 * never adds an index to an existing table (D-13; the ADR-100 Am. 3 trap —
 * a model must not index a column a later migration adds).
 *
 * No try/catch: every failure propagates, and the migration is not recorded as
 * applied (CLAUDE.md). Verify with psql, not the log:
 *   SELECT indexname FROM pg_indexes WHERE indexname = ANY (ARRAY[…INDEXES names…]);
 *   EXPLAIN SELECT * FROM ticket_comments WHERE ticket_id = '<uuid>';
 *     -- Index Scan using ticket_comments_ticket_id
 *
 * Idempotent + reversible.
 */
import type { QueryInterface } from "sequelize";

interface FkIndex {
  readonly name: string;
  readonly table: string;
  readonly columns: string;
}

const ix = (table: string, name: string, columns: string): FkIndex =>
  Object.freeze({ table, name, columns });

const INDEXES: readonly FkIndex[] = Object.freeze([
  ix("ticket_comments", "ticket_comments_ticket_id", "ticket_id"),
  ix("ticket_comments", "ticket_comments_user_id_created_at", "user_id, created_at DESC"),
  ix("webhook_deliveries", "webhook_deliveries_tenant_id_webhook_id", "tenant_id, webhook_id"),
  ix(
    "webhook_deliveries",
    "webhook_deliveries_tenant_id_status_next_attempt_at",
    "tenant_id, status, next_attempt_at",
  ),
  ix("stocks", "stocks_tenant_id_warehouse_id", "tenant_id, warehouse_id"),
  ix("stocks", "stocks_tenant_id_location_id", "tenant_id, location_id"),
  ix("calibration_records", "calibration_records_tenant_id_device_id", "tenant_id, device_id"),
  ix("inspection_results", "inspection_results_tenant_id_session_id", "tenant_id, session_id"),
]);

/** @returns index name → indisvalid, for every index on the INDEXES tables */
const existing = async (context: QueryInterface): Promise<Map<string, boolean>> => {
  const [rows] = (await context.sequelize.query(
    `SELECT i.relname AS name, ix.indisvalid AS valid
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE t.relname IN (:tables) AND n.nspname = current_schema()`,
    { replacements: { tables: [...new Set(INDEXES.map((x) => x.table))] } },
  )) as [{ name: string; valid: boolean }[], unknown];
  return new Map(rows.map((r) => [r.name, r.valid]));
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const present = await existing(context);
  for (const { name, table, columns } of INDEXES) {
    if (present.get(name) === true) {
      continue;
    }
    if (present.has(name)) {
      // Left INVALID by an interrupted concurrent build: rebuild it.
      await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
    }
    await context.sequelize.query(`CREATE INDEX CONCURRENTLY "${name}" ON ${table} (${columns})`);
  }
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  for (const { name } of INDEXES) {
    await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
  }
};

export = { INDEXES, up, down };
