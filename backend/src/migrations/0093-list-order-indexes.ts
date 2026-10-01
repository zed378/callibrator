/**
 * Per-tenant ORDER BY indexes for the operational lists (P8-04, ADR-096).
 *
 * WHAT WAS WRONG
 *
 * Every list endpoint reads one page of the caller's tenant in a fixed order,
 * but no index served "tenant, then that order". Measured on PostgreSQL 18
 * (pgvector/pgvector:pg18) over the P8-07 volume (scripts/load/p807-seed.sql)
 * plus 20,000 certificates, attachments and notifications, 10,000 work orders
 * and stocks per two tenants:
 *
 *  - calibration_records — ORDER BY calibration_date DESC: an Index Scan
 *    Backward on (calibration_date) that walked every tenant's rows and threw
 *    the other tenant's away (25,512 rows removed, 27,842 buffers, 63 ms for
 *    page 200 of 10); the dashboard's 30-day and 6-month counts scanned the
 *    tenant's whole history;
 *  - certificates — ORDER BY created_at DESC: Seq Scan + sort of every
 *    certificate the tenant has (12,000 rows, 53–85 ms);
 *  - calibration_devices — ORDER BY name: bitmap scan + top-N sort of all 5,000
 *    devices per page (40 ms at page 200);
 *  - maintenance_work_orders / attachments — ORDER BY created_at DESC: Seq
 *    Scan + sort (23–47 ms / 17–29 ms);
 *  - stocks — ORDER BY item_name: Seq Scan + sort (9–19 ms).
 *
 * WHAT THIS DOES
 *
 * Builds each index on INDEXES CONCURRENTLY, as 0062 does: every one of these
 * tables takes writes in every tenant, and a plain CREATE INDEX would hold a
 * SHARE lock for the build. Umzug does not wrap a migration in a transaction,
 * which CONCURRENTLY requires. An INVALID index of the same name (an
 * interrupted concurrent build) is dropped and rebuilt, never accepted.
 *
 * The indexes live only here, never on a model: db.sync() runs first and never
 * adds an index to an existing table (D-13), and on a fresh database this
 * migration builds them the same way.
 *
 * No try/catch: every failure propagates, and the migration is not recorded as
 * applied (CLAUDE.md). Verify with psql, not the log:
 *   SELECT indexname FROM pg_indexes WHERE indexname = ANY (ARRAY[…INDEXES names…]);
 *   EXPLAIN SELECT id FROM certificates WHERE tenant_id = '<uuid>' AND deleted_at IS NULL
 *     ORDER BY created_at DESC LIMIT 10;   -- Index Scan using certificates_tenant_id_created_at
 *
 * Idempotent + reversible.
 */
import type { QueryInterface } from "sequelize";

interface ListIndex {
  readonly name: string;
  readonly table: string;
  readonly columns: string;
}

const ix = (table: string, name: string, columns: string): ListIndex => Object.freeze({ table, name, columns });

const INDEXES: readonly ListIndex[] = Object.freeze([
  ix("calibration_records", "calibration_records_tenant_id_calibration_date", "tenant_id, calibration_date DESC"),
  ix("certificates", "certificates_tenant_id_created_at", "tenant_id, created_at DESC"),
  ix("calibration_devices", "calibration_devices_tenant_id_name", "tenant_id, name"),
  ix("maintenance_work_orders", "maintenance_work_orders_tenant_id_created_at", "tenant_id, created_at DESC"),
  ix("attachments", "attachments_tenant_id_created_at", "tenant_id, created_at DESC"),
  ix("stocks", "stocks_tenant_id_item_name", "tenant_id, item_name"),
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
