/**
 * Migration 0117 — `client_facilities`, `client_facility_moves`, `audit_logs.client_facility_id`,
 * the facility trigger functions, and ONE self facility per tenant (P20-07, migration M1 of seven;
 * ADR-124 and its Amendments 2–3; spec MEMORY/specs/P19-04-client-facilities.md § 4, § 5.4, § 5.5,
 * § 6.1).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. `client_facilities` unless it exists (db.sync() runs BEFORE the migrations at boot and creates
 *     it from the model on a database that has never seen it; ENUM types
 *     `enum_client_facilities_kind` / `_status`, Sequelize's names). Tenant-scoped; NOT paranoid,
 *     no defaultScope (G-F3).
 *  2. Its CHECKs (`id` is never NO_FACILITY_ID; the self facility always active; a status other
 *     than active names a reason; code and name shapes; legacy id positive), its UNIQUE indexes —
 *     `(tenant_id, id)` (the composite-FK target), `(tenant_id, code)`, `(tenant_id,
 *     lower(btrim(name)))`, ONE `is_self` per tenant, `(tenant_id, legacy_id)` — the D-20 indexes
 *     of its user keys and the list index. No global uniqueness on any column (the oracle trap).
 *  3. TRIGGER `client_facilities_identity_immutable` (ENABLE ALWAYS): `id`, `tenant_id`, `is_self`
 *     never change, for any role.
 *  4. `client_facility_moves` (the device-move log and the key the facility triggers check): its
 *     composite keys to the two facilities and to the device `(tenant_id, id)`, its CHECKs, its
 *     indexes, the append-only trigger (only `in_progress → completed`), no DELETE or TRUNCATE for
 *     any role, and a DEFERRED constraint trigger refusing a COMMIT that leaves a move
 *     `in_progress` — so an in-progress row is only ever seen by the transaction moving the device.
 *     The application role loses DELETE and TRUNCATE on it.
 *  5. `calibration_devices` `UNIQUE (tenant_id, id)` if absent (P20-02's, built here idempotently —
 *     spec G-F8): the move log's key to the device.
 *  6. `audit_logs.client_facility_id` (no FK, no back-fill — the trail outlives what it names; a
 *     NULL on an earlier row means the tenant's self facility) and its breach-scoping index
 *     `(tenant_id, client_facility_id, created_at)`.
 *  7. The trigger FUNCTIONS of the seven (defined here, attached by 0118 – 0123): the move check
 *     `facility_move_admits`, `facility_column_guard` (the facility column changes only under
 *     `callibrator.facility_move`, for every role), `facility_insert_default` (ADR-124 Am. 3: a row
 *     written without a facility takes its device's — or, for a device of a tenant with no other
 *     facility, the self facility), `facility_accepts_inserts` (no new rows in an `ended` facility),
 *     the resource resolvers of the polymorphic attachments, `users_binding_guard` and
 *     `users_bound_role_check`.
 *  8. ONE self facility per tenant row — PLATFORM, the default tenant and soft-deleted tenants
 *     included (`name` = the tenant's, normalised; `code` SELF; `kind` other) — and one CREATE
 *     audit row each, in the facility's own tenant, under `system:client-facility-backfill`
 *     (changes.operation CREATE_SELF_FACILITY). Set-based, idempotent: a tenant that already has one
 *     is skipped, and so is its audit row.
 *
 * The CHECKs, indexes and triggers live only here, never on the models (ADR-100 Am. 3). Throws,
 * never skips, when a prerequisite is absent (PR-5); no try/catch. Verify with psql, not the log:
 *   SELECT count(*), count(*) FILTER (WHERE is_self) FROM client_facilities;      -- = tenants
 *   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'client_facility_moves'::regclass AND NOT tgisinternal;
 *
 * `down` REFUSES while any facility beyond a tenant's own, any move or any bound user exists; on a
 * single-facility database it drops what `up` made — except `audit_logs.client_facility_id` and its
 * index, which stay (the audit trail is append-only; dropping the column would erase what it says).
 */
