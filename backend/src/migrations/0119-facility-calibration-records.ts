/**
 * Migration 0119 — `calibration_records.client_facility_id`, and the append-only trigger's ONE
 * exception: a device move (P20-07, migration M3 of seven; ADR-124 and its Amendments 2–3; spec
 * MEMORY/specs/P19-04-client-facilities.md § 5.1, § 5.4, § 6.1, § 11).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. ADD COLUMN client_facility_id UUID (unless sync() made it).
 *  2. Back-fill from the record's device, one set-based UPDATE. calibration_records is append-only
 *     for EVERY column added later (0057: "everything except the lifecycle columns"), so the
 *     back-fill runs with `calibration_records_append_only` disabled — DDL, inside this transaction
 *     (ACCESS EXCLUSIVE is held by the ADD COLUMN anyway), restored to the state it was in ('O')
 *     before the transaction ends. Nothing else can write in between.
 *  3. SET NOT NULL.
 *  4. The composite-FK TARGET certificates reference: UNIQUE `(tenant_id, client_facility_id, id)`;
 *     the composite key to the device `(tenant_id, client_facility_id, device_id)` → devices ON
 *     UPDATE CASCADE ON DELETE RESTRICT (0037's device key is RESTRICT), with its D-20 index.
 *  5. 0057's FUNCTION is REPLACED (spec § 5.4): every column stays immutable, lifecycle columns
 *     one way, as before — and `client_facility_id` may change only when `callibrator.facility_move`
 *     names this record's device's in-progress move from OLD to NEW (facility_move_admits, 0117).
 *     That is the cascade of a device move; nothing else.
 *  6. Triggers, ENABLE ALWAYS: `calibration_records_facility_default` (BEFORE INSERT, from the
 *     device — Am. 3), `calibration_records_facility_open` (no new record in an ended facility),
 *     `calibration_records_facility_guard` (BEFORE UPDATE OF client_facility_id).
 *
 * RI actions run as the referencing table's owner, so the cascade does not need the application
 * role's column grants on calibration_records (it has UPDATE on the lifecycle columns only) —
 * proven by deviceMove.p2007.live, not assumed.
 *
 * `down` refuses while facilities are in use; otherwise restores 0057's function exactly and
 * drops the triggers, keys, index and column.
 */
import type { QueryInterface } from "sequelize";
import {
  type ChildTable,
  constraintNames,
  downNotNullChild,
  rows,
  run,
  triggerState,
  upNotNullChild,
} from "./facilityMigration.shared";
import m0057 from "./0057-calibration-records-append-only";

const TABLE = "calibration_records";
const APPEND_ONLY_TRIGGER = m0057.ROW_TRIGGER;
const TARGET_UNIQUE = "calibration_records_tenant_facility_id_unique";

const CHILD: ChildTable = Object.freeze({
  tag: "0119",
  table: TABLE,
  deviceFk: "calibration_records_device_facility_fkey",
  deviceFkIndex: "calibration_records_tenant_facility_device",
  onDelete: "RESTRICT",
  defaultTrigger: "calibration_records_facility_default",
  openTrigger: "calibration_records_facility_open",
  guardTrigger: "calibration_records_facility_guard",
});

