/**
 * Migration 0123 — the NULLABLE facility columns: `attachments`, `non_conformances`, `warehouses`,
 * `users`; the polymorphic attachment rule (AM-7); the user-binding triggers (P20-07, migration M7
 * of seven; ADR-124 and its Amendments 2–3; spec MEMORY/specs/P19-04-client-facilities.md § 5.1,
 * § 5.3, § 5.4, § 6.1, § 10).
 *
 * WHAT THIS DOES, in ONE transaction (the small tables together — spec § 6.1)
 *
 *  attachments
 *   - `client_facility_id` UUID NULL and `rekey_pending` BOOLEAN NOT NULL DEFAULT false.
 *   - Back-fill: a file LINKED (`resource_id`) to a facility-scoped type (device, record,
 *     certificate, work order — facilityMigration.shared FACILITY_ATTACHMENT_TYPES) takes its
 *     record's facility (soft-deleted records included); a linked file whose record no longer
 *     exists takes its tenant's self facility — the only facility there was. Everything else NULL.
 *   - CHECK attachments_facility_kind: a facility exactly when linked to a facility-scoped type.
 *   - AM-7, two DEFERRED constraint triggers (checked at COMMIT, so a move can update a record
 *     before its files): `attachments_facility_matches_resource` (a file's facility equals its
 *     record's, the record loaded with soft-deleted rows) and `<table>_attachments_follow_facility`
 *     on the four resource tables (a record whose facility changed leaves no file behind).
 *   - The default (from the resource — Am. 3; also on a re-link), ended-insert and column-guard
 *     triggers; a partial index on `resource_id` for the follow check.
 *  non_conformances
 *   - `client_facility_id` UUID NULL, back-filled from the device; CHECK
 *     `(device_id IS NULL) = (client_facility_id IS NULL)`; the composite key to the device ON
 *     UPDATE CASCADE ON DELETE SET NULL (client_facility_id, device_id) — 0037's device key is SET
 *     NULL; whichever of the two fires first, the default trigger clears the facility with the
 *     device so the CHECK holds; the three triggers.
 *  warehouses
 *   - `client_facility_id` UUID NULL (NULL = the provider's store; no back-fill), the composite key
 *     to client_facilities RESTRICT and its index. The room CHECK waits for UD-10 (G-F4).
 *  users
 *   - `client_facility_id` UUID NULL (every existing user stays UNBOUND) and
 *     `facility_binding_pending` BOOLEAN NOT NULL DEFAULT false (G-F6); CHECK
 *     users_facility_needs_tenant; the composite key to client_facilities RESTRICT and its index;
 *     `users_facility_binding_guard` (the binding changes only under `callibrator.facility_binding`
 *     naming the user) and `users_facility_bound_role` (a bound row's role is one of the four).
 *
 * Every trigger ENABLE ALWAYS. Throws, never skips (PR-5); no try/catch.
 *
 * `down` refuses while facilities are in use; otherwise drops what `up` made.
 */
import type { QueryInterface, Sequelize, Transaction } from "sequelize";
import {
  FACILITY_ATTACHMENT_TYPES,
  LOCK_TIMEOUT,
  columnExists,
  constraintNames,
  createAlwaysTrigger,
  refuseDownWhenFacilitiesUsed,
  requireFacilityFoundation,
  requireTables,
  rows,
  run,
  sqlList,
} from "./facilityMigration.shared";

const TYPES = sqlList(FACILITY_ATTACHMENT_TYPES);

/** The resource tables of AM-7's second trigger, and the attachment types naming each. */
const RESOURCE_TABLES: readonly (readonly [table: string, types: readonly string[]])[] = Object.freeze([
  ["calibration_devices", ["device", "calibrationdevice"]],
  ["calibration_records", ["calibration", "calibrationrecord"]],
  ["certificates", ["certificate"]],
  ["maintenance_work_orders", ["workorder", "maintenanceworkorder"]],
]);

const followTrigger = (table: string): string => `${table}_attachments_follow_facility`;

const CHECKS: Readonly<Record<string, readonly [table: string, predicate: string]>> = Object.freeze({
  attachments_facility_kind: [
    "attachments",
    `(client_facility_id IS NOT NULL) = (resource_id IS NOT NULL AND lower(resource_type) IN (${TYPES}))`,
  ],
  non_conformances_facility_follows_device: ["non_conformances", "(device_id IS NULL) = (client_facility_id IS NULL)"],
  users_facility_needs_tenant: ["users", "client_facility_id IS NULL OR tenant_id IS NOT NULL"],
});

