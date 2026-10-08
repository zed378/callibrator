/**
 * Shared by migrations 0117 – 0123 (P20-07; ADR-124 and its Amendments 2–3; spec
 * MEMORY/specs/P19-04-client-facilities.md § 4 – § 6): the client-facility dimension.
 *
 * Not a migration (no `NNNN-` prefix, not in the manifest): the catalog helpers, the frozen lists
 * the seven write into the database, and the one rule every `down` applies. It ships with the
 * seven and is frozen with them — a change here changes what an applied migration would re-run.
 *
 * Named exports only (ADR-087 Am. 15). No try/catch anywhere: a failure propagates and the
 * migration is not recorded as applied (PR-5).
 */
import type { Sequelize, Transaction } from "sequelize";
import { env } from "../config/env";

/** Every migration of the seven sets this first (the 0111 precedent): a lock it cannot get fails fast. */
export const LOCK_TIMEOUT = "10s";

/** The application role 0057 created (`DB_APP_ROLE`). */
export const DEFAULT_APP_ROLE = "callibrator_app";

/** The transaction-local setting naming the `client_facility_moves` row of a device move (spec § 5.4). */
export const MOVE_SETTING = "callibrator.facility_move";

/** The transaction-local setting naming the user whose binding the binding operation changes (spec § 10.1). */
export const BINDING_SETTING = "callibrator.facility_binding";

/** The facility deny sentinel (types/ids.ts NO_FACILITY_ID); 0117's CHECK refuses it as an id. */
export const NO_FACILITY_ID = "00000000-0000-0000-0000-00000000f000";

/**
 * The `attachments.resource_type` values (lower-cased) whose record carries a client facility —
 * constants/attachmentResources LINKABLE_RESOURCES minus `kanbancard` (provider-internal). The
 * IPM photo types are added by P19-02/03's migration, which replaces 0123's CHECK and function.
 */
export const FACILITY_ATTACHMENT_TYPES = Object.freeze([
  "certificate",
  "device",
  "calibrationdevice",
  "calibration",
  "calibrationrecord",
  "workorder",
  "maintenanceworkorder",
] as const);

/** FACILITY_BOUND_ROLES (constants/facilityAccess.ts), written out: a migration is frozen once applied. */
export const BOUND_ROLE_NAMES = Object.freeze([
  "HEALTHCARE ADMIN",
  "HEALTHCARE TECHNICIAN",
  "FACILITY MAINTENANCE",
  "ROOM USER",
] as const);

/** `'a', 'b'` — a SQL list of the given trusted literals (constants of this module only). */
export const sqlList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(", ");

/** One catalog/result row. */
export type Row = Record<string, unknown>;

/** Run `statement` in `transaction`, returning its rows. */
export const rows = async (
  sequelize: Sequelize,
  transaction: Transaction,
  statement: string,
  replacements: Record<string, unknown> = {},
): Promise<Row[]> => {
  const [result] = (await sequelize.query(statement, { transaction, replacements })) as [Row[], unknown];
  return result;
};

/** Run `statement` in `transaction`. */
export const run = async (sequelize: Sequelize, transaction: Transaction, statement: string): Promise<void> => {
  await sequelize.query(statement, { transaction });
};

/** Whether `table` exists in the current schema. */
export const tableExists = async (sequelize: Sequelize, transaction: Transaction, table: string): Promise<boolean> => {
  const [row] = await rows(sequelize, transaction, "SELECT to_regclass(current_schema() || '.' || :table) IS NOT NULL AS present", {
    table,
  });
  return row?.["present"] === true;
};

/** Whether `table.column` exists. */
export const columnExists = async (
  sequelize: Sequelize,
  transaction: Transaction,
  table: string,
  column: string,
): Promise<boolean> =>
  (
    await rows(
      sequelize,
      transaction,
      "SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column",
      { table, column },
    )
  ).length > 0;

