/**
 * Migration 0134 — the upstream transform's first steps (P24-02a; ADR-129 Amendment 3): the
 * provider tenant on the run, the facilities step's quarantine reason, and the transform role's
 * grants on the two application tables those steps write.
 *
 *  1. `upstream_sql_imports.transform_tenant_id` UUID — the PROVIDER tenant a requested transform
 *     writes into (the super admin names it; the transform never creates a tenant). No foreign
 *     key and not `tenant_id`, for `notify_tenant_id`'s reason (0114): the run is the platform's
 *     record, a tenant's removal must neither be blocked by it nor delete it, and the global hooks
 *     must not scope the table. No index (no foreign key, never a lookup key). CHECK
 *     `upstream_sql_imports_transform_tenant`: a run past `not_available` names its tenant.
 *  2. `upstream_import.quarantine`'s reason CHECK rebuilt from @callibrator/contracts
 *     UPSTREAM_IMPORT_QUARANTINE_REASONS — it gains `facility_without_devices` (UD-11: only the
 *     facilities with a device in the register become client facilities). Altered AS the import
 *     role, the table's owner. (A fresh database's 0133 already builds it from the same list.)
 *  3. Grants to the transform role (0133's `callibrator_transform`, which had nothing in `public`):
 *     SELECT, INSERT, UPDATE on `client_facilities` (step 1 inserts, adopts and updates facilities;
 *     no DELETE), INSERT on `audit_logs` (step 13's one row per written row; it reads nothing
 *     there). Each later P24-02 part grants its own tables in its own migration (ADR-129 Am. 1 § 1).
 *
 * Throws, rather than skipping, when a table or role it needs is absent (PR-5). No try/catch.
 * Verify with psql, not the log:
 *   \d upstream_sql_imports                     -- transform_tenant_id, upstream_sql_imports_transform_tenant
 *   \dp client_facilities                       -- callibrator_transform=arw
 *   \dp audit_logs                              -- callibrator_transform=a
 *   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'quarantine_reason_vocabulary';
 *
 * `down` REFUSES while a run's transform status is not `not_available` or a quarantine row uses
 * the new reason; else it removes what `up` added (the reason CHECK narrowed back).
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import m0133 from "./0133-upstream-import-transform";

const TABLE = "upstream_sql_imports";
const COLUMN = "transform_tenant_id";
const TENANT_CHECK = "upstream_sql_imports_transform_tenant";
const TENANT_PREDICATE = `transform_status = 'not_available' OR ${COLUMN} IS NOT NULL`;
const REASON_CHECK = "quarantine_reason_vocabulary";
const NEW_REASON = "facility_without_devices";
const DEFAULT_IMPORT_ROLE = "callibrator_import";
const LOCK_TIMEOUT = "10s";

/** The application tables the transform role writes after this migration, and how. */
const GRANTS: readonly (readonly [table: string, privileges: string])[] = Object.freeze([
  ["client_facilities", "SELECT, INSERT, UPDATE"],
  ["audit_logs", "INSERT"],
]);

const list = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(", ");

/** The reason CHECK over `reasons`. */
const reasonCheck = (reasons: readonly string[]): string => `ALTER TABLE ${m0133.QUARANTINE} ADD CONSTRAINT ${REASON_CHECK} CHECK (reason IN (${list(reasons)}))`;

type Row = Record<string, unknown>;

const run = async (sequelize: Sequelize, transaction: Transaction, statement: string, replacements: Row = {}): Promise<void> => {
  await sequelize.query(statement, { transaction, replacements });
};

const truthy = async (sequelize: Sequelize, transaction: Transaction, statement: string, replacements: Row = {}): Promise<boolean> => {
  const [result] = (await sequelize.query(`SELECT (${statement}) AS yes`, { transaction, replacements })) as [Row[], unknown];
  return result[0]?.["yes"] === true;
};

