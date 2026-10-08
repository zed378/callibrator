/**
 * Migration 0121 — `maintenance_work_orders.client_facility_id` (P20-07, migration M5 of seven;
 * ADR-124 and its Amendments 2–3; spec MEMORY/specs/P19-04-client-facilities.md § 5.1, § 6.1).
 *
 * In ONE transaction: ADD COLUMN, back-fill from the work order's device (one set-based UPDATE),
 * SET NOT NULL; the composite key `(tenant_id, client_facility_id, device_id)` → devices ON UPDATE
 * CASCADE ON DELETE CASCADE — CASCADE because 0037's single-column device key is (a hard-deleted
 * device takes its work orders with it; the two keys must not disagree on a delete); its D-20 index;
 * the three triggers (default from the device — Am. 3 —, no insert into an ended facility, the
 * column only under a move), ENABLE ALWAYS.
 *
 * `down` refuses while facilities are in use; otherwise drops what `up` made.
 */
import type { QueryInterface } from "sequelize";
import { type ChildTable, downNotNullChild, upNotNullChild } from "./facilityMigration.shared";

const TABLE = "maintenance_work_orders";

const CHILD: ChildTable = Object.freeze({
  tag: "0121",
  table: TABLE,
  deviceFk: "maintenance_work_orders_device_facility_fkey",
  deviceFkIndex: "maintenance_work_orders_tenant_facility_device",
  onDelete: "CASCADE",
  defaultTrigger: "maintenance_work_orders_facility_default",
  openTrigger: "maintenance_work_orders_facility_open",
  guardTrigger: "maintenance_work_orders_facility_guard",
});

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await upNotNullChild(sequelize, transaction, CHILD, {
      addColumn: "ALTER TABLE maintenance_work_orders ADD COLUMN client_facility_id UUID",
      index: "CREATE INDEX IF NOT EXISTS maintenance_work_orders_tenant_facility_device ON maintenance_work_orders (tenant_id, client_facility_id, device_id)",
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
