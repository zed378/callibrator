/**
 * P6-05 (PR-5) — verify the REAL schema against what the models declare,
 * after db.sync() and the migrator have run.
 *
 * A migration wrapped in a blanket try/catch is recorded as applied while
 * doing nothing (0008/0013/0014 were). `db.sync()` creates missing TABLES but
 * never adds a missing COLUMN to an existing one, so such a column stays
 * absent until the first query that names it fails — weeks later. The
 * migration log is not evidence; `information_schema` is.
 *
 * What is checked, and why each is a failure:
 *
 *  - every model's table exists;
 *  - every non-VIRTUAL model attribute has its column (by physical field
 *    name) — a missing column is a query that will fail;
 *  - no column the model does NOT declare is NOT NULL without a default —
 *    every INSERT through the model would fail on it. (An undeclared NULLABLE
 *    column is harmless and is only reported as a note.);
 *  - the database objects that carry a control and exist only in migrations
 *    (EXPECTED_OBJECTS): a missing trigger is a missing control that no
 *    query would ever notice.
 *
 * It runs at boot (index.js), BEFORE the backend drops to the application
 * role: information_schema shows a role only the columns it has privileges
 * on. It is not wrapped in a catch — the P6-05 abuse case. The one way to let
 * a boot continue past a mismatch is `SCHEMA_VERIFY=warn`, which logs every
 * problem at error level on every boot; it exists for a recovery, not a
 * steady state.
 *
 * P9-09 (ADR-087): converted from schemaVerify.util.js with no behaviour
 * change. The Sequelize instance and the logger are typed by the members used
 * here; raw-SQL rows are typed by the columns each query selects.
 */

import { env } from "../config/env";
import { sql } from "./sql.util";

/** The physical objects that carry a control. */
export type ExpectedObjectKind = "trigger" | "index" | "constraint";

/** One object that lives only in migrations. */
export interface ExpectedObject {
  readonly kind: ExpectedObjectKind;
  readonly table: string;
  readonly name: string;
  readonly why: string;
}

/** A model attribute (a rawAttributes entry) — the members read here. */
export interface SchemaModelAttribute {
  readonly type?: { readonly key?: string } | null | undefined;
  readonly field?: string | undefined;
}

/** A Sequelize model — the members read here. */
export interface SchemaModel {
  readonly name: string;
  getTableName(): string | { readonly tableName: string };
  readonly rawAttributes: Readonly<Record<string, SchemaModelAttribute>>;
}

/** The Sequelize members used here. Rows come back untyped from raw SQL. */
export interface SchemaSequelize {
  readonly models: Readonly<Record<string, SchemaModel>>;
  query(sql: string, options: { type: "SELECT" }): Promise<unknown[]>;
}

/** The logger members used here. */
export interface SchemaLogger {
  info(message: string): unknown;
  error(message: string): unknown;
}

/** assertSchemaMatchesModels' options. */
export interface AssertSchemaOptions {
  sequelize: SchemaSequelize;
  logger: SchemaLogger;
  /** process.env.SCHEMA_VERIFY; "warn" logs and continues */
  mode?: string | undefined;
}

/** What verifySchema found. */
export interface SchemaVerifyResult {
  problems: string[];
  notes: string[];
  tables: number;
  columns: number;
  objects: number;
}

/** An information_schema.columns row, as selected below. */
interface ColumnRow {
  table_name: string;
  column_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  is_generated: string;
}

/** A trigger, index or constraint row, as selected below. */
interface NamedObjectRow {
  table_name: string;
  name: string;
}

/** A table-name-only row, as selected below. */
interface TableRow {
  table_name: string;
}

/** A P20-07 control object (frozen). */
const control = (kind: ExpectedObjectKind, table: string, name: string, why: string): ExpectedObject =>
  Object.freeze({ kind, table, name, why });

/** The NOT NULL children of calibration_devices (migrations 0119 – 0122), and whether each refuses an ended facility. */
const P2007_CHILDREN: readonly (readonly [table: string, migration: string, open: boolean])[] = Object.freeze([
  ["calibration_records", "0119", true],
  ["certificates", "0120", true],
  ["maintenance_work_orders", "0121", true],
  ["iot_readings", "0122", false],
]);

