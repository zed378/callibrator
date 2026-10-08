/**
 * Migration 0118 — `calibration_devices.client_facility_id`: the root of the evidence chain's
 * second scope dimension, and the serial number unique per facility (P20-07, migration M2 of seven;
 * ADR-124 and its Amendments 2–3; spec MEMORY/specs/P19-04-client-facilities.md § 5.1, § 5.2,
 * § 5.4, § 6.1; UD-9).
 *
 * WHAT THIS DOES, in ONE transaction (one per large table — spec § 6.1)
 *
 *  1. ADD COLUMN client_facility_id UUID (NULL), unless sync() made it on a fresh database.
 *  2. Back-fill: every device to its tenant's SELF facility (0117 made one per tenant), one
 *     set-based UPDATE; a device left without one fails the migration (nothing recorded).
 *  3. SET NOT NULL.
 *  4. The composite key `(tenant_id, client_facility_id)` → client_facilities `(tenant_id, id)`
 *     RESTRICT — a device names a facility of its OWN tenant, or the write fails — and the
 *     composite-FK TARGET its children reference: UNIQUE `(tenant_id, client_facility_id, id)`.
 *  5. UD-9: the serial is unique per FACILITY. 0026's `UNIQUE (tenant_id, serial_number)` is
 *     replaced by `calibration_devices_tenant_facility_serial_unique` `(tenant_id,
 *     client_facility_id, serial_number)` — NULLs distinct, as 0026. Identical behaviour for every
 *     tenant today (one facility each).
 *  6. Triggers, ENABLE ALWAYS:
 *       calibration_devices_facility_default  BEFORE INSERT — ADR-124 Am. 3: a device written
 *         without a facility gets its tenant's self facility WHILE the tenant has no other; a
 *         tenant with client facilities must name one (23502). The P21-09 service supplies it.
 *       calibration_devices_facility_open     BEFORE INSERT — none into an `ended` facility (23514).
 *       calibration_devices_facility_guard    BEFORE UPDATE OF client_facility_id — refused (42501)
 *         unless `callibrator.facility_move` names this device's in-progress move, for every role.
 *
 * Throws, never skips (PR-5); no try/catch. Verify with psql:
 *   SELECT count(*) FROM calibration_devices WHERE client_facility_id IS NULL;   -- 0, and NOT NULL
 *   \d calibration_devices
 *
 * `down` refuses while facilities are in use (facilityMigration.shared); otherwise the triggers,
 * the keys, the column, and 0026's per-tenant serial index back.
 */
import type { QueryInterface } from "sequelize";
import {
  LOCK_TIMEOUT,
  constraintNames,
  columnExists,
  createAlwaysTrigger,
  refuseDownWhenFacilitiesUsed,
  requireFacilityFoundation,
  requireTables,
  rows,
  run,
} from "./facilityMigration.shared";

const TABLE = "calibration_devices";
const FK = "calibration_devices_client_facility_fkey";
const TARGET_UNIQUE = "calibration_devices_tenant_facility_id_unique";
const SERIAL_UNIQUE = "calibration_devices_tenant_facility_serial_unique";
/** 0026's index, replaced (UD-9). */
const OLD_SERIAL_UNIQUE = "calibration_devices_tenant_id_serial_number_unique";
const TRIGGERS = Object.freeze({
  default: "calibration_devices_facility_default",
  open: "calibration_devices_facility_open",
  guard: "calibration_devices_facility_guard",
});

const BACKFILL_SQL =
  `UPDATE ${TABLE} d SET client_facility_id = f.id FROM client_facilities f ` +
  "WHERE f.tenant_id = d.tenant_id AND f.is_self AND d.client_facility_id IS NULL";

const FK_SQL =
  `ALTER TABLE ${TABLE} ADD CONSTRAINT ${FK} FOREIGN KEY (tenant_id, client_facility_id) ` +
  "REFERENCES client_facilities (tenant_id, id) ON DELETE RESTRICT";

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await requireTables(sequelize, transaction, "0118", [TABLE]);
    await requireFacilityFoundation(sequelize, transaction, "0118");

    // 1 – 3. Column, back-fill to the self facility, NOT NULL.
    if (!(await columnExists(sequelize, transaction, TABLE, "client_facility_id"))) {
      await run(sequelize, transaction, `ALTER TABLE ${TABLE} ADD COLUMN client_facility_id UUID`);
    }
    await run(sequelize, transaction, BACKFILL_SQL);
    const [left] = await rows(sequelize, transaction, `SELECT count(*)::int AS n FROM ${TABLE} WHERE client_facility_id IS NULL`);
    if (Number(left?.["n"]) > 0) {
      throw new Error(
        `0118: ${String(left?.["n"])} device(s) belong to a tenant with no self client facility (0117 makes one per tenant). ` +
          "Nothing was changed.",
      );
    }
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} ALTER COLUMN client_facility_id SET NOT NULL`);

    // 4. The composite key to the facility, and the target the children reference.
    await run(sequelize, transaction, `CREATE UNIQUE INDEX IF NOT EXISTS ${TARGET_UNIQUE} ON ${TABLE} (tenant_id, client_facility_id, id)`);
    if (!(await constraintNames(sequelize, transaction, TABLE)).has(FK)) {
      await run(sequelize, transaction, FK_SQL);
    }

    // 5. UD-9: the serial per facility.
    await run(sequelize, transaction, `DROP INDEX IF EXISTS ${OLD_SERIAL_UNIQUE}`);
    await run(
      sequelize,
      transaction,
      `CREATE UNIQUE INDEX IF NOT EXISTS ${SERIAL_UNIQUE} ON ${TABLE} (tenant_id, client_facility_id, serial_number)`,
    );

    // 6. The triggers.
    await createAlwaysTrigger(
      sequelize,
      transaction,
      TABLE,
      TRIGGERS.default,
      `TRIGGER ${TRIGGERS.default} BEFORE INSERT ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION facility_insert_default('device')`,
    );
    await createAlwaysTrigger(
      sequelize,
      transaction,
      TABLE,
      TRIGGERS.open,
      `TRIGGER ${TRIGGERS.open} BEFORE INSERT ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION facility_accepts_inserts()`,
    );
    await createAlwaysTrigger(
      sequelize,
      transaction,
      TABLE,
      TRIGGERS.guard,
      `TRIGGER ${TRIGGERS.guard} BEFORE UPDATE OF client_facility_id ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION facility_column_guard('device')`,
    );
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await refuseDownWhenFacilitiesUsed(sequelize, transaction, "0118");
    for (const trigger of Object.values(TRIGGERS)) {
      await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${trigger} ON ${TABLE}`);
    }
    await run(sequelize, transaction, `DROP INDEX IF EXISTS ${SERIAL_UNIQUE}`);
    await run(
      sequelize,
      transaction,
      `CREATE UNIQUE INDEX IF NOT EXISTS ${OLD_SERIAL_UNIQUE} ON ${TABLE} (tenant_id, serial_number)`,
    );
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${FK}`);
    await run(sequelize, transaction, `DROP INDEX IF EXISTS ${TARGET_UNIQUE}`);
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS client_facility_id`);
  });
};

export = {
  TABLE,
  FK,
  TARGET_UNIQUE,
  SERIAL_UNIQUE,
  OLD_SERIAL_UNIQUE,
  TRIGGERS,
  BACKFILL_SQL,
  FK_SQL,
  up,
  down,
};