/** The constraint names on `table`. */
export const constraintNames = async (sequelize: Sequelize, transaction: Transaction, table: string): Promise<Set<string>> =>
  new Set(
    (
      await rows(sequelize, transaction, "SELECT conname FROM pg_constraint WHERE conrelid = (current_schema() || '.' || :table)::regclass", {
        table,
      })
    ).map((r) => String(r["conname"])),
  );

/** Whether a function named `name` exists in the current schema. */
export const functionExists = async (sequelize: Sequelize, transaction: Transaction, name: string): Promise<boolean> =>
  (
    await rows(
      sequelize,
      transaction,
      "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = current_schema() AND p.proname = :name",
      { name },
    )
  ).length > 0;

/** `tgenabled` of a trigger ('O', 'A', 'R', 'D'), or null when absent. */
export const triggerState = async (
  sequelize: Sequelize,
  transaction: Transaction,
  table: string,
  trigger: string,
): Promise<string | null> => {
  const [row] = await rows(
    sequelize,
    transaction,
    "SELECT tgenabled::text AS state FROM pg_trigger WHERE tgrelid = (current_schema() || '.' || :table)::regclass AND tgname = :trigger",
    { table, trigger },
  );
  return row ? String(row["state"]) : null;
};

/**
 * @param tag - the migration number, for the message
 * @param raw - DB_APP_ROLE
 * @returns a safe, unquoted role identifier (0057's rule)
 */
export const appRoleName = (tag: string, raw: string | undefined = env("DB_APP_ROLE")): string => {
  const name = raw === undefined || raw === "" || raw === "none" ? DEFAULT_APP_ROLE : raw;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(
      `${tag}: DB_APP_ROLE "${name}" is not a plain lower-case identifier ([a-z_][a-z0-9_]*). ` +
        "Refusing to interpolate it into GRANT statements.",
    );
  }
  return name;
};

/** Whether the role exists (cluster-wide). */
export const roleExists = async (sequelize: Sequelize, transaction: Transaction, role: string): Promise<boolean> => {
  const [row] = await rows(sequelize, transaction, "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :role) AS exists", { role });
  return row?.["exists"] === true;
};

/** Throw unless every table exists — a skip would be recorded as applied with nothing done (PR-5). */
export const requireTables = async (
  sequelize: Sequelize,
  transaction: Transaction,
  tag: string,
  tables: readonly string[],
): Promise<void> => {
  for (const table of tables) {
    if (!(await tableExists(sequelize, transaction, table))) {
      throw new Error(
        `${tag}: table ${table} does not exist. Run db.sync() and the earlier migrations first (the backend does at boot); ` +
          "skipping would record this migration as applied with nothing done.",
      );
    }
  }
};

/** Throw unless 0117 ran: the facilities table and the shared trigger functions exist. */
export const requireFacilityFoundation = async (sequelize: Sequelize, transaction: Transaction, tag: string): Promise<void> => {
  await requireTables(sequelize, transaction, tag, ["client_facilities", "client_facility_moves"]);
  for (const fn of ["facility_insert_default", "facility_column_guard", "facility_accepts_inserts", "facility_move_admits"]) {
    if (!(await functionExists(sequelize, transaction, fn))) {
      throw new Error(`${tag}: function ${fn}() does not exist — migration 0117 must run first.`);
    }
  }
};

/**
 * The rule of every `down` of the seven (spec § 6.3): refuse while any facility beyond a tenant's
 * own exists, any device move was recorded, or any user is bound — reverting would destroy which
 * facility owns what. On a database still single-facility (every row in its tenant's self facility)
 * nothing is lost, and the migration reverts. The pre-upgrade backup is the rollback after real use.
 */
