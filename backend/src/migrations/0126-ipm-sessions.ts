/**
 * Migration 0126 — the IPM aggregate's tables: `inspection_sessions`, `inspection_results`,
 * `inspection_session_signatures`, `idempotency_keys` (P20-04; ADR-126 and its Amendments 1–2,
 * ADR-127 § 7; spec MEMORY/specs/P19-02-ipm-session-aggregate.md § 4, § 5.3, § 5.4, § 9.1 and
 * MEMORY/specs/P19-06-ipm-report-document.md § 4.1 – § 4.2). The immutability triggers are 0127's
 * (P20-05).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. The four tables (with their ENUM types, `enum_<table>_<column>`, Sequelize's names), each
 *     unless it exists — db.sync() runs BEFORE the migrations at boot and creates them from the
 *     models on a database that has never seen them, so on that path only 2–6 run. None is
 *     paranoid or has a defaultScope (G-S4). `client_facility_id` is created nullable, as the
 *     models declare it (ADR-124 Am. 3), and set NOT NULL here on both paths; `performed_at`,
 *     `received_at` and `signed_at` get the server-side default `now()` (DataTypes.NOW is
 *     Sequelize's, never a column default).
 *  2. CHECKs (sync never creates one) — spec § 4.1's eleven on sessions plus the report-hash
 *     shape; the ad-hoc rules on results; the signature's kind ⇔ meaning and hash shape; exactly
 *     one principal, the completion pair, the expiry and the hash shapes on idempotency keys.
 *  3. Indexes, every one here and none on a model (ADR-100 Am. 3): the composite-key target
 *     `(tenant_id, client_facility_id, id)`; the invariants' partial UNIQUE indexes — one visit
 *     number per device root, a linear correction chain, one open root draft per creator and
 *     device, `client_ref` per creator, `legacy_key` / `report_number` per tenant, the random
 *     `verification_token` (global by ADR-126 Am. 2 § 3: the public verification resolves it
 *     without a tenant; random, so no oracle — ADR-100); one result per template item; one
 *     signature per kind; one key per caller; the list orders and the effective-session partial
 *     index; a leading index on every foreign key (D-20).
 *  4. The composite keys `(tenant_id, client_facility_id, device_id)` → calibration_devices and
 *     `(tenant_id, client_facility_id, session_id)` → inspection_sessions, ON UPDATE CASCADE (a
 *     device move carries every session, result and signature) ON DELETE RESTRICT.
 *  5. 0117's `facility_insert_default()` and `facility_column_guard()` are REPLACED with a
 *     `result` branch (spec § 5.3, G-S7): a result or signature takes its session's facility, and
 *     its facility column changes only under a move of its session's device. Every other branch
 *     is 0117's text, byte for byte (tests/migrations/0126 proves it by removing the branch).
 *     Then the facility triggers, ENABLE ALWAYS: sessions `child` (from the device), results and
 *     signatures `result` (from the session) — default, open (no insert into an ended
 *     facility), guard.
 *  6. Grants of the application role (spec § 5.4, G-S3; P19-06 § 4.2): sessions SELECT, INSERT,
 *     UPDATE; results SELECT, INSERT, UPDATE, DELETE (a draft's results are replaced wholesale);
 *     signatures SELECT, INSERT; idempotency keys SELECT, INSERT, UPDATE, DELETE (the purge). No
 *     TRUNCATE anywhere. The triggers of 0127 bind every role, the owner too.
 *
 * Throws, never skips, when a prerequisite is absent (PR-5): the tables it references, 0117's
 * functions, 0118's device facility column, the application role. No try/catch. Verify with
 * psql, not the log:
 *   \d inspection_sessions
 *   SELECT tgrelid::regclass, tgname, tgenabled FROM pg_trigger
 *    WHERE tgrelid::regclass::text LIKE 'inspection_session%' OR tgrelid = 'inspection_results'::regclass;
 *
 * `down` REFUSES while any of the four tables holds a row (it would destroy evidence or keys);
 * otherwise drops what `up` made and restores 0117's two functions exactly. Re-running 0117's
 * `up` ALONE after this migration would put the functions back without the `result` branch (the
 * shape of the 0057-after-0119 trap): never do that outside the manifest order.
 */
