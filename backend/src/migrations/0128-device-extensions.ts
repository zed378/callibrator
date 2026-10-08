/**
 * Migration 0128 — the device register's extensions and the calibration-date columns (P20-02;
 * ADR-132, ADR-133 and their Amendment 1; specs MEMORY/specs/P19-03-device-extensions.md § 4,
 * § 6.1, § 6.2 and MEMORY/specs/P19-05-calibration-dates.md § 4).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. The ENUM types (`enum_<table>_<column>`, Sequelize's names), each unless it exists — on an
 *     upgrade, the boot's db.sync() has already created them (ensureEnums), though not the columns.
 *  2. The columns, each unless it exists (db.sync() builds them on a fresh database). Every one is
 *     nullable or has a constant default, so no table is rewritten:
 *       calibration_devices  qr_code, inventoried_on, accessories_complete, condition (+ _changed_at,
 *                            _source), calibration_vendor_id → vendors SET NULL, created_by → users
 *                            RESTRICT, registrant_snapshot, ipm_interval_months, client_ref,
 *                            next_calibration_date_source, calibration_requested_at,
 *                            calibration_requested_by_session_id;
 *       warehouses           kind (NOT NULL DEFAULT 'store' — every existing row stays a store), floor;
 *       calibration_records  entry_kind (NOT NULL DEFAULT 'full_record'), calibration_vendor_id →
 *                            vendors SET NULL, external_lab_name, room_snapshot, floor_snapshot,
 *                            performer_snapshot. These are immutable after insert by the existing
 *                            append-only trigger (0057/0119 compare the whole row); adding a column
 *                            with a constant default updates no row, so the trigger is not lifted.
 *  3. The one back-fill (P19-05 § 4.2): `next_calibration_date_source = 'manual'` where a device has
 *     a next calibration date — calibration_devices is not append-only.
 *  4. CHECKs (sync never creates one): the QR's normalised shape, the inventory floor, the
 *     condition ⇔ source pair, the IPM interval 0 – 60, the next-date ⇔ source pair, the request
 *     pair, a client_ref only with its creator; a room has a facility, a store has no floor; an
 *     external date names its lab (or is the import's) and carries no results.
 *  5. Indexes, every one here and none on a model (ADR-100 Am. 3): the QR unique PER TENANT over
 *     every row (deleted and retired included — a sticker is physical, A-133), `client_ref` per
 *     creator, the room name unique PER FACILITY among live rooms, and a leading index on every new
 *     foreign key (D-20). The serial unique per facility is 0118's and the `(tenant_id, id)` unique
 *     0117's — reused, not created again.
 *  6. `calibration_devices.calibration_requested_by_session_id` → inspection_sessions (id) RESTRICT,
 *     single-column (no facility in it: the device move's cascade has one path — P19-04 § 5.1).
 *  7. Triggers, ENABLE ALWAYS (every role, the owner too):
 *       calibration_devices_location_facility    a ROOM holds only devices of its own facility; any
 *                                                location is of the device's tenant (spec § 6.2);
 *       calibration_devices_request_same_device  the requesting IPM session is this device's (P19-05 § 4.2);
 *       calibration_devices_next_date_source     fills the source: NULL with no date, 'manual' when a
 *                                                date is written without one (ADR-133 Am. 1 § 1);
 *       warehouses_room_devices_facility         a room's facility or kind does not change under the
 *                                                devices it holds (ADR-132 Am. 1 § 2).
 *
 * Throws, never skips, when a prerequisite is absent (PR-5); no try/catch. Verify with psql, not
 * the log:
 *   \d calibration_devices
 *   SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('calibration_devices_location_facility',
 *     'calibration_devices_request_same_device', 'calibration_devices_next_date_source', 'warehouses_room_devices_facility');
 *
 * `down` REFUSES while any new column holds a value it would destroy (a QR, a condition, a room, an
 * external calibration, a snapshot …); the derived `next_calibration_date_source` does not count.
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import {
  CALIBRATION_ENTRY_KINDS,
  DEVICE_CONDITION_SOURCES,
  DEVICE_CONDITIONS,
  INVENTORIED_ON_MIN,
  IPM_INTERVAL_MONTHS_MAX,
  NEXT_CALIBRATION_DATE_SOURCES,
  QR_CODE_PATTERN,
  WAREHOUSE_KINDS,
} from "@callibrator/contracts/deviceValues";
import {
  LOCK_TIMEOUT,
  columnExists,
  constraintNames,
  createAlwaysTrigger,
  requireTables,
  rows,
  run,
  sqlList,
} from "./facilityMigration.shared";

const DEVICES = "calibration_devices";
const WAREHOUSES = "warehouses";
const RECORDS = "calibration_records";

/** The ENUM types (name -> values, in the contract's order — the order sync() creates them in). */
const ENUM_TYPES: readonly (readonly [name: string, values: readonly string[]])[] = Object.freeze([
  ["enum_calibration_devices_condition", DEVICE_CONDITIONS],
  ["enum_calibration_devices_condition_source", DEVICE_CONDITION_SOURCES],
  ["enum_calibration_devices_next_calibration_date_source", NEXT_CALIBRATION_DATE_SOURCES],
  ["enum_warehouses_kind", WAREHOUSE_KINDS],
  ["enum_calibration_records_entry_kind", CALIBRATION_ENTRY_KINDS],
]);