/** The roles, checked present (0057, 0114 and 0133 create them). */
const roles = async (sequelize: Sequelize, transaction: Transaction): Promise<{ importRole: string; transformRole: string }> => {
  const importRole = m0133.roleName("UPSTREAM_IMPORT_DB_ROLE", DEFAULT_IMPORT_ROLE);
  const transformRole = m0133.roleName("UPSTREAM_TRANSFORM_DB_ROLE", m0133.DEFAULT_TRANSFORM_ROLE);
  for (const [label, present] of [
    [`table ${TABLE}`, `to_regclass('${TABLE}') IS NOT NULL`],
    ["table client_facilities", "to_regclass('client_facilities') IS NOT NULL"],
    ["table audit_logs", "to_regclass('audit_logs') IS NOT NULL"],
    [`table ${m0133.QUARANTINE}`, `to_regclass('${m0133.QUARANTINE}') IS NOT NULL`],
    [`the transform role "${transformRole}"`, `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${transformRole}')`],
  ] as const) {
    if (!(await truthy(sequelize, transaction, present))) {
      throw new Error(`0134: ${label} does not exist. Migrations 0114, 0117 and 0133 create it; run the migrations in order.`);
    }
  }
  if (!(await truthy(sequelize, transaction, "pg_has_role(current_user, :role, 'SET')", { role: importRole }))) {
    throw new Error(`0134: the migrating role cannot SET ROLE to the import role "${importRole}" (0114 grants it); refusing.`);
  }
  return { importRole, transformRole };
};

const hasConstraint = (sequelize: Sequelize, transaction: Transaction, table: string, name: string): Promise<boolean> =>
  truthy(sequelize, transaction, "EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = :table::regclass AND conname = :name)", { table, name });

/** Rebuild the quarantine's reason CHECK over `reasons`, as the import role (the owner). */
const rebuildReasons = async (sequelize: Sequelize, transaction: Transaction, importRole: string, reasons: readonly string[]): Promise<void> => {
  await run(sequelize, transaction, `SET LOCAL ROLE ${importRole}`);
  await run(sequelize, transaction, `ALTER TABLE ${m0133.QUARANTINE} DROP CONSTRAINT IF EXISTS ${REASON_CHECK}`);
  await run(sequelize, transaction, reasonCheck(reasons));
  await run(sequelize, transaction, "RESET ROLE");
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const { importRole, transformRole } = await roles(sequelize, transaction);

    // 1. The provider tenant on the run.
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS ${COLUMN} UUID`);
    if (!(await hasConstraint(sequelize, transaction, TABLE, TENANT_CHECK))) {
      await run(sequelize, transaction, `ALTER TABLE ${TABLE} ADD CONSTRAINT ${TENANT_CHECK} CHECK (${TENANT_PREDICATE})`);
    }

    // 2. The quarantine reasons, from the contracts.
    await rebuildReasons(sequelize, transaction, importRole, UPSTREAM_IMPORT_QUARANTINE_REASONS);

    // 3. The transform role's grants in public.
    for (const [table, privileges] of GRANTS) {
      await run(sequelize, transaction, `GRANT ${privileges} ON ${table} TO ${transformRole}`);
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const { importRole, transformRole } = await roles(sequelize, transaction);
    if (await truthy(sequelize, transaction, `EXISTS (SELECT 1 FROM ${TABLE} WHERE transform_status <> 'not_available')`)) {
      throw new Error(`0134 down: a run of ${TABLE} has a transform status; refusing to drop the tenant it names.`);
    }
    if (await truthy(sequelize, transaction, `EXISTS (SELECT 1 FROM ${m0133.QUARANTINE} WHERE reason = :reason)`, { reason: NEW_REASON })) {
      throw new Error(`0134 down: ${m0133.QUARANTINE} holds a "${NEW_REASON}" decision; refusing to narrow the reasons under it.`);
    }
    for (const [table, privileges] of GRANTS) {
      await run(sequelize, transaction, `REVOKE ${privileges} ON ${table} FROM ${transformRole}`);
    }
    await rebuildReasons(
      sequelize,
      transaction,
      importRole,
      UPSTREAM_IMPORT_QUARANTINE_REASONS.filter((reason) => reason !== NEW_REASON),
    );
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${TENANT_CHECK}`);
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS ${COLUMN}`);
  });
};

export = { TABLE, COLUMN, TENANT_CHECK, TENANT_PREDICATE, REASON_CHECK, NEW_REASON, GRANTS, up, down };
