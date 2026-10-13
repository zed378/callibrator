/**
 * Migration 0139 — the upstream transform's register steps (P24-02e; ADR-129 Amendment 7): the
 * laboratories, rooms and devices.
 *
 *  1. `upstream_import.quarantine`'s reason CHECK rebuilt from @callibrator/contracts
 *     UPSTREAM_IMPORT_QUARANTINE_REASONS (AS the import role, the table's owner): it gains `qr_in_use`
 *     and `facility_changed`.
 *  2. `upstream_import.former_users` (AS the import role): the per-migration number of each departed
 *     upstream registrant (07 § 3: "Former upstream user #<n>", never the upstream id). The link
 *     from the number to the upstream id lives only here and in `id_map`, and goes with the schema
 *     at decommission. Not readable by the application role.
 *  3. Column-level grants to the transform role — only the columns the steps read or write; no
 *     credential, secret or token column (`calibration_devices.iot_token_hash` is not granted):
 *     `vendors`, `warehouses` (read the key, insert), `calibration_devices` (read the keys, insert;
 *     update the register columns but never `client_facility_id` — a move is the operator's), `tenant_settings` (read the QR settings), `users` (read the
 *     registrant's printed name, role and facility), `tenants` (read the organisation's name).
 *
 * Throws, rather than skipping, when a table or role it needs is absent (PR-5). No try/catch.
 * Verify with psql:
 *   \dp calibration_devices         -- callibrator_transform: column privileges only
 *   \dp upstream_import.former_users
 *
 * `down` REFUSES while `former_users` holds a row or a quarantine row uses the new reason; else it
 * revokes the grants, drops the table and narrows the reasons back.
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import m0133 from "./0133-upstream-import-transform";

const REASON_CHECK = "quarantine_reason_vocabulary";
const NEW_REASONS: readonly string[] = Object.freeze(["qr_in_use", "facility_changed"]);
const DEFAULT_IMPORT_ROLE = "callibrator_import";
const DEFAULT_APP_ROLE = "callibrator_app";
const LOCK_TIMEOUT = "10s";
const FORMER_USERS = `${m0133.SCHEMA}.former_users`;

const FORMER_USERS_SQL = `CREATE TABLE IF NOT EXISTS ${FORMER_USERS} (
  legacy_user_id text PRIMARY KEY CONSTRAINT former_users_legacy_user_id_length CHECK (length(legacy_user_id) BETWEEN 1 AND 255),
  number integer NOT NULL CONSTRAINT former_users_number_positive CHECK (number > 0),
  first_import_run_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT former_users_number_unique UNIQUE (number)
)`;

/** The register columns a re-run updates — never the facility (a move is the operator's, P19-04 § 10). */
const DEVICE_WRITE_COLUMNS = Object.freeze([
  "name",
  "serial_number",
  "manufacturer",
  "model",
  "category",
  "status",
  "location_id",
  "device_type_id",
  "qr_code",
  "inventoried_on",
  "accessories_complete",
  '"condition"',
  "condition_changed_at",
  "condition_source",
  "calibration_vendor_id",
  "created_by",
  "registrant_snapshot",
  "updated_at",
]);

