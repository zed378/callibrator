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
 *   jest.mock("../../config", () => ({ db: require("../fixtures/memoryDb").memoryDb().sequelize }));
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

const { AsyncLocalStorage } = require("async_hooks");
const { Sequelize, Op, Transaction, Utils } = require("sequelize");

const SequelizeMethod = Utils.SequelizeMethod;

let singleton = null;

const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof SequelizeMethod);

const unsupported = (what) => {
  throw new Error(`memoryDb: cannot evaluate ${what} — extend the fixture or answer it with onQuery()`);
};

const normalize = (v) => {
  if (v instanceof Date) {return v.getTime();}
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? v : t;
  }
  return v;
};

const equal = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) {return false;}
  const na = normalize(a);
  const nb = normalize(b);
  if (typeof na === "number" || typeof nb === "number") {
    return Number(na) === Number(nb);
  }
  return String(na) === String(nb);
};

const compare = (a, b) => {
  const na = normalize(a);
  const nb = normalize(b);
  if (typeof na === "number" || typeof nb === "number") {return Number(na) - Number(nb);}
  return String(na) < String(nb) ? -1 : String(na) > String(nb) ? 1 : 0;
};

const likeToRegex = (pattern, flags) =>
  new RegExp(
    `^${String(pattern)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/%/g, ".*")
      .replace(/_/g, ".")}$`,
    flags,
  );

const clone = (v) => {
  if (v instanceof Date) {return new Date(v.getTime());}
  if (Buffer.isBuffer(v)) {return Buffer.from(v);}
  if (Array.isArray(v)) {return v.map(clone);}
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) {out[k] = clone(v[k]);}
    return out;
  }
  return v;
};