/** Columns added (table, column, DDL) — the models declare the same (tests/migrations/0128 holds them equal). */
const COLUMNS: readonly (readonly [table: string, column: string, ddl: string])[] = Object.freeze([
  [DEVICES, "qr_code", "VARCHAR(32)"],
  [DEVICES, "inventoried_on", "DATE"],
  [DEVICES, "accessories_complete", "BOOLEAN"],
  [DEVICES, "condition", '"enum_calibration_devices_condition"'],
  [DEVICES, "condition_changed_at", "TIMESTAMP WITH TIME ZONE"],
  [DEVICES, "condition_source", '"enum_calibration_devices_condition_source"'],
  [DEVICES, "calibration_vendor_id", "UUID REFERENCES vendors (id) ON DELETE SET NULL ON UPDATE CASCADE"],
  [DEVICES, "created_by", "UUID REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE"],
  [DEVICES, "registrant_snapshot", "JSONB"],
  [DEVICES, "ipm_interval_months", "SMALLINT"],
  [DEVICES, "client_ref", "UUID"],
  [DEVICES, "next_calibration_date_source", '"enum_calibration_devices_next_calibration_date_source"'],
  [DEVICES, "calibration_requested_at", "TIMESTAMP WITH TIME ZONE"],
  [DEVICES, "calibration_requested_by_session_id", "UUID"],
  [WAREHOUSES, "kind", "\"enum_warehouses_kind\" NOT NULL DEFAULT 'store'"],
  [WAREHOUSES, "floor", "VARCHAR(50)"],
  [RECORDS, "entry_kind", "\"enum_calibration_records_entry_kind\" NOT NULL DEFAULT 'full_record'"],
  [RECORDS, "calibration_vendor_id", "UUID REFERENCES vendors (id) ON DELETE SET NULL ON UPDATE CASCADE"],
  [RECORDS, "external_lab_name", "VARCHAR(255)"],
  [RECORDS, "room_snapshot", "VARCHAR(255)"],
  [RECORDS, "floor_snapshot", "VARCHAR(50)"],
  [RECORDS, "performer_snapshot", "JSONB"],
]);

/** P19-05 § 4.2: a date that exists was set through the device form — the honest label of every existing row. */
const BACKFILL_SQL =
  `UPDATE ${DEVICES} SET next_calibration_date_source = 'manual' ` +
  "WHERE next_calibration_date IS NOT NULL AND next_calibration_date_source IS NULL";

/** CHECK name -> [table, predicate]. */
const CHECKS: Readonly<Record<string, readonly [table: string, predicate: string]>> = Object.freeze({
  calibration_devices_qr_code_shape: [DEVICES, `qr_code IS NULL OR qr_code ~ '${QR_CODE_PATTERN}'`],
  calibration_devices_inventoried_on_floor: [DEVICES, `inventoried_on IS NULL OR inventoried_on >= DATE '${INVENTORIED_ON_MIN}'`],
  calibration_devices_condition_source: [DEVICES, '("condition" IS NULL) = (condition_source IS NULL)'],
  calibration_devices_ipm_interval: [DEVICES, `ipm_interval_months IS NULL OR ipm_interval_months BETWEEN 0 AND ${String(IPM_INTERVAL_MONTHS_MAX)}`],
  calibration_devices_next_date_has_source: [DEVICES, "(next_calibration_date IS NULL) = (next_calibration_date_source IS NULL)"],
  calibration_devices_calibration_request: [DEVICES, "(calibration_requested_at IS NULL) = (calibration_requested_by_session_id IS NULL)"],
  calibration_devices_client_ref_creator: [DEVICES, "client_ref IS NULL OR created_by IS NOT NULL"],
  warehouses_room_has_facility: [WAREHOUSES, "kind <> 'room' OR client_facility_id IS NOT NULL"],
  warehouses_store_no_floor: [WAREHOUSES, "kind = 'room' OR floor IS NULL"],
  calibration_records_external_has_lab: [
    RECORDS,
    "entry_kind <> 'external_date' OR external_lab_name IS NOT NULL OR api_key_id IS NOT NULL " +
      "OR coalesce(performer_snapshot->>'source', '') = 'upstream-import'",
  ],
  calibration_records_external_no_results: [
    RECORDS,
    "entry_kind <> 'external_date' OR (results IS NULL AND measurement_uncertainty IS NULL AND standard IS NULL)",
  ],
});

