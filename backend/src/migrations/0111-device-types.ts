/**
 * Migration 0111 — `device_types`, the first table of the global inspection
 * catalogue, and `calibration_devices.device_type_id` (P20-01; ADR-125 and its
 * Amendment 1; spec MEMORY/specs/P19-01-inspection-catalogue.md § 4.1, § 4.7,
 * § 7.7).
 *
 * WHAT THIS DOES, in ONE transaction
 *
 *  1. `device_types` (and its ENUM type `enum_device_types_status`, the name
 *     Sequelize gives it) unless it exists — db.sync() runs BEFORE the
 *     migrations at boot and creates it from the model on a database that has
 *     never seen it, so on that path only 2–6 run:
 *       id, name VARCHAR(255), status ENUM('active','retired') DEFAULT 'active',
 *       legacy_id INTEGER (upstream `mst_alat.id`), created_by / updated_by →
 *       users ON DELETE RESTRICT, created_at, updated_at.
 *     GLOBAL: no tenant_id, no client_facility_id (ADR-125 § 1, ADR-124 § 5) —
 *     the tenant hooks never scope it (unscopedModels.d17, group "global").
 *     NOT paranoid and no defaultScope (G-4): an include of a model with a
 *     defaultScope is an INNER JOIN (the A-75 trap); `retired` is the only
 *     removal.
 *  2. CHECKs: `device_types_name_normalised` (no leading, trailing or repeated
 *     whitespace, not empty — the service normalises, the database refuses
 *     what it missed) and `device_types_legacy_id_positive`.
 *  3. Indexes: `device_types_name_unique` UNIQUE on lower(btrim(name)), over
 *     EVERY status (a retired name is reactivated, not recreated; global
 *     uniqueness on platform content is no tenant oracle — spec § 4.1);
 *     `device_types_legacy_id_unique` (partial, NOT NULL); the D-20 leading
 *     indexes of the two user foreign keys.
 *  4. The TRIGGERS `device_types_no_delete` (BEFORE DELETE, each row) and
 *     `device_types_no_truncate` (BEFORE TRUNCATE): nothing in the catalogue
 *     is deleted, for EVERY role (spec § 7.7). ENABLE ALWAYS, as 0091's: they
 *     fire under `session_replication_role = replica` too, so only DDL gets
 *     past them.
 *  5. `calibration_devices.device_type_id` UUID NULL → device_types ON DELETE
 *     RESTRICT ON UPDATE CASCADE (G-5: RESTRICT, not 04's SET NULL — a type is
 *     never deleted, and SET NULL would only ever fire on a mistaken delete,
 *     silently stripping evidence), and its index
 *     `calibration_devices_device_type_id_tenant_id` (device_type_id,
 *     tenant_id). The spec wrote (tenant_id, device_type_id); D-20 (0067's
 *     guard) wants the foreign key LEADING, and an index on the pair serves
 *     the per-tenant "devices of this type" filter in either order.
 *  6. The APPLICATION ROLE (`DB_APP_ROLE`, default `callibrator_app`, created
 *     by 0057): REVOKE DELETE, TRUNCATE ON device_types — the second,
 *     independent layer. SELECT, INSERT, UPDATE stay.
 *
 * The CHECKs, indexes and triggers live only here, never on the model:
 * db.sync() never adds a CHECK, and a model index on a migration-added column
 * kills an upgrade boot (ADR-100 Am. 3, CLAUDE.md traps).
 *
 * Throws, rather than skipping, when `users`, `calibration_devices` or the
 * application role is absent: a skip would be recorded as applied with no
 * trigger (PR-5). No try/catch: every failure propagates and the migration is
 * not recorded as applied. Verify with psql, not the log:
 *   \d device_types
 *   SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'device_types'::regclass AND NOT tgisinternal;
 *     -- device_types_no_delete A, device_types_no_truncate A
 *   SELECT confdeltype FROM pg_constraint WHERE conname = 'calibration_devices_device_type_id_fkey';  -- r
 *   SET ROLE callibrator_app; DELETE FROM device_types WHERE false;  -- permission denied
 *
 * Idempotent. `down` REFUSES while any device type exists (it would destroy
 * them and every device's link to one); on an empty catalogue it drops the
 * column, the table, the function and the type.
 */
import { DataTypes, type QueryInterface, type Sequelize, type Transaction } from "sequelize";
import { DEVICE_TYPE_STATUSES } from "@callibrator/contracts/states";
import { env } from "../config/env";