const P2007_OBJECTS: readonly ExpectedObject[] = Object.freeze([
  control("index", "client_facilities", "client_facilities_one_self", "P20-07 / ADR-124 Am. 2: exactly one self facility per tenant (migration 0117)"),
  control("index", "client_facilities", "client_facilities_tenant_id_id_unique", "P20-07 / ADR-124 § 2: the composite-key target (tenant_id, id) (migration 0117)"),
  control("constraint", "client_facilities", "client_facilities_self_active", "P20-07 / ADR-124 Am. 2: a tenant's self facility is always active (migration 0117)"),
  control("trigger", "client_facilities", "client_facilities_identity_immutable", "P20-07 / ADR-124 Am. 2: a facility's id, tenant and self flag never change (migration 0117)"),
  control("trigger", "client_facility_moves", "client_facility_moves_append_only", "P20-07 / ADR-124 Am. 2: a device move only completes, never changes or disappears (migration 0117)"),
  control("trigger", "client_facility_moves", "client_facility_moves_no_truncate", "P20-07 / ADR-124 Am. 2: the move log cannot be truncated (migration 0117)"),
  control("trigger", "client_facility_moves", "client_facility_moves_complete_at_commit", "P20-07 / ADR-124 Am. 2: no transaction commits a move left in progress (migration 0117)"),
  control("trigger", "calibration_devices", "calibration_devices_facility_default", "P20-07 / ADR-124 Am. 3: a device written without a facility gets the self facility (migration 0118)"),
  control("trigger", "calibration_devices", "calibration_devices_facility_open", "P20-07 / ADR-124 Am. 2: no device is added to an ended facility (migration 0118)"),
  control("trigger", "calibration_devices", "calibration_devices_facility_guard", "P20-07 / ADR-124 Am. 2 (AM-6): a device's facility changes only by an audited move (migration 0118)"),
  control("constraint", "calibration_devices", "calibration_devices_client_facility_fkey", "P20-07 / ADR-124 § 3: a device names a facility of its own tenant (migration 0118)"),
  ...P2007_CHILDREN.flatMap(([table, migration, open]) => [
    control("trigger", table, `${table}_facility_default`, `P20-07 / ADR-124 Am. 3: a row written without a facility takes its device's (migration ${migration})`),
    ...(open ? [control("trigger", table, `${table}_facility_open`, `P20-07 / ADR-124 Am. 2: no row is added to an ended facility (migration ${migration})`)] : []),
    control("trigger", table, `${table}_facility_guard`, `P20-07 / ADR-124 Am. 2 (AM-6): the facility changes only by a device move (migration ${migration})`),
    control("constraint", table, `${table}_device_facility_fkey`, `P20-07 / ADR-124 Am. 2: a row's facility is its device's, and follows a move (migration ${migration})`),
  ]),
  control("constraint", "certificates", "certificates_record_facility_fkey", "P20-07 / ADR-124 Am. 2: a certificate's record is in its facility, checked at commit (migration 0120)"),
  control("trigger", "attachments", "attachments_facility_default", "P20-07 / ADR-124 Am. 3: a linked file takes its record's facility (migration 0123)"),
  control("trigger", "attachments", "attachments_facility_open", "P20-07 / ADR-124 Am. 2: no file is added to an ended facility (migration 0123)"),
  control("trigger", "attachments", "attachments_facility_guard", "P20-07 / ADR-124 Am. 2 (AM-6): a file's facility changes only by a device move (migration 0123)"),
  control("trigger", "attachments", "attachments_facility_matches_resource", "P20-07 / AM-7: a file's facility equals its record's, at commit (migration 0123)"),
  control("constraint", "attachments", "attachments_facility_kind", "P20-07 / ADR-124 § 3: a file has a facility exactly when linked to a facility-scoped record (migration 0123)"),
  ...["calibration_devices", "calibration_records", "certificates", "maintenance_work_orders"].map((table) =>
    control("trigger", table, `${table}_attachments_follow_facility`, "P20-07 / AM-7: a record whose facility changed leaves no file behind, at commit (migration 0123)"),
  ),
  control("trigger", "non_conformances", "non_conformances_facility_default", "P20-07 / ADR-124 Am. 3: an NC takes its device's facility, none without a device (migration 0123)"),
  control("trigger", "non_conformances", "non_conformances_facility_open", "P20-07 / ADR-124 Am. 2: no NC is added to an ended facility (migration 0123)"),
  control("trigger", "non_conformances", "non_conformances_facility_guard", "P20-07 / ADR-124 Am. 2 (AM-6): an NC's facility changes only by a device move (migration 0123)"),
  control("constraint", "non_conformances", "non_conformances_facility_follows_device", "P20-07 / ADR-124 § 3: an NC has a facility exactly when it has a device (migration 0123)"),
  control("constraint", "non_conformances", "non_conformances_device_facility_fkey", "P20-07 / ADR-124 Am. 2: an NC's facility is its device's (migration 0123)"),
  control("constraint", "warehouses", "warehouses_client_facility_fkey", "P20-07 / ADR-124 § 3: a room names a facility of its own tenant (migration 0123)"),
  control("constraint", "users", "users_client_facility_fkey", "P20-07 / ADR-124 § 4: a bound user names a facility of its own tenant (migration 0123)"),
  control("trigger", "users", "users_facility_binding_guard", "P20-07 / ADR-124 Am. 2 § 6: a binding changes only by the binding operation (migration 0123)"),
  control("trigger", "users", "users_facility_bound_role", "P20-07 / ADR-124 § 4: a bound user holds one of the four facility roles (migration 0123)"),
]);

