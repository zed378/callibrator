/**
 * memoryDb — the REAL models and the REAL tenant hooks over an in-memory
 * store, for two-tenant route tests (A-63 follow-up: "every :id route has a
 * two-tenant test").
 *
 * WHY
 *
 * A two-tenant test built on `Model.findOne = jest.fn()` proves nothing about
 * isolation: the double decides what "another tenant's row" returns, so the
 * test asserts the author's belief about the hooks. CLAUDE.md: "where a test
 * double is needed, it must enforce the tenant predicate the way the real hooks
 * do". The surest way is not to double the hooks at all.
 *
 * WHAT IS REAL
 *
 *  - `models/index.js` itself: every model file, every association, and
 *    `tenantScope.util#register` — the eleven global hooks, the include walk
 *    (A-87/ADR-048) and the hookless-statics wrappers (W-34). This fixture is
 *    wired in as `config.db`; the barrel loads on it exactly as in production.
 *  - Sequelize 6 itself above the query interface: scopes (`defaultScope`),
 *    `paranoid`, validation, timestamps, `findByPk`/`findOne`/`findAll`/
 *    `count`/`update`/`destroy`/`restore`/`increment`, instance methods, the
 *    include conformance and `required` defaulting, and the hooks' place in
 *    that pipeline.
 *  - CLS: production calls `Sequelize.useCLS` (config/index.js), so a query
 *    inside a managed `transaction(cb)` joins it without `{ transaction }`.
 *    `_cls` is emulated with an AsyncLocalStorage holding the transaction.
 *
 * WHAT IS DOUBLED
 *
 *  - The query interface (`select`, `rawSelect`, `insert`, `update`,
 *    `bulkUpdate`, `delete`, `bulkDelete`, `bulkInsert`, `increment`,
 *    `upsert`): it evaluates the `where` Sequelize hands it — AFTER the hooks
 *    have added the tenant predicate — against plain rows. A column the model
 *    does not define throws PostgreSQL's `column "x" does not exist` (the
 *    `is_deleted` trap). An operator or a `sequelize.where/fn/literal` it
 *    cannot evaluate THROWS rather than guessing: a test that silently
 *    matched everything would pass for the wrong reason.
 *  - Joins: belongsTo / hasOne / hasMany / belongsToMany includes are
 *    resolved from the REAL association metadata, with the include's own
 *    `where` (which the A-87 hook has already scoped), its `required`
 *    (INNER drops the parent, LEFT joins null) and the target's `paranoid`.
 *  - `sequelize.query` (raw SQL bypasses the hooks — CLAUDE.md): refused
 *    unless the test installs `onQuery(handler)`, which then answers it. A
 *    raw query is a review item, so a test that meets one says so.
 *  - Transactions: `transaction()` / `transaction(cb)` with commit, rollback
 *    (which UNDOES every write made in it), `afterCommit` and `LOCK`.
 *
 * WIRING
 *
 *   (TypeScript wiring: routes/qms.twoTenant.test.ts)
 *   const mdb = require("../fixtures/memoryDb").memoryDb();   // same instance
 *   const models = require("../../models");                     // the real barrel
 *   beforeEach(() => mdb.reset());
 *   mdb.seed("Vendor", [{ id, tenantId, name: "A" }]);
 *
 * ASSERTING "NOTHING IS WRITTEN"
 *
 *   mdb.writes()      — every write attempted (committed, rolled back or open)
 *   mdb.committed()   — writes that are durable
 *   mdb.dump()        — a deep copy of every table, for before/after equality
 *
 * It is a fixture, not PostgreSQL: no constraints beyond the model's own
 * validation, no triggers, no SQL. Grants and SQL are tested against the
 * database (the *.live.test.js suites).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { Sequelize, Op, Transaction, Utils } from "sequelize";

/** A stored row: attribute name -> value. */
export type Row = Record<string, unknown>;

/** What the fixture reads of a Sequelize model (partly internal API). */
interface ModelLike {
  readonly name: string;
  readonly rawAttributes: Record<string, { field?: string } | undefined>;
  readonly fieldRawAttributesMap?: Record<string, { fieldName: string } | undefined>;
  readonly _timestampAttributes: { deletedAt?: string };
  readonly options: { paranoid?: boolean };
  readonly primaryKeyAttribute?: string;
  getTableName(): string | { tableName: string };
  bulkBuild(rows: Row[], options: object): unknown[];
  build(values: Row, options: object): { dataValues: Row };
}

interface AssociationLike {
  readonly associationType: string;
  readonly foreignKey: string;
  readonly targetKey: string;
  readonly sourceKey: string;
  readonly otherKey: string;
  readonly through?: { model: ModelLike };
}