const TABLE = "device_types";
const DEVICES = "calibration_devices";
const COLUMN = "device_type_id";
const ENUM_TYPES = Object.freeze(["enum_device_types_status"]);
const FUNCTION_NAME = "device_types_no_delete";
const ROW_TRIGGER = "device_types_no_delete";
const TRUNCATE_TRIGGER = "device_types_no_truncate";
const DEVICE_FK = "calibration_devices_device_type_id_fkey";
const DEVICE_INDEX = "calibration_devices_device_type_id_tenant_id";
const DEFAULT_APP_ROLE = "callibrator_app";
const LOCK_TIMEOUT = "10s";

/** CHECK name -> predicate. */
const CHECKS: Readonly<Record<string, string>> = Object.freeze({
  device_types_name_normalised: "name <> '' AND name = btrim(regexp_replace(name, '\\s+', ' ', 'g'))",
  device_types_legacy_id_positive: "legacy_id IS NULL OR legacy_id > 0",
});

/** D-20: the foreign-key columns, each with a leading index (Sequelize's default name). */
const FK_COLUMNS = Object.freeze(["created_by", "updated_by"]);

const INDEX_SQL = Object.freeze([
  `CREATE UNIQUE INDEX IF NOT EXISTS device_types_name_unique ON ${TABLE} (lower(btrim(name)))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS device_types_legacy_id_unique ON ${TABLE} (legacy_id) WHERE legacy_id IS NOT NULL`,
  ...FK_COLUMNS.map((column) => `CREATE INDEX IF NOT EXISTS ${TABLE}_${column} ON ${TABLE} (${column})`),
]);

const DEVICE_COLUMN_SQL = `ALTER TABLE ${DEVICES} ADD COLUMN ${COLUMN} UUID`;
const DEVICE_FK_SQL =
  `ALTER TABLE ${DEVICES} ADD CONSTRAINT ${DEVICE_FK} FOREIGN KEY (${COLUMN}) ` +
  `REFERENCES ${TABLE} (id) ON DELETE RESTRICT ON UPDATE CASCADE`;
const DEVICE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS ${DEVICE_INDEX} ON ${DEVICES} (${COLUMN}, tenant_id)`;

const FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION '${TABLE} is never emptied: TRUNCATE is refused'
      USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION '${TABLE}: device type % cannot be deleted', OLD.id
    USING ERRCODE = '42501',
          HINT = 'Retire it (status = ''retired''); devices keep their type (ADR-125 Amendment 1).';
END
$fn$`;

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

const run = async (sequelize: Sequelize, transaction: Transaction, statement: string): Promise<void> => {
  await sequelize.query(statement, { transaction });
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

const columnExists = async (sequelize: Sequelize, transaction: Transaction): Promise<boolean> =>
  (
    await rows(
      sequelize,
      transaction,
      "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column",
      { table: DEVICES, column: COLUMN },
    )
  ).length > 0;

/** The constraint names on `table`. */
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
      `0111: DB_APP_ROLE "${name}" is not a plain lower-case identifier ([a-z_][a-z0-9_]*). ` +
        "Refusing to interpolate it into GRANT statements.",
    );
  }
  return name;
};

const roleExists = async (sequelize: Sequelize, transaction: Transaction, role: string): Promise<boolean> => {
  const [row] = await rows(sequelize, transaction, "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role) AS exists", {
    role,
  });
  return row?.["exists"] === true;
};

const userFk = (): { type: typeof DataTypes.UUID; allowNull: true; references: object; onDelete: string; onUpdate: string } => ({
  type: DataTypes.UUID,
  allowNull: true,
  references: { model: "users", key: "id" },
  onDelete: "RESTRICT",
  onUpdate: "CASCADE",
});