import { DataTypes, type QueryInterface, type Sequelize, type Transaction } from "sequelize";
import {
  CLIENT_FACILITY_KINDS,
  CLIENT_FACILITY_MOVE_STATUSES,
  CLIENT_FACILITY_STATUSES,
} from "@callibrator/contracts/states";
import {
  BINDING_SETTING,
  BOUND_ROLE_NAMES,
  FACILITY_ATTACHMENT_TYPES,
  LOCK_TIMEOUT,
  MOVE_SETTING,
  NO_FACILITY_ID,
  appRoleName,
  constraintNames,
  createAlwaysTrigger,
  refuseDownWhenFacilitiesUsed,
  requireTables,
  roleExists,
  run,
  sqlList,
  tableExists,
  columnExists,
} from "./facilityMigration.shared";

const TABLE = "client_facilities";
const MOVES = "client_facility_moves";
const ENUM_TYPES = Object.freeze([
  "enum_client_facilities_kind",
  "enum_client_facilities_status",
  "enum_client_facility_moves_status",
]);
const BACKFILL_ACTOR = "system:client-facility-backfill";
const SELF_CODE = "SELF";

/** CHECK name -> predicate, on client_facilities. */
const CHECKS: Readonly<Record<string, string>> = Object.freeze({
  client_facilities_id_not_sentinel: `id <> '${NO_FACILITY_ID}'::uuid`,
  client_facilities_self_active: "NOT is_self OR status = 'active'",
  client_facilities_status_reason: "status = 'active' OR btrim(coalesce(status_reason, '')) <> ''",
  client_facilities_code_shape: "code ~ '^[A-Z0-9][A-Z0-9._-]{0,31}$'",
  client_facilities_name_normalised: "name <> '' AND name = btrim(regexp_replace(name, '\\s+', ' ', 'g'))",
  client_facilities_legacy_id_positive: "legacy_id IS NULL OR legacy_id > 0",
});

/** CHECK name -> predicate, on client_facility_moves. */
const MOVE_CHECKS: Readonly<Record<string, string>> = Object.freeze({
  client_facility_moves_distinct: "from_client_facility_id <> to_client_facility_id",
  client_facility_moves_reason: "btrim(reason) <> ''",
  client_facility_moves_completed: "(status = 'completed') = (completed_at IS NOT NULL)",
});

/** The composite keys of the move log (name -> SQL). */
const MOVE_FKS: Readonly<Record<string, string>> = Object.freeze({
  client_facility_moves_from_fkey:
    `ALTER TABLE ${MOVES} ADD CONSTRAINT client_facility_moves_from_fkey FOREIGN KEY (tenant_id, from_client_facility_id) ` +
    `REFERENCES ${TABLE} (tenant_id, id) ON DELETE RESTRICT`,
  client_facility_moves_to_fkey:
    `ALTER TABLE ${MOVES} ADD CONSTRAINT client_facility_moves_to_fkey FOREIGN KEY (tenant_id, to_client_facility_id) ` +
    `REFERENCES ${TABLE} (tenant_id, id) ON DELETE RESTRICT`,
  client_facility_moves_device_fkey:
    `ALTER TABLE ${MOVES} ADD CONSTRAINT client_facility_moves_device_fkey FOREIGN KEY (tenant_id, device_id) ` +
    "REFERENCES calibration_devices (tenant_id, id) ON DELETE RESTRICT",
});

/** The unique target the move log's device key needs (P20-02's, made idempotent here). */
const DEVICE_TENANT_ID_UNIQUE = "calibration_devices_tenant_id_id_unique";
const AUDIT_INDEX = "audit_logs_tenant_id_client_facility_id_created_at";