interface IncludeLike {
  readonly association: AssociationLike;
  readonly model: ModelLike;
  readonly as: string;
  readonly where?: unknown;
  readonly required?: boolean;
  readonly paranoid?: boolean;
  readonly separate?: boolean;
  readonly _pseudo?: boolean;
  readonly include?: IncludeLike[];
  readonly through?: { where?: unknown };
}

/** The options Sequelize hands the query interface (the parts read here). */
export interface QueryOptionsLike {
  readonly where?: unknown;
  readonly include?: IncludeLike[];
  readonly order?: unknown;
  readonly limit?: number | null | undefined;
  readonly offset?: number;
  readonly raw?: boolean;
  readonly plain?: boolean;
  readonly group?: unknown;
  readonly distinct?: boolean;
  readonly col?: string;
  readonly attributes?: unknown;
  readonly originalAttributes?: unknown;
  readonly includeNames?: unknown;
  readonly includeMap?: unknown;
  readonly returning?: boolean;
  readonly model?: ModelLike;
  readonly transaction?: MemoryTransaction | null;
  readonly upsertKeys?: string[];
  readonly conflictFields?: string[];
  readonly replacements?: Record<string, unknown>;
  readonly bind?: unknown;
}

/** One write, whatever became of it. */
export interface WriteRecord {
  readonly op: string;
  readonly model: string;
  readonly id: unknown;
  readonly values: unknown;
  tx: string | null;
  state: "open" | "committed" | "rolledBack";
}

type Undo = () => void;
type WriteEntry = Pick<WriteRecord, "op" | "model" | "id" | "values">;

/** Answers raw SQL — returns what `sequelize.query` would. */
export type QueryHandler = (
  sql: string,
  options: QueryOptionsLike,
  helpers: { record: (entry: WriteEntry, undo?: Undo) => WriteRecord },
) => unknown;

let txSeq = 0;

/**
 * A class, not a plain object: Sequelize deep-clones plain objects in its
 * options (Utils.cloneDeep), which would detach the undo log from the
 * transaction the caller holds.
 */
export class MemoryTransaction {
  readonly id: string;
  finished: "commit" | "rollback" | undefined = undefined;
  readonly LOCK = Transaction.LOCK;
  readonly undo: Undo[] = [];
  readonly writes: WriteRecord[] = [];
  private readonly after: ((tx: MemoryTransaction) => unknown)[] = [];

  constructor() {
    txSeq += 1;
    this.id = `memtx-${String(txSeq)}`;
  }

  afterCommit(fn: (tx: MemoryTransaction) => unknown): void {
    this.after.push(fn);
  }

  async commit(): Promise<void> {
    if (this.finished) {
      throw new Error(`Transaction cannot be committed because it has been finished with state: ${this.finished}`);
    }
    this.finished = "commit";
    for (const w of this.writes) {
      w.state = "committed";
    }
    for (const fn of this.after) {
      await fn(this);
    }
  }

  rollback(): Promise<void> {
    if (this.finished) {
      return Promise.reject(
        new Error(`Transaction cannot be rolled back because it has been finished with state: ${this.finished}`),
      );
    }
    this.finished = "rollback";
    for (const undo of [...this.undo].reverse()) {
      undo();
    }
    for (const w of this.writes) {
      w.state = "rolledBack";
    }
    return Promise.resolve();
  }
}

const isSequelizeMethod = (v: unknown): boolean => v instanceof Utils.SequelizeMethod;

const isPlainObject = (v: unknown): v is Record<string | symbol, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !isSequelizeMethod(v);

const unsupported = (what: string): never => {
  throw new Error(`memoryDb: cannot evaluate ${what} — extend the fixture or answer it with onQuery()`);
};

const kindOf = (v: unknown): string => (v instanceof Utils.SequelizeMethod ? v.constructor.name : typeof v);

const normalize = (v: unknown): unknown => {
  if (v instanceof Date) {
    return v.getTime();
  }
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? v : t;
  }
  return v;
};

const text = (v: unknown): string => {
  if (typeof v === "string") {
    return v;
  }
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") {
    return String(v);
  }
  // JSON.stringify(undefined) is undefined at runtime, whatever its type says.
  return v === undefined ? "" : JSON.stringify(v);
};

const equal = (a: unknown, b: unknown): boolean => {
  if (a === null || a === undefined || b === null || b === undefined) {
    return false;
  }
  const na = normalize(a);
  const nb = normalize(b);
  if (typeof na === "number" || typeof nb === "number") {
    return Number(na) === Number(nb);
  }
  return text(na) === text(nb);
};