const INDEX_SQL = Object.freeze([
  // A sticker is physical: unique per tenant over EVERY row (soft-deleted and retired included).
  `CREATE UNIQUE INDEX IF NOT EXISTS calibration_devices_tenant_qr_code_unique ON ${DEVICES} (tenant_id, qr_code) WHERE qr_code IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS calibration_devices_client_ref_unique ON ${DEVICES} (tenant_id, created_by, client_ref) WHERE client_ref IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS calibration_devices_calibration_vendor_id ON ${DEVICES} (calibration_vendor_id)`,
  `CREATE INDEX IF NOT EXISTS calibration_devices_created_by ON ${DEVICES} (created_by)`,
  `CREATE INDEX IF NOT EXISTS calibration_devices_tenant_condition ON ${DEVICES} (tenant_id, "condition")`,
  `CREATE INDEX IF NOT EXISTS calibration_devices_calibration_requested_by_session_id ON ${DEVICES} (calibration_requested_by_session_id)`,
  // A room's name (and floor) is unique PER FACILITY among live rooms — never global.
  `CREATE UNIQUE INDEX IF NOT EXISTS warehouses_room_name_unique ON ${WAREHOUSES} ` +
    "(tenant_id, client_facility_id, lower(btrim(name)), coalesce(lower(btrim(floor)), '')) WHERE kind = 'room' AND is_deleted = false",
  `CREATE INDEX IF NOT EXISTS calibration_records_calibration_vendor_id ON ${RECORDS} (calibration_vendor_id)`,
]);
/** Every index `up` creates, by name (for `down`). */
const INDEX_NAMES = Object.freeze(INDEX_SQL.map((statement) => (/INDEX IF NOT EXISTS (\w+) /.exec(statement) ?? ["", ""])[1]));

/** The request's key (P19-05 § 4.2): single-column, RESTRICT — a session is never deleted anyway (0127). */
const SESSION_FK = "calibration_devices_calibration_requested_by_session_id_fkey";
const SESSION_FK_SQL =
  `ALTER TABLE ${DEVICES} ADD CONSTRAINT ${SESSION_FK} FOREIGN KEY (calibration_requested_by_session_id) ` +
  "REFERENCES inspection_sessions (id) ON UPDATE RESTRICT ON DELETE RESTRICT";