/** GRANT statements (privilege and column list → table). */
const GRANTS: readonly (readonly [privilege: string, table: string])[] = Object.freeze([
  ["SELECT (id, tenant_id, name, type, deleted_at, created_at)", "vendors"],
  ["INSERT (id, tenant_id, name, type, approval_status, status, created_at, updated_at)", "vendors"],
  ["SELECT (id, tenant_id, client_facility_id, name, floor, kind, code, is_deleted)", "warehouses"],
  ["INSERT (id, tenant_id, client_facility_id, name, code, floor, kind, status, is_deleted, created_at, updated_at)", "warehouses"],
  ['SELECT (id, tenant_id, client_facility_id, qr_code, serial_number, deleted_at, "condition", condition_changed_at, condition_source)', "calibration_devices"],
  [`INSERT (id, tenant_id, client_facility_id, ${DEVICE_WRITE_COLUMNS.join(", ")}, iot_enabled, is_deleted, created_at)`, "calibration_devices"],
  [`UPDATE (${DEVICE_WRITE_COLUMNS.join(", ")})`, "calibration_devices"],
  ["SELECT (tenant_id, key, value)", "tenant_settings"],
  ["SELECT (first_name, last_name, role_id, client_facility_id)", "users"],
  ["SELECT (id, name)", "tenants"],
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
const roles = async (sequelize: Sequelize, transaction: Transaction): Promise<{ importRole: string; transformRole: string; appRole: string }> => {
  const importRole = m0133.roleName("UPSTREAM_IMPORT_DB_ROLE", DEFAULT_IMPORT_ROLE);
  const transformRole = m0133.roleName("UPSTREAM_TRANSFORM_DB_ROLE", m0133.DEFAULT_TRANSFORM_ROLE);
  const appRole = m0133.roleName("DB_APP_ROLE", DEFAULT_APP_ROLE);
  for (const table of ["vendors", "warehouses", "calibration_devices", "tenant_settings", "users", "tenants", m0133.QUARANTINE]) {
    if (!(await truthy(sequelize, transaction, `to_regclass('${table}') IS NOT NULL`))) {
      throw new Error(`0139: table ${table} does not exist. Migrations 0128 and 0133 come first; run the migrations in order.`);
    }
  }
  if (!(await truthy(sequelize, transaction, `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${transformRole}')`))) {
    throw new Error(`0139: the transform role "${transformRole}" does not exist. Migration 0133 creates it; run the migrations in order.`);
  }
  if (!(await truthy(sequelize, transaction, "pg_has_role(current_user, :role, 'SET')", { role: importRole }))) {
    throw new Error(`0139: the migrating role cannot SET ROLE to the import role "${importRole}" (0114 grants it); refusing.`);
  }
  return { importRole, transformRole, appRole };
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
    const { importRole, transformRole, appRole } = await roles(sequelize, transaction);
    await rebuildReasons(sequelize, transaction, importRole, UPSTREAM_IMPORT_QUARANTINE_REASONS);
    await run(sequelize, transaction, `SET LOCAL ROLE ${importRole}`);
    await run(sequelize, transaction, FORMER_USERS_SQL);
    await run(sequelize, transaction, `REVOKE ALL ON ${FORMER_USERS} FROM PUBLIC`);
    await run(sequelize, transaction, `REVOKE ALL ON ${FORMER_USERS} FROM ${appRole}`);
    await run(sequelize, transaction, `GRANT SELECT, INSERT ON ${FORMER_USERS} TO ${transformRole}`);
    await run(sequelize, transaction, "RESET ROLE");
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
      throw new Error(`0139 down: ${m0133.QUARANTINE} holds a register-step decision; refusing to narrow the reasons under it.`);
    }
    if (await truthy(sequelize, transaction, `to_regclass('${FORMER_USERS}') IS NOT NULL AND EXISTS (SELECT 1 FROM ${FORMER_USERS})`)) {
      throw new Error(`0139 down: ${FORMER_USERS} holds a departed registrant's number; refusing to drop it.`);
    }
    for (const [privilege, table] of GRANTS) {
      await run(sequelize, transaction, `REVOKE ${privilege} ON ${table} FROM ${transformRole}`);
    }
    await run(sequelize, transaction, `SET LOCAL ROLE ${importRole}`);
    await run(sequelize, transaction, `DROP TABLE IF EXISTS ${FORMER_USERS}`);
    await run(sequelize, transaction, "RESET ROLE");
    await rebuildReasons(
      sequelize,
      transaction,
      importRole,
      UPSTREAM_IMPORT_QUARANTINE_REASONS.filter((reason) => !NEW_REASONS.includes(reason)),
    );
  });
};

export = { REASON_CHECK, NEW_REASONS, FORMER_USERS, FORMER_USERS_SQL, GRANTS, up, down };