const compare = (a: unknown, b: unknown): number => {
  const na = normalize(a);
  const nb = normalize(b);
  if (typeof na === "number" || typeof nb === "number") {
    return Number(na) - Number(nb);
  }
  const sa = text(na);
  const sb = text(nb);
  if (sa < sb) {
    return -1;
  }
  return sa > sb ? 1 : 0;
};

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

// PostgreSQL's LIKE: `%` any run, `_` one character, and a backslash (the
// default ESCAPE) makes the next character literal, so `\_` is an underscore,
// not a wildcard. The escape was ignored here until A-329, so an escaped
// pattern (tenantHierarchy#subtreePattern, user.service's search) matched MORE
// rows in memory than on PostgreSQL.
const likeToRegex = (pattern: unknown, flags: string): RegExp => {
  const source = text(pattern);
  let out = "";
  for (let i = 0; i < source.length; i += 1) {
    const ch = source.charAt(i);
    if (ch === "\\" && i + 1 < source.length) {
      i += 1;
      out += source.charAt(i).replace(REGEX_SPECIAL, "\\$&");
    } else if (ch === "%") {
      out += ".*";
    } else if (ch === "_") {
      out += ".";
    } else {
      out += ch.replace(REGEX_SPECIAL, "\\$&");
    }
  }
  return new RegExp(`^${out}$`, flags);
};

const clone = <T>(v: T): T => {
  if (v instanceof Date) {
    return new Date(v.getTime()) as T;
  }
  if (Buffer.isBuffer(v)) {
    return Buffer.from(v) as T;
  }
  if (Array.isArray(v)) {
    return v.map((x: unknown) => clone(x)) as T;
  }
  if (v !== null && typeof v === "object" && !isSequelizeMethod(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      out[k] = clone(x);
    }
    return out as T;
  }
  return v;
};

const present = (v: unknown): boolean => v !== null && v !== undefined;
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : [v]);

/** The in-memory database. See the header for what is real and what is doubled. */
export class MemoryDb {
  readonly sequelize: Sequelize;
  private readonly tables = new Map<string, Row[]>();
  private readonly log: WriteRecord[] = [];
  private queryHandler: QueryHandler | null = null;
  private readonly ambient = new AsyncLocalStorage<MemoryTransaction>();

  constructor() {
    this.sequelize = new Sequelize({ dialect: "postgres", logging: false });
    // CLS, as production has it (config/index.js: Sequelize.useCLS).
    const clsHost = Sequelize as unknown as { _cls: { get: (key: string) => unknown } };
    clsHost._cls = {
      get: (key: string): unknown => (key === "transaction" ? this.ambient.getStore() : undefined),
    };
    this.installQueryInterface();
    this.installSequelize();
  }

  // ------------------------------------------------------------- public API

  /** Empty every table, forget every write and the raw-SQL handler. */
  reset(): void {
    this.tables.clear();
    this.log.length = 0;
    this.queryHandler = null;
  }

  /**
   * Insert rows directly (no hooks, no log): the world before the request.
   * Each row is BUILT through the real model, so its defaults apply.
   */
  seed(modelName: string, rows: Row | Row[]): Row[] {
    const model = this.model(modelName);
    const out: Row[] = [];
    for (const values of Array.isArray(rows) ? rows : [rows]) {
      const built = model.build(values, { isNewRecord: true });
      const row: Row = {};
      for (const attr of Object.keys(model.rawAttributes)) {
        const v = built.dataValues[attr];
        if (v !== undefined) {
          row[attr] = clone(v);
        }
      }
      this.rowsOf(model).push(row);
      out.push(row);
    }
    return out;
  }

  /** Plain copies of a table's rows, soft-deleted ones included. */
  rows(modelName: string): Row[] {
    return clone(this.rowsOf(this.model(modelName)));
  }

  /** A deep copy of every table, for before/after equality. */
  dump(): Record<string, Row[]> {
    const out: Record<string, Row[]> = {};
    for (const [name, rows] of this.tables) {
      out[name] = clone(rows);
    }
    return out;
  }

  /** Every write attempted, whatever became of it. */
  writes(): WriteRecord[] {
    return this.log.map((w) => ({ ...w }));
  }

  /** Writes that are durable (outside a transaction, or in a committed one). */
  committed(): WriteRecord[] {
    return this.log.filter((w) => w.state === "committed").map((w) => ({ ...w }));
  }

