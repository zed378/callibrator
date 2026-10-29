/**
 * Migration 0147 — the transform role may ANALYZE the tables it writes (P24-05 finding, 2026-10-29).
 *
 * The transform writes hundreds of thousands of rows in ONE transaction, then reads them back in the
 * next steps (the device snapshots of the IPM sessions, the photo rows, the rooms). The planner's
 * statistics still describe the tables as they were before the transaction: on the real dump three
 * such reads took 120 s, 63 s and 30 s as nested loops over sequential scans. The runner now runs
 * `ANALYZE` on what each step wrote, inside the transaction (it sees the transaction's own rows).
 * ANALYZE needs the table's owner or the MAINTAIN privilege (PostgreSQL 17+; the project runs 18,
 * ADR-041), so this grants MAINTAIN — statistics, VACUUM, REINDEX, CLUSTER, REFRESH MATERIALIZED VIEW
 * and LOCK TABLE, no row read and no row write — on exactly the tables the transform writes.
 *
 * Without the grant ANALYZE warns and skips (it never fails the transaction): the transform stays
 * correct, only slower. The bookkeeping tables belong to the import role (0133 creates them as it), and a
 * GRANT by a role that neither owns a table nor holds the grant option only WARNS — so those three are
 * granted AS the import role, as 0133 does, whatever the migrating role is (the live suites migrate as a
 * superuser, for whom either works). Proved in upstreamImportGrants.p2401.live ("0147: MAINTAIN …"). No try/catch here: a failure fails the migration (CLAUDE.md). Verify with psql:
 *   SELECT table_schema, table_name FROM information_schema.table_privileges
 *    WHERE grantee = 'callibrator_transform' AND privilege_type = 'MAINTAIN' ORDER BY 1, 2;
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import m0133 from "./0133-upstream-import-transform";

const LOCK_TIMEOUT = "10s";
const DEFAULT_IMPORT_ROLE = "callibrator_import";
const SCHEMA = "upstream_import.";

/** The tables the transform writes (steps.ts `writes`, plus its bookkeeping), frozen 2026-10-29. */
const TABLES: readonly string[] = Object.freeze([
  "client_facilities",
  "users",
  "device_types",
  "inspection_item_definitions",
  "inspection_templates",
  "inspection_template_versions",
  "inspection_template_items",
  "vendors",
  "warehouses",
  "calibration_devices",
  "attachments",
  "calibration_records",
  "inspection_sessions",
  "inspection_results",
  "audit_logs",
  "upstream_import.id_map",
  "upstream_import.quarantine",
  "upstream_import.former_users",
]);

type Row = Record<string, unknown>;
interface Roles {
  importRole: string;
  transformRole: string;
}

const run = async (sequelize: Sequelize, transaction: Transaction, statement: string): Promise<void> => {
  await sequelize.query(statement, { transaction });
};

const truthy = async (sequelize: Sequelize, transaction: Transaction, statement: string): Promise<boolean> => {
  const [result] = (await sequelize.query(`SELECT (${statement}) AS yes`, { transaction })) as [Row[], unknown];
  return result[0]?.["yes"] === true;
};

/** The roles, checked present with every table; the migrating role must be able to act as the import role. */
const rolesOf = async (sequelize: Sequelize, transaction: Transaction): Promise<Roles> => {
  const importRole = m0133.roleName("UPSTREAM_IMPORT_DB_ROLE", DEFAULT_IMPORT_ROLE);
  const transformRole = m0133.roleName("UPSTREAM_TRANSFORM_DB_ROLE", m0133.DEFAULT_TRANSFORM_ROLE);
  if (!(await truthy(sequelize, transaction, `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${transformRole}')`))) {
    throw new Error(`0147: the transform role "${transformRole}" does not exist. Migrations 0133 … 0146 come first; run the migrations in order.`);
  }
  for (const table of TABLES) {
    if (!(await truthy(sequelize, transaction, `to_regclass('${table}') IS NOT NULL`))) {
      throw new Error(`0147: table ${table} does not exist. Run the migrations in order.`);
    }
  }
  if (!(await truthy(sequelize, transaction, `pg_has_role(current_user, '${importRole}', 'SET')`))) {
    throw new Error(`0147: the migrating role cannot SET ROLE to the import role "${importRole}" (0114 grants it); refusing.`);
  }
  return { importRole, transformRole };
};

const apply = async (context: QueryInterface, verb: "GRANT" | "REVOKE"): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const { importRole, transformRole } = await rolesOf(sequelize, transaction);
    const statement = (table: string): string => `${verb} MAINTAIN ON ${table} ${verb === "GRANT" ? "TO" : "FROM"} ${transformRole}`;
    for (const table of TABLES.filter((t) => !t.startsWith(SCHEMA))) {
      await run(sequelize, transaction, statement(table));
    }
    await run(sequelize, transaction, `SET LOCAL ROLE ${importRole}`);
    for (const table of TABLES.filter((t) => t.startsWith(SCHEMA))) {
      await run(sequelize, transaction, statement(table));
    }
    await run(sequelize, transaction, "RESET ROLE");
  });
};

const up = ({ context }: { context: QueryInterface }): Promise<void> => apply(context, "GRANT");

const down = ({ context }: { context: QueryInterface }): Promise<void> => apply(context, "REVOKE");

export = { TABLES, up, down };
