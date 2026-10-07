/**
 * Migration 0112 — the inspection catalogue: the item library, templates,
 * versions, their frozen items, tenants' proposals, and the neutral base
 * checklist, version 1 (P20-03; ADR-125 and its Amendments 1 and 2; spec
 * MEMORY/specs/P19-01-inspection-catalogue.md § 4.2 – 4.6, § 7.7, § 12).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. Five tables (with their ENUM types, `enum_<table>_<column>`, the names
 *     Sequelize gives them), each unless it exists — db.sync() runs BEFORE the
 *     migrations at boot and creates them from the models on a database that
 *     has never seen them, so on that path only 2–7 run:
 *       inspection_item_definitions   GLOBAL — the library (§ 4.2)
 *       inspection_templates          GLOBAL — one per device type, plus THE
 *                                     base template (device_type_id NULL)
 *       inspection_template_versions  GLOBAL — draft → published → retired,
 *                                     draft → discarded (§ 4.4, § 7.2)
 *       inspection_template_items     GLOBAL — the frozen content of a version
 *       inspection_template_proposals TENANT-SCOPED (tenant_id NOT NULL) — a
 *                                     tenant's request to the operator (§ 4.6)
 *     The global four have no tenant_id and no client_facility_id (ADR-125 § 1,
 *     ADR-124 § 5); none of the five is paranoid or has a defaultScope (G-4).
 *  2. CHECKs (sync never creates one) — the structured limit (§ 4.2: one
 *     shape per operator, a range low ≤ high, a tolerance ≥ 0), the verbatim
 *     limit text with every limit, the hard and soft input ranges, a non-empty
 *     outcome set except for `measured` and `text`, the version lifecycle (a
 *     published or retired version carries its number, hash, note and
 *     publication, and names EXACTLY ONE publisher — a user or a `system:`
 *     actor, the precedent of 0105's exactly-one CHECK), the proposal's
 *     target, reason and decision.
 *  3. Indexes, every one here and none on a model (ADR-100 Am. 3): the
 *     partial UNIQUE indexes that hold the invariants — ONE published version
 *     per template, at most ONE open draft, version numbers unique per
 *     template, ONE base template, one template per device type, a library
 *     definition at most once per version — the read and queue orders, and a
 *     leading index on every foreign key (D-20).
 *  4. TRIGGERS, the 0057 pattern, ENABLE ALWAYS as 0091's (spec § 7.7):
 *       - inspection_template_versions: DELETE and TRUNCATE refused; an
 *         UPDATE of a published version may only retire it (status,
 *         retired_at, retired_by, updated_at, updated_by); a retired or
 *         discarded version is final; a draft may change, may be published or
 *         discarded, never retired; its identity (id, template, creation)
 *         never changes;
 *       - inspection_template_items: INSERT, UPDATE and DELETE refused unless
 *         the parent version is a DRAFT (read under FOR SHARE, so an item write
 *         racing a publish waits for it and is then refused); TRUNCATE refused;
 *       - inspection_item_definitions, inspection_templates,
 *         inspection_template_proposals: DELETE and TRUNCATE refused (retire,
 *         withdraw — never delete).
 *  5. The APPLICATION ROLE (`DB_APP_ROLE`, default `callibrator_app`, created
 *     by 0057): REVOKE DELETE, TRUNCATE on the definitions, templates,
 *     versions and proposals; REVOKE TRUNCATE on the items. The items KEEP
 *     DELETE: a draft's items are replaced wholesale (spec § 7.7), and the
 *     trigger refuses the delete of a published or retired version's items for
 *     every role (ADR-125 Amendment 2, which resolves the spec's "no DELETE on
 *     all six tables" against its own wholesale replacement). device_types
 *     (0111) has no DELETE either.
 *  6. The base checklist, version 1 (§ 12), unless a base template exists:
 *     fifteen neutral, platform-authored library definitions for the fixed
 *     sections — environment (temperature, humidity), electrical supply
 *     (mains, UPS, stabiliser), other safety (placement; wheels / trolley /
 *     bracket), physical (main unit, accessories), and the six maintenance
 *     tasks of F-48 — with the proposed § 6.5 ranges (the SME confirms them at
 *     UAT, P26-01). No upstream text is copied. The base template, a draft
 *     version, its fifteen `base` items (inserted through the draft-only
 *     trigger), then the publish UPDATE: version_number 1, the change note,
 *     `published_by_system` = `system:catalogue-seed`, and content_hash =
 *     SHA-256 of `canonicalTemplateVersion` (@callibrator/contracts, § 7.6).
 *     The ids are FIXED, so every deployment's base version 1 has the same id
 *     and the same hash.
 *  7. The audit row of that publish (APPROVE, `InspectionTemplateVersion`,
 *     `changes.operation` PUBLISH_TEMPLATE_VERSION, the version number and
 *     hash) under the PLATFORM tenant, actor `system:catalogue-seed` — inside
 *     this transaction, written once (a re-run after `down` finds it).
 *
 * Throws, rather than skipping, when a table it builds on (users, tenants,
 * device_types, audit_logs), the application role or — for the seed — the
 * PLATFORM tenant is absent: a skip would be recorded as applied with no
 * trigger (PR-5). No try/catch: every failure propagates and the migration is
 * not recorded as applied. Verify with psql, not the log:
 *   \d inspection_template_versions
 *   SELECT tgrelid::regclass, tgname, tgenabled FROM pg_trigger
 *    WHERE tgname LIKE 'inspection_%' AND NOT tgisinternal;          -- ten, all A
 *   SELECT status, version_number, content_hash FROM inspection_template_versions;
 *   SET ROLE callibrator_app; UPDATE inspection_template_versions SET change_note = 'x';  -- refused
 *
 * Idempotent. `down` REFUSES while the catalogue holds anything but the seed
 * (a proposal, another template, version or definition) — it would destroy
 * them; otherwise it drops the five tables, the three functions and the ENUM
 * types. The seed's audit row stays: audit_logs is append-only (0091).
 */