/** The table as the model declares it (tests/migrations/0111 holds the two equal). */
const createTable = (context: QueryInterface, transaction: Transaction): Promise<void> =>
  context.createTable(
    TABLE,
    {
      id: { type: DataTypes.UUID, primaryKey: true, allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false },
      status: { type: DataTypes.ENUM(...DEVICE_TYPE_STATUSES), allowNull: false, defaultValue: "active" },
      legacy_id: { type: DataTypes.INTEGER, allowNull: true },
      created_by: userFk(),
      updated_by: userFk(),
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    { transaction },
  );

const up = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  const role = appRoleName();
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    for (const required of ["users", DEVICES]) {
      if (!(await tableExists(sequelize, transaction, required))) {
        throw new Error(
          `0111: table ${required} does not exist. Run db.sync() first (the backend does at boot); ` +
            "skipping would record this migration as applied with no device types.",
        );
      }
    }
    if (!(await roleExists(sequelize, transaction, role))) {
      throw new Error(
        `0111: the application role "${role}" does not exist. Migration 0057 creates it; ` +
          "run the migrations in order, or create it as an administrator (see 0057).",
      );
    }

    // 1. The table.
    if (!(await tableExists(sequelize, transaction, TABLE))) {
      await createTable(context, transaction);
    }

    // 2. CHECKs (sync never creates one).
    const own = await constraints(sequelize, transaction, TABLE);
    for (const [name, predicate] of Object.entries(CHECKS)) {
      if (!own.has(name)) {
        await run(sequelize, transaction, `ALTER TABLE ${TABLE} ADD CONSTRAINT ${name} CHECK (${predicate})`);
      }
    }

    // 3. Indexes.
    for (const statement of INDEX_SQL) {
      await run(sequelize, transaction, statement);
    }

    // 4. Nothing is deleted — for every role.
    await run(sequelize, transaction, FUNCTION_SQL);
    await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${ROW_TRIGGER} ON ${TABLE}`);
    await run(
      sequelize,
      transaction,
      `CREATE TRIGGER ${ROW_TRIGGER} BEFORE DELETE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION ${FUNCTION_NAME}()`,
    );
    await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${TRUNCATE_TRIGGER} ON ${TABLE}`);
    await run(
      sequelize,
      transaction,
      `CREATE TRIGGER ${TRUNCATE_TRIGGER} BEFORE TRUNCATE ON ${TABLE} FOR EACH STATEMENT EXECUTE FUNCTION ${FUNCTION_NAME}()`,
    );
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} ENABLE ALWAYS TRIGGER ${ROW_TRIGGER}`);
    await run(sequelize, transaction, `ALTER TABLE ${TABLE} ENABLE ALWAYS TRIGGER ${TRUNCATE_TRIGGER}`);

    // 5. The device's type: the column (sync() made it on a fresh database), its RESTRICT key, its index.
    if (!(await columnExists(sequelize, transaction))) {
      await run(sequelize, transaction, DEVICE_COLUMN_SQL);
    }
    if (!(await constraints(sequelize, transaction, DEVICES)).has(DEVICE_FK)) {
      await run(sequelize, transaction, DEVICE_FK_SQL);
    }
    await run(sequelize, transaction, DEVICE_INDEX_SQL);

    // 6. The application role: no DELETE, no TRUNCATE.
    await run(sequelize, transaction, `REVOKE DELETE, TRUNCATE ON ${TABLE} FROM ${role}`);
  });
};

const down = async ({ context }: { context: QueryInterface }): Promise<void> => {
  const { sequelize } = context;
  await sequelize.transaction(async (transaction) => {
    await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    if (await tableExists(sequelize, transaction, TABLE)) {
      const [row] = await rows(sequelize, transaction, `SELECT count(*)::int AS n FROM ${TABLE}`);
      const count = Number(row?.["n"]);
      if (count > 0) {
        throw new Error(
          `0111 down: ${String(count)} device type(s) exist. Reverting would destroy them and every ` +
            "device's link to one; the catalogue is never deleted (ADR-125). Nothing was changed.",
        );
      }
    }
    await run(sequelize, transaction, `DROP INDEX IF EXISTS ${DEVICE_INDEX}`);
    await run(sequelize, transaction, `ALTER TABLE ${DEVICES} DROP COLUMN IF EXISTS ${COLUMN}`);
    await run(sequelize, transaction, `DROP TABLE IF EXISTS ${TABLE}`);
    await run(sequelize, transaction, `DROP FUNCTION IF EXISTS ${FUNCTION_NAME}()`);
    for (const type of ENUM_TYPES) {
      await run(sequelize, transaction, `DROP TYPE IF EXISTS "${type}"`);
    }
  });
};

export = {
  TABLE,
  DEVICES,
  COLUMN,
  ENUM_TYPES,
  FUNCTION_NAME,
  ROW_TRIGGER,
  TRUNCATE_TRIGGER,
  DEVICE_FK,
  DEVICE_INDEX,
  CHECKS,
  FK_COLUMNS,
  INDEX_SQL,
  DEVICE_COLUMN_SQL,
  DEVICE_FK_SQL,
  DEVICE_INDEX_SQL,
  FUNCTION_SQL,
  appRoleName,
  up,
  down,
};