  /** Answer raw SQL: handler(sql, options) -> the result sequelize.query would give. */
  onQuery(handler: QueryHandler): void {
    this.queryHandler = handler;
  }

  // ------------------------------------------------------------- internals

  private model(name: string): ModelLike {
    const models = this.sequelize.models as unknown as Record<string, ModelLike | undefined>;
    const model = models[name];
    if (!model) {
      throw new Error(`memoryDb: no model ${name}`);
    }
    return model;
  }

  private modelOf(nameOrTable: unknown): ModelLike {
    const name = isPlainObject(nameOrTable) ? nameOrTable["tableName"] : nameOrTable;
    const models = Object.values(this.sequelize.models) as unknown as ModelLike[];
    for (const model of models) {
      const t = model.getTableName();
      const tableName = typeof t === "object" ? t.tableName : t;
      if (model.name === name || tableName === name) {
        return model;
      }
    }
    throw new Error(`memoryDb: no model for table ${text(nameOrTable)}`);
  }

  private rowsOf(model: ModelLike): Row[] {
    let rows = this.tables.get(model.name);
    if (!rows) {
      rows = [];
      this.tables.set(model.name, rows);
    }
    return rows;
  }

  private attributeOf(model: ModelLike, key: string): string {
    if (model.rawAttributes[key]) {
      return key;
    }
    const byField = model.fieldRawAttributesMap?.[key];
    if (byField) {
      return byField.fieldName;
    }
    throw new Error(`column "${key}" does not exist (memoryDb: ${model.name} has no attribute or column "${key}")`);
  }

  private applyOp(op: symbol, value: unknown, arg: unknown): boolean {
    const has = present(value);
    const list = asArray(arg ?? []);
    switch (op) {
      case Op.eq:
        return arg === null ? !has : equal(value, arg);
      case Op.ne:
        return arg === null ? has : has && !equal(value, arg);
      case Op.is:
        return arg === null ? !has : value === arg;
      case Op.not:
        if (arg === null) {
          return has;
        }
        if (isPlainObject(arg)) {
          return !this.testValue(value, arg);
        }
        return has && !equal(value, arg);
      case Op.in:
        return list.some((a) => equal(value, a));
      case Op.notIn:
        return has && !list.some((a) => equal(value, a));
      case Op.gt:
        return has && compare(value, arg) > 0;
      case Op.gte:
        return has && compare(value, arg) >= 0;
      case Op.lt:
        return has && compare(value, arg) < 0;
      case Op.lte:
        return has && compare(value, arg) <= 0;
      case Op.between:
        return has && compare(value, list[0]) >= 0 && compare(value, list[1]) <= 0;
      case Op.notBetween:
        return has && !(compare(value, list[0]) >= 0 && compare(value, list[1]) <= 0);
      case Op.like:
        return has && likeToRegex(arg, "").test(text(value));
      case Op.notLike:
        return has && !likeToRegex(arg, "").test(text(value));
      case Op.iLike:
        return has && likeToRegex(arg, "i").test(text(value));
      case Op.notILike:
        return has && !likeToRegex(arg, "i").test(text(value));
      case Op.startsWith:
        return has && text(value).startsWith(text(arg));
      case Op.endsWith:
        return has && text(value).endsWith(text(arg));
      case Op.substring:
        return has && text(value).includes(text(arg));
      case Op.contains:
        if (Array.isArray(value)) {
          const values = value as unknown[];
          return asArray(arg).every((a) => values.some((v) => equal(v, a)));
        }
        if (isPlainObject(value) && isPlainObject(arg)) {
          return Object.keys(arg).every((k) => JSON.stringify(value[k]) === JSON.stringify(arg[k]));
        }
        return false;
      case Op.overlap:
        return Array.isArray(value) && list.some((a) => (value as unknown[]).some((v) => equal(v, a)));
      case Op.or:
        return asArray(arg).some((a) => this.testValue(value, a));
      case Op.and:
        return asArray(arg).every((a) => this.testValue(value, a));
      default:
        return unsupported(`operator ${String(op)}`);
    }
  }

  private testValue(value: unknown, cond: unknown): boolean {
    if (isSequelizeMethod(cond)) {
      return unsupported(`a ${kindOf(cond)} condition`);
    }
    if (cond === null) {
      return !present(value);
    }
    if (Array.isArray(cond)) {
      return (cond as unknown[]).some((c) => equal(value, c));
    }
    if (isPlainObject(cond)) {
      const ops = Object.getOwnPropertySymbols(cond);
      if (ops.length === 0) {
        return unsupported(`a nested object condition ${JSON.stringify(cond)}`);
      }
      return ops.every((op) => this.applyOp(op, value, cond[op]));
    }
    if (typeof cond === "boolean") {
      return value === cond || text(value) === String(cond);
    }
    return equal(value, cond);
  }

