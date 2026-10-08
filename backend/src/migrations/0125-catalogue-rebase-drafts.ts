/**
 * Migration 0125 — P21-01: a base rebase's version is not an operator draft (ADR-125 Am. 3; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 7.3).
 *
 * WHY. Publishing a new BASE checklist rebases every published type checklist in the same
 * transaction: a new version of each, holding the type's items and the new base items. Items are
 * written only under a DRAFT parent (0112's `inspection_template_items_draft_only`), so the rebase
 * version is inserted as a draft, filled, and published before the transaction ends. 0112's
 * `inspection_template_versions_one_draft` — one row per template `WHERE status = 'draft'` — then
 * refused the rebase of any type template whose operator had a draft open (23505), while the spec
 * says "open drafts are untouched".
 *
 * WHAT. The index is rebuilt to leave out a row that carries `rebased_from_version_id` (set only
 * by the rebase, at insert): one open OPERATOR draft per template stays enforced; a rebase draft
 * lives only inside the publish that made it. Same name — schemaVerify's EXPECTED_OBJECTS names it.
 *
 * In ONE transaction; idempotent (DROP IF EXISTS, then CREATE); no try/catch. `down` restores
 * 0112's predicate — it fails (23505) while two drafts of one template exist, which only an
 * interrupted rebase could leave, and that rolls back with its transaction.
 *
 * Verify with psql:
 *   SELECT indexdef FROM pg_indexes WHERE indexname = 'inspection_template_versions_one_draft';
 */
import type { QueryInterface } from "sequelize";

const TABLE = "inspection_template_versions";
const INDEX = "inspection_template_versions_one_draft";

const UP_SQL = Object.freeze([
  `DROP INDEX IF EXISTS ${INDEX}`,
  `CREATE UNIQUE INDEX ${INDEX} ON ${TABLE} (template_id) WHERE status = 'draft' AND rebased_from_version_id IS NULL`,
]);

const DOWN_SQL = Object.freeze([
  `DROP INDEX IF EXISTS ${INDEX}`,
  `CREATE UNIQUE INDEX ${INDEX} ON ${TABLE} (template_id) WHERE status = 'draft'`,
]);

/** Run `statements` in one transaction, after checking 0112's table exists. */
const apply = async (context: QueryInterface, statements: readonly string[]): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    const [found] = (await sequelize.query("SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present", {
      transaction,
      replacements: { table: TABLE },
    })) as [{ present: boolean }[], unknown];
    if (found[0]?.present !== true) {
      throw new Error(`0125: ${TABLE} does not exist — migration 0112 must run first.`);
    }
    for (const statement of statements) {
      await sequelize.query(statement, { transaction });
    }
  });
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await apply(context, UP_SQL);
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  await apply(context, DOWN_SQL);
};

export = { UP_SQL, DOWN_SQL, up, down };