export const refuseDownWhenFacilitiesUsed = async (sequelize: Sequelize, transaction: Transaction, tag: string): Promise<void> => {
  const reasons: string[] = [];
  if (await tableExists(sequelize, transaction, "client_facilities")) {
    const [row] = await rows(sequelize, transaction, "SELECT count(*)::int AS n FROM client_facilities WHERE NOT is_self");
    const n = Number(row?.["n"]);
    if (n > 0) {
      reasons.push(`${String(n)} client facilit${n === 1 ? "y" : "ies"} beyond the tenants' own`);
    }
  }
  if (await tableExists(sequelize, transaction, "client_facility_moves")) {
    const [row] = await rows(sequelize, transaction, "SELECT count(*)::int AS n FROM client_facility_moves");
    const n = Number(row?.["n"]);
    if (n > 0) {
      reasons.push(`${String(n)} device move(s)`);
    }
  }
  if (await columnExists(sequelize, transaction, "users", "client_facility_id")) {
    const [row] = await rows(sequelize, transaction, "SELECT count(*)::int AS n FROM users WHERE client_facility_id IS NOT NULL");
    const n = Number(row?.["n"]);
    if (n > 0) {
      reasons.push(`${String(n)} facility-bound user(s)`);
    }
  }
  if (reasons.length > 0) {
    throw new Error(
      `${tag} down: the database holds ${reasons.join(", ")}. Reverting would destroy which client facility owns ` +
        "which record; restore the pre-upgrade backup instead (ADR-116). Nothing was changed.",
    );
  }
};