import { DataTypes, type ModelAttributeColumnOptions, type QueryInterface, type Sequelize, type Transaction } from "sequelize";
import {
  INSPECTION_CLEANLINESS,
  INSPECTION_INPUT_KINDS,
  INSPECTION_OUTCOMES,
  INSPECTION_OUTCOME_SOURCES,
  INSPECTION_OVERALL_OUTCOMES,
  INSPECTION_RECOMMENDATIONS,
  INSPECTION_SECTION_RULES,
  INSPECTION_SECTIONS,
  INSPECTION_SIGNATURE_AUTH_METHODS,
  INSPECTION_SIGNATURE_KINDS,
  INSPECTION_SIGNATURE_MEANINGS,
} from "@callibrator/contracts/inspectionValues";
import { IDEMPOTENCY_KEY_STATUSES, INSPECTION_SESSION_STATUSES } from "@callibrator/contracts/states";
import {
  LOCK_TIMEOUT,
  appRoleName,
  columnExists,
  constraintNames,
  createAlwaysTrigger,
  requireFacilityFoundation,
  requireTables,
  roleExists,
  rows,
  run,
  sqlList,
  tableExists,
} from "./facilityMigration.shared";
import m0117 from "./0117-client-facilities";

const SESSIONS = "inspection_sessions";
const RESULTS = "inspection_results";
const SIGNATURES = "inspection_session_signatures";
const KEYS = "idempotency_keys";
/** In creation order; `down` drops them in reverse. */
const TABLES = Object.freeze([SESSIONS, RESULTS, SIGNATURES, KEYS]);
/** The tables that carry a client facility (the column is set NOT NULL on each). */
const FACILITY_TABLES = Object.freeze([SESSIONS, RESULTS, SIGNATURES]);

/** The ENUM types Sequelize names `enum_<table>_<column>` — what sync() and createTable() make. */
const ENUM_TYPES = Object.freeze([
  "enum_inspection_sessions_status",
  "enum_inspection_sessions_inspection_outcome",
  "enum_inspection_sessions_maintenance_outcome",
  "enum_inspection_sessions_recommendation",
  "enum_inspection_results_section",
  "enum_inspection_results_input_kind",
  "enum_inspection_results_outcome",
  "enum_inspection_results_cleanliness",
  "enum_inspection_results_computed_outcome",
  "enum_inspection_results_outcome_source",
  "enum_inspection_session_signatures_kind",
  "enum_inspection_session_signatures_meaning",
  "enum_inspection_session_signatures_auth_method",
  "enum_idempotency_keys_status",
]);

/** The sections whose rule allows ad-hoc rows (P19-01 § 5.1) — from the contract, not re-listed. */
const AD_HOC_SECTIONS = Object.freeze(
  Object.entries(INSPECTION_SECTION_RULES)
    .filter(([, rule]) => rule.adHoc)
    .map(([section]) => section),
);

const HEX_64 = "'^[0-9a-f]{64}$'";