/**
 * P20-04 / P20-05 (migrations 0126, 0127; ADR-126 § 5, Am. 1 § 3, Am. 2 § 5): the IPM aggregate's
 * controls — the composite keys that keep a session in its device's facility and a result or
 * signature in its session's, the facility triggers, the invariants' partial unique indexes, the
 * CHECKs a submit relies on, and the immutability triggers (every role, each with the device-move
 * exception). A skipped migration must not pass silently.
 */
const P2004_OBJECTS: readonly ExpectedObject[] = Object.freeze([
  ...(["inspection_sessions", "inspection_results", "inspection_session_signatures"] as const).flatMap((table) => [
    control("trigger", table, `${table}_facility_default`, "P20-04 / ADR-124 Am. 3: a row takes its device's or session's facility (migration 0126)"),
    control("trigger", table, `${table}_facility_open`, "P20-04 / ADR-124 Am. 2: no row is added to an ended facility (migration 0126)"),
    control("trigger", table, `${table}_facility_guard`, "P20-04 / ADR-124 Am. 2 (AM-6): the facility changes only by a device move (migration 0126)"),
  ]),
  control("constraint", "inspection_sessions", "inspection_sessions_device_facility_fkey", "P20-04 / ADR-126 § 1: a session's facility is its device's, and follows a move (migration 0126)"),
  control("constraint", "inspection_results", "inspection_results_session_facility_fkey", "P20-04 / ADR-126 § 1: a result's facility is its session's (migration 0126)"),
  control("constraint", "inspection_session_signatures", "inspection_session_signatures_session_facility_fkey", "P20-04 / ADR-126 Am. 2 § 5: a signature's facility is its session's (migration 0126)"),
  control("index", "inspection_sessions", "inspection_sessions_tenant_facility_id_unique", "P20-04 / P19-04 § 5.1: the composite-key target of results and signatures (migration 0126)"),
  control("index", "inspection_sessions", "inspection_sessions_visit_unique", "P20-04 / ADR-126 § 4: one visit number per device root (migration 0126)"),
  control("index", "inspection_sessions", "inspection_sessions_linear_chain", "P20-04 / ADR-126 § 3: a session is corrected at most once — the chain is a line (migration 0126)"),
  control("index", "inspection_sessions", "inspection_sessions_one_root_draft", "P20-04 / ADR-126 Am. 1 § 7: one open root draft per device and technician (migration 0126)"),
  control("index", "inspection_sessions", "inspection_sessions_client_ref_unique", "P20-04 / ADR-126 Am. 1 § 1: a client_ref is unique per creator (migration 0126)"),
  control("index", "inspection_sessions", "inspection_sessions_report_number_unique", "P20-04 / ADR-126 Am. 2 § 2: a report number is unique per tenant (migration 0126)"),
  control("index", "inspection_results", "inspection_results_one_per_item", "P20-04 / ADR-126 § 1: one result per template item of a session (migration 0126)"),
  control("index", "inspection_session_signatures", "inspection_session_signatures_session_kind_unique", "P20-04 / ADR-126 Am. 2 § 5: one signature per kind per session (migration 0126)"),
  control("index", "idempotency_keys", "idempotency_keys_user_key_unique", "P20-04 / ADR-127 § 7: an idempotency key is unique per tenant and user (migration 0126)"),
  control("constraint", "inspection_sessions", "inspection_sessions_issued_fields", "P20-04 / ADR-126 Am. 1–2: a submitted or voided session carries its number, snapshots and report fields (migration 0126)"),
  control("constraint", "idempotency_keys", "idempotency_keys_one_principal", "P20-04 / ADR-127 § 7: a key names exactly one caller, a user or an API key (migration 0126)"),
  control("trigger", "inspection_sessions", "inspection_sessions_append_only", "P20-05 / ADR-126 § 5: after the draft only the lifecycle changes, each once; never deleted (migration 0127)"),
  control("trigger", "inspection_sessions", "inspection_sessions_no_truncate", "P20-05 / ADR-126 § 5: inspection_sessions cannot be truncated (migration 0127)"),
  control("trigger", "inspection_sessions", "inspection_sessions_correction_same_device", "P20-05 / P19-02 § 5.3: a correction stays on its original's device (migration 0127)"),
  control("trigger", "inspection_results", "inspection_results_draft_only", "P20-05 / ADR-126 § 5: results are written only while their session is a draft (migration 0127)"),
  control("trigger", "inspection_results", "inspection_results_no_truncate", "P20-05 / ADR-126 § 5: inspection_results cannot be truncated (migration 0127)"),
  control("trigger", "inspection_session_signatures", "inspection_session_signatures_append_only", "P20-05 / ADR-126 Am. 2 § 5: a signature is never changed or deleted, and binds the issued hash (migration 0127)"),
  control("trigger", "inspection_session_signatures", "inspection_session_signatures_no_truncate", "P20-05 / ADR-126 Am. 2 § 5: signatures cannot be truncated (migration 0127)"),
]);

