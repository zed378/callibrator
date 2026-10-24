/**
 * Migration 0146 — the upstream reconciliation's read grants (P25-01, P25-02; ADR-129 Am. 11).
 *
 * The reconciliation (services/upstreamReconciliation.service.ts) and the data-quality report
 * (services/upstreamDataQuality.service.ts) run on the transform connection, because only the
 * transform role reads `upstream_import` (ADR-129 Am. 1) and their checks join `id_map` with the
 * rows the transform wrote. Every column they read is already granted by 0135 … 0145 except two:
 *
 *   - `calibration_records.client_facility_id` — RC-F1 and RC-F2 compare a calibration's facility
 *     with the facility the transform decided and with its device's;
 *   - `calibration_devices.inventoried_on` — Q-12 and Q-13 count future and implausibly old dates.
 *
 * SELECT on those two columns only, to the transform role. No write, no other column.
 *
 * Throws, rather than skipping, when a table or the role is absent (PR-5). No try/catch.
 * Verify with psql:
 *   SELECT table_name, column_name, privilege_type FROM information_schema.column_privileges
 *    WHERE grantee = 'callibrator_transform' AND column_name IN ('client_facility_id', 'inventoried_on')
 *      AND table_name IN ('calibration_records', 'calibration_devices');
 *
 * `down` revokes the two grants.
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import m0133 from "./0133-upstream-import-transform";

const LOCK_TIMEOUT = "10s";

/** GRANT statements (privilege → table). */
const GRANTS: readonly (readonly [privilege: string, table: string])[] = Object.freeze([
  ["SELECT (client_facility_id)", "calibration_records"],
  ["SELECT (inventoried_on)", "calibration_devices"],
]);

type Row = Record<string, unknown>;

const run = async (sequelize: Sequelize, transaction: Transaction, statement: string): Promise<void> => {
  await sequelize.query(statement, { transaction });
};

const truthy = async (sequelize: Sequelize, transaction: Transaction, statement: string): Promise<boolean> => {
  const [result] = (await sequelize.query(`SELECT (${statement}) AS yes`, { transaction })) as [Row[], unknown];
  return result[0]?.["yes"] === true;
};

/** The transform role, checked present with both tables. */
const transformRoleOf = async (sequelize: Sequelize, transaction: Transaction): Promise<string> => {
  const transformRole = m0133.roleName("UPSTREAM_TRANSFORM_DB_ROLE", m0133.DEFAULT_TRANSFORM_ROLE);
  for (const [label, present] of [
    ["table calibration_records", "to_regclass('calibration_records') IS NOT NULL"],
    ["table calibration_devices", "to_regclass('calibration_devices') IS NOT NULL"],
    [`the transform role "${transformRole}"`, `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${transformRole}')`],
  ] as const) {
    if (!(await truthy(sequelize, transaction, present))) {
      throw new Error(`0146: ${label} does not exist. Migrations 0133 … 0145 come first; run the migrations in order.`);
    }
  }
  return transformRole;
};

const apply = async (context: QueryInterface, verb: "GRANT" | "REVOKE"): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const transformRole = await transformRoleOf(sequelize, transaction);
    for (const [privilege, table] of GRANTS) {
      await run(sequelize, transaction, `${verb} ${privilege} ON ${table} ${verb === "GRANT" ? "TO" : "FROM"} ${transformRole}`);
    }
  });
};

const up = ({ context }: { context: QueryInterface }): Promise<void> => apply(context, "GRANT");

const down = ({ context }: { context: QueryInterface }): Promise<void> => apply(context, "REVOKE");

export = { GRANTS, up, down };