/** CHECK name -> [table, predicate]. */
const CHECKS: Readonly<Record<string, readonly [table: string, predicate: string]>> = Object.freeze({
  inspection_sessions_version_or_import: [SESSIONS, "template_version_id IS NOT NULL OR legacy_key IS NOT NULL"],
  inspection_sessions_captured_actor: [SESSIONS, "legacy_key IS NOT NULL OR (created_by IS NOT NULL AND performed_by = created_by)"],
  inspection_sessions_submitter: [SESSIONS, "submitted_by IS NULL OR legacy_key IS NOT NULL OR submitted_by = created_by"],
  inspection_sessions_issued_fields: [
    SESSIONS,
    "status NOT IN ('submitted', 'voided') OR (submitted_at IS NOT NULL AND visit_number IS NOT NULL AND performer_snapshot IS NOT NULL " +
      "AND device_snapshot IS NOT NULL AND facility_snapshot IS NOT NULL AND report_number IS NOT NULL AND verification_token IS NOT NULL " +
      "AND report_content_hash IS NOT NULL AND report_hash_scheme IS NOT NULL AND issuer_snapshot IS NOT NULL)",
  ],
  inspection_sessions_captured_outcomes: [
    SESSIONS,
    "legacy_key IS NOT NULL OR status NOT IN ('submitted', 'voided') " +
      "OR (inspection_outcome IS NOT NULL AND maintenance_outcome IS NOT NULL AND recommendation IS NOT NULL)",
  ],
  inspection_sessions_correction_reason: [
    SESSIONS,
    "(supersedes_id IS NULL) = (correction_reason IS NULL) AND supersedes_id IS DISTINCT FROM id",
  ],
  inspection_sessions_superseded_pair: [
    SESSIONS,
    "(superseded_by_id IS NULL) = (superseded_at IS NULL) AND (superseded_by_id IS NULL OR status = 'submitted')",
  ],
  inspection_sessions_void_fields: [
    SESSIONS,
    "(status = 'voided') = (void_reason IS NOT NULL AND voided_by IS NOT NULL AND voided_at IS NOT NULL)",
  ],
  inspection_sessions_discard_fields: [SESSIONS, "(status = 'discarded') = (discarded_by IS NOT NULL AND discarded_at IS NOT NULL)"],
  inspection_sessions_visit_positive: [SESSIONS, "visit_number IS NULL OR visit_number >= 1"],
  inspection_sessions_text_lengths: [
    SESSIONS,
    "(correction_reason IS NULL OR char_length(btrim(correction_reason)) BETWEEN 3 AND 2000) " +
      "AND (void_reason IS NULL OR char_length(btrim(void_reason)) BETWEEN 3 AND 2000) " +
      "AND (notes IS NULL OR char_length(notes) <= 4000)",
  ],
  inspection_sessions_report_hash_shape: [SESSIONS, `report_content_hash IS NULL OR report_content_hash ~ ${HEX_64}`],
  inspection_results_ad_hoc_no_item: [RESULTS, "NOT is_ad_hoc OR template_item_id IS NULL"],
  inspection_results_ad_hoc_section: [RESULTS, `NOT is_ad_hoc OR section IN (${sqlList(AD_HOC_SECTIONS)})`],
  inspection_session_signatures_meaning: [SIGNATURES, "(kind = 'performer') = (meaning = 'authorship')"],
  inspection_session_signatures_hash_shape: [SIGNATURES, `document_hash ~ ${HEX_64}`],
  idempotency_keys_one_principal: [KEYS, "num_nonnulls(user_id, api_key_id) = 1"],
  idempotency_keys_completed: [
    KEYS,
    "(status = 'completed') = (completed_at IS NOT NULL) AND (status <> 'completed' OR response_status IS NOT NULL)",
  ],
  idempotency_keys_expiry: [KEYS, "expires_at > created_at"],
  idempotency_keys_hash_shape: [KEYS, `request_hash ~ ${HEX_64} AND scope_fingerprint ~ ${HEX_64}`],
});

/** The composite keys (name -> [table, SQL]): the move cascades along them (ADR-124 Am. 2 § 2). */
const FKS: Readonly<Record<string, readonly [table: string, sql: string]>> = Object.freeze({
  inspection_sessions_device_facility_fkey: [
    SESSIONS,
    `ALTER TABLE ${SESSIONS} ADD CONSTRAINT inspection_sessions_device_facility_fkey FOREIGN KEY (tenant_id, client_facility_id, device_id) ` +
      "REFERENCES calibration_devices (tenant_id, client_facility_id, id) ON UPDATE CASCADE ON DELETE RESTRICT",
  ],
  inspection_results_session_facility_fkey: [
    RESULTS,
    `ALTER TABLE ${RESULTS} ADD CONSTRAINT inspection_results_session_facility_fkey FOREIGN KEY (tenant_id, client_facility_id, session_id) ` +
      `REFERENCES ${SESSIONS} (tenant_id, client_facility_id, id) ON UPDATE CASCADE ON DELETE RESTRICT`,
  ],
  inspection_session_signatures_session_facility_fkey: [
    SIGNATURES,
    `ALTER TABLE ${SIGNATURES} ADD CONSTRAINT inspection_session_signatures_session_facility_fkey ` +
      `FOREIGN KEY (tenant_id, client_facility_id, session_id) REFERENCES ${SESSIONS} (tenant_id, client_facility_id, id) ` +
      "ON UPDATE CASCADE ON DELETE RESTRICT",
  ],
});

