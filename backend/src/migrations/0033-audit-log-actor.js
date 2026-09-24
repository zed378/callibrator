"use strict";

/**
 * `audit_logs.actor_type` and `audit_logs.actor_name` — a first-class system
 * actor (A-124, ADR-051 Q-13).
 *
 * WHAT WAS WRONG
 *
 * `user_id IS NULL` meant three things and the row could not say which: a
 * background job (the retention purge and the tenant-lifecycle scheduler named
 * themselves only inside `changes.actor`), a user deleted while the foreign key
 * was still SET NULL (before 0030), and an actor that was simply lost. "Every
 * action not taken by a person" was a JSON predicate on an unindexed field, and
 * nothing stopped the next job from writing any string it liked.
 *
 * WHAT THIS DOES — one transaction, refusing rather than guessing
 *
 * 1. Creates the ENUM `enum_audit_logs_actor_type` ('user','system','unknown')
 *    — the name Sequelize gives the model's ENUM, so a database built by
 *    `db.sync()` and one migrated here converge. If the type already exists
 *    with other labels the migration REFUSES: it will not guess what an
 *    existing, different type means.
 * 2. Adds `actor_type` (the ENUM) and `actor_name` VARCHAR(100), nullable.
 * 3. Backfills every row whose `actor_type` is NULL — honestly:
 *      user_id IS NOT NULL                                   -> 'user'
 *      user_id IS NULL and changes.actor is a 'system:…' str -> 'system', that name
 *      anything else                                          -> 'unknown'
 *    `unknown` is what the table actually knows about those rows. The row is
 *    not guessed into a user or a job, and `changes.actor` is left in place.
 * 4. Makes `actor_type` NOT NULL. There is no DEFAULT: audit.service#logAction
 *    sets it on every insert, and an insert that bypasses logAction and names
 *    no actor must fail, not be stamped with a value nobody chose.
 * 5. Adds CHECK `audit_logs_actor_check`, tying the three columns together:
 *      user    — user_id set, actor_name NULL;
 *      system  — user_id NULL, actor_name LIKE 'system:%';
 *      unknown — user_id NULL, actor_name NULL, and created_at no later than
 *                the moment this migration ran. That instant is written into
 *                the constraint as a literal, so `\d audit_logs` shows it and
 *                no row written afterwards can be 'unknown'.
 * 6. Adds index `audit_logs_actor_type_actor_name` for "who acted" queries.
 *
 * `LOCK TABLE ... SHARE ROW EXCLUSIVE` first: no row can be inserted between
 * the backfill and the constraint. `lock_timeout` makes it fail fast rather
 * than queue behind a long transaction with every writer queued behind it.
 * `audit_logs` is the largest table; the backfill is three UPDATEs over it and
 * the CHECK is validated in the same pass — ship it as a planned deploy.
 *
 * `audit_logs` MUST exist. The backend runs `db.sync()` before the migrator,
 * so it always does at boot. `npm run migrate` against an empty database runs
 * without that sync, and there this migration THROWS instead of skipping: a
 * skip would be recorded as applied, and the CHECK — which `sync()` cannot
 * create — would never be added (the 0008/0013/0014 failure mode). The next
 * boot syncs and then runs it.
 *
 * IDEMPOTENT: every step checks the catalog first; a second run changes
 * nothing. REVERSIBLE: `down` drops the constraint, index, both columns and
 * the type — see `down` for exactly what a re-run can and cannot recompute.
 *
 * No try/catch: every failure propagates (CLAUDE.md). Verify with psql:
 *   \d audit_logs
 *   SELECT actor_type, actor_name, count(*) FROM audit_logs GROUP BY 1, 2;
 */

const TABLE = "audit_logs";
const TYPE = "enum_audit_logs_actor_type";
const TYPE_COLUMN = "actor_type";
const NAME_COLUMN = "actor_name";
const CONSTRAINT = "audit_logs_actor_check";
const INDEX = "audit_logs_actor_type_actor_name";
const LOCK_TIMEOUT = "10s";

/** The ENUM's labels, in order. Must equal constants/systemActors.js ACTOR_TYPE_VALUES. */
const ACTOR_TYPES = Object.freeze(["user", "system", "unknown"]);
/** Must equal constants/systemActors.js ACTOR_NAME_MAX_LENGTH. */
const NAME_LENGTH = 100;

/**
 * The CHECK expression, with the cut-off instant for `unknown` rows.
 * @param {string} cutoffIso - an ISO-8601 instant, from the database's own clock
 * @returns {string}
 */
const checkExpression = (cutoffIso) =>
  [
    `(${TYPE_COLUMN} = 'user' AND user_id IS NOT NULL AND ${NAME_COLUMN} IS NULL)`,
    `(${TYPE_COLUMN} = 'system' AND user_id IS NULL AND ${NAME_COLUMN} LIKE 'system:%')`,
    `(${TYPE_COLUMN} = 'unknown' AND user_id IS NULL AND ${NAME_COLUMN} IS NULL` +
      ` AND created_at <= '${cutoffIso}'::timestamptz)`,
  ].join(" OR ");

const one = async (sequelize, transaction, sql, replacements = {}) => {
  const [rows] = await sequelize.query(sql, { transaction, replacements });
  return rows[0];
};

const tablePresent = async (sequelize, transaction) =>
  (await one(
    sequelize,
    transaction,
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { table: TABLE },
  )).present;

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

/** @returns {Promise<Object<string, {nullable: boolean}>>} this table's columns */
const columns = async (sequelize, transaction) => {
  const [rows] = await sequelize.query(
    `SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table`,
    { transaction, replacements: { table: TABLE } },
  );
  return Object.fromEntries(rows.map((r) => [r.column_name, { nullable: r.is_nullable === "YES" }]));
};