const INDEX_SQL = Object.freeze([
  `CREATE UNIQUE INDEX IF NOT EXISTS client_facilities_tenant_id_id_unique ON ${TABLE} (tenant_id, id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_facilities_tenant_code_unique ON ${TABLE} (tenant_id, code)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_facilities_tenant_name_unique ON ${TABLE} (tenant_id, lower(btrim(name)))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_facilities_one_self ON ${TABLE} (tenant_id) WHERE is_self`,
  `CREATE UNIQUE INDEX IF NOT EXISTS client_facilities_tenant_legacy_id_unique ON ${TABLE} (tenant_id, legacy_id) WHERE legacy_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS client_facilities_created_by ON ${TABLE} (created_by)`,
  `CREATE INDEX IF NOT EXISTS client_facilities_updated_by ON ${TABLE} (updated_by)`,
  `CREATE INDEX IF NOT EXISTS client_facilities_status_changed_by ON ${TABLE} (status_changed_by)`,
  `CREATE INDEX IF NOT EXISTS client_facilities_tenant_status_name ON ${TABLE} (tenant_id, status, lower(name), id)`,
  `CREATE INDEX IF NOT EXISTS client_facility_moves_tenant_device_created ON ${MOVES} (tenant_id, device_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS client_facility_moves_tenant_from ON ${MOVES} (tenant_id, from_client_facility_id)`,
  `CREATE INDEX IF NOT EXISTS client_facility_moves_tenant_to ON ${MOVES} (tenant_id, to_client_facility_id)`,
  `CREATE INDEX IF NOT EXISTS client_facility_moves_moved_by ON ${MOVES} (moved_by)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ${DEVICE_TENANT_ID_UNIQUE} ON calibration_devices (tenant_id, id)`,
]);

const UUID_RE = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const ATTACHMENT_TYPES = sqlList(FACILITY_ATTACHMENT_TYPES);

