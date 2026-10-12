/**
 * Migration 0135 — the upstream transform's users step (P24-02b; ADR-129 Amendment 4): its five
 * quarantine reasons and the transform role's COLUMN-level grants on `users` and `roles`.
 *
 *  1. `upstream_import.quarantine`'s reason CHECK rebuilt from @callibrator/contracts
 *     UPSTREAM_IMPORT_QUARANTINE_REASONS (AS the import role, the table's owner): it gains
 *     `user_without_group`, `facility_not_imported`, `email_in_use`, `unknown_group` and
 *     `user_not_imported` (P18-01-02 § 2.2).
 *  2. Grants to the transform role, column by column — `users` holds credentials, MFA secrets and
 *     recovery codes the transform must never read or write:
 *       - `roles`: SELECT (id, name) — the step looks roles up by name, and the bound-role trigger
 *         (0117 `users_bound_role_check`, run as the inserting role) reads them;
 *       - `users`: SELECT (id, tenant_id, username, email) — the target check and the global
 *         username / e-mail collision check; INSERT of exactly the columns the step writes;
 *         UPDATE (first_name, last_name, is_active, status, updated_at) — a changed user's profile.
 *     No DELETE, no TRUNCATE, nothing on `password` but INSERT (the run's unusable hash).
 *
 * Throws, rather than skipping, when a table or role it needs is absent (PR-5). No try/catch.
 * Verify with psql:
 *   SELECT column_name, privilege_type FROM information_schema.column_privileges
 *    WHERE grantee = 'callibrator_transform' AND table_name IN ('users', 'roles') ORDER BY 1, 2;
 *
 * `down` REFUSES while a quarantine row uses one of the new reasons; else it revokes the grants and
 * narrows the reasons back.
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import m0133 from "./0133-upstream-import-transform";

const REASON_CHECK = "quarantine_reason_vocabulary";
const NEW_REASONS: readonly string[] = Object.freeze(["user_without_group", "facility_not_imported", "email_in_use", "unknown_group", "user_not_imported"]);
const DEFAULT_IMPORT_ROLE = "callibrator_import";
const LOCK_TIMEOUT = "10s";

/** The columns the users step inserts (services/upstreamImport/transform/users.ts). */
const USER_INSERT_COLUMNS: readonly string[] = Object.freeze([
  "id",
  "tenant_id",
  "role_id",
  "username",
  "email",
  "password",
  "first_name",
  "last_name",
  "avatar_url",
  "is_active",
  "status",
  "is_email_verified",
  "must_change_password",
  "password_one_time",
  "client_facility_id",
  "facility_binding_pending",
  "is_deleted",
  "created_at",
  "updated_at",
]);

/** GRANT statements (privilege and column list → table). */
const GRANTS: readonly (readonly [privilege: string, table: string])[] = Object.freeze([
  ["SELECT (id, name)", "roles"],
  ["SELECT (id, tenant_id, username, email)", "users"],
  [`INSERT (${USER_INSERT_COLUMNS.join(", ")})`, "users"],
  ["UPDATE (first_name, last_name, is_active, status, updated_at)", "users"],
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
    ["table users", "to_regclass('users') IS NOT NULL"],
    ["table roles", "to_regclass('roles') IS NOT NULL"],
    [`table ${m0133.QUARANTINE}`, `to_regclass('${m0133.QUARANTINE}') IS NOT NULL`],
    [`the transform role "${transformRole}"`, `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${transformRole}')`],
  ] as const) {
    if (!(await truthy(sequelize, transaction, present))) {
      throw new Error(`0135: ${label} does not exist. Migrations 0133 and 0134 come first; run the migrations in order.`);
    }
  }
  if (!(await truthy(sequelize, transaction, "pg_has_role(current_user, :role, 'SET')", { role: importRole }))) {
    throw new Error(`0135: the migrating role cannot SET ROLE to the import role "${importRole}" (0114 grants it); refusing.`);
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
      throw new Error(`0135 down: ${m0133.QUARANTINE} holds a users-step decision; refusing to narrow the reasons under it.`);
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

export = { REASON_CHECK, NEW_REASONS, USER_INSERT_COLUMNS, GRANTS, up, down };