import { createHash } from "node:crypto";
import {
  DataTypes,
  type ModelAttributeColumnOptions,
  type QueryInterface,
  type Sequelize,
  type Transaction,
} from "sequelize";
import {
  INSPECTION_INPUT_KINDS,
  INSPECTION_LIMIT_OPS,
  INSPECTION_OUTCOMES,
  INSPECTION_SECTIONS,
  TEMPLATE_ITEM_ORIGINS,
  TEMPLATE_PROPOSAL_KINDS,
  canonicalTemplateVersion,
  type CanonicalTemplateItemInput,
  type InspectionInputKind,
  type InspectionOutcome,
  type InspectionSection,
} from "@callibrator/contracts/inspectionValues";
import {
  INSPECTION_ITEM_DEFINITION_STATUSES,
  INSPECTION_TEMPLATE_STATUSES,
  TEMPLATE_PROPOSAL_STATUSES,
  TEMPLATE_VERSION_STATUSES,
} from "@callibrator/contracts/states";
import { env } from "../config/env";
import { PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { SYSTEM_ACTORS } from "../constants/systemActors";

const DEFINITIONS = "inspection_item_definitions";
const TEMPLATES = "inspection_templates";
const VERSIONS = "inspection_template_versions";
const ITEMS = "inspection_template_items";
const PROPOSALS = "inspection_template_proposals";
/** In creation order; `down` drops them in reverse. */
const TABLES = Object.freeze([DEFINITIONS, TEMPLATES, VERSIONS, ITEMS, PROPOSALS]);

/** The ENUM types Sequelize names `enum_<table>_<column>` — what sync() and createTable() make. */
const ENUM_TYPES = Object.freeze([
  "enum_inspection_item_definitions_section",
  "enum_inspection_item_definitions_input_kind",
  "enum_inspection_item_definitions_limit_op",
  "enum_inspection_item_definitions_allowed_outcomes",
  "enum_inspection_item_definitions_status",
  "enum_inspection_templates_status",
  "enum_inspection_template_versions_status",
  "enum_inspection_template_items_origin",
  "enum_inspection_template_items_section",
  "enum_inspection_template_items_input_kind",
  "enum_inspection_template_items_limit_op",
  "enum_inspection_template_items_allowed_outcomes",
  "enum_inspection_template_proposals_kind",
  "enum_inspection_template_proposals_status",
]);

const DEFAULT_APP_ROLE = "callibrator_app";
const LOCK_TIMEOUT = "10s";

// ── 1. The tables, as the models declare them (tests/migrations/0112 holds them equal) ──

/** One column, as createTable() and a model's attributes take it. */
type ColumnSpec = ModelAttributeColumnOptions;

const fk = (table: string, allowNull: boolean): ColumnSpec => ({
  type: DataTypes.UUID,
  allowNull,
  references: { model: table, key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

const decimal = (): ColumnSpec => ({ type: DataTypes.DECIMAL, allowNull: true });

const timestamps = (): Record<string, ColumnSpec> => ({
  created_at: { type: DataTypes.DATE, allowNull: false },
  updated_at: { type: DataTypes.DATE, allowNull: false },
});

/** The § 4.2 content an item definition holds and a template item copies. */
const contentColumns = (): Record<string, ColumnSpec> => ({
  section: { type: DataTypes.ENUM(...INSPECTION_SECTIONS), allowNull: false },
  label: { type: DataTypes.STRING(255), allowNull: false },
  input_kind: { type: DataTypes.ENUM(...INSPECTION_INPUT_KINDS), allowNull: false },
  unit: { type: DataTypes.STRING(20), allowNull: true },
  symbol: { type: DataTypes.STRING(50), allowNull: true },
  setting_text: { type: DataTypes.STRING(50), allowNull: true },
  setting_value: decimal(),
  limit_op: { type: DataTypes.ENUM(...INSPECTION_LIMIT_OPS), allowNull: true },
  limit_value: decimal(),
  limit_low: decimal(),
  limit_high: decimal(),
  limit_nominal: decimal(),
  limit_tolerance: decimal(),
  limit_text: { type: DataTypes.STRING(100), allowNull: true },
  valid_min: decimal(),
  valid_max: decimal(),
  warn_min: decimal(),
  warn_max: decimal(),
  allowed_outcomes: { type: DataTypes.ARRAY(DataTypes.ENUM(...INSPECTION_OUTCOMES)), allowNull: false },
});

const id = (): ColumnSpec => ({ type: DataTypes.UUID, primaryKey: true, allowNull: false });

/** table -> its columns, in creation order. */
const COLUMNS: Readonly<Record<string, () => Record<string, ColumnSpec>>> = Object.freeze({
  [DEFINITIONS]: () => ({
    id: id(),
    ...contentColumns(),
    default_required: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM(...INSPECTION_ITEM_DEFINITION_STATUSES), allowNull: false, defaultValue: "active" },
    legacy_table: { type: DataTypes.STRING(64), allowNull: true },
    legacy_id: { type: DataTypes.INTEGER, allowNull: true },
    created_by: fk("users", true),
    updated_by: fk("users", true),
    ...timestamps(),
  }),
  [TEMPLATES]: () => ({
    id: id(),
    device_type_id: fk("device_types", true),
    status: { type: DataTypes.ENUM(...INSPECTION_TEMPLATE_STATUSES), allowNull: false, defaultValue: "active" },
    created_by: fk("users", true),
    updated_by: fk("users", true),
    ...timestamps(),
  }),
  [VERSIONS]: () => ({
    id: id(),
    template_id: fk(TEMPLATES, false),
    status: { type: DataTypes.ENUM(...TEMPLATE_VERSION_STATUSES), allowNull: false, defaultValue: "draft" },
    version_number: { type: DataTypes.INTEGER, allowNull: true },
    base_version_id: fk(VERSIONS, true),
    rebased_from_version_id: fk(VERSIONS, true),
    content_hash: { type: DataTypes.CHAR(64), allowNull: true },
    change_note: { type: DataTypes.TEXT, allowNull: true },
    revision: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    published_at: { type: DataTypes.DATE, allowNull: true },
    published_by: fk("users", true),
    published_by_system: { type: DataTypes.STRING(64), allowNull: true },
    retired_at: { type: DataTypes.DATE, allowNull: true },
    retired_by: fk("users", true),
    discarded_at: { type: DataTypes.DATE, allowNull: true },
    discarded_by: fk("users", true),
    created_by: fk("users", true),
    updated_by: fk("users", true),
    ...timestamps(),
  }),
  [ITEMS]: () => ({
    id: id(),
    version_id: fk(VERSIONS, false),
    item_definition_id: fk(DEFINITIONS, false),
    origin: { type: DataTypes.ENUM(...TEMPLATE_ITEM_ORIGINS), allowNull: false },
    ...contentColumns(),
    required: { type: DataTypes.BOOLEAN, allowNull: false },
    sort_order: { type: DataTypes.INTEGER, allowNull: false },
    ...timestamps(),
  }),
  [PROPOSALS]: () => ({
    id: id(),
    tenant_id: fk("tenants", false),
    kind: { type: DataTypes.ENUM(...TEMPLATE_PROPOSAL_KINDS), allowNull: false },
    device_type_id: fk("device_types", true),
    proposed_device_type_name: { type: DataTypes.STRING(255), allowNull: true },
    based_on_version_id: fk(VERSIONS, true),
    proposed_items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    reason: { type: DataTypes.TEXT, allowNull: false },
    status: { type: DataTypes.ENUM(...TEMPLATE_PROPOSAL_STATUSES), allowNull: false, defaultValue: "submitted" },
    submitted_by: fk("users", false),
    decided_by: fk("users", true),
    decided_at: { type: DataTypes.DATE, allowNull: true },
    decision_note: { type: DataTypes.TEXT, allowNull: true },
    resulting_version_id: fk(VERSIONS, true),
    withdrawn_at: { type: DataTypes.DATE, allowNull: true },
    withdrawn_by: fk("users", true),
    ...timestamps(),
  }),
});

// ── 2. CHECKs ────────────────────────────────────────────────────────────────

/** § 4.2: exactly the columns its operator uses; NULL operator ⇔ no limit at all. */
const LIMIT_SHAPE =
  "(limit_op IS NULL AND limit_value IS NULL AND limit_low IS NULL AND limit_high IS NULL" +
  " AND limit_nominal IS NULL AND limit_tolerance IS NULL AND limit_text IS NULL)" +
  " OR (limit_op IN ('lt', 'lte', 'gt', 'gte') AND limit_value IS NOT NULL AND limit_low IS NULL" +
  " AND limit_high IS NULL AND limit_nominal IS NULL AND limit_tolerance IS NULL)" +
  " OR (limit_op = 'between' AND limit_low IS NOT NULL AND limit_high IS NOT NULL AND limit_low <= limit_high" +
  " AND limit_value IS NULL AND limit_nominal IS NULL AND limit_tolerance IS NULL)" +
  " OR (limit_op IN ('plus_minus', 'plus_minus_pct') AND limit_tolerance IS NOT NULL AND limit_tolerance >= 0" +
  " AND limit_value IS NULL AND limit_low IS NULL AND limit_high IS NULL)" +
  " OR (limit_op = 'text' AND limit_value IS NULL AND limit_low IS NULL AND limit_high IS NULL" +
  " AND limit_nominal IS NULL AND limit_tolerance IS NULL)";

/** The § 4.2 CHECKs, on a definition and again on every template item (the copy is the content). */
const contentChecks = (table: string): Record<string, string> => ({
  [`${table}_label_valid`]: "btrim(label) <> '' AND label !~ '[[:cntrl:]]'",
  [`${table}_limit_kind`]: "limit_op IS NULL OR input_kind IN ('measured_with_limit', 'setting_measured_reference')",
  [`${table}_setting_kind`]:
    "(setting_text IS NULL AND setting_value IS NULL) OR input_kind = 'setting_measured_reference'",
  [`${table}_limit_shape`]: LIMIT_SHAPE,
  [`${table}_limit_text`]: "limit_op IS NULL OR (limit_text IS NOT NULL AND btrim(limit_text) <> '')",
  [`${table}_valid_range`]: "valid_min IS NULL OR valid_max IS NULL OR valid_min <= valid_max",
  [`${table}_warn_range`]:
    "(warn_min IS NULL OR warn_max IS NULL OR warn_min <= warn_max)" +
    " AND (warn_min IS NULL OR valid_min IS NULL OR warn_min >= valid_min)" +
    " AND (warn_max IS NULL OR valid_max IS NULL OR warn_max <= valid_max)",
  [`${table}_outcomes`]: "cardinality(allowed_outcomes) > 0 OR input_kind IN ('measured', 'text')",
});

/** table -> (CHECK name -> predicate). */
const CHECKS: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  [DEFINITIONS]: Object.freeze({
    ...contentChecks(DEFINITIONS),
    inspection_item_definitions_legacy_pair: "(legacy_id IS NULL) = (legacy_table IS NULL)",
  }),
  [TEMPLATES]: Object.freeze({}),
  [VERSIONS]: Object.freeze({
    inspection_template_versions_published_complete:
      "status IN ('draft', 'discarded') OR (version_number IS NOT NULL AND content_hash IS NOT NULL" +
      " AND change_note IS NOT NULL AND published_at IS NOT NULL)",
    inspection_template_versions_draft_unpublished:
      "status NOT IN ('draft', 'discarded') OR (version_number IS NULL AND content_hash IS NULL" +
      " AND published_at IS NULL AND published_by IS NULL AND published_by_system IS NULL)",
    inspection_template_versions_publisher_exactly_one:
      "status IN ('draft', 'discarded') OR ((published_by IS NULL) <> (published_by_system IS NULL))",
    inspection_template_versions_system_publisher:
      "published_by_system IS NULL OR published_by_system ~ '^system:[a-z][a-z-]*$'",
    inspection_template_versions_retired_stamped:
      "(status = 'retired') = (retired_at IS NOT NULL) AND (retired_by IS NULL OR status = 'retired')",
    inspection_template_versions_discarded_stamped:
      "(status = 'discarded') = (discarded_at IS NOT NULL) AND (discarded_by IS NULL OR status = 'discarded')",
    inspection_template_versions_content_hash_hex: "content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'",
    inspection_template_versions_change_note_length:
      "change_note IS NULL OR char_length(btrim(change_note)) BETWEEN 3 AND 2000",
    inspection_template_versions_numbers:
      "(version_number IS NULL OR version_number > 0) AND revision >= 0",
    inspection_template_versions_not_self:
      "(base_version_id IS NULL OR base_version_id <> id) AND (rebased_from_version_id IS NULL OR rebased_from_version_id <> id)",
  }),
  [ITEMS]: Object.freeze({
    ...contentChecks(ITEMS),
    inspection_template_items_sort_order: "sort_order >= 0",
  }),
  [PROPOSALS]: Object.freeze({
    inspection_template_proposals_target:
      "((kind = 'new_device_type') = (proposed_device_type_name IS NOT NULL))" +
      " AND (kind = 'new_device_type' OR device_type_id IS NOT NULL)",
    inspection_template_proposals_type_name:
      "proposed_device_type_name IS NULL OR btrim(proposed_device_type_name) <> ''",
    inspection_template_proposals_reason_length: "char_length(btrim(reason)) BETWEEN 3 AND 2000",
    inspection_template_proposals_items_array:
      "jsonb_typeof(proposed_items) = 'array' AND jsonb_array_length(proposed_items) <= 100",
    inspection_template_proposals_decided:
      "(status IN ('accepted', 'rejected')) = (decided_at IS NOT NULL AND decided_by IS NOT NULL)",
    inspection_template_proposals_rejection_noted:
      "status <> 'rejected' OR (decision_note IS NOT NULL AND btrim(decision_note) <> '')",
    inspection_template_proposals_withdrawn:
      "(status = 'withdrawn') = (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL)",
  }),
});

// ── 3. Indexes ───────────────────────────────────────────────────────────────

/** D-20: each table's foreign-key columns no other index below leads (each gets `<table>_<column>`). */
const DEFINITION_FKS = Object.freeze(["created_by", "updated_by"]);
const TEMPLATE_FKS = Object.freeze(["created_by", "updated_by"]);
const VERSION_FKS = Object.freeze([
  "base_version_id",
  "rebased_from_version_id",
  "published_by",
  "retired_by",
  "discarded_by",
  "created_by",
  "updated_by",
]);
const ITEM_FKS = Object.freeze(["item_definition_id"]);
const PROPOSAL_FKS = Object.freeze([
  "device_type_id",
  "based_on_version_id",
  "resulting_version_id",
  "submitted_by",
  "decided_by",
  "withdrawn_by",
]);
/** table -> its FK index columns (for the tests). */
const FK_INDEX_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [DEFINITIONS]: DEFINITION_FKS,
  [TEMPLATES]: TEMPLATE_FKS,
  [VERSIONS]: VERSION_FKS,
  [ITEMS]: ITEM_FKS,
  [PROPOSALS]: PROPOSAL_FKS,
});