/**
 * Objects that live only in migrations and carry a control. Each is checked
 * by name on its table.
 */
const EXPECTED_OBJECTS: readonly ExpectedObject[] = Object.freeze([
  Object.freeze({
    kind: "trigger",
    table: "calibration_records",
    name: "calibration_records_append_only",
    why: "P6-03: calibration records are append-only (migration 0057)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "calibration_records",
    name: "calibration_records_no_truncate",
    why: "P6-03: calibration records cannot be truncated (migration 0057)",
  }),
  Object.freeze({
    kind: "constraint",
    table: "calibration_records",
    name: "calibration_records_void_reason_check",
    why: "P6-03: a voided calibration record names a reason (migration 0057)",
  }),
  // UD-9 (P20-07, migration 0118): 0026's per-tenant serial index became per FACILITY — identical
  // for a tenant with one facility.
  Object.freeze({
    kind: "index",
    table: "calibration_devices",
    name: "calibration_devices_tenant_facility_serial_unique",
    why: "P6-06 / ADR-049, UD-9: serial numbers are unique per client facility (migration 0118, replacing 0026's per-tenant index)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "calibration_devices",
    name: "calibration_devices_retired_terminal",
    why: "Q-02 / ADR-084: a retired device leaves 'retired' only by audited reinstatement (migration 0089)",
  }),
  Object.freeze({
    kind: "constraint",
    table: "stock_adjustments",
    name: "stock_adjustments_reason_not_blank",
    why: "P6-09: every stock adjustment names a reason (migration 0059)",
  }),
  // Q-51 (migration 0105): a row names exactly one actor, a user or an API key.
  Object.freeze({
    kind: "constraint",
    table: "calibration_records",
    name: "calibration_records_actor_exactly_one",
    why: "Q-51: a calibration record names exactly one of performed_by / api_key_id (migration 0105)",
  }),
  Object.freeze({
    kind: "constraint",
    table: "stock_adjustments",
    name: "stock_adjustments_actor_exactly_one",
    why: "Q-51: a stock adjustment names exactly one of adjusted_by / api_key_id (migration 0105)",
  }),
  Object.freeze({
    kind: "constraint",
    table: "stock_transfers",
    name: "stock_transfers_requester_exactly_one",
    why: "Q-51: a stock transfer names exactly one requester, requested_by or api_key_id (migration 0105)",
  }),
  // 0063 skips (by design) when `users` is absent; a skip that happened must
  // not pass silently, because sign-in assumes one account per identifier.
  Object.freeze({
    kind: "index",
    table: "users",
    name: "users_email_lower_unique",
    why: "D-06 / ADR-063: one account per email, whatever its case (migration 0063)",
  }),
  Object.freeze({
    kind: "index",
    table: "users",
    name: "users_username_lower_unique",
    why: "D-06 / ADR-063: one account per username, whatever its case (migration 0063)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "audit_logs",
    name: "audit_logs_append_only",
    why: "Q-34 / ADR-095: audit rows are never deleted, only masked (migration 0091)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "audit_logs",
    name: "audit_logs_no_truncate",
    why: "Q-34 / ADR-095: the audit trail cannot be truncated (migration 0091)",
  }),
  // P20-01 / P20-03 (migrations 0111, 0112; ADR-125 and its Amendment 1): the inspection
  // catalogue's controls — the no-delete and immutability triggers, and the invariants'
  // partial unique indexes and CHECKs. A skipped migration must not pass silently.
  Object.freeze({
    kind: "trigger",
    table: "device_types",
    name: "device_types_no_delete",
    why: "P20-01 / ADR-125 Am. 1: no device type is deleted, for any role (migration 0111)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "device_types",
    name: "device_types_no_truncate",
    why: "P20-01 / ADR-125 Am. 1: device_types cannot be truncated (migration 0111)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "inspection_item_definitions",
    name: "inspection_item_definitions_no_delete",
    why: "P20-03 / ADR-125 Am. 1: no library definition is deleted (migration 0112)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "inspection_item_definitions",
    name: "inspection_item_definitions_no_truncate",
    why: "P20-03 / ADR-125 Am. 1: the item library cannot be truncated (migration 0112)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "inspection_templates",
    name: "inspection_templates_no_delete",
    why: "P20-03 / ADR-125 Am. 1: no template is deleted (migration 0112)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "inspection_templates",
    name: "inspection_templates_no_truncate",
    why: "P20-03 / ADR-125 Am. 1: inspection_templates cannot be truncated (migration 0112)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "inspection_template_proposals",
    name: "inspection_template_proposals_no_delete",
    why: "P20-03 / ADR-125 § 5: a proposal is withdrawn, never deleted (migration 0112)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "inspection_template_proposals",
    name: "inspection_template_proposals_no_truncate",
    why: "P20-03 / ADR-125 § 5: proposals cannot be truncated (migration 0112)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "inspection_template_versions",
    name: "inspection_template_versions_immutable",
    why: "P20-03 / ADR-125 § 2: a published version is immutable, retired and discarded are final, none is deleted (migration 0112)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "inspection_template_versions",
    name: "inspection_template_versions_no_truncate",
    why: "P20-03 / ADR-125 § 2: template versions cannot be truncated (migration 0112)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "inspection_template_items",
    name: "inspection_template_items_draft_only",
    why: "P20-03 / ADR-125 § 2: only a draft's items are written or deleted (migration 0112)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "inspection_template_items",
    name: "inspection_template_items_no_truncate",
    why: "P20-03 / ADR-125 § 2: template items cannot be truncated (migration 0112)",
  }),
  Object.freeze({
    kind: "index",
    table: "device_types",
    name: "device_types_name_unique",
    why: "P20-01 / ADR-125 Am. 1: one device type per name, whatever its case or status (migration 0111)",
  }),
  Object.freeze({
    kind: "index",
    table: "inspection_templates",
    name: "inspection_templates_one_base",
    why: "P20-03 / ADR-125 § 1: exactly one base template (migration 0112)",
  }),
  Object.freeze({
    kind: "index",
    table: "inspection_template_versions",
    name: "inspection_template_versions_one_published",
    why: "P20-03 / ADR-125 § 2: exactly one published version per template (migration 0112)",
  }),
  Object.freeze({
    kind: "index",
    table: "inspection_template_versions",
    name: "inspection_template_versions_one_draft",
    why: "P20-03 / ADR-125 Am. 1: at most one open draft per template (migration 0112)",
  }),
  Object.freeze({
    kind: "constraint",
    table: "inspection_template_versions",
    name: "inspection_template_versions_published_complete",
    why: "P20-03 / ADR-125 § 2: a published version carries its number, hash, note and publication (migration 0112)",
  }),
  Object.freeze({
    kind: "constraint",
    table: "inspection_template_versions",
    name: "inspection_template_versions_publisher_exactly_one",
    why: "P20-03 / ADR-125 Am. 1: a published version names exactly one publisher, a user or a system actor (migration 0112)",
  }),
  // P20-07 (migrations 0117 – 0123; ADR-124 Am. 2, Am. 3): the client-facility dimension's controls —
  // one self facility per tenant, the facility column immutable outside a move, the insert default
  // every existing create path relies on, no insert into an ended facility, the composite keys that
  // keep a child in its device's facility, the AM-7 attachment triggers, the user-binding triggers.
  ...P2007_OBJECTS,
  ...P2004_OBJECTS,
]);