const constraintPresent = async (sequelize, transaction) =>
  (await one(
    sequelize,
    transaction,
    `SELECT count(*)::int AS n FROM pg_constraint
      WHERE conname = :name AND conrelid = (current_schema() || '.' || :table)::regclass`,
    { name: CONSTRAINT, table: TABLE },
  )).n > 0;

const indexPresent = async (sequelize, transaction) =>
  (await one(
    sequelize,
    transaction,
    "SELECT to_regclass(current_schema() || '.' || :index) IS NOT NULL AS present",
    { index: INDEX },
  )).present;

module.exports = {
  TABLE,
  TYPE,
  TYPE_COLUMN,
  NAME_COLUMN,
  CONSTRAINT,
  INDEX,
  ACTOR_TYPES,
  NAME_LENGTH,
  checkExpression,

  up: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      if (!(await tablePresent(sequelize, transaction))) {
        throw new Error(
          `0033: table "${TABLE}" does not exist. Run db.sync() first (the backend does at boot); ` +
            "skipping would record this migration as applied without its CHECK constraint.",
        );
      }
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      await sequelize.query(`LOCK TABLE ${TABLE} IN SHARE ROW EXCLUSIVE MODE`, { transaction });

      // 1. The ENUM type — create it, or refuse one that differs.
      const labels = await typeLabels(sequelize, transaction);
      if (labels === null) {
        const list = ACTOR_TYPES.map((t) => `'${t}'`).join(", ");
        await sequelize.query(`CREATE TYPE ${TYPE} AS ENUM (${list})`, { transaction });
      } else if (labels.join(",") !== ACTOR_TYPES.join(",")) {
        throw new Error(
          `0033: type ${TYPE} exists with labels (${labels.join(", ")}), expected ` +
            `(${ACTOR_TYPES.join(", ")}). Refusing to guess what the existing type means.`,
        );
      }

      // 2. The columns.
      let cols = await columns(sequelize, transaction);
      if (!cols[TYPE_COLUMN]) {
        await sequelize.query(`ALTER TABLE ${TABLE} ADD COLUMN ${TYPE_COLUMN} ${TYPE}`, { transaction });
      }
      if (!cols[NAME_COLUMN]) {
        await sequelize.query(
          `ALTER TABLE ${TABLE} ADD COLUMN ${NAME_COLUMN} VARCHAR(${NAME_LENGTH})`,
          { transaction },
        );
      }

      // 3. The honest backfill — only rows no one has classified.
      await sequelize.query(
        `UPDATE ${TABLE} SET ${TYPE_COLUMN} = 'user', ${NAME_COLUMN} = NULL
          WHERE ${TYPE_COLUMN} IS NULL AND user_id IS NOT NULL`,
        { transaction },
      );
      await sequelize.query(
        `UPDATE ${TABLE} SET ${TYPE_COLUMN} = 'system', ${NAME_COLUMN} = changes->>'actor'
          WHERE ${TYPE_COLUMN} IS NULL AND user_id IS NULL
            AND jsonb_typeof(changes) = 'object'
            AND jsonb_typeof(changes->'actor') = 'string'
            AND changes->>'actor' LIKE 'system:%'
            AND length(changes->>'actor') <= ${NAME_LENGTH}`,
        { transaction },
      );
      await sequelize.query(
        `UPDATE ${TABLE} SET ${TYPE_COLUMN} = 'unknown', ${NAME_COLUMN} = NULL
          WHERE ${TYPE_COLUMN} IS NULL`,
        { transaction },
      );

      // 4. NOT NULL, no default.
      cols = await columns(sequelize, transaction);
      if (cols[TYPE_COLUMN].nullable) {
        await sequelize.query(`ALTER TABLE ${TABLE} ALTER COLUMN ${TYPE_COLUMN} SET NOT NULL`, {
          transaction,
        });
      }

      // 5. The CHECK, with the cut-off for 'unknown' taken from the database's
      //    own clock (the transaction's start: every row it backfilled is older).
      if (!(await constraintPresent(sequelize, transaction))) {
        const { cutoff } = await one(
          sequelize,
          transaction,
          "SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS cutoff",
        );
        await sequelize.query(
          `ALTER TABLE ${TABLE} ADD CONSTRAINT ${CONSTRAINT} CHECK (${checkExpression(cutoff)})`,
          { transaction },
        );
      }

      // 6. The index.
      if (!(await indexPresent(sequelize, transaction))) {
        await sequelize.query(
          `CREATE INDEX ${INDEX} ON ${TABLE} (${TYPE_COLUMN}, ${NAME_COLUMN})`,
          { transaction },
        );
      }
    });
  },

  // Rolling back drops the actor columns: the rows go back to "user_id NULL
  // means one of three things". For rows written BEFORE 0033 nothing is lost:
  // a re-run recomputes the same backfill. For rows written AFTER it, a system
  // row survives a down/up only if its job also put its name in
  // `changes.actor` — both jobs today do (dataRetention, tenantLifecycle); a
  // row whose job did not comes back 'unknown'. Verified on PostgreSQL 18.
  down: async ({ context }) => {
    const { sequelize } = context;
    await sequelize.transaction(async (transaction) => {
      if (!(await tablePresent(sequelize, transaction))) {
        return; // nothing was ever added
      }
      await sequelize.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`, { transaction });
      await sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${CONSTRAINT}`, { transaction });
      await sequelize.query(`DROP INDEX IF EXISTS ${INDEX}`, { transaction });
      await sequelize.query(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS ${NAME_COLUMN}`, { transaction });
      await sequelize.query(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS ${TYPE_COLUMN}`, { transaction });
      await sequelize.query(`DROP TYPE IF EXISTS ${TYPE}`, { transaction });
    });
  },
};