const INDEX_SQL = Object.freeze([
  // The library list (operator): by section, status and label.
  `CREATE INDEX IF NOT EXISTS inspection_item_definitions_library_order ON ${DEFINITIONS} (section, status, lower(label), id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_item_definitions_legacy_unique ON ${DEFINITIONS} (legacy_table, legacy_id) WHERE legacy_id IS NOT NULL`,
  // One template per device type, ever (NULLs distinct) — and exactly one base template.
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_templates_device_type_id_unique ON ${TEMPLATES} (device_type_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_templates_one_base ON ${TEMPLATES} ((device_type_id IS NULL)) WHERE device_type_id IS NULL`,
  // The version invariants (§ 4.4) and orders.
  `CREATE INDEX IF NOT EXISTS inspection_template_versions_template_id_status ON ${VERSIONS} (template_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_versions_version_number_unique ON ${VERSIONS} (template_id, version_number) WHERE version_number IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_versions_one_published ON ${VERSIONS} (template_id) WHERE status = 'published'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_versions_one_draft ON ${VERSIONS} (template_id) WHERE status = 'draft'`,
  `CREATE INDEX IF NOT EXISTS inspection_template_versions_status_id ON ${VERSIONS} (status, id)`,
  // A version's items: each library definition once, one item per position, in read order.
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_items_version_definition_unique ON ${ITEMS} (version_id, item_definition_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS inspection_template_items_version_position_unique ON ${ITEMS} (version_id, section, origin, sort_order)`,
  `CREATE INDEX IF NOT EXISTS inspection_template_items_read_order ON ${ITEMS} (version_id, section, origin, sort_order, id)`,
  // The tenant's own list and the operator's queue.
  `CREATE INDEX IF NOT EXISTS inspection_template_proposals_tenant_queue ON ${PROPOSALS} (tenant_id, status, created_at DESC, id)`,
  `CREATE INDEX IF NOT EXISTS inspection_template_proposals_operator_queue ON ${PROPOSALS} (status, created_at, id)`,
  // The D-20 leading index of every other foreign key (one .map per table: migrationScan reads each).
  ...DEFINITION_FKS.map((column) => `CREATE INDEX IF NOT EXISTS ${DEFINITIONS}_${column} ON ${DEFINITIONS} (${column})`),
  ...TEMPLATE_FKS.map((column) => `CREATE INDEX IF NOT EXISTS ${TEMPLATES}_${column} ON ${TEMPLATES} (${column})`),
  ...VERSION_FKS.map((column) => `CREATE INDEX IF NOT EXISTS ${VERSIONS}_${column} ON ${VERSIONS} (${column})`),
  ...ITEM_FKS.map((column) => `CREATE INDEX IF NOT EXISTS ${ITEMS}_${column} ON ${ITEMS} (${column})`),
  ...PROPOSAL_FKS.map((column) => `CREATE INDEX IF NOT EXISTS ${PROPOSALS}_${column} ON ${PROPOSALS} (${column})`),
]);

// ── 4. Triggers ──────────────────────────────────────────────────────────────

const NO_DELETE_FUNCTION = "inspection_catalogue_no_delete";
const VERSIONS_FUNCTION = "inspection_template_versions_guard";
const ITEMS_FUNCTION = "inspection_template_items_guard";
const FUNCTIONS = Object.freeze([NO_DELETE_FUNCTION, VERSIONS_FUNCTION, ITEMS_FUNCTION]);

/** Tables whose rows are never deleted and whose other changes the trigger leaves to the service. */
const NO_DELETE_TABLES = Object.freeze([DEFINITIONS, TEMPLATES, PROPOSALS]);

/** Every trigger: [table, name, timing, function]. Each is listed in schemaVerify's EXPECTED_OBJECTS. */
const TRIGGERS: readonly (readonly [string, string, string, string])[] = Object.freeze([
  ...NO_DELETE_TABLES.flatMap((table) => [
    [table, `${table}_no_delete`, "BEFORE DELETE ON", `FOR EACH ROW EXECUTE FUNCTION ${NO_DELETE_FUNCTION}()`] as const,
    [table, `${table}_no_truncate`, "BEFORE TRUNCATE ON", `FOR EACH STATEMENT EXECUTE FUNCTION ${NO_DELETE_FUNCTION}()`] as const,
  ]),
  [VERSIONS, `${VERSIONS}_immutable`, "BEFORE UPDATE OR DELETE ON", `FOR EACH ROW EXECUTE FUNCTION ${VERSIONS_FUNCTION}()`],
  [VERSIONS, `${VERSIONS}_no_truncate`, "BEFORE TRUNCATE ON", `FOR EACH STATEMENT EXECUTE FUNCTION ${VERSIONS_FUNCTION}()`],
  [ITEMS, `${ITEMS}_draft_only`, "BEFORE INSERT OR UPDATE OR DELETE ON", `FOR EACH ROW EXECUTE FUNCTION ${ITEMS_FUNCTION}()`],
  [ITEMS, `${ITEMS}_no_truncate`, "BEFORE TRUNCATE ON", `FOR EACH STATEMENT EXECUTE FUNCTION ${ITEMS_FUNCTION}()`],
]);

const NO_DELETE_SQL = `
CREATE OR REPLACE FUNCTION ${NO_DELETE_FUNCTION}() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION '% is never emptied: TRUNCATE is refused', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION '%: row % cannot be deleted', TG_TABLE_NAME, OLD.id
    USING ERRCODE = '42501',
          HINT = 'Retire it, or withdraw a proposal: nothing in the inspection catalogue is deleted (ADR-125).';
END
$fn$`;

/** The columns a published version's one permitted UPDATE — its retirement — may change. */
const RETIRE_COLUMNS = Object.freeze(["status", "retired_at", "retired_by", "updated_at", "updated_by"]);

const VERSIONS_GUARD_SQL = `
CREATE OR REPLACE FUNCTION ${VERSIONS_FUNCTION}() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  retire_columns CONSTANT text[] := ARRAY[${RETIRE_COLUMNS.map((c) => `'${c}'`).join(", ")}];
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION '${VERSIONS} is never emptied: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '${VERSIONS}: version % cannot be deleted', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Discard a draft; a published version is retired when its successor is published.';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.template_id IS DISTINCT FROM OLD.template_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION '${VERSIONS}: the identity of version % cannot be changed', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status = 'retired' THEN
      RAISE EXCEPTION '${VERSIONS}: version % is a draft; a draft is published or discarded, never retired', OLD.id
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'published' AND NEW.status = 'retired'
     AND (to_jsonb(NEW) - retire_columns) = (to_jsonb(OLD) - retire_columns) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '${VERSIONS}: version % is %; its content cannot be changed', OLD.id, OLD.status
    USING ERRCODE = '42501',
          HINT = 'Create a new draft and publish it. A published version changes only by being retired; retired and discarded versions are final.';
END
$fn$`;

const ITEMS_GUARD_SQL = `
CREATE OR REPLACE FUNCTION ${ITEMS_FUNCTION}() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION '${ITEMS} is never emptied: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status::text INTO parent_status FROM ${VERSIONS} WHERE id = OLD.version_id FOR SHARE;
    IF parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION '${ITEMS}: item % belongs to version %, which is %; only a draft''s items change', OLD.id, OLD.version_id, parent_status
        USING ERRCODE = '42501',
              HINT = 'Create a new draft; a published version is immutable (ADR-125).';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status::text INTO parent_status FROM ${VERSIONS} WHERE id = NEW.version_id FOR SHARE;
    -- No parent row: let the foreign key refuse it (23503), as it would without this trigger.
    IF FOUND AND parent_status <> 'draft' THEN
      RAISE EXCEPTION '${ITEMS}: version % is %; items are added only to a draft', NEW.version_id, parent_status
        USING ERRCODE = '42501',
              HINT = 'Create a new draft; a published version is immutable (ADR-125).';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$fn$`;

// ── 5. Grants ────────────────────────────────────────────────────────────────

/** table -> the privileges the application role loses on it (ADR-125 Amendment 2: the items keep DELETE). */
const REVOKED: Readonly<Record<string, string>> = Object.freeze({
  [DEFINITIONS]: "DELETE, TRUNCATE",
  [TEMPLATES]: "DELETE, TRUNCATE",
  [VERSIONS]: "DELETE, TRUNCATE",
  [ITEMS]: "TRUNCATE",
  [PROPOSALS]: "DELETE, TRUNCATE",
});

// ── 6. The base checklist, version 1 (§ 12) ───────────────────────────────────

const BASE_TEMPLATE_ID = "5eedca7a-0000-4000-8000-000000000001";
const BASE_VERSION_ID = "5eedca7a-0000-4000-8000-000000000002";
const SEED_CHANGE_NOTE =
  "Base checklist, version 1: the platform's neutral common sections (environment, electrical supply, " +
  "other safety, physical, maintenance tasks), seeded by migration 0112. The ranges are proposed; " +
  "the subject-matter expert confirms them at UAT (P26-01).";
const SEED_ACTOR = SYSTEM_ACTORS.CATALOGUE_SEED;

/** A seeded library definition (and its item in the base version). Decimals as strings, as NUMERIC returns them. */
interface SeedEntry {
  readonly n: number;
  readonly section: InspectionSection;
  readonly label: string;
  readonly inputKind: InspectionInputKind;
  readonly unit: string | null;
  readonly validMin: string | null;
  readonly validMax: string | null;
  readonly warnMin: string | null;
  readonly warnMax: string | null;
  readonly allowedOutcomes: readonly InspectionOutcome[];
  readonly sortOrder: number;
}

const measured = (
  n: number,
  section: InspectionSection,
  label: string,
  unit: string,
  [validMin, validMax, warnMin, warnMax]: readonly [string, string, string, string],
  allowedOutcomes: readonly InspectionOutcome[],
  sortOrder: number,
): SeedEntry => ({ n, section, label, inputKind: "measured", unit, validMin, validMax, warnMin, warnMax, allowedOutcomes, sortOrder });

const choice = (
  n: number,
  section: InspectionSection,
  label: string,
  inputKind: InspectionInputKind,
  allowedOutcomes: readonly InspectionOutcome[],
  sortOrder: number,
): SeedEntry => ({
  n,
  section,
  label,
  inputKind,
  unit: null,
  validMin: null,
  validMax: null,
  warnMin: null,
  warnMax: null,
  allowedOutcomes,
  sortOrder,
});

/** § 6.5's proposed ranges: [valid min, valid max, warn min, warn max]. */
const TEMPERATURE = ["-20", "80", "10", "45"] as const;
const HUMIDITY = ["0", "100", "10", "95"] as const;
const VOLTAGE = ["0", "400", "198", "242"] as const;
const TRI_STATE: readonly InspectionOutcome[] = ["pass", "fail", "not_applicable"];
const CONDITION: readonly InspectionOutcome[] = ["good", "minor_damage", "major_damage"];
const CHECKED: readonly InspectionOutcome[] = ["done", "not_done"];

/** Platform-authored (Indonesian, the reports' language); no upstream text. */
const SEED: readonly SeedEntry[] = Object.freeze([
  measured(1, "environment", "Suhu ruangan", "°C", TEMPERATURE, [], 0),
  measured(2, "environment", "Kelembapan ruangan", "%", HUMIDITY, [], 1),
  measured(3, "electrical_supply", "Tegangan listrik jala-jala", "V", VOLTAGE, ["not_applicable"], 0),
  measured(4, "electrical_supply", "Tegangan keluaran UPS", "V", VOLTAGE, ["not_applicable"], 1),
  measured(5, "electrical_supply", "Tegangan keluaran stabilizer", "V", VOLTAGE, ["not_applicable"], 2),
  choice(6, "other_safety", "Penempatan alat", "tri_state", TRI_STATE, 0),
  choice(7, "other_safety", "Roda, troli atau bracket", "tri_state", TRI_STATE, 1),
  choice(8, "physical", "Unit utama", "condition_clean", CONDITION, 0),
  choice(9, "physical", "Aksesori", "condition_clean", CONDITION, 1),
  choice(10, "maintenance_task", "Membersihkan unit utama", "check", CHECKED, 0),
  choice(11, "maintenance_task", "Membersihkan aksesori", "check", CHECKED, 1),
  choice(12, "maintenance_task", "Memantau fungsi alat", "check", CHECKED, 2),
  choice(13, "maintenance_task", "Memantau kinerja alat", "check", CHECKED, 3),
  choice(14, "maintenance_task", "Mengganti bagian habis pakai", "check", CHECKED, 4),
  choice(15, "maintenance_task", "Melumasi dan/atau mengencangkan", "check", CHECKED, 5),
]);

const seedId = (group: number, n: number): string =>
  `5eedca7a-000${String(group)}-4000-8000-${String(n).padStart(12, "0")}`;
/** The fixed id of seeded library definition `n`. */
const seedDefinitionId = (n: number): string => seedId(1, n);
/** The fixed id of seeded base item `n` (results pin it). */
const seedItemId = (n: number): string => seedId(2, n);

/** The base version's items, as `canonicalTemplateVersion` reads them. */
const seedItems = (): CanonicalTemplateItemInput[] =>
  SEED.map((entry) => ({
    id: seedItemId(entry.n),
    itemDefinitionId: seedDefinitionId(entry.n),
    origin: "base",
    section: entry.section,
    label: entry.label,
    inputKind: entry.inputKind,
    unit: entry.unit,
    symbol: null,
    settingText: null,
    settingValue: null,
    limitOp: null,
    limitValue: null,
    limitLow: null,
    limitHigh: null,
    limitNominal: null,
    limitTolerance: null,
    limitText: null,
    validMin: entry.validMin,
    validMax: entry.validMax,
    warnMin: entry.warnMin,
    warnMax: entry.warnMax,
    allowedOutcomes: entry.allowedOutcomes,
    required: true,
    sortOrder: entry.sortOrder,
  }));

/** SHA-256 (lower-case hex) of base version 1's canonical text — its `content_hash`. */
const seedContentHash = (): string =>
  createHash("sha256")
    .update(
      canonicalTemplateVersion({
        templateId: BASE_TEMPLATE_ID,
        deviceTypeId: null,
        versionNumber: 1,
        baseVersionId: null,
        items: seedItems(),
      }),
      "utf8",
    )
    .digest("hex");

/** A PostgreSQL array literal of ENUM labels (`{a,b}`), cast by the statement. */
const pgArray = (values: readonly string[]): string => `{${values.join(",")}}`;

const SEED_DEFINITION_SQL =
  `INSERT INTO ${DEFINITIONS} (id, section, label, input_kind, unit, valid_min, valid_max, warn_min, warn_max, ` +
  "allowed_outcomes, default_required, status, created_at, updated_at) VALUES (:id, :section, :label, :inputKind, " +
  ':unit, :validMin, :validMax, :warnMin, :warnMax, CAST(:outcomes AS "enum_inspection_item_definitions_allowed_outcomes"[]), ' +
  "true, 'active', now(), now())";
const SEED_TEMPLATE_SQL =
  `INSERT INTO ${TEMPLATES} (id, device_type_id, status, created_at, updated_at) VALUES (:id, NULL, 'active', now(), now())`;
const SEED_DRAFT_SQL =
  `INSERT INTO ${VERSIONS} (id, template_id, status, revision, created_at, updated_at) ` +
  "VALUES (:id, :templateId, 'draft', 0, now(), now())";
const SEED_ITEM_SQL =
  `INSERT INTO ${ITEMS} (id, version_id, item_definition_id, origin, section, label, input_kind, unit, valid_min, ` +
  "valid_max, warn_min, warn_max, allowed_outcomes, required, sort_order, created_at, updated_at) VALUES (:id, " +
  ":versionId, :definitionId, 'base', :section, :label, :inputKind, :unit, :validMin, :validMax, :warnMin, :warnMax, " +
  'CAST(:outcomes AS "enum_inspection_template_items_allowed_outcomes"[]), true, :sortOrder, now(), now())';
const SEED_PUBLISH_SQL =
  `UPDATE ${VERSIONS} SET status = 'published', version_number = 1, content_hash = :hash, change_note = :note, ` +
  "published_at = now(), published_by_system = :actor, updated_at = now() WHERE id = :id AND status = 'draft'";
/** Once: a re-run after `down` finds the row (audit_logs is append-only, 0091). */
const SEED_AUDIT_SQL =
  "INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, actor_name, action, resource_type, resource_id, " +
  "changes, created_at) SELECT gen_random_uuid(), :tenantId, NULL, 'system', :actor, 'APPROVE', " +
  "'InspectionTemplateVersion', :id, CAST(:changes AS jsonb), now() WHERE NOT EXISTS (SELECT 1 FROM audit_logs " +
  "WHERE resource_type = 'InspectionTemplateVersion' AND resource_id = :id AND action = 'APPROVE')";

// ── helpers ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const rows = async (
  sequelize: Sequelize,
  transaction: Transaction,
  statement: string,
  replacements: Record<string, unknown> = {},
): Promise<Row[]> => {
  const [result] = (await sequelize.query(statement, { transaction, replacements })) as [Row[], unknown];
  return result;
};

const run = async (
  sequelize: Sequelize,
  transaction: Transaction,
  statement: string,
  replacements: Record<string, unknown> = {},
): Promise<void> => {
  await sequelize.query(statement, { transaction, replacements });
};

const tableExists = async (sequelize: Sequelize, transaction: Transaction, table: string): Promise<boolean> => {
  const [row] = await rows(
    sequelize,
    transaction,
    "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present",
    { table },
  );
  return row?.["present"] === true;
};

const constraints = async (sequelize: Sequelize, transaction: Transaction, table: string): Promise<Set<string>> =>
  new Set(
    (
      await rows(
        sequelize,
        transaction,
        "SELECT conname FROM pg_constraint WHERE conrelid = (current_schema() || '.' || :table)::regclass",
        { table },
      )
    ).map((r) => String(r["conname"])),
  );

/**
 * @param raw - DB_APP_ROLE
 * @returns a safe, unquoted role identifier (0057's rule)
 */
const appRoleName = (raw: string | undefined = env("DB_APP_ROLE")): string => {
  const name = raw === undefined || raw === "" || raw === "none" ? DEFAULT_APP_ROLE : raw;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(
      `0112: DB_APP_ROLE "${name}" is not a plain lower-case identifier ([a-z_][a-z0-9_]*). ` +
        "Refusing to interpolate it into GRANT statements.",
    );
  }
  return name;
};