const INDEX_SQL = Object.freeze([
  // inspection_sessions — the composite-key target, the invariants, the reads (spec § 4.1).
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_sessions_tenant_facility_id_unique ON ${SESSIONS} (tenant_id, client_facility_id, id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_sessions_visit_unique ON ${SESSIONS} (tenant_id, device_id, visit_number) ` +
    "WHERE supersedes_id IS NULL AND status IN ('submitted', 'voided')",
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_sessions_linear_chain ON ${SESSIONS} (tenant_id, supersedes_id) ` +
    "WHERE supersedes_id IS NOT NULL AND status <> 'discarded'",
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_sessions_one_root_draft ON ${SESSIONS} (tenant_id, device_id, created_by) ` +
    "WHERE status = 'draft' AND supersedes_id IS NULL",
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_sessions_client_ref_unique ON ${SESSIONS} (tenant_id, created_by, client_ref) WHERE client_ref IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_sessions_legacy_key_unique ON ${SESSIONS} (tenant_id, legacy_key) WHERE legacy_key IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_sessions_report_number_unique ON ${SESSIONS} (tenant_id, report_number) WHERE report_number IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_sessions_verification_token_unique ON ${SESSIONS} (verification_token) WHERE verification_token IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_tenant_facility_device ON ${SESSIONS} (tenant_id, client_facility_id, device_id)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_device_history ON ${SESSIONS} (tenant_id, device_id, performed_at DESC, id)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_effective_device ON ${SESSIONS} (tenant_id, device_id, performed_at DESC, id) ` +
    "WHERE status = 'submitted' AND superseded_by_id IS NULL",
  `CREATE INDEX IF NOT EXISTS inspection_sessions_facility_performed ON ${SESSIONS} (tenant_id, client_facility_id, performed_at DESC, id)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_status_performed ON ${SESSIONS} (tenant_id, status, performed_at DESC, id)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_template_version_id ON ${SESSIONS} (template_version_id)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_supersedes_id ON ${SESSIONS} (supersedes_id)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_superseded_by_id ON ${SESSIONS} (superseded_by_id)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_created_by ON ${SESSIONS} (created_by)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_updated_by ON ${SESSIONS} (updated_by)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_performed_by ON ${SESSIONS} (performed_by)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_submitted_by ON ${SESSIONS} (submitted_by)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_voided_by ON ${SESSIONS} (voided_by)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_discarded_by ON ${SESSIONS} (discarded_by)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_location_id ON ${SESSIONS} (location_id)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_work_order_id ON ${SESSIONS} (work_order_id)`,
  `CREATE INDEX IF NOT EXISTS inspection_sessions_follow_up_work_order_id ON ${SESSIONS} (follow_up_work_order_id)`,
  // inspection_results (spec § 4.2). The read order (session, section, sort_order) is the unique
  // index itself: it is unique, so a trailing id would never break a tie.
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_results_one_per_item ON ${RESULTS} (session_id, template_item_id) WHERE template_item_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_results_section_order_unique ON ${RESULTS} (session_id, section, sort_order)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_results_legacy_unique ON ${RESULTS} (tenant_id, legacy_table, legacy_id) WHERE legacy_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS inspection_results_tenant_facility_session ON ${RESULTS} (tenant_id, client_facility_id, session_id)`,
  `CREATE INDEX IF NOT EXISTS inspection_results_template_item_id ON ${RESULTS} (template_item_id)`,
  `CREATE INDEX IF NOT EXISTS inspection_results_item_definition_created ON ${RESULTS} (item_definition_id, created_at)`,
  // inspection_session_signatures (P19-06 § 4.2).
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_session_signatures_session_kind_unique ON ${SIGNATURES} (session_id, kind)`,
  `CREATE INDEX IF NOT EXISTS inspection_session_signatures_tenant_facility_session ON ${SIGNATURES} (tenant_id, client_facility_id, session_id)`,
  `CREATE INDEX IF NOT EXISTS inspection_session_signatures_signer ON ${SIGNATURES} (signer_id, signed_at DESC, id)`,
  `CREATE INDEX IF NOT EXISTS inspection_session_signatures_tenant_kind_signed ON ${SIGNATURES} (tenant_id, kind, signed_at DESC, id)`,
  // idempotency_keys (spec § 9.1): one key per caller (NULLs are distinct: the other principal's rows never collide).
  `CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_user_key_unique ON ${KEYS} (tenant_id, user_id, key)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_api_key_key_unique ON ${KEYS} (tenant_id, api_key_id, key)`,
  `CREATE INDEX IF NOT EXISTS idempotency_keys_expires_at ON ${KEYS} (expires_at)`,
  `CREATE INDEX IF NOT EXISTS idempotency_keys_user_id ON ${KEYS} (user_id)`,
  `CREATE INDEX IF NOT EXISTS idempotency_keys_api_key_id ON ${KEYS} (api_key_id)`,
]);
/** Every index `up` creates, by name (for `down`). */
const INDEX_NAMES = Object.freeze(INDEX_SQL.map((statement) => (/INDEX IF NOT EXISTS (\w+) /.exec(statement) ?? ["", ""])[1]));

/** 0117's text of a function it defined. */
const m0117Function = (name: string): string => {
  const found = m0117.FUNCTIONS.find(([fn]) => fn === name);
  if (!found) {
    throw new Error(`0126: migration 0117 defines no function ${name}`);
  }
  return found[2];
};

/** The `result` branch of facility_insert_default (spec § 5.3), inserted before 0117's `nc` branch. */
const INSERT_DEFAULT_RESULT_BRANCH = `  ELSIF TG_ARGV[0] = 'result' THEN
    -- P20-04 (ADR-126 Am. 1 § 3): an IPM result or report signature takes its session's facility,
    -- in its own tenant. A value given explicitly is never replaced; the composite key checks it.
    IF NEW.client_facility_id IS NULL THEN
      SELECT s.client_facility_id INTO NEW.client_facility_id
        FROM ${SESSIONS} s WHERE s.id = NEW.session_id AND s.tenant_id = NEW.tenant_id;
    END IF;
`;
const INSERT_DEFAULT_ANCHOR = "  ELSIF TG_ARGV[0] = 'nc' AND NEW.device_id IS NULL THEN\n";

/** The `result` branch of facility_column_guard: the device is the session's. */
const COLUMN_GUARD_RESULT_BRANCH = `  ELSIF TG_ARGV[0] = 'result' THEN
    -- P20-04: an IPM result or signature follows its session; the device is the session's.
    SELECT s.device_id INTO v_device FROM ${SESSIONS} s WHERE s.id = NEW.session_id AND s.tenant_id = NEW.tenant_id;
`;
const COLUMN_GUARD_ANCHOR = "  ELSE\n    -- 'child' and 'nc': the row's own device.";

/** Insert `branch` before `anchor` in `text`, which must hold the anchor exactly once. */
const withBranch = (name: string, text: string, anchor: string, branch: string): string => {
  const at = text.indexOf(anchor);
  if (at < 0 || text.includes(anchor, at + 1)) {
    throw new Error(`0126: 0117's ${name}() does not hold its anchor exactly once`);
  }
  return text.slice(0, at) + branch + text.slice(at);
};

/** The two functions as this migration defines them: 0117's, plus the `result` branch. */
const FUNCTIONS: readonly (readonly [name: string, sql: string])[] = Object.freeze([
  [
    "facility_insert_default",
    withBranch("facility_insert_default", m0117Function("facility_insert_default"), INSERT_DEFAULT_ANCHOR, INSERT_DEFAULT_RESULT_BRANCH),
  ],
  [
    "facility_column_guard",
    withBranch("facility_column_guard", m0117Function("facility_column_guard"), COLUMN_GUARD_ANCHOR, COLUMN_GUARD_RESULT_BRANCH),
  ],
]);

/** Every trigger `up` creates: [table, name, definition after CREATE]. */
const TRIGGERS: readonly (readonly [table: string, name: string, definition: string])[] = Object.freeze(
  ([[SESSIONS, "child"], [RESULTS, "result"], [SIGNATURES, "result"]] as const).flatMap(([table, kind]): (readonly [string, string, string])[] => [
    [
      table,
      `${table}_facility_default`,
      `TRIGGER ${table}_facility_default BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION facility_insert_default('${kind}')`,
    ],
    [
      table,
      `${table}_facility_open`,
      `TRIGGER ${table}_facility_open BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION facility_accepts_inserts()`,
    ],
    [
      table,
      `${table}_facility_guard`,
      `TRIGGER ${table}_facility_guard BEFORE UPDATE OF client_facility_id ON ${table} FOR EACH ROW EXECUTE FUNCTION facility_column_guard('${kind}')`,
    ],
  ]),
);

/**
 * Server-side defaults (spec § 4.1: `received_at` is the server's time of the create; `performed_at`
 * defaults to it; a signature's `signed_at` is the server's clock — P19-06 § 4.2). The models'
 * DataTypes.NOW is applied by Sequelize only, never written as a column default, so a raw-SQL
 * writer (the ETL, a script) would otherwise have none.
 */
const DEFAULTS: readonly (readonly [table: string, column: string])[] = Object.freeze([
  [SESSIONS, "performed_at"],
  [SESSIONS, "received_at"],
  [SIGNATURES, "signed_at"],
]);

/** The application role's privileges (spec § 5.4): [table, granted, revoked]. */
const GRANTS: readonly (readonly [table: string, granted: string, revoked: string])[] = Object.freeze([
  [SESSIONS, "SELECT, INSERT, UPDATE", "DELETE, TRUNCATE"],
  [RESULTS, "SELECT, INSERT, UPDATE, DELETE", "TRUNCATE"],
  [SIGNATURES, "SELECT, INSERT", "UPDATE, DELETE, TRUNCATE"],
  [KEYS, "SELECT, INSERT, UPDATE, DELETE", "TRUNCATE"],
]);

type Columns = Record<string, ModelAttributeColumnOptions>;

const fk = (table: string, onDelete: "RESTRICT" | "SET NULL" = "RESTRICT", allowNull = true): ModelAttributeColumnOptions => ({
  type: DataTypes.UUID,
  allowNull,
  references: { model: table, key: "id" },
  onDelete,
  onUpdate: "CASCADE",
});
const id = (): ModelAttributeColumnOptions => ({ type: DataTypes.UUID, primaryKey: true, allowNull: false });
const tenant = (): ModelAttributeColumnOptions => fk("tenants", "RESTRICT", false);
const text = (length?: number): ModelAttributeColumnOptions => ({
  type: length === undefined ? DataTypes.TEXT : DataTypes.STRING(length),
  allowNull: true,
});
const date = (allowNull = true): ModelAttributeColumnOptions => ({ type: DataTypes.DATE, allowNull });
const json = (allowNull = true): ModelAttributeColumnOptions => ({ type: DataTypes.JSONB, allowNull });
const enumOf = (values: readonly string[], allowNull = true): ModelAttributeColumnOptions => ({ type: DataTypes.ENUM(...values), allowNull });
const flag = (): ModelAttributeColumnOptions => ({ type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
const decimal = (): ModelAttributeColumnOptions => ({ type: DataTypes.DECIMAL, allowNull: true });

/** The four tables as the models declare them (tests/migrations/0126 holds them equal), by table. */
const TABLE_COLUMNS: Readonly<Record<string, Columns>> = Object.freeze({
  [SESSIONS]: {
    id: id(),
    tenant_id: tenant(),
    client_facility_id: { type: DataTypes.UUID, allowNull: true },
    device_id: { type: DataTypes.UUID, allowNull: false },
    template_version_id: fk("inspection_template_versions"),
    status: { ...enumOf(INSPECTION_SESSION_STATUSES, false), defaultValue: "draft" },
    revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    supersedes_id: fk(SESSIONS),
    correction_reason: text(),
    superseded_by_id: fk(SESSIONS),
    superseded_at: date(),
    performed_at: { ...date(false), defaultValue: DataTypes.NOW },
    received_at: { ...date(false), defaultValue: DataTypes.NOW },
    captured_offline: flag(),
    client_captured_at: date(),
    client_ref: { type: DataTypes.UUID, allowNull: true },
    created_by: fk("users"),
    updated_by: fk("users"),
    performed_by: fk("users"),
    submitted_at: date(),
    submitted_by: fk("users"),
    performer_snapshot: json(),
    device_snapshot: json(),
    facility_snapshot: json(),
    room_snapshot: text(255),
    floor_snapshot: text(50),
    location_id: fk("warehouses", "SET NULL"),
    visit_number: { type: DataTypes.INTEGER, allowNull: true },
    legacy_visit_number: { type: DataTypes.SMALLINT, allowNull: true },
    inspection_outcome: enumOf(INSPECTION_OVERALL_OUTCOMES),
    maintenance_outcome: enumOf(INSPECTION_OVERALL_OUTCOMES),
    recommendation: enumOf(INSPECTION_RECOMMENDATIONS),
    notes: text(),
    work_order_id: fk("maintenance_work_orders"),
    follow_up_work_order_id: fk("maintenance_work_orders"),
    side_effects: json(),
    void_reason: text(),
    voided_by: fk("users"),
    voided_at: date(),
    discarded_by: fk("users"),
    discarded_at: date(),
    legacy_key: text(64),
    report_number: text(48),
    verification_token: text(64),
    report_content_hash: { type: DataTypes.CHAR(64), allowNull: true },
    report_hash_scheme: text(32),
    issuer_snapshot: json(),
    created_at: date(false),
    updated_at: date(false),
  },
  [RESULTS]: {
    id: id(),
    tenant_id: tenant(),
    client_facility_id: { type: DataTypes.UUID, allowNull: true },
    session_id: { type: DataTypes.UUID, allowNull: false },
    section: enumOf(INSPECTION_SECTIONS, false),
    input_kind: enumOf(INSPECTION_INPUT_KINDS, false),
    template_item_id: fk("inspection_template_items"),
    item_definition_id: fk("inspection_item_definitions"),
    is_ad_hoc: flag(),
    label_snapshot: { type: DataTypes.STRING(255), allowNull: false },
    unit: text(20),
    symbol: text(50),
    setting_text: text(50),
    reference_text: text(100),
    outcome: enumOf(INSPECTION_OUTCOMES),
    cleanliness: enumOf(INSPECTION_CLEANLINESS),
    measured_value: decimal(),
    measured_value_1: decimal(),
    measured_value_2: decimal(),
    text_value: text(500),
    raw_value: text(255),
    computed_outcome: enumOf(INSPECTION_OVERALL_OUTCOMES),
    outcome_source: enumOf(INSPECTION_OUTCOME_SOURCES),
    warn_flag: flag(),
    disagreement_flag: flag(),
    sort_order: { type: DataTypes.INTEGER, allowNull: false },
    legacy_table: text(64),
    legacy_id: { type: DataTypes.INTEGER, allowNull: true },
    created_at: date(false),
    updated_at: date(false),
  },
  [SIGNATURES]: {
    id: id(),
    tenant_id: tenant(),
    client_facility_id: { type: DataTypes.UUID, allowNull: true },
    session_id: { type: DataTypes.UUID, allowNull: false },
    kind: enumOf(INSPECTION_SIGNATURE_KINDS, false),
    signer_id: fk("users", "RESTRICT", false),
    signer_snapshot: json(false),
    meaning: enumOf(INSPECTION_SIGNATURE_MEANINGS, false),
    auth_method: enumOf(INSPECTION_SIGNATURE_AUTH_METHODS, false),
    document_hash: { type: DataTypes.CHAR(64), allowNull: false },
    signed_at: { ...date(false), defaultValue: DataTypes.NOW },
    ip_address: text(45),
    user_agent: text(500),
    created_at: date(false),
  },
  [KEYS]: {
    id: id(),
    tenant_id: tenant(),
    user_id: fk("users"),
    api_key_id: fk("api_keys"),
    key: { type: DataTypes.UUID, allowNull: false },
    route: { type: DataTypes.STRING(128), allowNull: false },
    request_hash: { type: DataTypes.CHAR(64), allowNull: false },
    scope_fingerprint: { type: DataTypes.CHAR(64), allowNull: false },
    status: { ...enumOf(IDEMPOTENCY_KEY_STATUSES, false), defaultValue: "in_flight" },
    response_status: { type: DataTypes.SMALLINT, allowNull: true },
    resource_type: text(64),
    resource_id: { type: DataTypes.UUID, allowNull: true },
    created_at: date(false),
    completed_at: date(),
    expires_at: date(false),
  },
});

/** The tables `up` needs before it starts (beyond 0117's facility foundation). */
const PREREQUISITES = Object.freeze([
  "tenants",
  "users",
  "api_keys",
  "warehouses",
  "calibration_devices",
  "maintenance_work_orders",
  "inspection_template_versions",
  "inspection_template_items",
  "inspection_item_definitions",
]);

const createMissingTables = async (context: QueryInterface, sequelize: Sequelize, transaction: Transaction): Promise<void> => {
  for (const table of TABLES) {
    if (!(await tableExists(sequelize, transaction, table))) {
      await context.createTable(table, TABLE_COLUMNS[table] ?? {}, { transaction });
    }
  }
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const role = appRoleName("0126");
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await requireTables(sequelize, transaction, "0126", PREREQUISITES);
    await requireFacilityFoundation(sequelize, transaction, "0126");
    if (!(await columnExists(sequelize, transaction, "calibration_devices", "client_facility_id"))) {
      throw new Error("0126: calibration_devices.client_facility_id does not exist — migration 0118 must run first.");
    }
    if (!(await roleExists(sequelize, transaction, role))) {
      throw new Error(
        `0126: the application role "${role}" does not exist. Migration 0057 creates it; ` +
          "run the migrations in order, or create it as an administrator (see 0057).",
      );
    }

    // 1. The tables (sync() made them on a database that never had them); the facility NOT NULL.
    await createMissingTables(context, sequelize, transaction);
    for (const table of FACILITY_TABLES) {
      await run(sequelize, transaction, `ALTER TABLE ${table} ALTER COLUMN client_facility_id SET NOT NULL`);
    }
    for (const [table, column] of DEFAULTS) {
      await run(sequelize, transaction, `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT now()`);
    }

    // 2. CHECKs.
    for (const [name, [table, predicate]] of Object.entries(CHECKS)) {
      if (!(await constraintNames(sequelize, transaction, table)).has(name)) {
        await run(sequelize, transaction, `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
    }

    // 3. Indexes (the composite-key target first — the keys below need it).
    for (const statement of INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }

    // 4. The composite keys.
    for (const [name, [table, statement]] of Object.entries(FKS)) {
      if (!(await constraintNames(sequelize, transaction, table)).has(name)) {
        await run(sequelize, transaction, statement);
      }
    }

    // 5. The functions with the result branch, then the facility triggers.
    for (const [, statement] of FUNCTIONS) {
      await run(sequelize, transaction, statement);
    }
    for (const [table, name, definition] of TRIGGERS) {
      await createAlwaysTrigger(sequelize, transaction, table, name, definition);
    }

    // 6. Grants.
    for (const [table, granted, revoked] of GRANTS) {
      await run(sequelize, transaction, `GRANT ${granted} ON ${table} TO ${role}`);
      await run(sequelize, transaction, `REVOKE ${revoked} ON ${table} FROM ${role}`);
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const held: string[] = [];
    for (const table of TABLES) {
      if (await tableExists(sequelize, transaction, table)) {
        const [row] = await rows(sequelize, transaction, `SELECT count(*)::int AS n FROM ${table}`);
        const n = Number(row?.["n"]);
        if (n > 0) {
          held.push(`${String(n)} row(s) in ${table}`);
        }
      }
    }
    if (held.length > 0) {
      throw new Error(
        `0126 down: the database holds ${held.join(", ")}. Reverting would destroy IPM records or idempotency keys; ` +
          "restore the pre-upgrade backup instead (ADR-116). Nothing was changed.",
      );
    }
    for (const table of [...TABLES].reverse()) {
      await run(sequelize, transaction, `DROP TABLE IF EXISTS ${table}`);
    }
    for (const type of ENUM_TYPES) {
      await run(sequelize, transaction, `DROP TYPE IF EXISTS "${type}"`);
    }
    // 0117's two functions exactly as 0117 made them (the result branch named a table that is gone).
    for (const [name] of FUNCTIONS) {
      await run(sequelize, transaction, m0117Function(name));
    }
  });
};

export = {
  SESSIONS,
  RESULTS,
  SIGNATURES,
  KEYS,
  TABLES,
  ENUM_TYPES,
  AD_HOC_SECTIONS,
  CHECKS,
  FKS,
  INDEX_SQL,
  INDEX_NAMES,
  FUNCTIONS,
  INSERT_DEFAULT_RESULT_BRANCH,
  COLUMN_GUARD_RESULT_BRANCH,
  TRIGGERS,
  DEFAULTS,
  GRANTS,
  TABLE_COLUMNS,
  up,
  down,
};
