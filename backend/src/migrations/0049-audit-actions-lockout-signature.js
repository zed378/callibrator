"use strict";

/**
 * `audit_logs.action` gains `ACCOUNT_LOCKED` and `SIGNATURE_AUTH_FAILED`
 * (A-126, ADR-051 Q-15).
 *
 * WHY
 *
 * 21 CFR 11.300(d) wants attempted unauthorized use of signature credentials
 * detected and reported. A wrong password or MFA code at signing, and a
 * brute-force lockout, left no audit row: the ENUM had no member for either,
 * and recording them as `UPDATE` would hide them from every query that looks
 * for them. Individual failed sign-ins stay in the security log (Q-15).
 *
 * WHAT THIS DOES — one transaction, refusing rather than guessing
 *
 * 1. The type `enum_audit_logs_action` MUST exist, and MUST begin with the six
 *    labels the model has always declared, in order. Anything else means the
 *    database is not what this migration was written for, and it REFUSES: it
 *    will not guess what a different type means.
 * 2. `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for each new label, appended in
 *    the model's order. A FRESH database, whose `db.sync()` created the type
 *    from the model with all eight, is left as it is. An EXISTING one is not
 *    fixed by `db.sync()`: it does not alter a type that already exists
 *    (checked on PostgreSQL 18 — `AuditLog.sync()` left the six labels), so
 *    without this migration every new row would be refused by the database.
 *
 * The type must exist: the backend runs `db.sync()` before the migrator. On an
 * empty database `npm run migrate` runs without that sync, and there this
 * THROWS instead of skipping — as 0033 does, which precedes it and throws in
 * the same case.
 *
 * `ADD VALUE` inside a transaction block is allowed since PostgreSQL 12; the
 * new labels become usable when it commits. It is a catalog change only — no
 * table rewrite, no lock on `audit_logs` rows.
 *
 * IDEMPOTENT: a second run adds nothing.
 *
 * REVERSIBLE, with a refusal: PostgreSQL cannot drop an ENUM label, so `down`
 * rebuilds the type with the six labels and converts the column. It REFUSES
 * while any row carries a new label — audit rows are never deleted (ADR-051
 * Q-12), so once one exists this migration is, deliberately, one-way. The
 * rebuild rewrites `audit_logs` under an ACCESS EXCLUSIVE lock: plan it.
 *
 * No try/catch: every failure propagates (CLAUDE.md). Verify with psql:
 *   \dT+ enum_audit_logs_action
 */

const TABLE = "audit_logs";
const COLUMN = "action";
const TYPE = "enum_audit_logs_action";
const LOCK_TIMEOUT = "10s";

/** The labels every database has had since the table was created, in order. */
const BASE_ACTIONS = Object.freeze(["CREATE", "UPDATE", "DELETE", "LOGIN", "APPROVE", "EXPORT"]);
/** Appended by this migration, in this order. Must be the model ENUM's tail. */
const NEW_ACTIONS = Object.freeze(["ACCOUNT_LOCKED", "SIGNATURE_AUTH_FAILED"]);

/** @returns {Promise<string[]|null>} the type's labels in order, or null when absent */
const typeLabels = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT e.enumlabel AS label
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = :type AND n.nspname = current_schema()
      ORDER BY e.enumsortorder`,
    { transaction, replacements: { type: TYPE } },
  );
  return rows.length ? rows.map((r) => r.label) : null;
};

/**
 * Refuse a type that is absent, or that does not begin with the six base labels
 * followed only by labels this migration adds.
 *
 * @param {string[]|null} labels
 * @param {string} step - "up" or "down", for the message
 */
const assertKnownType = (labels, step) => {
  if (labels === null) {
    throw new Error(
      `0049 ${step}: type ${TYPE} does not exist. Run db.sync() first (the backend does at boot); ` +
        "skipping would record this migration as applied without its labels.",
    );
  }
  const head = labels.slice(0, BASE_ACTIONS.length);
  const tail = labels.slice(BASE_ACTIONS.length);
  if (head.join(",") !== BASE_ACTIONS.join(",") || tail.some((l) => !NEW_ACTIONS.includes(l))) {
    throw new Error(
      `0049 ${step}: type ${TYPE} has labels (${labels.join(", ")}); expected ` +
        `(${BASE_ACTIONS.join(", ")}) optionally followed by (${NEW_ACTIONS.join(", ")}). ` +
        "Refusing to guess what the existing type means.",
    );
  }
};

module.exports = {
  TABLE,
  COLUMN,
  TYPE,
  BASE_ACTIONS,
  NEW_ACTIONS,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      assertKnownType(await typeLabels(sequelize, transaction), "up");
      for (const label of NEW_ACTIONS) {
        await sequelize.query(`ALTER TYPE ${TYPE} ADD VALUE IF NOT EXISTS '${label}'`, { transaction });
      }
    });
  },

  down: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      const labels = await typeLabels(sequelize, transaction);
      assertKnownType(labels, "down");
      if (labels.length === BASE_ACTIONS.length) {
        return; // already the six — nothing to undo
      }
      // Locked first, so no row with a new label can be inserted between the
      // count and the conversion.
      await sequelize.query(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE`, { transaction });
      const [[{ n }]] = await sequelize.query(
        `SELECT count(*)::int AS n FROM ${TABLE} WHERE ${COLUMN}::text IN (:labels)`,
        { transaction, replacements: { labels: [...NEW_ACTIONS] } },
      );
      if (n > 0) {
        throw new Error(
          `0049 down: ${n} audit row(s) carry ${NEW_ACTIONS.join(" or ")}. Audit rows are never ` +
            "deleted or rewritten (ADR-051 Q-12), so these labels cannot be removed. Refusing.",
        );
      }
      const list = BASE_ACTIONS.map((a) => `'${a}'`).join(", ");
      await sequelize.query(`ALTER TYPE ${TYPE} RENAME TO ${TYPE}_0049_old`, { transaction });
      await sequelize.query(`CREATE TYPE ${TYPE} AS ENUM (${list})`, { transaction });
      await sequelize.query(
        `ALTER TABLE ${TABLE} ALTER COLUMN ${COLUMN} TYPE ${TYPE} USING ${COLUMN}::text::${TYPE}`,
        { transaction },
      );
      await sequelize.query(`DROP TYPE ${TYPE}_0049_old`, { transaction });
    });
  },
};
