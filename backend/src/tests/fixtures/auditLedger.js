/**
 * auditLedger — a transactional, schema-enforcing stand-in for the database,
 * for testing that audit rows are written INSIDE the transaction (A-41).
 *
 * Why this exists: a jest.fn() AuditLog.create accepts any string, so a test
 * built on one passed while `action: "RESTORE"` / `"DOCUMENT_SIGNED"` would
 * have been rejected by PostgreSQL and rolled every restore / signature back.
 * A mock proves the client, not the contract. This fixture enforces the
 * contract that matters here:
 *
 *  - `audit_logs.action` is the ENUM declared in models/auditLog.model.js,
 *    read from a REAL (unconnected) Sequelize model — the schema, not the code
 *    under test. An out-of-ENUM value throws PostgreSQL's error text.
 *  - the model's NOT NULL columns are enforced (so `entityType` in place of
 *    `resourceType` fails, as it does against the database).
 *  - A-124: `actor_type` is the model's ENUM, and migration 0033's CHECK
 *    `audit_logs_actor_check` is enforced — a user row names a user and no
 *    actor name, a system row names no user and a `system:` actor, and no NEW
 *    row may be `unknown` (the CHECK's cut-off is in the past for any test).
 *  - `transaction(cb)` stages every write and commits only if `cb` resolves.
 *    A failed statement aborts the transaction, as PostgreSQL does — and a
 *    COMMIT of an aborted transaction silently rolls back, as PostgreSQL does.
 *  - a write with no explicit `transaction` joins the ambient managed one —
 *    production runs `Sequelize.useCLS` (config/index.js), which is how model
 *    instance methods such as `certificate.approve()` → `this.save()` join the
 *    service's transaction. `transaction: null` opts out, as in Sequelize.
 *
 * Tests assert on COMMITTED rows only: `ledger.committed(table)`,
 * `ledger.auditRows()`.
 */

const { AsyncLocalStorage } = require("async_hooks");

const loadAuditSchema = () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const sequelize = new Sequelize({ dialect: "postgres", logging: false });
  const AuditLog = jest.requireActual("../../models/auditLog.model")(sequelize);
  const attributes = AuditLog.getAttributes();
  return {
    actions: Object.freeze([...attributes.action.values]),
    actorTypes: Object.freeze([...attributes.actorType.values]),
    // createdAt is NOT NULL but stamped by Sequelize itself.
    notNull: Object.entries(attributes)
      .filter(([name, a]) => a.allowNull === false && !a.primaryKey && name !== "createdAt")
      .map(([name]) => name),
  };
};

let cachedSchema = null;
const auditSchema = () => {
  if (!cachedSchema) {cachedSchema = loadAuditSchema();}
  return cachedSchema;
};

/**
 * Migration 0033's CHECK `audit_logs_actor_check`, for a row inserted now.
 * `unknown` is never valid for a new row: the CHECK allows it only for rows
 * created before the migration ran.
 */
const actorCheckHolds = ({ actorType, userId, actorName }) => {
  const hasUser = userId !== undefined && userId !== null;
  const hasName = actorName !== undefined && actorName !== null;
  if (actorType === "user") {return hasUser && !hasName;}
  if (actorType === "system") {return !hasUser && hasName && String(actorName).startsWith("system:");}
  return false;
};

class LedgerTransaction {
  constructor(ledger) {
    this.ledger = ledger;
    this.staged = [];
    this.aborted = false;
    this.finished = false;
  }

  async commit() {
    if (this.finished) {throw new Error("Transaction already finished");}
    this.finished = true;
    // PostgreSQL answers COMMIT on an aborted transaction with ROLLBACK and
    // NO error: the caller believes it committed, and nothing did.
    if (this.aborted) {
      this.staged = [];
      return;
    }
    this.ledger.rows.push(...this.staged);
  }

  async rollback() {
    this.finished = true;
    this.staged = [];
  }
}