/** Every function this migration defines, in creation order (down drops them in reverse). */
const FUNCTIONS: readonly (readonly [name: string, signature: string, sql: string])[] = Object.freeze([
  [
    "client_facilities_identity_immutable",
    "()",
    `
CREATE OR REPLACE FUNCTION client_facilities_identity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.is_self IS DISTINCT FROM OLD.is_self THEN
    RAISE EXCEPTION 'client facility %: its id, tenant and self flag never change', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "client_facility_moves_append_only",
    "()",
    `
CREATE OR REPLACE FUNCTION client_facility_moves_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  mutable CONSTANT text[] := ARRAY['status', 'completed_at', 'counts'];
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION '${MOVES} is append-only: TRUNCATE is refused' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '${MOVES} is append-only: move % cannot be deleted', OLD.id USING ERRCODE = '42501';
  END IF;
  IF OLD.status::text <> 'in_progress' OR NEW.status::text <> 'completed'
     OR (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION '${MOVES} is append-only: move % only completes, once (status, completed_at, counts)', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "client_facility_moves_complete_at_commit",
    "()",
    `
CREATE OR REPLACE FUNCTION client_facility_moves_complete_at_commit() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM ${MOVES} m WHERE m.id = NEW.id AND m.status::text = 'in_progress') THEN
    RAISE EXCEPTION 'device move % was not completed in its transaction', NEW.id
      USING ERRCODE = '23514',
            HINT = 'A move row is inserted in_progress and marked completed by the same transaction (ADR-124 Am. 2 § 2).';
  END IF;
  RETURN NULL;
END
$fn$`,
  ],
  [
    "facility_move_admits",
    "(uuid, uuid, uuid, uuid)",
    `
CREATE OR REPLACE FUNCTION facility_move_admits(p_tenant uuid, p_device uuid, p_from uuid, p_to uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_move text := current_setting('${MOVE_SETTING}', true);
BEGIN
  IF v_move IS NULL OR v_move !~ '${UUID_RE}' OR p_device IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM ${MOVES} m
     WHERE m.id = v_move::uuid AND m.status::text = 'in_progress' AND m.tenant_id = p_tenant
       AND m.device_id = p_device
       AND m.from_client_facility_id IS NOT DISTINCT FROM p_from
       AND m.to_client_facility_id IS NOT DISTINCT FROM p_to);
END
$fn$`,
  ],
  [
    "facility_resource_device",
    "(uuid, text, uuid)",
    `
CREATE OR REPLACE FUNCTION facility_resource_device(p_tenant uuid, p_type text, p_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v uuid;
BEGIN
  CASE lower(p_type)
    WHEN 'device', 'calibrationdevice' THEN
      SELECT d.id INTO v FROM calibration_devices d WHERE d.id = p_id AND d.tenant_id = p_tenant;
    WHEN 'certificate' THEN
      SELECT c.device_id INTO v FROM certificates c WHERE c.id = p_id AND c.tenant_id = p_tenant;
    WHEN 'calibration', 'calibrationrecord' THEN
      SELECT r.device_id INTO v FROM calibration_records r WHERE r.id = p_id AND r.tenant_id = p_tenant;
    WHEN 'workorder', 'maintenanceworkorder' THEN
      SELECT w.device_id INTO v FROM maintenance_work_orders w WHERE w.id = p_id AND w.tenant_id = p_tenant;
    ELSE
      v := NULL;
  END CASE;
  RETURN v;
END
$fn$`,
  ],
  [
    "facility_resource_facility",
    "(uuid, text, uuid)",
    `
CREATE OR REPLACE FUNCTION facility_resource_facility(p_tenant uuid, p_type text, p_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v uuid;
BEGIN
  -- Soft-deleted resources included: a file of a deleted record keeps its record's facility.
  CASE lower(p_type)
    WHEN 'device', 'calibrationdevice' THEN
      SELECT d.client_facility_id INTO v FROM calibration_devices d WHERE d.id = p_id AND d.tenant_id = p_tenant;
    WHEN 'certificate' THEN
      SELECT c.client_facility_id INTO v FROM certificates c WHERE c.id = p_id AND c.tenant_id = p_tenant;
    WHEN 'calibration', 'calibrationrecord' THEN
      SELECT r.client_facility_id INTO v FROM calibration_records r WHERE r.id = p_id AND r.tenant_id = p_tenant;
    WHEN 'workorder', 'maintenanceworkorder' THEN
      SELECT w.client_facility_id INTO v FROM maintenance_work_orders w WHERE w.id = p_id AND w.tenant_id = p_tenant;
    ELSE
      v := NULL;
  END CASE;
  RETURN v;
END
$fn$`,
  ],
  [
    "facility_column_guard",
    "()",
    `
CREATE OR REPLACE FUNCTION facility_column_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_device uuid;
BEGIN
  IF NEW.client_facility_id IS NOT DISTINCT FROM OLD.client_facility_id THEN
    RETURN NEW;
  END IF;
  IF TG_ARGV[0] = 'device' THEN
    v_device := NEW.id;
  ELSIF TG_ARGV[0] = 'attachment' THEN
    v_device := facility_resource_device(NEW.tenant_id, NEW.resource_type, NEW.resource_id);
  ELSE
    -- 'child' and 'nc': the row's own device. An NC whose device link is cleared drops its
    -- facility with it (the device key's ON DELETE SET NULL; ADR-124 Am. 3).
    IF TG_ARGV[0] = 'nc' AND NEW.device_id IS NULL AND NEW.client_facility_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_device := NEW.device_id;
  END IF;
  IF NOT facility_move_admits(NEW.tenant_id, v_device, OLD.client_facility_id, NEW.client_facility_id) THEN
    RAISE EXCEPTION '%: the client facility of % is changed only by an audited device move', TG_TABLE_NAME, OLD.id
      USING ERRCODE = '42501',
            HINT = 'POST /calibration-devices/:id/move (ADR-124 Am. 2 § 2); the column is immutable otherwise, for every role.';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "facility_insert_default",
    "()",
    `
CREATE OR REPLACE FUNCTION facility_insert_default() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_self uuid;
BEGIN
  IF TG_ARGV[0] = 'device' THEN
    IF NEW.client_facility_id IS NULL THEN
      SELECT f.id INTO v_self FROM ${TABLE} f WHERE f.tenant_id = NEW.tenant_id AND f.is_self;
      IF v_self IS NULL THEN
        RAISE EXCEPTION 'calibration device: tenant % has no self client facility to place it in', NEW.tenant_id
          USING ERRCODE = '23502',
                HINT = 'Every tenant-creation path calls clientFacilityService.createSelfFacility (ADR-124 Am. 2 § 4).';
      END IF;
      IF EXISTS (SELECT 1 FROM ${TABLE} f WHERE f.tenant_id = NEW.tenant_id AND NOT f.is_self) THEN
        RAISE EXCEPTION 'calibration device: client_facility_id is required — tenant % serves client facilities beyond its own', NEW.tenant_id
          USING ERRCODE = '23502';
      END IF;
      NEW.client_facility_id := v_self;
    END IF;
  ELSIF TG_ARGV[0] = 'attachment' THEN
    IF NEW.client_facility_id IS NULL AND NEW.resource_id IS NOT NULL
       AND lower(NEW.resource_type) IN (${ATTACHMENT_TYPES}) THEN
      NEW.client_facility_id := facility_resource_facility(NEW.tenant_id, NEW.resource_type, NEW.resource_id);
    END IF;
  ELSIF TG_ARGV[0] = 'nc' AND NEW.device_id IS NULL THEN
    NEW.client_facility_id := NULL;
  ELSIF NEW.client_facility_id IS NULL AND NEW.device_id IS NOT NULL THEN
    -- 'child' and 'nc': the device's facility, in the row's own tenant — the only value the
    -- composite key accepts. A value given explicitly is never replaced; the key checks it.
    SELECT d.client_facility_id INTO NEW.client_facility_id
      FROM calibration_devices d WHERE d.id = NEW.device_id AND d.tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "facility_accepts_inserts",
    "()",
    `
CREATE OR REPLACE FUNCTION facility_accepts_inserts() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_name text;
BEGIN
  IF NEW.client_facility_id IS NOT NULL THEN
    SELECT f.name INTO v_name FROM ${TABLE} f WHERE f.id = NEW.client_facility_id AND f.status::text = 'ended';
    IF FOUND THEN
      RAISE EXCEPTION '% has ended; new records cannot be added (%)', v_name, TG_TABLE_NAME
        USING ERRCODE = '23514',
              HINT = 'Reinstate the client facility first (ADR-124 Am. 2 § 3).';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "users_binding_guard",
    "()",
    `
CREATE OR REPLACE FUNCTION users_binding_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.client_facility_id IS DISTINCT FROM OLD.client_facility_id
     AND coalesce(current_setting('${BINDING_SETTING}', true), '') <> OLD.id::text THEN
    RAISE EXCEPTION 'user %: the facility binding is changed only by the binding operation', OLD.id
      USING ERRCODE = '42501',
            HINT = 'PUT /users/:userId/client-facility (ADR-124 Am. 2 § 6).';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "users_bound_role_check",
    "()",
    `
CREATE OR REPLACE FUNCTION users_bound_role_check() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_role text;
BEGIN
  IF NEW.client_facility_id IS NOT NULL THEN
    SELECT r.name INTO v_role FROM roles r WHERE r.id = NEW.role_id;
    IF v_role IS NULL OR v_role NOT IN (${sqlList(BOUND_ROLE_NAMES)}) THEN
      RAISE EXCEPTION 'user %: a user bound to a client facility holds one of ${BOUND_ROLE_NAMES.join(", ")} (has %)',
        NEW.id, coalesce(v_role, 'no role')
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
]);

/** The self facility for every tenant without one, and its CREATE audit row — one statement. */
const SELF_FACILITY_SQL = `
WITH created AS (
  INSERT INTO ${TABLE} (id, tenant_id, name, code, kind, is_self, status, created_at, updated_at)
  SELECT gen_random_uuid(), t.id,
         coalesce(nullif(btrim(left(regexp_replace(btrim(t.name), '\\s+', ' ', 'g'), 255)), ''), '${SELF_CODE}'),
         '${SELF_CODE}', 'other', true, 'active', now(), now()
    FROM tenants t
   WHERE NOT EXISTS (SELECT 1 FROM ${TABLE} f WHERE f.tenant_id = t.id AND f.is_self)
  RETURNING id, tenant_id, name, code
)
INSERT INTO audit_logs (id, tenant_id, user_id, actor_type, actor_name, action, resource_type, resource_id,
                        client_facility_id, changes, created_at)
SELECT gen_random_uuid(), c.tenant_id, NULL, 'system', '${BACKFILL_ACTOR}', 'CREATE', 'ClientFacility', c.id::text,
       c.id,
       jsonb_build_object('operation', 'CREATE_SELF_FACILITY', 'actor', '${BACKFILL_ACTOR}', 'tenantId', c.tenant_id,
                          'before', '{}'::jsonb,
                          'after', jsonb_build_object('name', c.name, 'code', c.code, 'kind', 'other', 'isSelf', true,
                                                      'status', 'active')),
       now()
  FROM created c`;

const userFk = (): { type: typeof DataTypes.UUID; allowNull: boolean; references: object; onDelete: string; onUpdate: string } => ({
  type: DataTypes.UUID,
  allowNull: true,
  references: { model: "users", key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

const tenantFk = (): { type: typeof DataTypes.UUID; allowNull: boolean; references: object; onDelete: string; onUpdate: string } => ({
  type: DataTypes.UUID,
  allowNull: false,
  references: { model: "tenants", key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

/** client_facilities as the model declares it (tests/migrations/0117 holds the two equal). */
const createFacilities = (context: QueryInterface, transaction: Transaction): Promise<void> =>
  context.createTable(
    TABLE,
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      tenant_id: tenantFk(),
      name: { type: DataTypes.STRING(255), allowNull: false },
      code: { type: DataTypes.STRING(32), allowNull: false },
      kind: { type: DataTypes.ENUM(...CLIENT_FACILITY_KINDS), allowNull: false, defaultValue: "other" },
      is_self: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.ENUM(...CLIENT_FACILITY_STATUSES), allowNull: false, defaultValue: "active" },
      status_reason: { type: DataTypes.STRING(500), allowNull: true },
      status_changed_at: { type: DataTypes.DATE, allowNull: true },
      status_changed_by: userFk(),
      address: { type: DataTypes.STRING(500), allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: true },
      province: { type: DataTypes.STRING(100), allowNull: true },
      postal_code: { type: DataTypes.STRING(20), allowNull: true },
      phone: { type: DataTypes.STRING(50), allowNull: true },
      contact_name: { type: DataTypes.STRING(255), allowNull: true },
      contact_email: { type: DataTypes.STRING(255), allowNull: true },
      contact_phone: { type: DataTypes.STRING(50), allowNull: true },
      logo_storage_key: { type: DataTypes.STRING(1024), allowNull: true },
      legacy_id: { type: DataTypes.INTEGER, allowNull: true },
      created_by: userFk(),
      updated_by: userFk(),
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    { transaction },
  );

/** client_facility_moves as the model declares it. */
const createMoves = (context: QueryInterface, transaction: Transaction): Promise<void> =>
  context.createTable(
    MOVES,
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      tenant_id: tenantFk(),
      device_id: { type: DataTypes.UUID, allowNull: false },
      from_client_facility_id: { type: DataTypes.UUID, allowNull: false },
      to_client_facility_id: { type: DataTypes.UUID, allowNull: false },
      reason: { type: DataTypes.STRING(500), allowNull: false },
      status: { type: DataTypes.ENUM(...CLIENT_FACILITY_MOVE_STATUSES), allowNull: false, defaultValue: "in_progress" },
      counts: { type: DataTypes.JSONB, allowNull: true },
      moved_by: { ...userFk(), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    },
    { transaction },
  );

const addChecks = async (
  sequelize: Sequelize,
  transaction: Transaction,
  table: string,
  checks: Readonly<Record<string, string>>,
): Promise<void> => {
  const own = await constraintNames(sequelize, transaction, table);
  for (const [name, predicate] of Object.entries(checks)) {
    if (!own.has(name)) {
      await run(sequelize, transaction, `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${predicate})`);
    }
  }
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const role = appRoleName("0117");
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await requireTables(sequelize, transaction, "0117", ["tenants", "users", "roles", "calibration_devices", "audit_logs"]);
    if (!(await roleExists(sequelize, transaction, role))) {
      throw new Error(
        `0117: the application role "${role}" does not exist. Migration 0057 creates it; ` +
          "run the migrations in order, or create it as an administrator (see 0057).",
      );
    }

    // 1. The tables (sync() made them on a database that never had them).
    if (!(await tableExists(sequelize, transaction, TABLE))) {
      await createFacilities(context, transaction);
    }
    if (!(await tableExists(sequelize, transaction, MOVES))) {
      await createMoves(context, transaction);
    }

    // 2. CHECKs and indexes (the device's (tenant_id, id) unique among them — the move log's key needs it).
    await addChecks(sequelize, transaction, TABLE, CHECKS);
    await addChecks(sequelize, transaction, MOVES, MOVE_CHECKS);
    for (const statement of INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }
    const moveConstraints = await constraintNames(sequelize, transaction, MOVES);
    for (const [name, statement] of Object.entries(MOVE_FKS)) {
      if (!moveConstraints.has(name)) {
        await run(sequelize, transaction, statement);
      }
    }

    // 3 + 7. The functions, then the triggers of the two tables.
    for (const [, , statement] of FUNCTIONS) {
      await run(sequelize, transaction, statement);
    }
    await createAlwaysTrigger(
      sequelize,
      transaction,
      TABLE,
      "client_facilities_identity_immutable",
      `TRIGGER client_facilities_identity_immutable BEFORE UPDATE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION client_facilities_identity_immutable()`,
    );
    await createAlwaysTrigger(
      sequelize,
      transaction,
      MOVES,
      "client_facility_moves_append_only",
      `TRIGGER client_facility_moves_append_only BEFORE UPDATE OR DELETE ON ${MOVES} FOR EACH ROW EXECUTE FUNCTION client_facility_moves_append_only()`,
    );
    await createAlwaysTrigger(
      sequelize,
      transaction,
      MOVES,
      "client_facility_moves_no_truncate",
      `TRIGGER client_facility_moves_no_truncate BEFORE TRUNCATE ON ${MOVES} FOR EACH STATEMENT EXECUTE FUNCTION client_facility_moves_append_only()`,
    );
    await createAlwaysTrigger(
      sequelize,
      transaction,
      MOVES,
      "client_facility_moves_complete_at_commit",
      `CONSTRAINT TRIGGER client_facility_moves_complete_at_commit AFTER INSERT ON ${MOVES} ` +
        "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION client_facility_moves_complete_at_commit()",
    );
    await run(sequelize, transaction, `REVOKE DELETE, TRUNCATE ON ${MOVES} FROM ${role}`);

    // 6. The audit trail's facility (no FK, no back-fill) and its breach-scoping index.
    if (!(await columnExists(sequelize, transaction, "audit_logs", "client_facility_id"))) {
      await run(sequelize, transaction, "ALTER TABLE audit_logs ADD COLUMN client_facility_id UUID");
    }
    await run(sequelize, transaction, `CREATE INDEX IF NOT EXISTS ${AUDIT_INDEX} ON audit_logs (tenant_id, client_facility_id, created_at)`);

    // 8. One self facility per tenant, and its audit row.
    await run(sequelize, transaction, SELF_FACILITY_SQL);
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await refuseDownWhenFacilitiesUsed(sequelize, transaction, "0117");
    // audit_logs.client_facility_id and its index STAY (append-only trail).
    await run(sequelize, transaction, `DROP TABLE IF EXISTS ${MOVES}`);
    await run(sequelize, transaction, `DROP TABLE IF EXISTS ${TABLE}`);
    await run(sequelize, transaction, `DROP INDEX IF EXISTS ${DEVICE_TENANT_ID_UNIQUE}`);
    for (const [name, signature] of [...FUNCTIONS].reverse()) {
      await run(sequelize, transaction, `DROP FUNCTION IF EXISTS ${name}${signature}`);
    }
    for (const type of ENUM_TYPES) {
      await run(sequelize, transaction, `DROP TYPE IF EXISTS "${type}"`);
    }
  });
};

export = {
  TABLE,
  MOVES,
  ENUM_TYPES,
  BACKFILL_ACTOR,
  SELF_CODE,
  CHECKS,
  MOVE_CHECKS,
  MOVE_FKS,
  INDEX_SQL,
  FUNCTIONS,
  SELF_FACILITY_SQL,
  DEVICE_TENANT_ID_UNIQUE,
  AUDIT_INDEX,
  up,
  down,
};