const exists = async (
  sequelize: Sequelize,
  transaction: Transaction,
  statement: string,
  replacements: Record<string, unknown>,
): Promise<boolean> => {
  const [row] = await rows(sequelize, transaction, `SELECT EXISTS (${statement}) AS present`, replacements);
  return row?.["present"] === true;
};

/** Steps 6 and 7: the base checklist, version 1, and its audit row. */
const seed = async (sequelize: Sequelize, transaction: Transaction): Promise<void> => {
  if (!(await exists(sequelize, transaction, "SELECT 1 FROM tenants WHERE id = :id", { id: PLATFORM_TENANT_ID }))) {
    throw new Error(
      `0112: the PLATFORM tenant (${PLATFORM_TENANT_ID}) does not exist. Migration 0034 creates it; the ` +
        "base checklist's audit row is written under it. Run the migrations in order.",
    );
  }
  for (const entry of SEED) {
    await run(sequelize, transaction, SEED_DEFINITION_SQL, {
      id: seedDefinitionId(entry.n),
      section: entry.section,
      label: entry.label,
      inputKind: entry.inputKind,
      unit: entry.unit,
      validMin: entry.validMin,
      validMax: entry.validMax,
      warnMin: entry.warnMin,
      warnMax: entry.warnMax,
      outcomes: pgArray(entry.allowedOutcomes),
    });
  }
  await run(sequelize, transaction, SEED_TEMPLATE_SQL, { id: BASE_TEMPLATE_ID });
  await run(sequelize, transaction, SEED_DRAFT_SQL, { id: BASE_VERSION_ID, templateId: BASE_TEMPLATE_ID });
  for (const entry of SEED) {
    await run(sequelize, transaction, SEED_ITEM_SQL, {
      id: seedItemId(entry.n),
      versionId: BASE_VERSION_ID,
      definitionId: seedDefinitionId(entry.n),
      section: entry.section,
      label: entry.label,
      inputKind: entry.inputKind,
      unit: entry.unit,
      validMin: entry.validMin,
      validMax: entry.validMax,
      warnMin: entry.warnMin,
      warnMax: entry.warnMax,
      outcomes: pgArray(entry.allowedOutcomes),
      sortOrder: entry.sortOrder,
    });
  }
  const hash = seedContentHash();
  await run(sequelize, transaction, SEED_PUBLISH_SQL, {
    id: BASE_VERSION_ID,
    hash,
    note: SEED_CHANGE_NOTE,
    actor: SEED_ACTOR,
  });
  await run(sequelize, transaction, SEED_AUDIT_SQL, {
    tenantId: PLATFORM_TENANT_ID,
    actor: SEED_ACTOR,
    id: BASE_VERSION_ID,
    changes: JSON.stringify({
      operation: "PUBLISH_TEMPLATE_VERSION",
      versionNumber: 1,
      contentHash: hash,
      baseVersionId: null,
      retiredVersionId: null,
      templateId: BASE_TEMPLATE_ID,
      itemCount: SEED.length,
      changeNote: SEED_CHANGE_NOTE,
    }),
  });
};