/**
 * @param {object} [options]
 * @param {boolean} [options.cls=true] - model Sequelize CLS (a write with no
 *   explicit transaction joins the ambient one). Pass `false` to prove a
 *   service passes `{ transaction }` explicitly on every write: an unpassed
 *   write then autocommits and survives the rollback, and the test sees it.
 */
const createLedger = ({ cls = true } = {}) => {
  const als = new AsyncLocalStorage();
  const failures = new Map();

  const ledger = {
    rows: [],
    AUDIT_ACTIONS: auditSchema().actions,

    /** Resolve the transaction a write runs in — explicit, else the ambient (CLS) one. */
    resolveTransaction(options) {
      // Sequelize: `transaction: undefined` (or absent) → the CLS transaction;
      // `transaction: null` → explicitly none.
      if (options && options.transaction !== undefined) {
        return options.transaction || null;
      }
      return cls ? als.getStore() || null : null;
    },

    /**
     * Record one write. Throws — and aborts the enclosing transaction — if the
     * table has a failure queued or the transaction is already aborted.
     */
    write(table, row, options) {
      const tx = ledger.resolveTransaction(options);
      if (tx && tx.aborted) {
        throw new Error(
          "current transaction is aborted, commands ignored until end of transaction block",
        );
      }
      const queued = failures.get(table);
      if (queued && queued.length) {
        const error = queued.shift();
        if (tx) {tx.aborted = true;}
        throw error;
      }
      const entry = { table, row: { ...row } };
      if (tx) {tx.staged.push(entry);} else {ledger.rows.push(entry);}
      return entry.row;
    },

    /** Make the next write to `table` fail with `error`. */
    failNext(table, error = new Error(`simulated failure writing ${table}`)) {
      if (!failures.has(table)) {failures.set(table, []);}
      failures.get(table).push(error);
    },

    committed(table) {
      return ledger.rows.filter((e) => e.table === table).map((e) => e.row);
    },

    auditRows() {
      return ledger.committed("audit_logs");
    },

    /**
     * sequelize.transaction(): managed when given a callback, unmanaged
     * (commit/rollback by the caller) when not.
     */
    async transaction(optionsOrCallback, maybeCallback) {
      const callback =
        typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
      const tx = new LedgerTransaction(ledger);
      if (typeof callback !== "function") {return tx;}
      try {
        const result = await als.run(tx, () => callback(tx));
        await tx.commit();
        return result;
      } catch (error) {
        await tx.rollback();
        throw error;
      }
    },

    AuditLog: {
      async create(values, options) {
        const { actions, notNull } = auditSchema();
        const tx = ledger.resolveTransaction(options);
        for (const column of notNull) {
          if (values[column] === undefined || values[column] === null) {
            if (tx) {tx.aborted = true;}
            const err = new Error(`notNull Violation: AuditLog.${column} cannot be null`);
            err.name = "SequelizeValidationError";
            throw err;
          }
        }
        const { actorTypes } = auditSchema();
        if (!actorTypes.includes(values.actorType)) {
          if (tx) {tx.aborted = true;}
          const err = new Error(
            `invalid input value for enum enum_audit_logs_actor_type: "${values.actorType}"`,
          );
          err.name = "SequelizeDatabaseError";
          throw err;
        }
        if (!actorCheckHolds(values)) {
          if (tx) {tx.aborted = true;}
          const err = new Error(
            'new row for relation "audit_logs" violates check constraint "audit_logs_actor_check"',
          );
          err.name = "SequelizeDatabaseError";
          throw err;
        }
        if (!actions.includes(values.action)) {
          if (tx) {tx.aborted = true;}
          const err = new Error(
            `invalid input value for enum enum_audit_logs_action: "${values.action}"`,
          );
          err.name = "SequelizeDatabaseError";
          throw err;
        }
        const row = ledger.write(
          "audit_logs",
          { id: `audit-${ledger.rows.length + 1}`, createdAt: new Date(), ...values },
          options,
        );
        return { ...row, toJSON: () => ({ ...row }) };
      },
    },
  };

  return ledger;
};

module.exports = { createLedger, auditSchema };