const createMemoryDb = () => {
  const sequelize = new Sequelize({ dialect: "postgres", logging: false });
  const qi = sequelize.getQueryInterface();

  const tables = new Map(); // model name -> rows (attribute-keyed plain objects)
  const log = []; // { op, model, id, values, tx, state }
  let queryHandler = null;
  let txSeq = 0;
  const ambient = new AsyncLocalStorage();

  // CLS, as production has it (config/index.js: Sequelize.useCLS).
  sequelize.constructor._cls = {
    get: (key) => (key === "transaction" ? ambient.getStore() : undefined),
  };

  const modelOf = (nameOrTable) => {
    const name = typeof nameOrTable === "object" && nameOrTable !== null ? nameOrTable.tableName : nameOrTable;
    for (const model of Object.values(sequelize.models)) {
      const t = model.getTableName();
      const tableName = typeof t === "object" ? t.tableName : t;
      if (model.name === name || tableName === name) {return model;}
    }
    throw new Error(`memoryDb: no model for table ${JSON.stringify(nameOrTable)}`);
  };

  const rowsOf = (model) => {
    if (!tables.has(model.name)) {tables.set(model.name, []);}
    return tables.get(model.name);
  };

  // ---------------------------------------------------------------- where

  const attributeOf = (model, key) => {
    if (model.rawAttributes[key]) {return key;}
    const byField = model.fieldRawAttributesMap && model.fieldRawAttributesMap[key];
    if (byField) {return byField.fieldName;}
    throw new Error(`column "${key}" does not exist (memoryDb: ${model.name} has no attribute or column "${key}")`);
  };

  const applyOp = (op, value, arg) => {
    switch (op) {
      case Op.eq:
        return arg === null ? value === null || value === undefined : equal(value, arg);
      case Op.ne:
        return arg === null ? value !== null && value !== undefined : value !== null && value !== undefined && !equal(value, arg);
      case Op.is:
        return arg === null ? value === null || value === undefined : value === arg;
      case Op.not:
        if (arg === null) {return value !== null && value !== undefined;}
        if (isPlainObject(arg)) {return !testValue(value, arg);}
        return value !== null && value !== undefined && !equal(value, arg);
      case Op.in:
        return (arg || []).some((a) => equal(value, a));
      case Op.notIn:
        return value !== null && value !== undefined && !(arg || []).some((a) => equal(value, a));
      case Op.gt:
        return value !== null && value !== undefined && compare(value, arg) > 0;
      case Op.gte:
        return value !== null && value !== undefined && compare(value, arg) >= 0;
      case Op.lt:
        return value !== null && value !== undefined && compare(value, arg) < 0;
      case Op.lte:
        return value !== null && value !== undefined && compare(value, arg) <= 0;
      case Op.between:
        return value !== null && value !== undefined && compare(value, arg[0]) >= 0 && compare(value, arg[1]) <= 0;
      case Op.notBetween:
        return value !== null && value !== undefined && !(compare(value, arg[0]) >= 0 && compare(value, arg[1]) <= 0);
      case Op.like:
        return value !== null && value !== undefined && likeToRegex(arg, "").test(String(value));
      case Op.notLike:
        return value !== null && value !== undefined && !likeToRegex(arg, "").test(String(value));
      case Op.iLike:
        return value !== null && value !== undefined && likeToRegex(arg, "i").test(String(value));
      case Op.notILike:
        return value !== null && value !== undefined && !likeToRegex(arg, "i").test(String(value));
      case Op.startsWith:
        return value !== null && value !== undefined && String(value).startsWith(String(arg));
      case Op.endsWith:
        return value !== null && value !== undefined && String(value).endsWith(String(arg));
      case Op.substring:
        return value !== null && value !== undefined && String(value).includes(String(arg));
      case Op.contains:
        if (Array.isArray(value)) {return (Array.isArray(arg) ? arg : [arg]).every((a) => value.some((v) => equal(v, a)));}
        if (isPlainObject(value) && isPlainObject(arg)) {
          return Object.keys(arg).every((k) => JSON.stringify(value[k]) === JSON.stringify(arg[k]));
        }
        return false;
      case Op.overlap:
        return Array.isArray(value) && (arg || []).some((a) => value.some((v) => equal(v, a)));
      case Op.or:
        return (Array.isArray(arg) ? arg : [arg]).some((a) => testValue(value, a));
      case Op.and:
        return (Array.isArray(arg) ? arg : [arg]).every((a) => testValue(value, a));
      default:
        return unsupported(`operator ${String(op)}`);
    }
  };

  const testValue = (value, cond) => {
    if (cond instanceof SequelizeMethod) {return unsupported(`a ${cond.constructor.name} condition`);}
    if (cond === null) {return value === null || value === undefined;}
    if (Array.isArray(cond)) {return cond.some((c) => equal(value, c));}
    if (isPlainObject(cond)) {
      const ops = Object.getOwnPropertySymbols(cond);
      if (ops.length === 0) {return unsupported(`a nested object condition ${JSON.stringify(cond)}`);}
      return ops.every((op) => applyOp(op, value, cond[op]));
    }
    if (typeof cond === "boolean") {return value === cond || String(value) === String(cond);}
    return equal(value, cond);
  };

  const matches = (model, row, where) => {
    if (where === undefined || where === null) {return true;}
    if (where instanceof SequelizeMethod) {return unsupported(`a ${where.constructor.name} where`);}
    if (Array.isArray(where)) {return where.every((w) => matches(model, row, w));}
    for (const key of Reflect.ownKeys(where)) {
      const cond = where[key];
      if (typeof key === "symbol") {
        if (key === Op.and) {
          if (!(Array.isArray(cond) ? cond : [cond]).every((w) => matches(model, row, w))) {return false;}
        } else if (key === Op.or) {
          const alts = Array.isArray(cond) ? cond : Object.keys(cond).map((k) => ({ [k]: cond[k] }));
          if (!alts.some((w) => matches(model, row, w))) {return false;}
        } else if (key === Op.not) {
          if (matches(model, row, cond)) {return false;}
        } else {
          unsupported(`top-level operator ${String(key)}`);
        }
        continue;
      }
      if (key.startsWith("$")) {unsupported(`the nested column reference ${key}`);}
      const attr = attributeOf(model, key);
      if (!testValue(row[attr], cond)) {return false;}
    }
    return true;
  };

  const paranoidLive = (model, row) => {
    if (!model.options.paranoid) {return true;}
    const attr = model._timestampAttributes.deletedAt;
    return row[attr] === null || row[attr] === undefined;
  };

  // ---------------------------------------------------------------- joins

  const joinOne = (parentModel, parentRow, include) => {
    const assoc = include.association;
    const target = include.model;
    const live = (r) => include.paranoid === false || paranoidLive(target, r);
    const keep = (r) => live(r) && matches(target, r, include.where);
    let found;
    switch (assoc.associationType) {
      case "BelongsTo":
        found = rowsOf(target).filter((r) => equal(r[assoc.targetKey], parentRow[assoc.foreignKey]) && keep(r));
        break;
      case "HasOne":
      case "HasMany":
        found = rowsOf(target).filter((r) => equal(r[assoc.foreignKey], parentRow[assoc.sourceKey]) && keep(r));
        break;
      case "BelongsToMany": {
        const through = assoc.through.model;
        const links = rowsOf(through).filter(
          (t) =>
            equal(t[assoc.foreignKey], parentRow[assoc.sourceKey]) &&
            paranoidLive(through, t) &&
            matches(through, t, include.through && include.through.where),
        );
        found = rowsOf(target).filter((r) => links.some((t) => equal(t[assoc.otherKey], r[assoc.targetKey])) && keep(r));
        break;
      }
      default:
        return unsupported(`association type ${assoc.associationType}`);
    }
    const built = [];
    for (const r of found) {
      const nested = resolveIncludes(target, clone(r), include.include);
      if (nested) {built.push(nested);}
    }
    return built;
  };

  /** The row with its includes attached, or null when an INNER include drops it. */
  const resolveIncludes = (model, row, includes) => {
    if (!includes || includes.length === 0) {return row;}
    for (const include of includes) {
      if (include._pseudo || include.separate) {continue;}
      const assoc = include.association;
      const found = joinOne(model, row, include);
      if (include.required && found.length === 0) {return null;}
      const single = assoc.associationType === "BelongsTo" || assoc.associationType === "HasOne";
      row[include.as] = single ? found[0] || null : found;
    }
    return row;
  };

  const orderRows = (model, rows, order) => {
    if (!order) {return rows;}
    const items = Array.isArray(order) ? order : [order];
    const keys = [];
    for (const item of items) {
      if (typeof item === "string") {
        keys.push([item, "ASC"]);
      } else if (Array.isArray(item) && typeof item[0] === "string" && item.length <= 2) {
        keys.push([item[0], item[1] || "ASC"]);
      }
      // Ordering by an include's column, a literal or a function is not
      // evaluated: the rows keep their insertion order.
    }
    if (keys.length === 0) {return rows;}
    return [...rows].sort((a, b) => {
      for (const [key, dir] of keys) {
        let attr;
        try {
          attr = attributeOf(model, key);
        } catch {
          continue;
        }
        const c = compare(a[attr] ?? "", b[attr] ?? "");
        if (c !== 0) {return /desc/i.test(String(dir)) ? -c : c;}
      }
      return 0;
    });
  };

  const selectRows = (model, options) => {
    let rows = rowsOf(model)
      .filter((r) => matches(model, r, options.where))
      .map((r) => resolveIncludes(model, clone(r), options.include))
      .filter(Boolean);
    rows = orderRows(model, rows, options.order);
    if (options.offset) {rows = rows.slice(options.offset);}
    if (options.limit !== undefined && options.limit !== null) {rows = rows.slice(0, options.limit);}
    return rows;
  };

  // ---------------------------------------------------------------- writes

  const record = (entry, undo, options) => {
    const tx = (options && options.transaction) || ambient.getStore() || null;
    if (tx && tx.finished) {throw new Error("memoryDb: write in a finished transaction");}
    const item = { ...entry, tx: tx ? tx.id : null, state: tx ? "open" : "committed" };
    log.push(item);
    if (tx) {tx._undo.push(undo); tx._writes.push(item);}
    return item;
  };

  const toAttributes = (model, values) => {
    const out = {};
    for (const [key, value] of Object.entries(values || {})) {
      out[attributeOf(model, key)] = value;
    }
    return out;
  };

  const pkOf = (model) => model.primaryKeyAttribute || "id";

  qi.select = async (model, tableName, options) => {
    const rows = selectRows(model, options);
    if (options.raw) {
      return options.plain ? rows[0] || null : rows;
    }
    const built = model.bulkBuild(rows, {
      isNewRecord: false,
      include: options.include,
      includeNames: options.includeNames,
      includeMap: options.includeMap,
      includeValidated: true,
      attributes: options.originalAttributes || options.attributes,
      raw: true,
    });
    return options.plain ? built[0] || null : built;
  };

  qi.rawSelect = async (tableName, options, aggregateFunction, Model) => {
    const model = Model || modelOf(tableName);
    if (options.group) {unsupported("a grouped aggregate");}
    const rows = selectRows(model, { ...options, order: undefined, limit: undefined, offset: undefined });
    const fn = String(aggregateFunction).toLowerCase();
    if (fn === "count") {
      if (options.distinct && options.col) {
        return new Set(rows.map((r) => String(r[attributeOf(model, options.col)]))).size;
      }
      return rows.length;
    }
    const spec = (options.attributes || []).find((a) => Array.isArray(a) && a[1] === aggregateFunction);
    const colArg = spec && spec[0] && spec[0].args && spec[0].args[0];
    const colName = colArg && (colArg.col || colArg);
    if (typeof colName !== "string") {unsupported(`aggregate ${aggregateFunction}`);}
    const attr = attributeOf(model, colName);
    const values = rows.map((r) => r[attr]).filter((v) => v !== null && v !== undefined);
    if (values.length === 0) {return null;}
    if (fn === "sum") {return values.reduce((s, v) => s + Number(v), 0);}
    if (fn === "max") {return values.reduce((m, v) => (compare(v, m) > 0 ? v : m));}
    if (fn === "min") {return values.reduce((m, v) => (compare(v, m) < 0 ? v : m));}
    return unsupported(`aggregate ${aggregateFunction}`);
  };

  const insertRow = (model, attrs, options) => {
    const rows = rowsOf(model);
    const row = {};
    for (const attr of Object.keys(model.rawAttributes)) {
      if (attrs[attr] !== undefined) {row[attr] = clone(attrs[attr]);}
    }
    rows.push(row);
    record({ op: "insert", model: model.name, id: row[pkOf(model)], values: clone(row) }, () => {
      const i = rows.indexOf(row);
      if (i >= 0) {rows.splice(i, 1);}
    }, options);
    return row;
  };

  const updateRows = (model, where, values, options, op = "update") => {
    const hits = rowsOf(model).filter((r) => matches(model, r, where));
    for (const row of hits) {
      const prior = {};
      for (const k of Object.keys(values)) {prior[k] = row[k];}
      Object.assign(row, clone(values));
      record({ op, model: model.name, id: row[pkOf(model)], values: clone(values) }, () => Object.assign(row, prior), options);
    }
    return hits;
  };

  const deleteRows = (model, where, options) => {
    const rows = rowsOf(model);
    const hits = rows.filter((r) => matches(model, r, where));
    for (const row of hits) {
      rows.splice(rows.indexOf(row), 1);
      record({ op: "delete", model: model.name, id: row[pkOf(model)], values: clone(row) }, () => rows.push(row), options);
    }
    return hits.length;
  };

  qi.insert = async (instance, tableName, values, options) => {
    const model = instance.constructor;
    const row = insertRow(model, { ...instance.dataValues, ...toAttributes(model, values) }, options);
    Object.assign(instance.dataValues, clone(row));
    return [instance, 1];
  };

  qi.update = async (instance, tableName, values, where, options) => {
    const model = instance.constructor;
    const hits = updateRows(model, where, toAttributes(model, values), options);
    return [instance, hits.length];
  };

  qi.bulkUpdate = async (tableName, values, where, options) => {
    const model = (options && options.model) || modelOf(tableName);
    const hits = updateRows(model, where, toAttributes(model, values), options);
    if (options && options.returning) {
      return model.bulkBuild(hits.map(clone), { isNewRecord: false, raw: true });
    }
    return hits.length;
  };

  qi.delete = async (instance, tableName, where, options) => deleteRows(instance.constructor, where, options);

  qi.bulkDelete = async (tableName, where, options, model) => deleteRows(model || modelOf(tableName), where, options);

  qi.bulkInsert = async (tableName, records, options) => {
    const model = (options && options.model) || modelOf(tableName);
    return records.map((r) => insertRow(model, toAttributes(model, r), options));
  };

  qi.increment = async (model, tableName, where, amounts, extra, options) => {
    const hits = rowsOf(model).filter((r) => matches(model, r, where));
    const byAttr = toAttributes(model, amounts);
    const extraAttrs = toAttributes(model, extra);
    for (const row of hits) {
      const values = { ...extraAttrs };
      for (const [k, v] of Object.entries(byAttr)) {values[k] = Number(row[k] || 0) + Number(v);}
      updateRows(model, { [pkOf(model)]: row[pkOf(model)] }, values, options, "increment");
    }
    return [hits.map(clone), hits.length];
  };

  qi.upsert = async (tableName, insertValues, updateValues, where, options) => {
    const model = (options && options.model) || modelOf(tableName);
    const attrsIn = toAttributes(model, insertValues);
    const keys = (options.upsertKeys || options.conflictFields || [pkOf(model)]).map((k) => attributeOf(model, k));
    const existing = rowsOf(model).find((r) => keys.every((k) => attrsIn[k] !== undefined && equal(r[k], attrsIn[k])));
    if (existing) {
      updateRows(model, { [pkOf(model)]: existing[pkOf(model)] }, toAttributes(model, updateValues), options, "upsert");
      return [model.build(clone(existing), { isNewRecord: false, raw: true }), false];
    }
    const row = insertRow(model, attrsIn, options);
    return [model.build(clone(row), { isNewRecord: false, raw: true }), true];
  };

  // ------------------------------------------------------------ raw SQL

  sequelize.query = async (sql, options = {}) => {
    const text = typeof sql === "string" ? sql : sql && sql.query;
    if (!queryHandler) {
      throw new Error(
        `memoryDb: raw SQL reached the database with no onQuery() handler — raw SQL bypasses the tenant hooks, so a test must answer it deliberately:\n${text}`,
      );
    }
    const tx = options.transaction || ambient.getStore() || null;
    return queryHandler(text, { ...options, transaction: tx }, { record: (e, undo) => record(e, undo || (() => {}), options) });
  };

  // --------------------------------------------------------- transactions

  // A class, not a plain object: Sequelize deep-clones plain objects in its
  // options (Utils.cloneDeep), which would detach the undo log from the
  // transaction the caller holds.
  class MemoryTransaction {
    constructor() {
      txSeq += 1;
      this.id = `memtx-${txSeq}`;
      this.finished = undefined;
      this.LOCK = Transaction.LOCK;
      this._undo = [];
      this._writes = [];
      this._after = [];
    }

    afterCommit(fn) {
      this._after.push(fn);
    }

    async commit() {
      if (this.finished) {throw new Error(`Transaction cannot be committed because it has been finished with state: ${this.finished}`);}
      this.finished = "commit";
      for (const w of this._writes) {w.state = "committed";}
      for (const fn of this._after) {await fn(this);}
    }

    async rollback() {
      if (this.finished) {throw new Error(`Transaction cannot be rolled back because it has been finished with state: ${this.finished}`);}
      this.finished = "rollback";
      for (const undo of this._undo.reverse()) {undo();}
      for (const w of this._writes) {w.state = "rolledBack";}
    }
  }

  const makeTx = () => new MemoryTransaction();

  sequelize.transaction = async (optionsOrCb, maybeCb) => {
    const cb = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb;
    const tx = makeTx();
    if (!cb) {return tx;}
    try {
      const result = await ambient.run(tx, () => cb(tx));
      await tx.commit();
      return result;
    } catch (err) {
      if (!tx.finished) {await tx.rollback();}
      throw err;
    }
  };

  sequelize.authenticate = async () => undefined;
  sequelize.close = async () => undefined;

  // ------------------------------------------------------------- the API

  const api = {
    sequelize,

    /** Empty every table, forget every write and the raw-SQL handler. */
    reset() {
      tables.clear();
      log.length = 0;
      queryHandler = null;
    },

    /**
     * Insert rows directly (no hooks, no log): the world before the request.
     * Each row is BUILT through the real model, so its defaults apply.
     */
    seed(modelName, rows) {
      const model = sequelize.models[modelName];
      if (!model) {throw new Error(`memoryDb.seed: no model ${modelName}`);}
      const out = [];
      for (const values of [].concat(rows)) {
        const built = model.build(values, { isNewRecord: true });
        const row = {};
        for (const attr of Object.keys(model.rawAttributes)) {
          const v = built.dataValues[attr];
          if (v !== undefined) {row[attr] = clone(v);}
        }
        rowsOf(model).push(row);
        out.push(row);
      }
      return out;
    },

    /** Plain copies of a table's rows, soft-deleted ones included. */
    rows(modelName) {
      return clone(rowsOf(sequelize.models[modelName]));
    },

    /** A deep copy of every table, for before/after equality. */
    dump() {
      const out = {};
      for (const [name, rows] of tables) {out[name] = clone(rows);}
      return out;
    },

    /** Every write attempted, whatever became of it. */
    writes() {
      return log.map((w) => ({ ...w }));
    },

    /** Writes that are durable (outside a transaction, or in a committed one). */
    committed() {
      return log.filter((w) => w.state === "committed").map((w) => ({ ...w }));
    },

    /** Answer raw SQL: handler(sql, options) -> the result sequelize.query would give. */
    onQuery(handler) {
      queryHandler = handler;
    },
  };
  return api;
};

/** The per-test-file instance (jest gives each test file its own registry). */
const memoryDb = () => {
  if (!singleton) {singleton = createMemoryDb();}
  return singleton;
};

module.exports = { memoryDb, createMemoryDb };
