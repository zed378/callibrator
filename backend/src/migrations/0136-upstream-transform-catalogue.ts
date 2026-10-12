/**
 * Migration 0136 — the upstream transform's catalogue steps (P24-02c; ADR-129 Amendment 5): their
 * quarantine reason and the transform role's grants on the two GLOBAL catalogue tables they write.
 *
 *  1. `upstream_import.quarantine`'s reason CHECK rebuilt from @callibrator/contracts
 *     UPSTREAM_IMPORT_QUARANTINE_REASONS (AS the import role, the table's owner): it gains
 *     `session_header_value` (the recommendation's answers are a session header field).
 *  2. Grants to the transform role: SELECT, INSERT, UPDATE on `device_types` and on
 *     `inspection_item_definitions` — platform reference data, no credential in either. No DELETE
 *     (both tables refuse it to everyone by trigger, 0111 / 0112). The template tables are the
 *     next part's (P24-02d).
 *
 * Throws, rather than skipping, when a table or role it needs is absent (PR-5). No try/catch.
 * Verify with psql:
 *   \dp device_types            -- callibrator_transform=arw
 *   \dp inspection_item_definitions
 *
 * `down` REFUSES while a quarantine row uses the new reason; else it revokes the grants and narrows
 * the reasons back.
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import m0133 from "./0133-upstream-import-transform";

const REASON_CHECK = "quarantine_reason_vocabulary";
const NEW_REASONS: readonly string[] = Object.freeze(["session_header_value"]);
const DEFAULT_IMPORT_ROLE = "callibrator_import";
const LOCK_TIMEOUT = "10s";

/** GRANT statements (privilege → table). */
const GRANTS: readonly (readonly [privilege: string, table: string])[] = Object.freeze([
  ["SELECT, INSERT, UPDATE", "device_types"],
  ["SELECT, INSERT, UPDATE", "inspection_item_definitions"],
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
    ["table device_types", "to_regclass('device_types') IS NOT NULL"],
    ["table inspection_item_definitions", "to_regclass('inspection_item_definitions') IS NOT NULL"],
    [`table ${m0133.QUARANTINE}`, `to_regclass('${m0133.QUARANTINE}') IS NOT NULL`],
    [`the transform role "${transformRole}"`, `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${transformRole}')`],
  ] as const) {
    if (!(await truthy(sequelize, transaction, present))) {
      throw new Error(`0136: ${label} does not exist. Migrations 0111, 0112 and 0133 come first; run the migrations in order.`);
    }
  }
  if (!(await truthy(sequelize, transaction, "pg_has_role(current_user, :role, 'SET')", { role: importRole }))) {
    throw new Error(`0136: the migrating role cannot SET ROLE to the import role "${importRole}" (0114 grants it); refusing.`);
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
      throw new Error(`0136 down: ${m0133.QUARANTINE} holds a catalogue-step decision; refusing to narrow the reasons under it.`);
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
