/**
 * Migration 0120 — `certificates.client_facility_id` (P20-07, migration M4 of seven; ADR-124 and
 * its Amendments 2–3; spec MEMORY/specs/P19-04-client-facilities.md § 5.1, § 6.1).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. ADD COLUMN, back-fill from the certificate's device (one set-based UPDATE), SET NOT NULL.
 *  2. Two composite keys:
 *       certificates_device_facility_fkey  (tenant_id, client_facility_id, device_id) → devices
 *         ON UPDATE CASCADE ON DELETE RESTRICT — the ONE path a device move updates a certificate
 *         along;
 *       certificates_record_facility_fkey  (tenant_id, client_facility_id, calibration_record_id)
 *         → calibration_records (tenant_id, client_facility_id, id), MATCH SIMPLE (a certificate
 *         with no record is not checked), NO ACTION, DEFERRABLE INITIALLY DEFERRED — checked at
 *         COMMIT, so during a move the record and the certificate may change in either order and
 *         the certificate is updated along one cascade path only; at commit they must agree.
 *     Each with its D-20 leading index.
 *  3. The three triggers (default from the device — Am. 3 —, no insert into an ended facility,
 *     the column only under a move), ENABLE ALWAYS.
 *
 * `down` refuses while facilities are in use; otherwise drops what `up` made.
 */
import type { QueryInterface } from "sequelize";
import {
  type ChildTable,
  constraintNames,
  downNotNullChild,
  run,
  upNotNullChild,
} from "./facilityMigration.shared";

const TABLE = "certificates";
const RECORD_FK = "certificates_record_facility_fkey";
const RECORD_FK_INDEX = "certificates_tenant_facility_record";

const CHILD: ChildTable = Object.freeze({
  tag: "0120",
  table: TABLE,
  deviceFk: "certificates_device_facility_fkey",
  deviceFkIndex: "certificates_tenant_facility_device",
  onDelete: "RESTRICT",
  defaultTrigger: "certificates_facility_default",
  openTrigger: "certificates_facility_open",
  guardTrigger: "certificates_facility_guard",
});

const RECORD_FK_SQL =
  `ALTER TABLE ${TABLE} ADD CONSTRAINT ${RECORD_FK} FOREIGN KEY (tenant_id, client_facility_id, calibration_record_id) ` +
  "REFERENCES calibration_records (tenant_id, client_facility_id, id) MATCH SIMPLE ON UPDATE NO ACTION ON DELETE NO ACTION " +
  "DEFERRABLE INITIALLY DEFERRED";

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await upNotNullChild(sequelize, transaction, CHILD, {
      addColumn: "ALTER TABLE certificates ADD COLUMN client_facility_id UUID",
      index: "CREATE INDEX IF NOT EXISTS certificates_tenant_facility_device ON certificates (tenant_id, client_facility_id, device_id)",
    });
    await run(
      sequelize,
      transaction,
      `CREATE INDEX IF NOT EXISTS ${RECORD_FK_INDEX} ON ${TABLE} (tenant_id, client_facility_id, calibration_record_id)`,
    );
    if (!(await constraintNames(sequelize, transaction, TABLE)).has(RECORD_FK)) {
      await run(sequelize, transaction, RECORD_FK_SQL);
    }
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    // downNotNullChild sets the lock timeout before its first lock.
    await downNotNullChild(sequelize, transaction, CHILD);
    // Both went with the column; named here so an operator reading this file sees them.
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${RECORD_FK}`);
    await run(sequelize, transaction, `DROP INDEX IF EXISTS ${RECORD_FK_INDEX}`);
  });
};

export = {
  TABLE,
  CHILD,
  RECORD_FK,
  RECORD_FK_INDEX,
  RECORD_FK_SQL,
  up,
  down,
};
