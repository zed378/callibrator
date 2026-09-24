"use strict";

/**
 * A-137 (ADR-051 Q-10) — drop `data_retention_policies`.
 *
 * The table's only reader was the second purge engine in gdpr.service
 * (`enforceDataRetention` / `purgeExpiredData`), removed by A-121. Nothing has
 * ever written it (no service, route or seed). The live engine is
 * dataRetention.service over `tenant_settings`, with its defaults in code. A
 * table that looks like retention configuration but governs nothing is the
 * "control that looks like it does something": a future reader would take its
 * rows as the policy in force. The model is removed in the same change, so
 * db.sync() no longer creates the table on a fresh database.
 *
 * REFUSES if the table has any row. A row here was written by hand (nothing in
 * the application can), so someone meant something by it, and this migration
 * will not guess what — see the message for what to do. The check and the drop
 * run in one transaction under an ACCESS EXCLUSIVE lock, so no row can arrive
 * between the count and the drop, and a refusal leaves the table untouched.
 * Migrations run at boot (index.js: db.sync() then migrator.up()), so a refusal
 * also refuses the boot, with this message (the 0024/0026 pattern).
 *
 * Idempotent: a database without the table (a fresh install after this change,
 * or a second run) is a no-op. No try/catch: presence is read from
 * showAllTables(), and every failure propagates, so Umzug cannot record this
 * migration as applied while it did nothing (0008/0013/0014).
 *
 * `down` recreates the EMPTY table in the shape db.sync() built it (read from
 * PostgreSQL 18 with `\d data_retention_policies` before this change): same
 * columns, defaults, primary key, both indexes, and the tenant foreign key as
 * migration 0030 left it (ON DELETE RESTRICT, tenant_id nullable). Nothing
 * reads it after a `down` either; it exists so the schema round-trips.
 *
 * Verify with psql, not the log:
 *   SELECT to_regclass('public.data_retention_policies');   -- NULL after up
 */

const TABLE = "data_retention_policies";

/** The refusal lists at most this many tenants before summarising. */
const REPORT_LIMIT = 20;

const tableNames = async (queryInterface, transaction) =>
  (await queryInterface.showAllTables({ transaction })).map((t) =>
    (typeof t === "object" ? t.tableName : t).toLowerCase(),
  );

/** The table as db.sync() created it from the removed model (see header). */
const CREATE_SQL = [
  `CREATE TABLE ${TABLE} (
     id uuid NOT NULL,
     tenant_id uuid,
     entity_type character varying(100) NOT NULL,
     retention_days integer DEFAULT 365 NOT NULL,
     is_active boolean DEFAULT true NOT NULL,
     created_at timestamp with time zone NOT NULL,
     updated_at timestamp with time zone NOT NULL,
     CONSTRAINT ${TABLE}_pkey PRIMARY KEY (id),
     CONSTRAINT ${TABLE}_tenant_id_fkey FOREIGN KEY (tenant_id)
       REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE RESTRICT
   )`,
  `CREATE INDEX ${TABLE}_tenant_id ON ${TABLE} USING btree (tenant_id)`,
  `CREATE INDEX ${TABLE}_is_active ON ${TABLE} USING btree (is_active)`,
];

/** The refusal. Names how many rows, whose, and what to do. */
const refusal = (total, groups) => {
  const lines = groups
    .slice(0, REPORT_LIMIT)
    .map((g) => `  tenant ${g.tenant_id ?? "(none — a global row)"}: ${g.n} row(s)`);
  if (groups.length > REPORT_LIMIT) {
    lines.push(`  … and ${groups.length - REPORT_LIMIT} more tenant(s)`);
  }
  return new Error(
    `Migration 0047 refused: ${TABLE} has ${total} row(s). Nothing in the application reads or ` +
      "writes this table (its only reader, gdpr.service#enforceDataRetention, was removed by " +
      "A-121), so these rows were written by hand and govern nothing — retention is " +
      "dataRetention.service over tenant_settings. This migration will not guess what they were " +
      "meant to say.\n" +
      `${lines.join("\n")}\n` +
      "For each row, decide: carry the intent into the live engine " +
      "(PUT <data-retention route>/:tenantId/policy, which applies the per-entity floors and " +
      "writes an audit row), or record that it is discarded. Then export the rows for the record " +
      `(\\copy ${TABLE} TO '${TABLE}.csv' CSV HEADER), delete them, and re-run. ` +
      `See them with: SELECT * FROM ${TABLE} ORDER BY tenant_id, entity_type;`,
  );
};

module.exports = {
  TABLE,
  CREATE_SQL,

  up: async ({ context }) => {
    await context.sequelize.transaction(async (transaction) => {
      if (!(await tableNames(context, transaction)).includes(TABLE)) {
        return; // fresh install after A-137, or already dropped
      }
      const q = (sql) => context.sequelize.query(sql, { transaction });

      await q(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE`);
      const [groups] = await q(
        `SELECT tenant_id, COUNT(*)::int AS n FROM ${TABLE} GROUP BY tenant_id ORDER BY tenant_id`,
      );
      const total = groups.reduce((sum, g) => sum + Number(g.n), 0);
      if (total > 0) {
        throw refusal(total, groups);
      }

      // No CASCADE: if anything has come to depend on this table, fail loudly.
      await q(`DROP TABLE ${TABLE}`);
    });
  },

  down: async ({ context }) => {
    await context.sequelize.transaction(async (transaction) => {
      if ((await tableNames(context, transaction)).includes(TABLE)) {
        return;
      }
      for (const sql of CREATE_SQL) {
        await context.sequelize.query(sql, { transaction });
      }
    });
  },
};
