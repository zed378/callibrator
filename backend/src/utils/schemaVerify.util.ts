/**
 * P6-05 (PR-5) — verify the REAL schema against what the models declare,
 * after db.sync() and the migrator have run.
 *
 * A migration wrapped in a blanket try/catch is recorded as applied while
 * doing nothing (0008/0013/0014 were). `db.sync()` creates missing TABLES but
 * never adds a missing COLUMN to an existing one, so such a column stays
 * absent until the first query that names it fails — weeks later. The
 * migration log is not evidence; `information_schema` is.
 *
 * What is checked, and why each is a failure:
 *
 *  - every model's table exists;
 *  - every non-VIRTUAL model attribute has its column (by physical field
 *    name) — a missing column is a query that will fail;
 *  - no column the model does NOT declare is NOT NULL without a default —
 *    every INSERT through the model would fail on it. (An undeclared NULLABLE
 *    column is harmless and is only reported as a note.);
 *  - the database objects that carry a control and exist only in migrations
 *    (EXPECTED_OBJECTS): a missing trigger is a missing control that no
 *    query would ever notice.
 *
 * It runs at boot (index.js), BEFORE the backend drops to the application
 * role: information_schema shows a role only the columns it has privileges
 * on. It is not wrapped in a catch — the P6-05 abuse case. The one way to let
 * a boot continue past a mismatch is `SCHEMA_VERIFY=warn`, which logs every
 * problem at error level on every boot; it exists for a recovery, not a
 * steady state.
 *
 * P9-09 (ADR-087): converted from schemaVerify.util.js with no behaviour
 * change. The Sequelize instance and the logger are typed by the members used
 * here; raw-SQL rows are typed by the columns each query selects.
 */

import { env } from "../config/env";

/** The physical objects that carry a control. */
export type ExpectedObjectKind = "trigger" | "index" | "constraint";

/** One object that lives only in migrations. */
export interface ExpectedObject {
  readonly kind: ExpectedObjectKind;
  readonly table: string;
  readonly name: string;
  readonly why: string;
}

/** A model attribute (a rawAttributes entry) — the members read here. */
export interface SchemaModelAttribute {
  readonly type?: { readonly key?: string } | null | undefined;
  readonly field?: string | undefined;
}

/** A Sequelize model — the members read here. */
export interface SchemaModel {
  readonly name: string;
  getTableName(): string | { readonly tableName: string };
  readonly rawAttributes: Readonly<Record<string, SchemaModelAttribute>>;
}

/** The Sequelize members used here. Rows come back untyped from raw SQL. */
export interface SchemaSequelize {
  readonly models: Readonly<Record<string, SchemaModel>>;
  query(sql: string, options: { type: "SELECT" }): Promise<unknown[]>;
}

/** The logger members used here. */
export interface SchemaLogger {
  info(message: string): unknown;
  error(message: string): unknown;
}

/** assertSchemaMatchesModels' options. */
export interface AssertSchemaOptions {
  sequelize: SchemaSequelize;
  logger: SchemaLogger;
  /** process.env.SCHEMA_VERIFY; "warn" logs and continues */
  mode?: string | undefined;
}

/** What verifySchema found. */
export interface SchemaVerifyResult {
  problems: string[];
  notes: string[];
  tables: number;
  columns: number;
  objects: number;
}

/** An information_schema.columns row, as selected below. */
interface ColumnRow {
  table_name: string;
  column_name: string;
  is_nullable: string;
  column_default: string | null;
  is_identity: string;
  is_generated: string;
}

/** A trigger, index or constraint row, as selected below. */
interface NamedObjectRow {
  table_name: string;
  name: string;
}

/** A table-name-only row, as selected below. */
interface TableRow {
  table_name: string;
}

/**
 * Objects that live only in migrations and carry a control. Each is checked
 * by name on its table.
 */