const TAG = "[schema-verify]";

/**
 * @param {object} model - a Sequelize model
 * @returns {string} its unqualified table name
 */
const tableNameOf = (model: SchemaModel): string => {
  const name = model.getTableName();
  return typeof name === "string" ? name : name.tableName;
};

/**
 * @param {object} attribute - a rawAttributes entry
 * @returns {boolean} true when the attribute has no column (DataTypes.VIRTUAL)
 */
const isVirtual = (attribute: SchemaModelAttribute): boolean => attribute.type?.key === "VIRTUAL";

/**
 * @param {object} sequelize - the Sequelize instance whose models to check
 * @returns {Promise<{problems: string[], notes: string[], tables: number, columns: number, objects: number}>}
 */
// P9-07: every catalog read goes through the bind-only helper — the same query() calls ({ type: "SELECT" }).
const verifySchema = async (sequelize: SchemaSequelize): Promise<SchemaVerifyResult> => {
  const columnRows = await sql<ColumnRow>(sequelize, `SELECT table_name, column_name, is_nullable, column_default, is_identity, is_generated
       FROM information_schema.columns
      WHERE table_schema = current_schema()`);
  const triggerRows = await sql<NamedObjectRow>(sequelize, `SELECT c.relname AS table_name, t.tgname AS name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND NOT t.tgisinternal`);
  const indexRows = await sql<NamedObjectRow>(sequelize, `SELECT tablename AS table_name, indexname AS name
       FROM pg_indexes WHERE schemaname = current_schema()`);
  const constraintRows = await sql<NamedObjectRow>(sequelize, `SELECT c.relname AS table_name, k.conname AS name
       FROM pg_constraint k
       JOIN pg_class c ON c.oid = k.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()`);

  /** table -> column -> row */
  const actual = new Map<string, Map<string, ColumnRow>>();
  for (const row of columnRows) {
    let byColumn = actual.get(row.table_name);
    if (!byColumn) {
      byColumn = new Map<string, ColumnRow>();
      actual.set(row.table_name, byColumn);
    }
    byColumn.set(row.column_name, row);
  }

  const problems: string[] = [];
  const notes: string[] = [];
  let tables = 0;
  let columns = 0;

  const models = Object.values(sequelize.models).sort((a, b) =>
    tableNameOf(a).localeCompare(tableNameOf(b)),
  );
  for (const model of models) {
    const table = tableNameOf(model);
    const present = actual.get(table);
    if (!present) {
      problems.push(`table ${table} (model ${model.name}) does not exist`);
      continue;
    }
    tables += 1;
    const declared = new Set<string>();
    for (const [attributeName, attribute] of Object.entries(model.rawAttributes)) {
      if (isVirtual(attribute)) {
        continue;
      }
      // `||`: an empty `field` means the attribute name, as before.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as-built (ADR-038 rule 3)
      const field = attribute.field || attributeName;
      declared.add(field);
      columns += 1;
      if (!present.has(field)) {
        problems.push(
          `column ${table}.${field} (model ${model.name}.${attributeName}) does not exist — ` +
            "a migration that should have added it did nothing",
        );
      }
    }
    for (const [field, row] of present) {
      if (declared.has(field)) {
        continue;
      }
      const required =
        row.is_nullable === "NO" &&
        row.column_default === null &&
        row.is_identity !== "YES" &&
        row.is_generated !== "ALWAYS";
      if (required) {
        problems.push(
          `column ${table}.${field} is NOT NULL with no default and model ${model.name} does not ` +
            "declare it — every insert through the model will fail",
        );
      } else {
        notes.push(`column ${table}.${field} is not declared by model ${model.name}`);
      }
    }
  }

  // A-242 / ADR-029: no table uses row level security. RLS left ENABLED with
  // no policy denies every row to any role that is not a superuser — the
  // application role included — while the owner-superuser never notices.
  const rlsRows = await sql<TableRow>(sequelize, `SELECT c.relname AS table_name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relrowsecurity`);
  for (const row of rlsRows) {
    problems.push(
      `row level security is enabled on ${row.table_name} — ADR-029 removed RLS, and with no policy it ` +
        "hides every row from the application role",
    );
  }

  const has = (rows: readonly NamedObjectRow[], table: string, name: string): boolean => rows.some((r) => r.table_name === table && r.name === name);
  for (const object of EXPECTED_OBJECTS) {
    const rows = { trigger: triggerRows, index: indexRows, constraint: constraintRows }[object.kind];
    if (!has(rows, object.table, object.name)) {
      problems.push(`${object.kind} ${object.name} on ${object.table} does not exist — ${object.why}`);
    }
  }

  return { problems, notes, tables, columns, objects: EXPECTED_OBJECTS.length };
};