/** CREATE TRIGGER … then ENABLE ALWAYS (the 0091 pattern: it fires under session_replication_role = replica too). */
export const createAlwaysTrigger = async (
  sequelize: Sequelize,
  transaction: Transaction,
  table: string,
  name: string,
  definition: string,
): Promise<void> => {
  await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${name} ON ${table}`);
  await run(sequelize, transaction, `CREATE ${definition}`);
  await run(sequelize, transaction, `ALTER TABLE ${table} ENABLE ALWAYS TRIGGER ${name}`);
};

/** One back-filled, NOT NULL facility column on a child of `calibration_devices` (M3 – M6). */
export interface ChildTable {
  /** the migration number, for messages */
  readonly tag: string;
  readonly table: string;
  /** the composite FK to calibration_devices (tenant_id, client_facility_id, id) */
  readonly deviceFk: string;
  /** its leading index (D-20) */
  readonly deviceFkIndex: string;
  /** ON DELETE of the composite key — the same as the single-column device_id key's (0037) */
  readonly onDelete: "RESTRICT" | "CASCADE";
  /** BEFORE INSERT: fill from the device (Am. 3) */
  readonly defaultTrigger: string;
  /** BEFORE INSERT: refuse an ended facility; null for iot_readings (spec § 5.4) */
  readonly openTrigger: string | null;
  /** BEFORE UPDATE OF client_facility_id: only under a device move */
  readonly guardTrigger: string;
}

/** The SQL of a child's composite key to its device (ON UPDATE CASCADE: the move carries it). */
export const childDeviceFkSql = (child: ChildTable): string =>
  `ALTER TABLE ${child.table} ADD CONSTRAINT ${child.deviceFk} FOREIGN KEY (tenant_id, client_facility_id, device_id) ` +
  `REFERENCES calibration_devices (tenant_id, client_facility_id, id) ON UPDATE CASCADE ON DELETE ${child.onDelete}`;

/** The set-based back-fill of a child from its device (spec § 6.2: one statement, no batching). */
export const childBackfillSql = (table: string): string =>
  `UPDATE ${table} c SET client_facility_id = d.client_facility_id FROM calibration_devices d ` +
  "WHERE d.id = c.device_id AND d.tenant_id = c.tenant_id AND c.client_facility_id IS NULL";

/**
 * The two statements a child migration writes out LITERALLY in its own `up` (so the closed-world
 * migration readers — modelIndexColumns.am3, D-20 — see the column and the index it creates; this
 * module itself adds no column and creates no index, and migrationScan holds it to that).
 */
export interface ChildStatements {
  /** `ALTER TABLE <table> ADD COLUMN client_facility_id UUID` */
  readonly addColumn: string;
  /** `CREATE INDEX IF NOT EXISTS <deviceFkIndex> ON <table> (tenant_id, client_facility_id, device_id)` */
  readonly index: string;
}

/**
 * M3 – M6's common `up` for a NOT NULL child: column, back-fill, NOT NULL, composite key, index,
 * the three triggers. `beforeBackfill` / `afterBackfill` wrap the UPDATE (0119 lifts 0057's trigger
 * there and puts it back). Returns the number of rows back-filled.
 */
export const upNotNullChild = async (
  sequelize: Sequelize,
  transaction: Transaction,
  child: ChildTable,
  statements: ChildStatements,
  hooks: {
    beforeBackfill?: () => Promise<void>;
    afterBackfill?: () => Promise<void>;
  } = {},
): Promise<number> => {
  const { tag, table } = child;
  await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  await requireTables(sequelize, transaction, tag, [table, "calibration_devices"]);
  await requireFacilityFoundation(sequelize, transaction, tag);
  if (!(await columnExists(sequelize, transaction, "calibration_devices", "client_facility_id"))) {
    throw new Error(`${tag}: calibration_devices.client_facility_id does not exist — migration 0118 must run first.`);
  }

  if (!(await columnExists(sequelize, transaction, table, "client_facility_id"))) {
    await run(sequelize, transaction, statements.addColumn);
  }
  if (hooks.beforeBackfill) {
    await hooks.beforeBackfill();
  }
  const [, meta] = (await sequelize.query(childBackfillSql(table), { transaction })) as [unknown, { rowCount?: number } | number];
  const backfilled = typeof meta === "number" ? meta : (meta.rowCount ?? 0);
  if (hooks.afterBackfill) {
    await hooks.afterBackfill();
  }
  const [orphan] = await rows(sequelize, transaction, `SELECT count(*)::int AS n FROM ${table} WHERE client_facility_id IS NULL`);
  const left = Number(orphan?.["n"]);
  if (left > 0) {
    throw new Error(
      `${tag}: ${String(left)} row(s) of ${table} have no device in their own tenant to take a client facility from. ` +
        "Nothing was changed; repair those rows first.",
    );
  }
  await run(sequelize, transaction, `ALTER TABLE ${table} ALTER COLUMN client_facility_id SET NOT NULL`);
  await run(sequelize, transaction, statements.index);
  if (!(await constraintNames(sequelize, transaction, table)).has(child.deviceFk)) {
    await run(sequelize, transaction, childDeviceFkSql(child));
  }
  await createAlwaysTrigger(
    sequelize,
    transaction,
    table,
    child.defaultTrigger,
    `TRIGGER ${child.defaultTrigger} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION facility_insert_default('child')`,
  );
  if (child.openTrigger) {
    await createAlwaysTrigger(
      sequelize,
      transaction,
      table,
      child.openTrigger,
      `TRIGGER ${child.openTrigger} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION facility_accepts_inserts()`,
    );
  }
  await createAlwaysTrigger(
    sequelize,
    transaction,
    table,
    child.guardTrigger,
    `TRIGGER ${child.guardTrigger} BEFORE UPDATE OF client_facility_id ON ${table} FOR EACH ROW EXECUTE FUNCTION facility_column_guard('child')`,
  );
  return backfilled;
};

/** M3 – M6's common `down`: refuse when used; else the triggers, the key, the index, the column. */
export const downNotNullChild = async (sequelize: Sequelize, transaction: Transaction, child: ChildTable): Promise<void> => {
  const { tag, table } = child;
  await run(sequelize, transaction, `SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  await refuseDownWhenFacilitiesUsed(sequelize, transaction, tag);
  for (const trigger of [child.defaultTrigger, child.openTrigger, child.guardTrigger]) {
    if (trigger) {
      await run(sequelize, transaction, `DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
    }
  }
  await run(sequelize, transaction, `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${child.deviceFk}`);
  await run(sequelize, transaction, `DROP INDEX IF EXISTS ${child.deviceFkIndex}`);
  await run(sequelize, transaction, `ALTER TABLE ${table} DROP COLUMN IF EXISTS client_facility_id`);
};
