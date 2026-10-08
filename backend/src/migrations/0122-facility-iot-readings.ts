/**
 * Migration 0122 — `iot_readings.client_facility_id` (P20-07, migration M6 of seven; ADR-124 and
 * its Amendments 2–3; spec MEMORY/specs/P19-04-client-facilities.md § 5.1, § 5.4, § 6.1, § 6.2).
 *
 * In ONE transaction — the largest table, alone (spec § 6.1): ADD COLUMN, back-fill from the
 * reading's device (one set-based UPDATE: batching inside a transaction would not shorten the lock,
 * and across transactions would break one-transaction-per-migration — § 6.2; P20-09 measures it on
 * production-shaped data), SET NOT NULL; the composite key `(tenant_id, client_facility_id,
 * device_id)` → devices ON UPDATE CASCADE ON DELETE RESTRICT (0037's device key is RESTRICT) and
 * its D-20 index; the default trigger (from the device — Am. 3) and the column guard, ENABLE ALWAYS.
 *
 * NO ended-facility insert trigger here (spec § 5.4): machine telemetry of a device whose client
 * left is dropped by the ingestion service, which reads the facility's status (P21-09), instead of
 * failing the MQTT path.
 *
 * `down` refuses while facilities are in use; otherwise drops what `up` made.
 */
import type { QueryInterface } from "sequelize";
import { type ChildTable, downNotNullChild, upNotNullChild } from "./facilityMigration.shared";

const TABLE = "iot_readings";

const CHILD: ChildTable = Object.freeze({
  tag: "0122",
  table: TABLE,
  deviceFk: "iot_readings_device_facility_fkey",
  deviceFkIndex: "iot_readings_tenant_facility_device",
  onDelete: "RESTRICT",
  defaultTrigger: "iot_readings_facility_default",
  openTrigger: null,
  guardTrigger: "iot_readings_facility_guard",
});

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await upNotNullChild(sequelize, transaction, CHILD, {
      addColumn: "ALTER TABLE iot_readings ADD COLUMN client_facility_id UUID",
      index: "CREATE INDEX IF NOT EXISTS iot_readings_tenant_facility_device ON iot_readings (tenant_id, client_facility_id, device_id)",
    });
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await downNotNullChild(sequelize, transaction, CHILD);
  });
};

export = { TABLE, CHILD, up, down };