/** Every function this migration defines (its trigger has the same name), in creation order. */
const FUNCTIONS: readonly (readonly [name: string, sql: string])[] = Object.freeze([
  [
    "calibration_devices_location_facility",
    `
CREATE OR REPLACE FUNCTION calibration_devices_location_facility() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  w record;
BEGIN
  IF NEW.location_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT x.tenant_id, x.kind::text AS kind, x.client_facility_id, x.name INTO w FROM ${WAREHOUSES} x WHERE x.id = NEW.location_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key answers (23503)
  END IF;
  IF w.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'calibration device %: its location % belongs to another tenant', NEW.id, NEW.location_id
      USING ERRCODE = '23514';
  END IF;
  IF w.kind = 'room' AND w.client_facility_id IS DISTINCT FROM NEW.client_facility_id THEN
    RAISE EXCEPTION 'calibration device %: room % belongs to another client facility', NEW.id, w.name
      USING ERRCODE = '23514',
            HINT = 'A room holds only devices of its facility; a store holds any (ADR-132 § 5). A device move clears or re-targets the room (§ 8).';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "calibration_devices_request_same_device",
    `
CREATE OR REPLACE FUNCTION calibration_devices_request_same_device() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.calibration_requested_by_session_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM inspection_sessions s
        WHERE s.id = NEW.calibration_requested_by_session_id AND s.tenant_id = NEW.tenant_id AND s.device_id = NEW.id) THEN
    RAISE EXCEPTION 'calibration device %: the calibration request names IPM session %, which is not this device''s',
      NEW.id, NEW.calibration_requested_by_session_id
      USING ERRCODE = '23514',
            HINT = 'An IPM recommending calibration flags its own device (P19-05 § 4.2, ADR-133 § 4).';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "calibration_devices_next_date_source",
    `
CREATE OR REPLACE FUNCTION calibration_devices_next_date_source() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  -- ADR-133 Am. 1 § 1: until every writer names the source (P21-05), a date written without one
  -- was set by hand; no date has no source. A source given explicitly is kept.
  IF NEW.next_calibration_date IS NULL THEN
    NEW.next_calibration_date_source := NULL;
  ELSIF NEW.next_calibration_date_source IS NULL THEN
    NEW.next_calibration_date_source := 'manual';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
  [
    "warehouses_room_devices_facility",
    `
CREATE OR REPLACE FUNCTION warehouses_room_devices_facility() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_held int;
BEGIN
  SELECT count(*) INTO v_held FROM ${DEVICES} d
   WHERE d.location_id = NEW.id
     AND (d.tenant_id IS DISTINCT FROM NEW.tenant_id
          OR (NEW.kind::text = 'room' AND d.client_facility_id IS DISTINCT FROM NEW.client_facility_id));
  IF v_held > 0 THEN
    RAISE EXCEPTION 'warehouse %: % device(s) it holds would be in another facility or tenant than it', NEW.id, v_held
      USING ERRCODE = '23514',
            HINT = 'A room holds only devices of its facility (ADR-132 § 5, Am. 1 § 2); move or re-locate the devices first.';
  END IF;
  RETURN NEW;
END
$fn$`,
  ],
]);

/** Every trigger `up` creates: [table, name, definition after CREATE]. */
const TRIGGERS: readonly (readonly [table: string, name: string, definition: string])[] = Object.freeze([
  [
    DEVICES,
    "calibration_devices_location_facility",
    `TRIGGER calibration_devices_location_facility BEFORE INSERT OR UPDATE OF location_id, client_facility_id, tenant_id ON ${DEVICES} ` +
      "FOR EACH ROW EXECUTE FUNCTION calibration_devices_location_facility()",
  ],
  [
    DEVICES,
    "calibration_devices_request_same_device",
    `TRIGGER calibration_devices_request_same_device BEFORE INSERT OR UPDATE OF calibration_requested_by_session_id ON ${DEVICES} ` +
      "FOR EACH ROW EXECUTE FUNCTION calibration_devices_request_same_device()",
  ],
  [
    DEVICES,
    "calibration_devices_next_date_source",
    `TRIGGER calibration_devices_next_date_source BEFORE INSERT OR UPDATE OF next_calibration_date, next_calibration_date_source ON ${DEVICES} ` +
      "FOR EACH ROW EXECUTE FUNCTION calibration_devices_next_date_source()",
  ],
  [
    WAREHOUSES,
    "warehouses_room_devices_facility",
    `TRIGGER warehouses_room_devices_facility BEFORE UPDATE OF kind, client_facility_id, tenant_id ON ${WAREHOUSES} ` +
      "FOR EACH ROW EXECUTE FUNCTION warehouses_room_devices_facility()",
  ],
]);

/** What `down` would destroy, per table: [table, the column that proves 0128 ran, predicate, label]. */
const DATA_HELD: readonly (readonly [table: string, column: string, predicate: string, label: string])[] = Object.freeze([
  [
    DEVICES,
    "qr_code",
    'qr_code IS NOT NULL OR inventoried_on IS NOT NULL OR accessories_complete IS NOT NULL OR "condition" IS NOT NULL ' +
      "OR calibration_vendor_id IS NOT NULL OR created_by IS NOT NULL OR registrant_snapshot IS NOT NULL " +
      "OR ipm_interval_months IS NOT NULL OR client_ref IS NOT NULL OR calibration_requested_at IS NOT NULL",
    "device(s) with a QR, condition, lab, registrant, IPM interval or calibration request",
  ],
  [WAREHOUSES, "kind", "kind <> 'store' OR floor IS NOT NULL", "room(s)"],
  [
    RECORDS,
    "entry_kind",
    "entry_kind <> 'full_record' OR calibration_vendor_id IS NOT NULL OR external_lab_name IS NOT NULL " +
      "OR room_snapshot IS NOT NULL OR floor_snapshot IS NOT NULL OR performer_snapshot IS NOT NULL",
    "calibration record(s) with an entry kind, lab or snapshot",
  ],
]);

/** The tables `up` needs before it starts. */
const PREREQUISITES = Object.freeze([DEVICES, WAREHOUSES, RECORDS, "vendors", "users", "inspection_sessions", "client_facilities"]);

const typeExists = async (sequelize: Sequelize, transaction: Transaction, name: string): Promise<boolean> =>
  (
    await rows(sequelize, transaction, "SELECT 1 FROM pg_type WHERE typname = :name AND typnamespace = current_schema()::regnamespace", {
      name,
    })
  ).length > 0;

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await requireTables(sequelize, transaction, "0128", PREREQUISITES);
    for (const table of [DEVICES, WAREHOUSES]) {
      if (!(await columnExists(sequelize, transaction, table, "client_facility_id"))) {
        throw new Error(`0128: ${table}.client_facility_id does not exist — migrations 0118 and 0123 must run first.`);
      }
    }

    // 1 + 2. The types, then the columns.
    for (const [name, values] of ENUM_TYPES) {
      if (!(await typeExists(sequelize, transaction, name))) {
        await run(sequelize, transaction, `CREATE TYPE "${name}" AS ENUM (${sqlList(values)})`);
      }
    }
    for (const [table, column, ddl] of COLUMNS) {
      if (!(await columnExists(sequelize, transaction, table, column))) {
        await run(sequelize, transaction, `ALTER TABLE ${table} ADD COLUMN "${column}" ${ddl}`);
      }
    }

    // 3. The back-fill, before the CHECK that needs it.
    await run(sequelize, transaction, BACKFILL_SQL);

    // 4. CHECKs.
    for (const [name, [table, predicate]] of Object.entries(CHECKS)) {
      if (!(await constraintNames(sequelize, transaction, table)).has(name)) {
        await run(sequelize, transaction, `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
    }

    // 5 + 6. Indexes, then the session key.
    for (const statement of INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }
    if (!(await constraintNames(sequelize, transaction, DEVICES)).has(SESSION_FK)) {
      await run(sequelize, transaction, SESSION_FK_SQL);
    }

    // 7. The functions, then the triggers.
    for (const [, statement] of FUNCTIONS) {
      await run(sequelize, transaction, statement);
    }
    for (const [table, name, definition] of TRIGGERS) {
      await createAlwaysTrigger(sequelize, transaction, table, name, definition);
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    const held: string[] = [];
    for (const [table, column, predicate, label] of DATA_HELD) {
      if (await columnExists(sequelize, transaction, table, column)) {
        const [row] = await rows(sequelize, transaction, `SELECT count(*)::int AS n FROM ${table} WHERE ${predicate}`);
        const n = Number(row?.["n"]);
        if (n > 0) {
          held.push(`${String(n)} ${label}`);
        }
      }
    }
    if (held.length > 0) {
      throw new Error(
        `0128 down: the database holds ${held.join(", ")}. Reverting would destroy them; ` +
          "restore the pre-upgrade backup instead (ADR-116). Nothing was changed.",
      );
    }
    for (const [table, name] of TRIGGERS) {
      await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${name} ON ${table}`);
    }
    for (const [name] of FUNCTIONS) {
      await run(sequelize, transaction, `DROP FUNCTION IF EXISTS ${name}()`);
    }
    await run(sequelize, transaction, `ALTER TABLE ${DEVICES} DROP CONSTRAINT IF EXISTS ${SESSION_FK}`);
    for (const name of INDEX_NAMES) {
      await run(sequelize, transaction, `DROP INDEX IF EXISTS ${name}`);
    }
    // The CHECKs and the inline keys go with their columns.
    for (const [table, column] of [...COLUMNS].reverse()) {
      await run(sequelize, transaction, `ALTER TABLE ${table} DROP COLUMN IF EXISTS "${column}"`);
    }
    for (const [name] of ENUM_TYPES) {
      await run(sequelize, transaction, `DROP TYPE IF EXISTS "${name}"`);
    }
  });
};

export = {
  DEVICES,
  WAREHOUSES,
  RECORDS,
  ENUM_TYPES,
  COLUMNS,
  BACKFILL_SQL,
  CHECKS,
  INDEX_SQL,
  INDEX_NAMES,
  SESSION_FK,
  SESSION_FK_SQL,
  FUNCTIONS,
  TRIGGERS,
  DATA_HELD,
  PREREQUISITES,
  up,
  down,
};