const FKS: Readonly<Record<string, readonly [table: string, sql: string]>> = Object.freeze({
  non_conformances_device_facility_fkey: [
    "non_conformances",
    "ALTER TABLE non_conformances ADD CONSTRAINT non_conformances_device_facility_fkey " +
      "FOREIGN KEY (tenant_id, client_facility_id, device_id) REFERENCES calibration_devices (tenant_id, client_facility_id, id) " +
      "MATCH SIMPLE ON UPDATE CASCADE ON DELETE SET NULL (client_facility_id, device_id)",
  ],
  warehouses_client_facility_fkey: [
    "warehouses",
    "ALTER TABLE warehouses ADD CONSTRAINT warehouses_client_facility_fkey FOREIGN KEY (tenant_id, client_facility_id) " +
      "REFERENCES client_facilities (tenant_id, id) MATCH SIMPLE ON DELETE RESTRICT",
  ],
  users_client_facility_fkey: [
    "users",
    "ALTER TABLE users ADD CONSTRAINT users_client_facility_fkey FOREIGN KEY (tenant_id, client_facility_id) " +
      "REFERENCES client_facilities (tenant_id, id) MATCH SIMPLE ON DELETE RESTRICT",
  ],
});

const INDEX_SQL = Object.freeze([
  "CREATE INDEX IF NOT EXISTS attachments_resource_id_facility ON attachments (resource_id) WHERE client_facility_id IS NOT NULL",
  "CREATE INDEX IF NOT EXISTS non_conformances_tenant_facility_device ON non_conformances (tenant_id, client_facility_id, device_id)",
  "CREATE INDEX IF NOT EXISTS warehouses_tenant_facility ON warehouses (tenant_id, client_facility_id)",
  "CREATE INDEX IF NOT EXISTS users_tenant_facility ON users (tenant_id, client_facility_id)",
]);
const INDEX_NAMES = Object.freeze([
  "attachments_resource_id_facility",
  "non_conformances_tenant_facility_device",
  "warehouses_tenant_facility",
  "users_tenant_facility",
]);

/** Columns added (table, column, DDL). */
const COLUMNS: readonly (readonly [table: string, column: string, ddl: string])[] = Object.freeze([
  ["attachments", "client_facility_id", "UUID"],
  ["attachments", "rekey_pending", "BOOLEAN NOT NULL DEFAULT false"],
  ["non_conformances", "client_facility_id", "UUID"],
  ["warehouses", "client_facility_id", "UUID"],
  ["users", "client_facility_id", "UUID"],
  ["users", "facility_binding_pending", "BOOLEAN NOT NULL DEFAULT false"],
]);

const ATTACHMENT_BACKFILL_SQL = `
UPDATE attachments a
   SET client_facility_id = coalesce(
         facility_resource_facility(a.tenant_id, a.resource_type, a.resource_id),
         (SELECT f.id FROM client_facilities f WHERE f.tenant_id = a.tenant_id AND f.is_self))
 WHERE a.client_facility_id IS NULL AND a.resource_id IS NOT NULL AND lower(a.resource_type) IN (${TYPES})`;

const NC_BACKFILL_SQL =
  "UPDATE non_conformances n SET client_facility_id = d.client_facility_id FROM calibration_devices d " +
  "WHERE d.id = n.device_id AND d.tenant_id = n.tenant_id AND n.client_facility_id IS NULL";