const EXPECTED_OBJECTS: readonly ExpectedObject[] = Object.freeze([
  Object.freeze({
    kind: "trigger",
    table: "calibration_records",
    name: "calibration_records_append_only",
    why: "P6-03: calibration records are append-only (migration 0057)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "calibration_records",
    name: "calibration_records_no_truncate",
    why: "P6-03: calibration records cannot be truncated (migration 0057)",
  }),
  Object.freeze({
    kind: "constraint",
    table: "calibration_records",
    name: "calibration_records_void_reason_check",
    why: "P6-03: a voided calibration record names a reason (migration 0057)",
  }),
  Object.freeze({
    kind: "index",
    table: "calibration_devices",
    name: "calibration_devices_tenant_id_serial_number_unique",
    why: "P6-06 / ADR-049: serial numbers are unique per tenant (migration 0026)",
  }),
  Object.freeze({
    kind: "trigger",
    table: "calibration_devices",
    name: "calibration_devices_retired_terminal",
    why: "Q-02 / ADR-084: a retired device leaves 'retired' only by audited reinstatement (migration 0089)",
  }),
  Object.freeze({
    kind: "constraint",
    table: "stock_adjustments",
    name: "stock_adjustments_reason_not_blank",
    why: "P6-09: every stock adjustment names a reason (migration 0059)",
  }),
  // 0063 skips (by design) when `users` is absent; a skip that happened must
  // not pass silently, because sign-in assumes one account per identifier.
  Object.freeze({
    kind: "index",
    table: "users",
    name: "users_email_lower_unique",
    why: "D-06 / ADR-063: one account per email, whatever its case (migration 0063)",
  }),
  Object.freeze({
    kind: "index",
    table: "users",
    name: "users_username_lower_unique",
    why: "D-06 / ADR-063: one account per username, whatever its case (migration 0063)",
  }),
]);

const TAG = "[schema-verify]";

/**
 * @param {object} model - a Sequelize model
 * @returns {string} its unqualified table name
 */
const tableNameOf = (model: SchemaModel): string => {
  const name = model.getTableName();
  return typeof name === "string" ? name : name.tableName;
};

/**
 * @param {object} attribute - a rawAttributes entry
 * @returns {boolean} true when the attribute has no column (DataTypes.VIRTUAL)
 */
const isVirtual = (attribute: SchemaModelAttribute): boolean => attribute.type?.key === "VIRTUAL";

/**
 * @param {object} sequelize - the Sequelize instance whose models to check
 * @returns {Promise<{problems: string[], notes: string[], tables: number, columns: number, objects: number}>}
 */
