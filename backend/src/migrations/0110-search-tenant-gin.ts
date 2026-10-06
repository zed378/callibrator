/**
 * Migration 0110 — the full-text search indexes are per tenant (U-06b, ADR-120).
 *
 * WHAT WAS WRONG
 *
 * GET /search runs, per type, `tenant_id = $2 AND <live> AND search_vector @@
 * plainto_tsquery('english', $1) ORDER BY ts_rank(...) DESC LIMIT $3`
 * (search.service#ftsSearch). The only full-text index was 0003's GIN on
 * `search_vector` alone, which holds every tenant's rows. A term therefore
 * matched every tenant's rows in the index, and the heap visit filtered the
 * other tenants' away. Measured on PostgreSQL 18 (pgvector/pgvector:pg18) over
 * the P8-07 volume (two tenants of 5,000 devices), as `callibrator_app`,
 * 2026-10-05: `infusion` read 2,000 index matches, 343 heap blocks and
 * removed 1,000 rows of the other tenant (Rows Removed by Filter: 1000). The
 * work grows with the PLATFORM's matches, not the caller's: with N tenants of
 * similar inventory, N times the caller's own.
 *
 * WHAT THIS DOES
 *
 *   CREATE EXTENSION IF NOT EXISTS btree_gin;
 *   CREATE INDEX CONCURRENTLY <table>_tenant_id_search_vector
 *     ON <table> USING gin (tenant_id, search_vector);
 *   DROP INDEX CONCURRENTLY IF EXISTS idx_<table>_search;   -- 0003's, now redundant
 *
 * on calibration_devices, stocks and certificates. btree_gin gives GIN an
 * operator class for `uuid`, so one index holds (tenant, lexeme) and the
 * bitmap scan intersects both inside the index: the same `infusion` reads
 * 1,000 matches and 172 heap blocks, removes none (U-06b record). A multi-
 * column GIN serves a condition on any subset of its columns equally, so the
 * single-column index 0003 built is dropped (one GIN to maintain per write,
 * not two).
 *
 * The extension: btree_gin ships with PostgreSQL (contrib) and is in the
 * pgvector/pgvector:pg18 image; it is a TRUSTED extension (PostgreSQL 13+),
 * so the database owner the migrations run as can create it without being a
 * superuser — checked on PostgreSQL 18 with a NOSUPERUSER owner (U-06b
 * record). A role that is neither the owner nor holds CREATE on the database
 * gets PostgreSQL's own "permission denied to create extension "btree_gin"
 * … Must have CREATE privilege on current database": the migration fails, is
 * not recorded as applied, and the operator creates the extension once
 * (deploy/helm values.yaml § database names the step). The application role
 * needs nothing: the planner uses the index.
 * `down` keeps the extension (other objects may come to use it; 0018 keeps
 * `vector` the same way).
 *
 * Built CONCURRENTLY, as 0062, 0093 and 0109 build theirs: these tables take
 * writes in every tenant. An INVALID index of the same name (an interrupted
 * concurrent build) is dropped and rebuilt, never accepted. The new index is
 * built BEFORE the old one is dropped, so search is never without an index.
 *
 * The indexes live only here, never on a model (db.sync() runs first; the
 * ADR-100 Am. 3 trap). Their rendered definition, `USING gin (tenant_id,
 * search_vector)`, parses in Sequelize's showIndex, which every boot's sync
 * runs (indexDefinitionSync.u06b).
 *
 * No try/catch: every failure propagates, and the migration is not recorded as
 * applied (CLAUDE.md). Verify with psql, not the log:
 *   SELECT indexrelid::regclass, indisvalid FROM pg_index
 *    WHERE indexrelid::regclass::text LIKE '%_tenant_id_search_vector';
 *   EXPLAIN SELECT id FROM calibration_devices WHERE tenant_id = '<uuid>'
 *     AND search_vector @@ plainto_tsquery('english', 'infusion');
 *     -- Bitmap Index Scan on calibration_devices_tenant_id_search_vector
 *
 * Idempotent + reversible.
 */
import type { QueryInterface } from "sequelize";

interface SearchIndex {
  readonly table: string;
  /** The per-tenant index this migration builds. */
  readonly name: string;
  /** 0003's single-column index it replaces. */
  readonly replaces: string;
}

const TABLES = ["calibration_devices", "stocks", "certificates"] as const;

const INDEXES: readonly SearchIndex[] = Object.freeze(
  TABLES.map((table) =>
    Object.freeze({ table, name: `${table}_tenant_id_search_vector`, replaces: `idx_${table}_search` }),
  ),
);

/** @returns index name → indisvalid, for every index on the three tables */
const existing = async (context: QueryInterface): Promise<Map<string, boolean>> => {
  const [rows] = (await context.sequelize.query(
    `SELECT i.relname AS name, ix.indisvalid AS valid
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE t.relname IN (:tables) AND n.nspname = current_schema()`,
    { replacements: { tables: [...TABLES] } },
  )) as [{ name: string; valid: boolean }[], unknown];
  return new Map(rows.map((r) => [r.name, r.valid]));
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.query("CREATE EXTENSION IF NOT EXISTS btree_gin");
  const present = await existing(context);
  for (const { table, name, replaces } of INDEXES) {
    if (present.get(name) !== true) {
      if (present.has(name)) {
        // Left INVALID by an interrupted concurrent build: rebuild it.
        await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
      }
      await context.sequelize.query(`CREATE INDEX CONCURRENTLY "${name}" ON ${table} USING gin (tenant_id, search_vector)`);
    }
    // Only once the per-tenant index is in place.
    await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${replaces}"`);
  }
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const present = await existing(context);
  for (const { table, name, replaces } of INDEXES) {
    if (present.get(replaces) !== true) {
      if (present.has(replaces)) {
        await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${replaces}"`);
      }
      // 0003's index, exactly as 0003 builds it (concurrently here: the table is live).
      await context.sequelize.query(`CREATE INDEX CONCURRENTLY "${replaces}" ON "${table}" USING GIN ("search_vector")`);
    }
    await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
  }
};

export = { INDEXES, up, down };