/** 0057's function, with the move exception (the lifecycle list and every other rule unchanged). */
const FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION ${m0057.FUNCTION_NAME}() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  lifecycle CONSTANT text[] := ARRAY[${m0057.LIFECYCLE_COLUMNS.map((c) => `'${c}'`).join(", ")}];
  compared text[] := lifecycle;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'calibration_records is append-only: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'calibration_records is append-only: record % cannot be deleted', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Void it (POST /calibration-records/:id/void) or correct it with a superseding record.';
  END IF;
  -- P20-07 (ADR-124 Am. 2 § 2): a device move carries its records to the new facility — the one
  -- change to a record's content the database admits, and only inside that move's transaction.
  IF NEW.client_facility_id IS DISTINCT FROM OLD.client_facility_id
     AND facility_move_admits(NEW.tenant_id, NEW.device_id, OLD.client_facility_id, NEW.client_facility_id) THEN
    compared := lifecycle || ARRAY['client_facility_id'];
  END IF;
  IF (to_jsonb(NEW) - compared) IS DISTINCT FROM (to_jsonb(OLD) - compared) THEN
    RAISE EXCEPTION 'calibration_records is append-only: the content of record % cannot be changed', OLD.id
      USING ERRCODE = '42501',
            HINT = 'Write a correction (POST /calibration-records/:id/corrections); the original stays.';
  END IF;
  IF (OLD.superseded_by_id IS NOT NULL AND NEW.superseded_by_id IS DISTINCT FROM OLD.superseded_by_id)
     OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
     OR (OLD.void_reason IS NOT NULL AND NEW.void_reason IS DISTINCT FROM OLD.void_reason)
     OR (OLD.voided_by IS NOT NULL AND NEW.voided_by IS DISTINCT FROM OLD.voided_by)
     OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
     OR (OLD.is_deleted AND NOT NEW.is_deleted) THEN
    RAISE EXCEPTION 'calibration_records is append-only: a supersession or void of record % is final', OLD.id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$`;

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    // The trigger's state, to restore exactly ('O' as 0057 made it; 'A' if an operator changed it).
    let state: string | null = null;
    await upNotNullChild(sequelize, transaction, CHILD, {
      addColumn: "ALTER TABLE calibration_records ADD COLUMN client_facility_id UUID",
      index: "CREATE INDEX IF NOT EXISTS calibration_records_tenant_facility_device ON calibration_records (tenant_id, client_facility_id, device_id)",
    }, {
      beforeBackfill: async () => {
        state = await triggerState(sequelize, transaction, TABLE, APPEND_ONLY_TRIGGER);
        if (state === null) {
          throw new Error(
            `0119: trigger ${APPEND_ONLY_TRIGGER} does not exist on ${TABLE} — migration 0057 must have run (it is the append-only guarantee).`,
          );
        }
        await run(sequelize, transaction, `ALTER TABLE ${TABLE} DISABLE TRIGGER ${APPEND_ONLY_TRIGGER}`);
      },
      afterBackfill: async () => {
        const mode = state === "A" ? "ENABLE ALWAYS" : state === "R" ? "ENABLE REPLICA" : "ENABLE";
        await run(sequelize, transaction, `ALTER TABLE ${TABLE} ${mode} TRIGGER ${APPEND_ONLY_TRIGGER}`);
      },
    });
    await run(sequelize, transaction, `CREATE UNIQUE INDEX IF NOT EXISTS ${TARGET_UNIQUE} ON ${TABLE} (tenant_id, client_facility_id, id)`);
    await run(sequelize, transaction, FUNCTION_SQL);
    // The lifted trigger is back in the state it was in (asserted, not assumed).
    const [after] = await rows(
      sequelize,
      transaction,
      "SELECT tgenabled::text AS state FROM pg_trigger WHERE tgrelid = 'calibration_records'::regclass AND tgname = :name",
      { name: APPEND_ONLY_TRIGGER },
    );
    if (after?.["state"] !== state) {
      throw new Error(`0119: ${APPEND_ONLY_TRIGGER} was not restored (${JSON.stringify(after?.["state"])} ≠ ${String(state)}).`);
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    // downNotNullChild sets the lock timeout before its first lock.
    // 0120's record-path key references the target; its down runs first (manifest order reversed).
    if ((await constraintNames(sequelize, transaction, "certificates")).has("certificates_record_facility_fkey")) {
      throw new Error("0119 down: certificates_record_facility_fkey still exists — revert 0120 first.");
    }
    await downNotNullChild(sequelize, transaction, CHILD);
    // 0057's function exactly as 0057 made it (the column it named is gone with the index).
    await run(sequelize, transaction, m0057.FUNCTION_SQL);
    await run(sequelize, transaction, `DROP INDEX IF EXISTS ${TARGET_UNIQUE}`);
  });
};

export = {
  TABLE,
  TARGET_UNIQUE,
  CHILD,
  FUNCTION_SQL,
  up,
  down,
};
