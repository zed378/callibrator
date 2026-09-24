"use strict";

/**
 * A removed custom domain can be added again (A-223; ADR-PENDING-misc).
 *
 * WHAT WAS WRONG
 *
 *  `custom_domains.domain` was UNIQUE across the whole table, while removing a
 *  domain is a SOFT delete (status `deleted`, kept because the audit trail
 *  names it). So once a domain was removed, adding it again — by the same
 *  tenant, or by the organisation that really owns it — hit the index, and the
 *  service answered 500. And a claim that was never verified (`pending_…`)
 *  held the name against its real owner for good.
 *
 * WHAT THIS DOES — one transaction
 *
 *  1. REFUSES, before any change, while the data already holds what the new
 *     indexes forbid, naming the row ids (never the domain — output lands in
 *     logs): two ACTIVE rows for one domain ignoring case, or two live
 *     (not deleted) rows of one tenant for one domain ignoring case. Which
 *     claim stands is an operator's decision (the 0026/0063 refuse-don't-repair
 *     rule).
 *  2. Drops every unique constraint or index on `domain` alone — the name
 *     db.sync() gave them is not assumed (`custom_domains_domain_key` for the
 *     attribute's `unique`, `custom_domains_domain` for the model index).
 *  3. Lower-cases stored domains: DNS names are case-insensitive, the service
 *     now stores and compares lower-case, and a mixed-case row would otherwise
 *     be missed by its exact lookups.
 *  4. Creates the two partial unique indexes:
 *       custom_domains_domain_active_uq       (lower(domain))            WHERE status = 'active'
 *       custom_domains_tenant_domain_live_uq  (tenant_id, lower(domain)) WHERE status <> 'deleted'
 *     A domain is ACTIVE (verified) for one organisation at a time; a tenant
 *     has one live row per domain; removed rows block nothing.
 *
 * The model no longer declares a unique `domain` and cannot declare these
 * expression indexes (db.sync() runs before the migrator at boot). Throws,
 * rather than skipping, when the table is absent: a skip would be recorded as
 * applied with no index (PR-5). No try/catch.
 *
 * Verify with psql:
 *   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'custom_domains';
 *
 * Idempotent + reversible (`down` restores the global constraint, and refuses
 * while two rows share a domain — the state `up` made possible).
 */

const TABLE = "custom_domains";
const ACTIVE_INDEX = "custom_domains_domain_active_uq";
const LIVE_INDEX = "custom_domains_tenant_domain_live_uq";
const LEGACY_CONSTRAINT = "custom_domains_domain_key";
const LOCK_TIMEOUT = "10s";

/** How many conflicting groups a refusal lists before summarising. */
const REPORT_LIMIT = 20;

const tableExists = async (sequelize, transaction) => {
  const [[{ present }]] = await sequelize.query(
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { transaction, replacements: { table: TABLE } },
  );
  return present;
};

/** Groups of row ids that the new indexes would refuse, per rule. */
const findConflicts = async (sequelize, transaction) => {
  const [active] = await sequelize.query(
    `SELECT array_agg(id::text ORDER BY created_at, id) AS ids
       FROM ${TABLE}
      WHERE status = 'active'
      GROUP BY lower(domain)
     HAVING COUNT(*) > 1`,
    { transaction },
  );
  const [live] = await sequelize.query(
    `SELECT array_agg(id::text ORDER BY created_at, id) AS ids
       FROM ${TABLE}
      WHERE status <> 'deleted'
      GROUP BY tenant_id, lower(domain)
     HAVING COUNT(*) > 1`,
    { transaction },
  );
  return [
    ...active.map((r) => ({ rule: "active in more than one row", ids: r.ids })),
    ...live.map((r) => ({ rule: "live more than once in one tenant", ids: r.ids })),
  ];
};

const conflictError = (conflicts) => {
  const lines = conflicts.slice(0, REPORT_LIMIT).map((c) => `  ${c.rule}: rows ${c.ids.join(", ")}`);
  if (conflicts.length > REPORT_LIMIT) {
    lines.push(`  … and ${conflicts.length - REPORT_LIMIT} more`);
  }
  return new Error(
    `Migration 0070 refused: ${conflicts.length} group(s) of custom_domains rows name the same domain ` +
      "(ignoring letter case) where the new unique indexes allow one. Nothing was changed.\n" +
      `${lines.join("\n")}\n` +
      "Decide which claim stands — remove the other (status 'deleted') — then re-run.",
  );
};

/** Unique constraints and indexes on `domain` alone, with no predicate or expression. */
const legacyUniques = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT i.relname AS index_name, c.conname AS constraint_name
       FROM pg_index ix
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       LEFT JOIN pg_constraint c ON c.conindid = ix.indexrelid AND c.contype = 'u'
      WHERE t.oid = (current_schema() || '.' || :table)::regclass
        AND ix.indisunique AND NOT ix.indisprimary
        AND ix.indpred IS NULL AND ix.indexprs IS NULL
        AND ix.indnatts = 1
        AND ix.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = t.oid AND attname = 'domain')`,
    { transaction, replacements: { table: TABLE } },
  );
  return rows;
};

module.exports = {
  TABLE,
  ACTIVE_INDEX,
  LIVE_INDEX,
  LEGACY_CONSTRAINT,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      if (!(await tableExists(sequelize, transaction))) {
        throw new Error(
          `Migration 0070: table ${TABLE} does not exist. db.sync() creates it before migrations run; ` +
            "refusing to record this migration as applied without its indexes.",
        );
      }

      // 1. Refuse before any change.
      const conflicts = await findConflicts(sequelize, transaction);
      if (conflicts.length) {
        throw conflictError(conflicts);
      }

      // 2. The global uniqueness goes, whatever it was named.
      for (const legacy of await legacyUniques(sequelize, transaction)) {
        if (legacy.constraint_name) {
          await sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT "${legacy.constraint_name}"`, { transaction });
        } else {
          await sequelize.query(`DROP INDEX "${legacy.index_name}"`, { transaction });
        }
      }

      // 3. One spelling.
      await sequelize.query(`UPDATE ${TABLE} SET domain = lower(domain) WHERE domain <> lower(domain)`, {
        transaction,
      });

      // 4. The partial unique indexes.
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${ACTIVE_INDEX}" ON ${TABLE} (lower(domain)) WHERE status = 'active'`,
        { transaction },
      );
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${LIVE_INDEX}" ON ${TABLE} (tenant_id, lower(domain)) WHERE status <> 'deleted'`,
        { transaction },
      );
    });
  },

  down: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      const [[{ shared }]] = await sequelize.query(
        `SELECT COUNT(*)::int AS shared FROM (SELECT domain FROM ${TABLE} GROUP BY domain HAVING COUNT(*) > 1) d`,
        { transaction },
      );
      if (shared > 0) {
        throw new Error(
          `Migration 0070 down refused: ${shared} domain(s) appear in more than one custom_domains row ` +
            "(a removed domain added again). A global UNIQUE (domain) cannot be restored over them; " +
            "hard-delete the removed rows you no longer need first. Nothing was changed.",
        );
      }
      await sequelize.query(`DROP INDEX IF EXISTS "${ACTIVE_INDEX}"`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS "${LIVE_INDEX}"`, { transaction });
      if ((await legacyUniques(sequelize, transaction)).length === 0) {
        await sequelize.query(`ALTER TABLE ${TABLE} ADD CONSTRAINT "${LEGACY_CONSTRAINT}" UNIQUE (domain)`, {
          transaction,
        });
      }
    });
  },
};