  private matches(model: ModelLike, row: Row, where: unknown): boolean {
    if (where === undefined || where === null) {
      return true;
    }
    if (isSequelizeMethod(where)) {
      return unsupported(`a ${kindOf(where)} where`);
    }
    if (Array.isArray(where)) {
      return (where as unknown[]).every((w) => this.matches(model, row, w));
    }
    if (!isPlainObject(where)) {
      return unsupported(`a where of type ${typeof where}`);
    }
    for (const key of Reflect.ownKeys(where)) {
      const cond = where[key];
      if (typeof key === "symbol") {
        if (!this.matchesOperator(model, row, key, cond)) {
          return false;
        }
        continue;
      }
      if (key.startsWith("$")) {
        unsupported(`the nested column reference ${key}`);
      }
      if (!this.testValue(row[this.attributeOf(model, key)], cond)) {
        return false;
      }
    }
    return true;
  }

  private matchesOperator(model: ModelLike, row: Row, key: symbol, cond: unknown): boolean {
    if (key === Op.and) {
      return asArray(cond).every((w) => this.matches(model, row, w));
    }
    if (key === Op.or) {
      const alts = Array.isArray(cond)
        ? (cond as unknown[])
        : Object.entries(isPlainObject(cond) ? cond : {}).map(([k, v]) => ({ [k]: v }));
      return alts.some((w) => this.matches(model, row, w));
    }
    if (key === Op.not) {
      return !this.matches(model, row, cond);
    }
    return unsupported(`top-level operator ${String(key)}`);
  }

  private static paranoidLive(model: ModelLike, row: Row): boolean {
    if (!model.options.paranoid) {
      return true;
    }
    const attr = model._timestampAttributes.deletedAt;
    return attr === undefined || !present(row[attr]);
  }

  private joinOne(parentRow: Row, include: IncludeLike): Row[] {
    const assoc = include.association;
    const target = include.model;
    const keep = (r: Row): boolean =>
      (include.paranoid === false || MemoryDb.paranoidLive(target, r)) && this.matches(target, r, include.where);
    let found: Row[];
    switch (assoc.associationType) {
      case "BelongsTo":
        found = this.rowsOf(target).filter((r) => equal(r[assoc.targetKey], parentRow[assoc.foreignKey]) && keep(r));
        break;
      case "HasOne":
      case "HasMany":
        found = this.rowsOf(target).filter((r) => equal(r[assoc.foreignKey], parentRow[assoc.sourceKey]) && keep(r));
        break;
      case "BelongsToMany": {
        const through = assoc.through?.model;
        if (!through) {
          return unsupported("a belongsToMany without a through model");
        }
        const links = this.rowsOf(through).filter(
          (t) =>
            equal(t[assoc.foreignKey], parentRow[assoc.sourceKey]) &&
            MemoryDb.paranoidLive(through, t) &&
            this.matches(through, t, include.through?.where),
        );
        found = this.rowsOf(target).filter(
          (r) => links.some((t) => equal(t[assoc.otherKey], r[assoc.targetKey])) && keep(r),
        );
        break;
      }
      default:
        return unsupported(`association type ${assoc.associationType}`);
    }
    const built: Row[] = [];
    for (const r of found) {
      const nested = this.resolveIncludes(clone(r), include.include);
      if (nested) {
        built.push(nested);
      }
    }
    return built;
  }

  /** The row with its includes attached, or null when an INNER include drops it. */
  private resolveIncludes(row: Row, includes: IncludeLike[] | undefined): Row | null {
    if (!includes || includes.length === 0) {
      return row;
    }
    for (const include of includes) {
      if (include._pseudo || include.separate) {
        continue;
      }
      const found = this.joinOne(row, include);
      if (include.required && found.length === 0) {
        return null;
      }
      const type = include.association.associationType;
      row[include.as] = type === "BelongsTo" || type === "HasOne" ? (found[0] ?? null) : found;
    }
    return row;
  }

