/**
 * Migration 0148 — the device register's text search uses an index (2026-10-29, measured on the real dump).
 *
 * WHAT WAS SLOW
 *
 * GET /calibration-devices?find=<term> filters `name ILIKE '%term%' OR serial_number ILIKE … OR
 * manufacturer ILIKE …` (calibrationDevices.service#listWhere), for the page and again for its count.
 * No index serves a leading-wildcard ILIKE, so both read every live device of the tenant. On the
 * P24-05 dry run's volume (23,722 devices in one tenant, PostgreSQL 18), a term matching nothing — a
 * serial number typed in the field, say — read all 23,722 rows: 38 ms for the page, the same for the
 * count, growing with the register.
 *
 * WHAT THIS DOES
 *
 *   CREATE EXTENSION IF NOT EXISTS pg_trgm;
 *   CREATE INDEX CONCURRENTLY calibration_devices_tenant_id_text_trgm ON calibration_devices
 *     USING gin (tenant_id, name gin_trgm_ops, serial_number gin_trgm_ops, manufacturer gin_trgm_ops);
 *
 * One GIN serves a condition on any subset of its columns, so the three ILIKEs become a BitmapOr of three
 * scans of this one index, each already narrowed to the tenant (btree_gin, 0110: a term never walks
 * another tenant's matches). The same rare-term page then took 0.18 ms and its count 0.12 ms. A term
 * matching many rows (7.5 % of the register) keeps the existing (tenant_id, name) index walk: the planner
 * chooses it with or without this index, and the timings were the same within this workstation's noise.
 * A term under three characters has no trigram and is unchanged. Size: 3.4 MB for 23,722 devices.
 *
 * pg_trgm, like btree_gin, ships with PostgreSQL (contrib), is in the pgvector/pgvector:pg18 image and is
 * TRUSTED: the database owner the migrations run as creates it without being a superuser. A role that
 * cannot gets PostgreSQL's "permission denied to create extension" and the migration fails, unrecorded
 * (0110's note). `down` keeps the extension, as 0018 and 0110 keep theirs.
 *
 * Built CONCURRENTLY, as 0062, 0093, 0109 and 0110 build theirs; an INVALID index of the same name (an
 * interrupted build) is dropped and rebuilt. The index lives only here, never on a model (ADR-100 Am. 3),
 * and its definition parses in Sequelize's showIndex (indexDefinitionSync.u06b). No try/catch. Verify:
 *   SELECT indisvalid FROM pg_index WHERE indexrelid = 'calibration_devices_tenant_id_text_trgm'::regclass;
 *   EXPLAIN SELECT id FROM calibration_devices WHERE tenant_id = '<uuid>' AND serial_number ILIKE '%zqxw%';
 *     -- Bitmap Index Scan on calibration_devices_tenant_id_text_trgm
 */
import type { QueryInterface } from "sequelize";

const TABLE = "calibration_devices";
const NAME = "calibration_devices_tenant_id_text_trgm";
const DEFINITION = `ON ${TABLE} USING gin (tenant_id, name gin_trgm_ops, serial_number gin_trgm_ops, manufacturer gin_trgm_ops)`;

/** @returns the index's indisvalid, or null when it does not exist */
const validity = async (context: QueryInterface): Promise<boolean | null> => {
  const [rows] = (await context.sequelize.query(
    `SELECT ix.indisvalid AS valid
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_namespace n ON n.oid = i.relnamespace
      WHERE i.relname = :name AND n.nspname = current_schema()`,
    { replacements: { name: NAME } },
  )) as [{ valid: boolean }[], unknown];
  return rows[0]?.valid ?? null;
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
  await context.sequelize.query("CREATE EXTENSION IF NOT EXISTS btree_gin");
  const valid = await validity(context);
  if (valid === true) {
    return;
  }
  if (valid === false) {
    // Left INVALID by an interrupted concurrent build: rebuild it.
    await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${NAME}"`);
  }
  await context.sequelize.query(`CREATE INDEX CONCURRENTLY "${NAME}" ${DEFINITION}`);
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await context.sequelize.query(`DROP INDEX CONCURRENTLY IF EXISTS "${NAME}"`);
};

export = { NAME, DEFINITION, up, down };