const verifySchema = async (sequelize: SchemaSequelize): Promise<SchemaVerifyResult> => {
  const columnRows = (await sequelize.query(
    `SELECT table_name, column_name, is_nullable, column_default, is_identity, is_generated
       FROM information_schema.columns
      WHERE table_schema = current_schema()`,
    { type: "SELECT" },
  )) as ColumnRow[];
  const triggerRows = (await sequelize.query(
    `SELECT c.relname AS table_name, t.tgname AS name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND NOT t.tgisinternal`,
    { type: "SELECT" },
  )) as NamedObjectRow[];
  const indexRows = (await sequelize.query(
    `SELECT tablename AS table_name, indexname AS name
       FROM pg_indexes WHERE schemaname = current_schema()`,
    { type: "SELECT" },
  )) as NamedObjectRow[];
  const constraintRows = (await sequelize.query(
    `SELECT c.relname AS table_name, k.conname AS name
       FROM pg_constraint k
       JOIN pg_class c ON c.oid = k.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()`,
    { type: "SELECT" },
  )) as NamedObjectRow[];

  /** table -> column -> row */
  const actual = new Map<string, Map<string, ColumnRow>>();
  for (const row of columnRows) {
    let byColumn = actual.get(row.table_name);
    if (!byColumn) {
      byColumn = new Map<string, ColumnRow>();
      actual.set(row.table_name, byColumn);
    }
    byColumn.set(row.column_name, row);
  }

  const problems: string[] = [];
  const notes: string[] = [];
  let tables = 0;
  let columns = 0;

  const models = Object.values(sequelize.models).sort((a, b) =>
    tableNameOf(a).localeCompare(tableNameOf(b)),
  );
  for (const model of models) {
    const table = tableNameOf(model);
    const present = actual.get(table);
    if (!present) {
      problems.push(`table ${table} (model ${model.name}) does not exist`);
      continue;
    }
    tables += 1;
    const declared = new Set<string>();
    for (const [attributeName, attribute] of Object.entries(model.rawAttributes)) {
      if (isVirtual(attribute)) {
        continue;
      }
      // `||`: an empty `field` means the attribute name, as before.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as-built (ADR-038 rule 3)
      const field = attribute.field || attributeName;
      declared.add(field);
      columns += 1;
      if (!present.has(field)) {
        problems.push(
          `column ${table}.${field} (model ${model.name}.${attributeName}) does not exist — ` +
            "a migration that should have added it did nothing",
        );
      }
    }
    for (const [field, row] of present) {
      if (declared.has(field)) {
        continue;
      }
      const required =
        row.is_nullable === "NO" &&
        row.column_default === null &&
        row.is_identity !== "YES" &&
        row.is_generated !== "ALWAYS";
      if (required) {
        problems.push(
          `column ${table}.${field} is NOT NULL with no default and model ${model.name} does not ` +
            "declare it — every insert through the model will fail",
        );
      } else {
        notes.push(`column ${table}.${field} is not declared by model ${model.name}`);
      }
    }
  }

  // A-242 / ADR-029: no table uses row level security. RLS left ENABLED with
  // no policy denies every row to any role that is not a superuser — the
  // application role included — while the owner-superuser never notices.
  const rlsRows = (await sequelize.query(
    `SELECT c.relname AS table_name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relrowsecurity`,
    { type: "SELECT" },
  )) as TableRow[];
  for (const row of rlsRows) {
    problems.push(
      `row level security is enabled on ${row.table_name} — ADR-029 removed RLS, and with no policy it ` +
        "hides every row from the application role",
    );
  }

  const has = (rows: readonly NamedObjectRow[], table: string, name: string): boolean => rows.some((r) => r.table_name === table && r.name === name);
  for (const object of EXPECTED_OBJECTS) {
    const rows = { trigger: triggerRows, index: indexRows, constraint: constraintRows }[object.kind];
    if (!has(rows, object.table, object.name)) {
      problems.push(`${object.kind} ${object.name} on ${object.table} does not exist — ${object.why}`);
    }
  }

  return { problems, notes, tables, columns, objects: EXPECTED_OBJECTS.length };
};

/**
 * Verify and act on the result: log, and THROW on a problem unless
 * `mode === "warn"`.
 *
 * @param {object} options
 * @param {object} options.sequelize - the Sequelize instance
 * @param {object} options.logger - { info, warn, error }
 * @param {string} [options.mode] - process.env.SCHEMA_VERIFY; "warn" logs and continues
 * @returns {Promise<object>} the verifySchema() result
 */
const assertSchemaMatchesModels = async ({ sequelize, logger, mode = env("SCHEMA_VERIFY") }: AssertSchemaOptions): Promise<SchemaVerifyResult> => {
  const result = await verifySchema(sequelize);
  for (const note of result.notes) {
    logger.info(`${TAG} note: ${note}`);
  }
  if (result.problems.length === 0) {
    logger.info(
      `${TAG} OK: ${String(result.tables)} tables, ${String(result.columns)} columns and ${String(result.objects)} ` +
        "control objects match the models",
    );
    return result;
  }
  for (const problem of result.problems) {
    logger.error(`${TAG} MISMATCH: ${problem}`);
  }
  const summary =
    `${TAG} FAILED: ${String(result.problems.length)} mismatch(es) between the models and the database. ` +
    "The migration log is not evidence (PR-5); fix the schema, then restart.";
  if (mode === "warn") {
    logger.error(`${summary} Continuing ONLY because SCHEMA_VERIFY=warn.`);
    return result;
  }
  throw new Error(`${summary}\n  ${result.problems.join("\n  ")}`);
};

export { verifySchema, assertSchemaMatchesModels, EXPECTED_OBJECTS, TAG };