  private orderRows(model: ModelLike, rows: Row[], order: unknown): Row[] {
    if (!order) {
      return rows;
    }
    const keys: [string, string][] = [];
    for (const item of asArray(order)) {
      if (typeof item === "string") {
        keys.push([item, "ASC"]);
      } else if (Array.isArray(item) && item.length <= 2 && typeof item[0] === "string") {
        keys.push([item[0], typeof item[1] === "string" ? item[1] : "ASC"]);
      }
      // Ordering by an include's column, a literal or a function is not
      // evaluated: the rows keep their insertion order.
    }
    if (keys.length === 0) {
      return rows;
    }
    return [...rows].sort((a, b) => {
      for (const [key, dir] of keys) {
        let attr: string;
        try {
          attr = this.attributeOf(model, key);
        } catch {
          continue;
        }
        const c = compare(a[attr] ?? "", b[attr] ?? "");
        if (c !== 0) {
          return /desc/i.test(dir) ? -c : c;
        }
      }
      return 0;
    });
  }

  private selectRows(model: ModelLike, options: QueryOptionsLike): Row[] {
    let rows = this.rowsOf(model)
      .filter((r) => this.matches(model, r, options.where))
      .map((r) => this.resolveIncludes(clone(r), options.include))
      .filter((r): r is Row => r !== null);
    rows = this.orderRows(model, rows, options.order);
    if (options.offset) {
      rows = rows.slice(options.offset);
    }
    if (options.limit !== undefined && options.limit !== null) {
      rows = rows.slice(0, options.limit);
    }
    return rows;
  }

  private record(entry: WriteEntry, undo: Undo, options?: QueryOptionsLike): WriteRecord {
    const tx = options?.transaction ?? this.ambient.getStore() ?? null;
    if (tx?.finished) {
      throw new Error("memoryDb: write in a finished transaction");
    }
    const item: WriteRecord = { ...entry, tx: tx ? tx.id : null, state: tx ? "open" : "committed" };
    this.log.push(item);
    if (tx) {
      tx.undo.push(undo);
      tx.writes.push(item);
    }
    return item;
  }

  private toAttributes(model: ModelLike, values: unknown): Row {
    const out: Row = {};
    for (const [key, value] of Object.entries(isPlainObject(values) ? values : {})) {
      out[this.attributeOf(model, key)] = value;
    }
    return out;
  }

  private static pkOf(model: ModelLike): string {
    return model.primaryKeyAttribute ?? "id";
  }

  private insertRow(model: ModelLike, attrs: Row, options?: QueryOptionsLike): Row {
    const rows = this.rowsOf(model);
    const row: Row = {};
    for (const attr of Object.keys(model.rawAttributes)) {
      if (attrs[attr] !== undefined) {
        row[attr] = clone(attrs[attr]);
      }
    }
    rows.push(row);
    this.record(
      { op: "insert", model: model.name, id: row[MemoryDb.pkOf(model)], values: clone(row) },
      () => {
        const i = rows.indexOf(row);
        if (i >= 0) {
          rows.splice(i, 1);
        }
      },
      options,
    );
    return row;
  }

  private updateRows(model: ModelLike, where: unknown, values: Row, options?: QueryOptionsLike, op = "update"): Row[] {
    const hits = this.rowsOf(model).filter((r) => this.matches(model, r, where));
    for (const row of hits) {
      const prior: Row = {};
      for (const k of Object.keys(values)) {
        prior[k] = row[k];
      }
      Object.assign(row, clone(values));
      this.record(
        { op, model: model.name, id: row[MemoryDb.pkOf(model)], values: clone(values) },
        () => Object.assign(row, prior),
        options,
      );
    }
    return hits;
  }

  private deleteRows(model: ModelLike, where: unknown, options?: QueryOptionsLike): number {
    const rows = this.rowsOf(model);
    const hits = rows.filter((r) => this.matches(model, r, where));
    for (const row of hits) {
      rows.splice(rows.indexOf(row), 1);
      this.record(
        { op: "delete", model: model.name, id: row[MemoryDb.pkOf(model)], values: clone(row) },
        () => rows.push(row),
        options,
      );
    }
    return hits.length;
  }

  /**
   * `Model.count({ group: ["attr", …] })` — one row per distinct key, shaped as
   * PostgreSQL returns it (`{ attr: value, count }`), NULL keys a group of their
   * own (P8-04, ADR-096: kanban's per-board and per-sprint counts). Any other
   * grouped aggregate, or a group that is not a list of attribute names, is
   * still refused.
   */
  private groupedCount(model: ModelLike, options: QueryOptionsLike, fn: string): Row[] {
    const group = asArray(options.group);
    if (fn !== "count" || !group.every((g) => typeof g === "string")) {
      return unsupported("a grouped aggregate");
    }
    const keys = group.map((g) => this.attributeOf(model, g));
    const rows = this.selectRows(model, { ...options, order: undefined, limit: undefined, offset: 0 });
    const groups = new Map<string, Row>();
    for (const row of rows) {
      const id = keys.map((k) => text(row[k] ?? null)).join("\u0000");
      const found = groups.get(id);
      if (found) {
        found["count"] = Number(found["count"]) + 1;
      } else {
        groups.set(id, { ...Object.fromEntries(keys.map((k) => [k, row[k] ?? null])), count: 1 });
      }
    }
    return [...groups.values()];
  }