// ── up / down ────────────────────────────────────────────────────────────────

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const role = appRoleName();
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    for (const required of ["users", "tenants", "device_types", "audit_logs"]) {
      if (!(await tableExists(sequelize, transaction, required))) {
        throw new Error(
          `0112: table ${required} does not exist. Run db.sync() and the migrations before 0112 first ` +
            "(the backend does at boot); skipping would record this migration as applied with no catalogue.",
        );
      }
    }
    if (!(await exists(sequelize, transaction, "SELECT 1 FROM pg_roles WHERE rolname = :role", { role }))) {
      throw new Error(
        `0112: the application role "${role}" does not exist. Migration 0057 creates it; ` +
          "run the migrations in order, or create it as an administrator (see 0057).",
      );
    }

    // 1. The tables.
    for (const table of TABLES) {
      if (!(await tableExists(sequelize, transaction, table))) {
        const columns = COLUMNS[table] as () => Record<string, ColumnSpec>;
        await context.createTable(table, columns(), { transaction });
      }
    }

    // 2. CHECKs.
    for (const table of TABLES) {
      const own = await constraints(sequelize, transaction, table);
      for (const [name, predicate] of Object.entries(CHECKS[table] ?? {})) {
        if (!own.has(name)) {
          await run(sequelize, transaction, `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${predicate})`);
        }
      }
    }

    // 3. Indexes.
    for (const statement of INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }

    // 4. Triggers — for every role.
    for (const statement of [NO_DELETE_SQL, VERSIONS_GUARD_SQL, ITEMS_GUARD_SQL]) {
      await run(sequelize, transaction, statement);
    }
    for (const [table, name, timing, action] of TRIGGERS) {
      await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${name} ON ${table}`);
      await run(sequelize, transaction, `CREATE TRIGGER ${name} ${timing} ${table} ${action}`);
      await run(sequelize, transaction, `ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${name}`);
    }

    // 5. The application role.
    for (const [table, privileges] of Object.entries(REVOKED)) {
      await run(sequelize, transaction, `REVOKE ${privileges} ON ${table} FROM ${role}`);
    }

    // 6–7. The base checklist, once.
    if (!(await exists(sequelize, transaction, `SELECT 1 FROM ${TEMPLATES} WHERE device_type_id IS NULL`, {}))) {
      await seed(sequelize, transaction);
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const present: string[] = [];
    for (const table of TABLES) {
      if (await tableExists(sequelize, transaction, table)) {
        present.push(table);
      }
    }
    if (present.length === TABLES.length) {
      const [row] = await rows(
        sequelize,
        transaction,
        `SELECT (SELECT count(*) FROM ${PROPOSALS})
              + (SELECT count(*) FROM ${TEMPLATES} WHERE id <> :template)
              + (SELECT count(*) FROM ${VERSIONS} WHERE id <> :version)
              + (SELECT count(*) FROM ${DEFINITIONS} WHERE id NOT IN (:definitions)) AS n`,
        { template: BASE_TEMPLATE_ID, version: BASE_VERSION_ID, definitions: SEED.map((e) => seedDefinitionId(e.n)) },
      );
      const count = Number(row?.["n"]);
      if (count > 0) {
        throw new Error(
          `0112 down: the inspection catalogue holds ${String(count)} row(s) beyond the seeded base checklist ` +
            "(proposals, templates, versions or definitions). Reverting would destroy them; the catalogue is " +
            "never deleted (ADR-125). Nothing was changed.",
        );
      }
    }
    for (const table of [...TABLES].reverse()) {
      await run(sequelize, transaction, `DROP TABLE IF EXISTS ${table}`);
    }
    for (const fn of FUNCTIONS) {
      await run(sequelize, transaction, `DROP FUNCTION IF EXISTS ${fn}()`);
    }
    for (const type of ENUM_TYPES) {
      await run(sequelize, transaction, `DROP TYPE IF EXISTS "${type}"`);
    }
  });
};

export = {
  DEFINITIONS,
  TEMPLATES,
  VERSIONS,
  ITEMS,
  PROPOSALS,
  TABLES,
  ENUM_TYPES,
  COLUMNS,
  CHECKS,
  FK_INDEX_COLUMNS,
  INDEX_SQL,
  FUNCTIONS,
  TRIGGERS,
  RETIRE_COLUMNS,
  REVOKED,
  NO_DELETE_SQL,
  VERSIONS_GUARD_SQL,
  ITEMS_GUARD_SQL,
  BASE_TEMPLATE_ID,
  BASE_VERSION_ID,
  SEED_CHANGE_NOTE,
  SEED_ACTOR,
  SEED,
  seedDefinitionId,
  seedItemId,
  seedItems,
  seedContentHash,
  appRoleName,
  up,
  down,
};
