/**
 * Migration 0141 — the upstream transform's IPM steps (P24-02g; ADR-129 Amendment 9): their quarantine
 * reasons and the transform role's column grants on the two IPM tables and what their snapshots read.
 *
 *  1. `upstream_import.quarantine`'s reason CHECK rebuilt from @callibrator/contracts
 *     UPSTREAM_IMPORT_QUARANTINE_REASONS (AS the import role, the table's owner): it gains
 *     `session_not_imported` and `session_changed_upstream`.
 *  2. Column-level grants to the transform role:
 *     - `inspection_sessions`: read what a re-run compares and the issue hashes, insert an imported
 *       draft, and update ONLY the issue's columns (`status`, `submitted_at`, the report number, token,
 *       hash, scheme, issuer, `updated_at`) — 0127 admits them only while the row is a draft, so an
 *       issued session stays out of reach; never the void or supersession columns;
 *     - `inspection_results`: read and insert; no UPDATE, no DELETE;
 *     - the reads of the snapshots: `calibration_devices` (name, make, model, type, next date,
 *       room), `calibration_records` (the last date), `tenants` (the issuer's letterhead).
 *
 * Throws, rather than skipping, when a table or role it needs is absent (PR-5). No try/catch.
 * Verify with psql:
 *   \dp inspection_sessions        -- callibrator_transform: column privileges only
 *   \dp inspection_results
 *
 * `down` REFUSES while a quarantine row uses a new reason; else it revokes the grants and narrows
 * the reasons back.
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import { UPSTREAM_IMPORT_QUARANTINE_REASONS } from "@callibrator/contracts/upstreamSqlImport";
import m0133 from "./0133-upstream-import-transform";

const REASON_CHECK = "quarantine_reason_vocabulary";
const NEW_REASONS: readonly string[] = Object.freeze(["session_not_imported", "session_changed_upstream"]);
const DEFAULT_IMPORT_ROLE = "callibrator_import";
const LOCK_TIMEOUT = "10s";

/** GRANT statements (privilege → table). */
const SESSION_READ = [
  "id", "tenant_id", "client_facility_id", "device_id", "status", "supersedes_id", "legacy_key", "performed_at", "visit_number",
  "legacy_visit_number", "inspection_outcome", "maintenance_outcome", "recommendation", "notes", "report_number",
  "performer_snapshot", "device_snapshot", "facility_snapshot", "room_snapshot", "floor_snapshot",
];
const SESSION_INSERT = [
  "id", "tenant_id", "client_facility_id", "device_id", "status", "revision", "performed_at", "received_at", "captured_offline",
  "performed_by", "performer_snapshot", "device_snapshot", "facility_snapshot", "room_snapshot", "floor_snapshot", "visit_number",
  "legacy_visit_number", "inspection_outcome", "maintenance_outcome", "recommendation", "notes", "side_effects", "legacy_key",
  "created_at", "updated_at",
];
const SESSION_ISSUE = ["status", "submitted_at", "report_number", "verification_token", "report_content_hash", "report_hash_scheme", "issuer_snapshot", "updated_at"];
const RESULT_COLUMNS = [
  "id", "tenant_id", "client_facility_id", "session_id", "section", "input_kind", "template_item_id", "item_definition_id", "is_ad_hoc",
  "label_snapshot", "unit", "symbol", "setting_text", "reference_text", "outcome", "cleanliness", "measured_value", "measured_value_1",
  "measured_value_2", "text_value", "raw_value", "computed_outcome", "outcome_source", "warn_flag", "disagreement_flag", "sort_order",
  "legacy_table", "legacy_id", "created_at", "updated_at",
];

/** GRANT statements (privilege → table). */
const GRANTS: readonly (readonly [privilege: string, table: string])[] = Object.freeze([
  [`SELECT (${SESSION_READ.join(", ")})`, "inspection_sessions"],
  [`INSERT (${SESSION_INSERT.join(", ")})`, "inspection_sessions"],
  [`UPDATE (${SESSION_ISSUE.join(", ")})`, "inspection_sessions"],
  [`SELECT (${RESULT_COLUMNS.join(", ")})`, "inspection_results"],
  [`INSERT (${RESULT_COLUMNS.join(", ")})`, "inspection_results"],
  ["SELECT (name, manufacturer, model, device_type_id, next_calibration_date, location_id)", "calibration_devices"],
  ["SELECT (calibration_date, deleted_at, created_at)", "calibration_records"],
  ["SELECT (email, phone, address, city, state, zip_code, country, website)", "tenants"],
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
    ["table inspection_sessions", "to_regclass('inspection_sessions') IS NOT NULL"],
    ["table inspection_results", "to_regclass('inspection_results') IS NOT NULL"],
    [`table ${m0133.QUARANTINE}`, `to_regclass('${m0133.QUARANTINE}') IS NOT NULL`],
    [`the transform role "${transformRole}"`, `EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${transformRole}')`],
  ] as const) {
    if (!(await truthy(sequelize, transaction, present))) {
      throw new Error(`0141: ${label} does not exist. Migrations 0126 and 0133 come first; run the migrations in order.`);
    }
  }
  if (!(await truthy(sequelize, transaction, "pg_has_role(current_user, :role, 'SET')", { role: importRole }))) {
    throw new Error(`0141: the migrating role cannot SET ROLE to the import role "${importRole}" (0114 grants it); refusing.`);
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
      throw new Error(`0141 down: ${m0133.QUARANTINE} holds an IPM-step decision; refusing to narrow the reasons under it.`);
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