  private aggregate(table: unknown, options: QueryOptionsLike, aggregateFunction: string, Model?: ModelLike): unknown {
    const model = Model ?? this.modelOf(table);
    const fn = aggregateFunction.toLowerCase();
    if (options.group !== undefined && options.group !== null) {
      return this.groupedCount(model, options, fn);
    }
    const rows = this.selectRows(model, { ...options, order: undefined, limit: undefined, offset: 0 });
    if (fn === "count") {
      if (options.distinct && options.col) {
        const attr = this.attributeOf(model, options.col);
        return new Set(rows.map((r) => text(r[attr]))).size;
      }
      return rows.length;
    }
    const spec = asArray(options.attributes ?? []).find((a) => Array.isArray(a) && a[1] === aggregateFunction);
    const fnArg = Array.isArray(spec) ? (spec[0] as { args?: unknown[] } | undefined) : undefined;
    const colArg = fnArg?.args?.[0];
    const colName = colArg !== null && typeof colArg === "object" ? (colArg as { col?: unknown }).col : colArg;
    if (typeof colName !== "string") {
      return unsupported(`aggregate ${aggregateFunction}`);
    }
    const attr = this.attributeOf(model, colName);
    const values = rows.map((r) => r[attr]).filter(present);
    if (values.length === 0) {
      return null;
    }
    if (fn === "sum") {
      return values.reduce((s: number, v) => s + Number(v), 0);
    }
    if (fn === "max") {
      return values.reduce((m, v) => (compare(v, m) > 0 ? v : m));
    }
    if (fn === "min") {
      return values.reduce((m, v) => (compare(v, m) < 0 ? v : m));
    }
    return unsupported(`aggregate ${aggregateFunction}`);
  }