const FUNCTIONS: readonly (readonly [name: string, sql: string])[] = Object.freeze([
  [
    "attachments_facility_matches_resource",
    `
CREATE OR REPLACE FUNCTION attachments_facility_matches_resource() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  r record;
  v uuid;
BEGIN
  -- At COMMIT: the row as it is now (a later statement of the transaction may have changed or removed it).
  SELECT a.id, a.tenant_id, a.resource_type, a.resource_id, a.client_facility_id INTO r FROM attachments a WHERE a.id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF r.resource_id IS NOT NULL AND lower(r.resource_type) IN (${TYPES}) THEN
    v := facility_resource_facility(r.tenant_id, r.resource_type, r.resource_id);
    IF v IS NULL THEN
      RAISE EXCEPTION 'attachment %: its % % does not exist in its tenant', r.id, r.resource_type, r.resource_id
        USING ERRCODE = '23503';
    END IF;
    IF v IS DISTINCT FROM r.client_facility_id THEN
      RAISE EXCEPTION 'attachment %: its client facility (%) is not its %''s (%)', r.id, r.client_facility_id, r.resource_type, v
        USING ERRCODE = '23514',
              HINT = 'An attachment takes its record''s facility (ADR-124 Am. 2, AM-7); a device move updates both.';
    END IF;
  ELSIF r.client_facility_id IS NOT NULL THEN
    RAISE EXCEPTION 'attachment %: only a file linked to a device, record, certificate or work order has a client facility', r.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$fn$`,
  ],
  [
    "facility_attachments_follow",
    `
CREATE OR REPLACE FUNCTION facility_attachments_follow() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_now uuid;
  v_left int;
BEGIN
  -- At COMMIT: the record's facility as it is now.
  EXECUTE format('SELECT client_facility_id FROM %I WHERE id = $1', TG_TABLE_NAME) INTO v_now USING NEW.id;
  IF v_now IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO v_left FROM attachments a
   WHERE a.resource_id = NEW.id AND a.client_facility_id IS NOT NULL AND a.client_facility_id <> v_now
     AND a.tenant_id = NEW.tenant_id AND lower(a.resource_type) = ANY (TG_ARGV);
  IF v_left > 0 THEN
    RAISE EXCEPTION '% %: its client facility changed but % attachment(s) still carry the old one', TG_TABLE_NAME, NEW.id, v_left
      USING ERRCODE = '23514',
            HINT = 'A device move updates the attachments of the device and of every moved record (ADR-124 Am. 2 § 2).';
  END IF;
  RETURN NULL;
END
$fn$`,
  ],
]);

const addColumns = async (sequelize: Sequelize, transaction: Transaction): Promise<void> => {
  for (const [table, column, ddl] of COLUMNS) {
    if (!(await columnExists(sequelize, transaction, table, column))) {
      await run(sequelize, transaction, `ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }
};

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await requireTables(sequelize, transaction, "0123", ["attachments", "non_conformances", "warehouses", "users", "roles"]);
    await requireFacilityFoundation(sequelize, transaction, "0123");
    for (const [table] of RESOURCE_TABLES) {
      if (!(await columnExists(sequelize, transaction, table, "client_facility_id"))) {
        throw new Error(`0123: ${table}.client_facility_id does not exist — migrations 0118 – 0121 must run first.`);
      }
    }

    await addColumns(sequelize, transaction);
    await run(sequelize, transaction, ATTACHMENT_BACKFILL_SQL);
    await run(sequelize, transaction, NC_BACKFILL_SQL);

    for (const [name, [table, predicate]] of Object.entries(CHECKS)) {
      if (!(await constraintNames(sequelize, transaction, table)).has(name)) {
        await run(sequelize, transaction, `ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
    }
    for (const statement of INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }
    for (const [name, [table, statement]] of Object.entries(FKS)) {
      if (!(await constraintNames(sequelize, transaction, table)).has(name)) {
        await run(sequelize, transaction, statement);
      }
    }
    for (const [, statement] of FUNCTIONS) {
      await run(sequelize, transaction, statement);
    }

    // attachments
    await createAlwaysTrigger(sequelize, transaction, "attachments", "attachments_facility_default",
      "TRIGGER attachments_facility_default BEFORE INSERT OR UPDATE OF resource_type, resource_id ON attachments " +
        "FOR EACH ROW EXECUTE FUNCTION facility_insert_default('attachment')");
    await createAlwaysTrigger(sequelize, transaction, "attachments", "attachments_facility_open",
      "TRIGGER attachments_facility_open BEFORE INSERT ON attachments FOR EACH ROW EXECUTE FUNCTION facility_accepts_inserts()");
    await createAlwaysTrigger(sequelize, transaction, "attachments", "attachments_facility_guard",
      "TRIGGER attachments_facility_guard BEFORE UPDATE OF client_facility_id ON attachments " +
        "FOR EACH ROW EXECUTE FUNCTION facility_column_guard('attachment')");
    await createAlwaysTrigger(sequelize, transaction, "attachments", "attachments_facility_matches_resource",
      "CONSTRAINT TRIGGER attachments_facility_matches_resource AFTER INSERT OR UPDATE OF client_facility_id, resource_type, resource_id " +
        "ON attachments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION attachments_facility_matches_resource()");
    for (const [table, types] of RESOURCE_TABLES) {
      await createAlwaysTrigger(sequelize, transaction, table, followTrigger(table),
        `CONSTRAINT TRIGGER ${followTrigger(table)} AFTER UPDATE OF client_facility_id ON ${table} ` +
          `DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION facility_attachments_follow(${sqlList(types)})`);
    }

    // non_conformances
    await createAlwaysTrigger(sequelize, transaction, "non_conformances", "non_conformances_facility_default",
      "TRIGGER non_conformances_facility_default BEFORE INSERT OR UPDATE OF device_id ON non_conformances " +
        "FOR EACH ROW EXECUTE FUNCTION facility_insert_default('nc')");
    await createAlwaysTrigger(sequelize, transaction, "non_conformances", "non_conformances_facility_open",
      "TRIGGER non_conformances_facility_open BEFORE INSERT ON non_conformances FOR EACH ROW EXECUTE FUNCTION facility_accepts_inserts()");
    await createAlwaysTrigger(sequelize, transaction, "non_conformances", "non_conformances_facility_guard",
      "TRIGGER non_conformances_facility_guard BEFORE UPDATE OF client_facility_id ON non_conformances " +
        "FOR EACH ROW EXECUTE FUNCTION facility_column_guard('nc')");

    // users
    await createAlwaysTrigger(sequelize, transaction, "users", "users_facility_binding_guard",
      "TRIGGER users_facility_binding_guard BEFORE UPDATE OF client_facility_id ON users FOR EACH ROW EXECUTE FUNCTION users_binding_guard()");
    await createAlwaysTrigger(sequelize, transaction, "users", "users_facility_bound_role",
      "TRIGGER users_facility_bound_role BEFORE INSERT OR UPDATE OF role_id, client_facility_id ON users " +
        "FOR EACH ROW EXECUTE FUNCTION users_bound_role_check()");
  });
};