/**
 * Verify and act on the result: log, and THROW on a problem unless
 * `mode === "warn"`.
 *
 * @param {object} options
 * @param {object} options.sequelize - the Sequelize instance
 * @param {object} options.logger - { info, warn, error }
 * @param {string} [options.mode] - process.env.SCHEMA_VERIFY; "warn" logs and continues
 * @returns {Promise<object>} the verifySchema() result
 */
const assertSchemaMatchesModels = async ({ sequelize, logger, mode = env("SCHEMA_VERIFY") }: AssertSchemaOptions): Promise<SchemaVerifyResult> => {
  const result = await verifySchema(sequelize);
  for (const note of result.notes) {
    logger.info(`${TAG} note: ${note}`);
  }
  if (result.problems.length === 0) {
    logger.info(
      `${TAG} OK: ${String(result.tables)} tables, ${String(result.columns)} columns and ${String(result.objects)} ` +
        "control objects match the models",
    );
    return result;
  }
  for (const problem of result.problems) {
    logger.error(`${TAG} MISMATCH: ${problem}`);
  }
  const summary =
    `${TAG} FAILED: ${String(result.problems.length)} mismatch(es) between the models and the database. ` +
    "The migration log is not evidence (PR-5); fix the schema, then restart.";
  if (mode === "warn") {
    logger.error(`${summary} Continuing ONLY because SCHEMA_VERIFY=warn.`);
    return result;
  }
  throw new Error(`${summary}\n  ${result.problems.join("\n  ")}`);
};

export { verifySchema, assertSchemaMatchesModels, EXPECTED_OBJECTS, TAG };