  /** Replace the query interface's data methods (the only layer doubled). */
  private installQueryInterface(): void {
    const qi = this.sequelize.getQueryInterface() as unknown as Record<string, unknown>;
    const asInstance = (i: unknown): { constructor: ModelLike; dataValues: Row } =>
      i as { constructor: ModelLike; dataValues: Row };

    qi["select"] = (model: ModelLike, _table: unknown, options: QueryOptionsLike): Promise<unknown> => {
      const rows = this.selectRows(model, options);
      if (options.raw) {
        return Promise.resolve(options.plain ? (rows[0] ?? null) : rows);
      }
      const built = model.bulkBuild(rows, {
        isNewRecord: false,
        include: options.include,
        includeNames: options.includeNames,
        includeMap: options.includeMap,
        includeValidated: true,
        attributes: options.originalAttributes ?? options.attributes,
        raw: true,
      });
      return Promise.resolve(options.plain ? (built[0] ?? null) : built);
    };

    qi["rawSelect"] = (table: unknown, options: QueryOptionsLike, fn: string, Model?: ModelLike): Promise<unknown> =>
      Promise.resolve(this.aggregate(table, options, fn, Model));

    qi["insert"] = (instance: unknown, _table: unknown, values: unknown, options?: QueryOptionsLike): Promise<unknown> => {
      const inst = asInstance(instance);
      const model = inst.constructor;
      const row = this.insertRow(model, { ...inst.dataValues, ...this.toAttributes(model, values) }, options);
      Object.assign(inst.dataValues, clone(row));
      return Promise.resolve([instance, 1]);
    };

    qi["update"] = (
      instance: unknown,
      _table: unknown,
      values: unknown,
      where: unknown,
      options?: QueryOptionsLike,
    ): Promise<unknown> => {
      const model = asInstance(instance).constructor;
      const hits = this.updateRows(model, where, this.toAttributes(model, values), options);
      return Promise.resolve([instance, hits.length]);
    };

    qi["bulkUpdate"] = (table: unknown, values: unknown, where: unknown, options?: QueryOptionsLike): Promise<unknown> => {
      const model = options?.model ?? this.modelOf(table);
      const hits = this.updateRows(model, where, this.toAttributes(model, values), options);
      if (options?.returning) {
        return Promise.resolve(model.bulkBuild(hits.map((h) => clone(h)), { isNewRecord: false, raw: true }));
      }
      return Promise.resolve(hits.length);
    };

    qi["delete"] = (instance: unknown, _table: unknown, where: unknown, options?: QueryOptionsLike): Promise<unknown> =>
      Promise.resolve(this.deleteRows(asInstance(instance).constructor, where, options));

    qi["bulkDelete"] = (table: unknown, where: unknown, options?: QueryOptionsLike, model?: ModelLike): Promise<unknown> =>
      Promise.resolve(this.deleteRows(model ?? this.modelOf(table), where, options));

    qi["bulkInsert"] = (table: unknown, records: unknown[], options?: QueryOptionsLike): Promise<unknown> => {
      const model = options?.model ?? this.modelOf(table);
      return Promise.resolve(records.map((r) => this.insertRow(model, this.toAttributes(model, r), options)));
    };

    qi["increment"] = (
      model: ModelLike,
      _table: unknown,
      where: unknown,
      amounts: unknown,
      extra: unknown,
      options?: QueryOptionsLike,
    ): Promise<unknown> => {
      const pk = MemoryDb.pkOf(model);
      const hits = this.rowsOf(model).filter((r) => this.matches(model, r, where));
      const byAttr = this.toAttributes(model, amounts);
      const extraAttrs = this.toAttributes(model, extra);
      for (const row of hits) {
        const values: Row = { ...extraAttrs };
        for (const [k, v] of Object.entries(byAttr)) {
          values[k] = Number(row[k] ?? 0) + Number(v);
        }
        this.updateRows(model, { [pk]: row[pk] }, values, options, "increment");
      }
      return Promise.resolve([hits.map((h) => clone(h)), hits.length]);
    };

    qi["upsert"] = (
      table: unknown,
      insertValues: unknown,
      updateValues: unknown,
      _where: unknown,
      options: QueryOptionsLike,
    ): Promise<unknown> => {
      const model = options.model ?? this.modelOf(table);
      const pk = MemoryDb.pkOf(model);
      const attrsIn = this.toAttributes(model, insertValues);
      const keys = (options.upsertKeys ?? options.conflictFields ?? [pk]).map((k) => this.attributeOf(model, k));
      const existing = this.rowsOf(model).find((r) =>
        keys.every((k) => attrsIn[k] !== undefined && equal(r[k], attrsIn[k])),
      );
      if (existing) {
        this.updateRows(model, { [pk]: existing[pk] }, this.toAttributes(model, updateValues), options, "upsert");
        return Promise.resolve([model.build(clone(existing), { isNewRecord: false, raw: true }), false]);
      }
      const row = this.insertRow(model, attrsIn, options);
      return Promise.resolve([model.build(clone(row), { isNewRecord: false, raw: true }), true]);
    };
  }

  /** Raw SQL and transactions on the Sequelize instance. */
  private installSequelize(): void {
    const host = this.sequelize as unknown as Record<string, unknown>;

    host["query"] = (sql: unknown, options: QueryOptionsLike = {}): Promise<unknown> => {
      const statement = typeof sql === "string" ? sql : text(isPlainObject(sql) ? sql["query"] : sql);
      const handler = this.queryHandler;
      if (!handler) {
        return Promise.reject(
          new Error(
            "memoryDb: raw SQL reached the database with no onQuery() handler — raw SQL bypasses the tenant hooks, " +
              `so a test must answer it deliberately:\n${statement}`,
          ),
        );
      }
      const transaction = options.transaction ?? this.ambient.getStore() ?? null;
      try {
        return Promise.resolve(
          handler(
            statement,
            { ...options, transaction },
            { record: (entry, undo) => this.record(entry, undo ?? (() => undefined), options) },
          ),
        );
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(text(err)));
      }
    };

    host["transaction"] = async (optionsOrCb?: unknown, maybeCb?: unknown): Promise<unknown> => {
      const cb = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb;
      const tx = new MemoryTransaction();
      if (typeof cb !== "function") {
        return tx;
      }
      const run = cb as (t: MemoryTransaction) => unknown;
      try {
        const result: unknown = await this.ambient.run(tx, () => run(tx));
        await tx.commit();
        return result;
      } catch (err) {
        if (!tx.finished) {
          await tx.rollback();
        }
        throw err;
      }
    };

    host["authenticate"] = (): Promise<void> => Promise.resolve();
    host["close"] = (): Promise<void> => Promise.resolve();
  }
}

let singleton: MemoryDb | null = null;

/** The per-test-file instance (jest gives each test file its own registry). */
export const memoryDb = (): MemoryDb => {
  singleton ??= new MemoryDb();
  return singleton;
};

/** A fresh instance, for a test that needs two. */
export const createMemoryDb = (): MemoryDb => new MemoryDb();
