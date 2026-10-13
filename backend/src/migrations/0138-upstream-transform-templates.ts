/**
 * Migration 0138 — the upstream transform's templates step (P24-02d; ADR-129 Amendment 6): its three
 * quarantine reasons and the transform role's grants on the three GLOBAL template tables it writes.
 *
 *  1. `upstream_import.quarantine`'s reason CHECK rebuilt from @callibrator/contracts
 *     UPSTREAM_IMPORT_QUARANTINE_REASONS (AS the import role, the table's owner): it gains
 *     `reference_unresolved`, `template_operator_managed` and `item_content_incomplete`.
 *  2. Grants to the transform role: SELECT, INSERT, UPDATE on `inspection_templates`,
 *     `inspection_template_versions` and `inspection_template_items` — platform reference data, no
 *     credential. UPDATE on the versions is also what the items trigger's `FOR SHARE` read needs.
 *     No DELETE: 0112's triggers refuse it on all three (a version is retired, never deleted).
 *
 * Throws, rather than skipping, when a table or role it needs is absent (PR-5). No try/catch.
 * Verify with psql:
 *   \dp inspection_templates            -- callibrator_transform=arw
 *   \dp inspection_template_versions
 *   \dp inspection_template_items
 *
 * `down` REFUSES while a quarantine row uses a new reason; else it revokes the grants and narrows
 * the reasons back.
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import m0133 from "./0133-upstream-import-transform";

const REASON_CHECK = "quarantine_reason_vocabulary";
const NEW_REASONS: readonly string[] = Object.freeze(["reference_unresolved", "template_operator_managed", "item_content_incomplete"]);
const DEFAULT_IMPORT_ROLE = "callibrator_import";
const LOCK_TIMEOUT = "10s";

/** GRANT statements (privilege → table). */
const GRANTS: readonly (readonly [privilege: string, table: string])[] = Object.freeze([
  ["SELECT, INSERT, UPDATE", "inspection_templates"],
  ["SELECT, INSERT, UPDATE", "inspection_template_versions"],
  ["SELECT, INSERT, UPDATE", "inspection_template_items"],
]);

const list = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(", ");

type Row = Record<string, unknown>;

const run = async (sequelize: Sequelize, transaction: Transaction, statement: string, replacements: Row = {}): Promise<void> => {
  await sequelize.query(statement, { transaction, replacements });
};

const truthy = async (sequelize: Sequelize, transaction: Transaction, statement: string, replacements: Row = {}): Promise<boolean> => {
  const [result] = (await sequelize.query(`SELECT (${statement}) AS yes`, { transaction, replacements })) as [Row[], unknown];
  return result[0]?.["yes"] === true;
};

/** The roles, checked present. */
const roles = async (sequelize: Sequelize, transaction: Transaction): Promise<{ importRole: string; transformRole: string }> => {
  const importRole = m0133.roleName("UPSTREAM_IMPORT_DB_ROLE", DEFAULT_IMPORT_ROLE);
  const transformRole = m0133.roleName("UPSTREAM_TRANSFORM_DB_ROLE", m0133.DEFAULT_TRANSFORM_ROLE);
  for (const [label, present] of [
    ["table inspection_templates", "to_regclass('inspection_templates') IS NOT NULL"],
    ["table inspection_template_versions", "to_regclass('inspection_template_versions') IS NOT NULL"],
    ["table inspection_template_items", "to_regclass('inspection_template_items') IS NOT NULL"],
    [`table ${m0133.QUARANTINE}`, `to_regclass('${m0133.QUARANTINE}') IS NOT NULL`],
    [`the transform role "${transformRole}"`, `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${transformRole}')`],
  ] as const) {
    if (!(await truthy(sequelize, transaction, present))) {
      throw new Error(`0138: ${label} does not exist. Migrations 0112 and 0133 come first; run the migrations in order.`);
    }
  }
  if (!(await truthy(sequelize, transaction, "pg_has_role(current_user, :role, 'SET')", { role: importRole }))) {
    throw new Error(`0138: the migrating role cannot SET ROLE to the import role "${importRole}" (0114 grants it); refusing.`);
  }
  return { importRole, transformRole };
};

/** Rebuild the quarantine's reason CHECK over `reasons`, as the import role (the owner). */
const rebuildReasons = async (sequelize: Sequelize, transaction: Transaction, importRole: string, reasons: readonly string[]): Promise<void> => {
  await run(sequelize, transaction, `SET LOCAL ROLE ${importRole}`);
  await run(sequelize, transaction, `ALTER TABLE ${m0133.QUARANTINE} DROP CONSTRAINT IF EXISTS ${REASON_CHECK}`);
  await run(sequelize, transaction, `ALTER TABLE ${m0133.QUARANTINE} ADD CONSTRAINT ${REASON_CHECK} CHECK (reason IN (${list(reasons)}))`);
  await run(sequelize, transaction, "RESET ROLE");
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const { importRole, transformRole } = await roles(sequelize, transaction);
    await rebuildReasons(sequelize, transaction, importRole, UPSTREAM_IMPORT_QUARANTINE_REASONS);
    for (const [privilege, table] of GRANTS) {
      await run(sequelize, transaction, `GRANT ${privilege} ON ${table} TO ${transformRole}`);
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const { importRole, transformRole } = await roles(sequelize, transaction);
    if (await truthy(sequelize, transaction, `EXISTS (SELECT 1 FROM ${m0133.QUARANTINE} WHERE reason IN (:reasons))`, { reasons: [...NEW_REASONS] })) {
      throw new Error(`0138 down: ${m0133.QUARANTINE} holds a templates-step decision; refusing to narrow the reasons under it.`);
    }
    for (const [privilege, table] of GRANTS) {
      await run(sequelize, transaction, `REVOKE ${privilege} ON ${table} FROM ${transformRole}`);
    }
    await rebuildReasons(
      sequelize,
      transaction,
      importRole,
      UPSTREAM_IMPORT_QUARANTINE_REASONS.filter((reason) => !NEW_REASONS.includes(reason)),
    );
  });
};

export = { REASON_CHECK, NEW_REASONS, GRANTS, up, down };