/** Every trigger `up` creates, as [table, name]. */
const TRIGGERS: readonly (readonly [table: string, name: string])[] = Object.freeze([
  ["attachments", "attachments_facility_default"],
  ["attachments", "attachments_facility_open"],
  ["attachments", "attachments_facility_guard"],
  ["attachments", "attachments_facility_matches_resource"],
  ...RESOURCE_TABLES.map(([table]) => [table, followTrigger(table)] as const),
  ["non_conformances", "non_conformances_facility_default"],
  ["non_conformances", "non_conformances_facility_open"],
  ["non_conformances", "non_conformances_facility_guard"],
  ["users", "users_facility_binding_guard"],
  ["users", "users_facility_bound_role"],
]);

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await refuseDownWhenFacilitiesUsed(sequelize, transaction, "0123");
    for (const [table, name] of TRIGGERS) {
      await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${name} ON ${table}`);
    }
    for (const [name] of FUNCTIONS) {
      await run(sequelize, transaction, `DROP FUNCTION IF EXISTS ${name}()`);
    }
    for (const name of INDEX_NAMES) {
      await run(sequelize, transaction, `DROP INDEX IF EXISTS ${name}`);
    }
    for (const [table, column] of [...COLUMNS].reverse()) {
      await run(sequelize, transaction, `ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column}`);
    }
    // The CHECKs and keys went with their columns; nothing of 0123 is left.
    const [left] = await rows(
      sequelize,
      transaction,
      "SELECT count(*)::int AS n FROM pg_constraint WHERE conname IN (:names)",
      { names: [...Object.keys(CHECKS), ...Object.keys(FKS)] },
    );
    if (Number(left?.["n"]) !== 0) {
      throw new Error("0123 down: a CHECK or key of 0123 survived its column — nothing was changed.");
    }
  });
};

export = {
  RESOURCE_TABLES,
  CHECKS,
  FKS,
  INDEX_SQL,
  INDEX_NAMES,
  COLUMNS,
  FUNCTIONS,
  TRIGGERS,
  ATTACHMENT_BACKFILL_SQL,
  NC_BACKFILL_SQL,
  up,
  down,
};
