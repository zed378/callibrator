"use strict";

/**
 * `users.email` and `users.username` unique CASE-INSENSITIVELY, platform-wide
 * (D-06; ADR-051 Q-18 re-affirmed by ADR-PENDING-dbA).
 *
 * ADR-051 Q-18 keeps ONE global identity per person: sign-in is by username or
 * email with no tenant qualifier (auth.service#login looks the identifier up
 * across every tenant), so the identifier must name exactly one account on the
 * platform. The global unique indexes guaranteed that only for an exact,
 * byte-for-byte match:
 *
 *  - every human path lowercases the address before writing it (auth and user
 *    validators, sso.service), but SCIM provisioning wrote it as the IdP sent
 *    it. So tenant A's SCIM client could provision `Victim@Hospital-B.org`
 *    beside tenant B's `victim@hospital-b.org`: two accounts for one mailbox,
 *    on a platform whose sign-in and password reset assume there is one;
 *  - the A-128 identity check in front of user creation compares with ILIKE
 *    (case-insensitively) while the constraint behind it did not, so the two
 *    layers disagreed about what "taken" means.
 *
 * This migration adds, beside the existing case-sensitive indexes (which the
 * model and db.sync() still declare):
 *
 *   users_email_lower_unique     UNIQUE (lower(email))
 *   users_username_lower_unique  UNIQUE (lower(username))
 *
 * Soft-deleted and erased rows are covered, exactly as they are by the existing
 * constraints — an erased row holds `erased_<id>@erased.local`, which is unique.
 *
 * It REFUSES to run while two accounts differ only by case, before any change,
 * naming the account ids and tenants — never the address or the username:
 * migration output lands in logs, and these are personal data. Which account a
 * person keeps is an operator's decision, not this migration's.
 *
 * The expression indexes live only here, not on the model: db.sync() runs
 * before migrations at boot and would fail on a bare constraint error before
 * the refusal could name the rows (the 0024/0026 pattern). No try/catch.
 *
 * Verify with psql:
 *   SELECT pg_get_indexdef(ix.indexrelid) FROM pg_index ix
 *     JOIN pg_class t ON t.oid = ix.indrelid
 *    WHERE t.relname = 'users' AND ix.indisunique;
 *
 * Idempotent + reversible.
 */

const TABLE = "users";

const INDEXES = Object.freeze([
  Object.freeze({ name: "users_email_lower_unique", column: "email" }),
  Object.freeze({ name: "users_username_lower_unique", column: "username" }),
]);

/** How many collision groups a refusal lists before summarising. */
const REPORT_LIMIT = 20;

const tableNames = async (queryInterface) =>
  (await queryInterface.showAllTables()).map((t) =>
    (typeof t === "object" ? t.tableName : t).toLowerCase(),
  );

const indexNames = async (queryInterface) =>
  (await queryInterface.showIndex(TABLE)).map((index) => index.name);

/** Groups of accounts whose `column` is equal ignoring case. */
const findCollisions = async (queryInterface, column) => {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT array_agg(id::text ORDER BY created_at, id) AS ids,
            array_agg(COALESCE(tenant_id::text, 'none') ORDER BY created_at, id) AS tenants
       FROM ${TABLE}
      GROUP BY lower(${column})
     HAVING COUNT(*) > 1
      ORDER BY min(created_at)`,
  );
  return rows.map((r) => ({ column, ids: r.ids, tenants: r.tenants }));
};

const collisionError = (collisions) => {
  const lines = collisions
    .slice(0, REPORT_LIMIT)
    .map((c) => `  ${c.column}: accounts ${c.ids.join(", ")} (tenants ${c.tenants.join(", ")})`);
  if (collisions.length > REPORT_LIMIT) {
    lines.push(`  … and ${collisions.length - REPORT_LIMIT} more`);
  }
  return new Error(
    `Migration 0063 refused: ${collisions.length} group(s) of accounts share an email or username ` +
      "that differs only by letter case, so a case-insensitive unique index cannot be created. " +
      "Sign-in is by username or email across every tenant (ADR-051 Q-18), so each of these is one " +
      "identifier naming several accounts. Nothing was changed.\n" +
      `${lines.join("\n")}\n` +
      "Resolve each deliberately — keep one account, rename or erase the other — then re-run. " +
      "Find them with: SELECT lower(email), array_agg(id) FROM users GROUP BY 1 HAVING COUNT(*) > 1; " +
      "(and the same for username).",
  );
};

module.exports = {
  TABLE,
  INDEXES,

  up: async ({ context }) => {
    if (!(await tableNames(context)).includes(TABLE)) {
      return; // db.sync() has not built it; it is created at boot before migrations run
    }

    // 1. Refuse on case-variant duplicates — before ANY change.
    const collisions = [];
    for (const { column } of INDEXES) {
      collisions.push(...(await findCollisions(context, column)));
    }
    if (collisions.length) {
      throw collisionError(collisions);
    }

    // 2. The case-insensitive unique indexes.
    const names = await indexNames(context);
    for (const { name, column } of INDEXES) {
      if (!names.includes(name)) {
        await context.sequelize.query(`CREATE UNIQUE INDEX "${name}" ON ${TABLE} (lower(${column}))`);
      }
    }
  },

  down: async ({ context }) => {
    for (const { name } of INDEXES) {
      await context.sequelize.query(`DROP INDEX IF EXISTS "${name}"`);
    }
  },
};
