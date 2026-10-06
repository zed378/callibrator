/**
 * Migration 0109 — a partial, covering index of the LIVE calibration records,
 * per tenant in date order (U-06, ADR-119).
 *
 * WHAT WAS WRONG
 *
 * Every count of a tenant's records — the list's `meta.total` and three of the
 * dashboard's figures (total, compliant, last 30 days) — filters on
 * `is_deleted = false AND deleted_at IS NULL` (the model's defaultScope and
 * paranoid clause), and the list also on `superseded_by_id IS NULL`. No index
 * holds those columns, so each count visited the heap for every record of the
 * tenant. Measured on PostgreSQL 18 (pgvector/pgvector:pg18) over the P8-07
 * volume (scripts/load/p807-seed.sql, 50,000 records per tenant), 2026-10-05:
 *   Index Scan using calibration_records_tenant_id, Filter on the three
 *   columns, 50,000 rows: 1,510 buffers, 21–44 ms — four times per
 *   dashboard-plus-list pair, and the top four statements by total time in
 *   pg_stat_statements under the k6 baseline.
 *
 * WHAT THIS DOES
 *
 *   CREATE INDEX CONCURRENTLY calibration_records_tenant_live_date
 *     ON calibration_records (tenant_id, calibration_date DESC, is_compliant, superseded_by_id)
 *     WHERE is_deleted = false AND deleted_at IS NULL
 *
 * Its predicate is the live-record predicate every query of the model carries,
 * so the planner can use it for any of them; the two trailing key columns let
 * the list count (superseded_by_id) and the compliant count (is_compliant)
 * stay index-only.
 *
 * U-06b (ADR-120): they are KEY columns, not `INCLUDE (...)` as first written.
 * Sequelize 6's showIndex — which `db.sync()` runs for every model at EVERY
 * boot — parses pg_get_indexdef() by splitting the text between the first `(`
 * and the last `)` on commas, and indexes the pieces by `indkey`. INCLUDE
 * columns are in indkey but render after `) INCLUDE (`, so there were four
 * keys and three pieces: `attribute.match` on undefined, "Failed to start
 * server", a crash loop on every boot after the one that applied 0109 (seen on
 * PG 18, callib-u06b, 2026-10-05). indexDefinitionSync.u06b guards the shape.
 *
 * Measured on the same data: Index Only Scan, Heap Fetches 0, 361 buffers with
 * INCLUDE; the key-column form's plans are in the U-06b record.
 * (tenant_id, calibration_date DESC) also serves the dashboard's
 * date-windowed counts and the list's order.
 *
 * Built CONCURRENTLY, as 0062 and 0093 build theirs: the table takes writes in
 * every tenant. Umzug does not wrap a migration in a transaction, which
 * CONCURRENTLY requires. An INVALID index of the same name (an interrupted
 * concurrent build) is dropped and rebuilt, never accepted.
 *
 * The index lives only here, never on a model: db.sync() runs first and never
 * adds an index to an existing table (D-13; the ADR-100 Am. 3 trap).
 *
 * No try/catch: every failure propagates, and the migration is not recorded as
 * applied (CLAUDE.md). Verify with psql, not the log:
 *   SELECT indisvalid FROM pg_index WHERE indexrelid = 'calibration_records_tenant_live_date'::regclass;
 *   EXPLAIN SELECT count(*) FROM calibration_records
 *     WHERE tenant_id = '<uuid>' AND is_deleted = false AND deleted_at IS NULL;
 *     -- Index Only Scan using calibration_records_tenant_live_date
 *
 * Idempotent + reversible.
 */
import type { QueryInterface } from "sequelize";

const NAME = "calibration_records_tenant_live_date";
const TABLE = "calibration_records";
const DEFINITION =
  "(tenant_id, calibration_date DESC, is_compliant, superseded_by_id) " +
  "WHERE is_deleted = false AND deleted_at IS NULL";

/** @returns the index's indisvalid, or null when there is no index of that name on the table */
const validity = async (context: QueryInterface): Promise<boolean | null> => {
  const [rows] = (await context.sequelize.query(
    `SELECT ix.indisvalid AS valid
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE i.relname = :name AND t.relname = :table AND n.nspname = current_schema()`,
    { replacements: { name: NAME, table: TABLE } },
  )) as [{ valid: boolean }[], unknown];
  const [row] = rows;
  return row ? row.valid : null;
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const valid = await validity(context);
  if (valid === true) {
    return;
  }
  if (valid === false) {
    // Left INVALID by an interrupted concurrent build: rebuild it.
    await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${NAME}"`);
  }
  await context.sequelize.query(`CREATE INDEX CONCURRENTLY "${NAME}" ON ${TABLE} ${DEFINITION}`);
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${NAME}"`);
};

export = { NAME, TABLE, DEFINITION, up, down };
