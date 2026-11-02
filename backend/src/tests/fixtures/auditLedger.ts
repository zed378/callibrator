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

import { AsyncLocalStorage } from "async_hooks";

const loadAuditSchema = () => {
  const { Sequelize } = (jest as any).requireActual("sequelize");
  const sequelize = new Sequelize({ dialect: "postgres", logging: false });
  const AuditLog = (jest as any).requireActual("../../models/auditLog.model")(sequelize);
  const attributes = AuditLog.getAttributes();
  return {
    actions: Object.freeze([...attributes.action.values]),
    actorTypes: Object.freeze([...attributes.actorType.values]),
    // createdAt is NOT NULL but stamped by Sequelize itself.
    notNull: Object.entries(attributes)
      .filter(([name, a]: any) => a.allowNull === false && !a.primaryKey && name !== "createdAt")
      .map(([name]) => name),
  };
};

let cachedSchema: any = null;
const auditSchema = () => {
  if (!cachedSchema) {cachedSchema = loadAuditSchema();}
  return cachedSchema;
};

/**
 * Migration 0033's CHECK `audit_logs_actor_check`, for a row inserted now.
 * `unknown` is never valid for a new row: the CHECK allows it only for rows
 * created before the migration ran.
 */
const actorCheckHolds = ({ actorType, userId, actorName }: any) => {
  const hasUser = userId !== undefined && userId !== null;
  const hasName = actorName !== undefined && actorName !== null;
  if (actorType === "user") {return hasUser && !hasName;}
  if (actorType === "system") {return !hasUser && hasName && String(actorName).startsWith("system:");}
  return false;
};

class LedgerTransaction {
  ledger: any;
  staged: any[];
  aborted: boolean;
  finished: boolean;

  constructor(ledger: any) {
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
const createLedger = ({ cls = true }: any = {}) => {
  const als = new AsyncLocalStorage<any>();
  const failures = new Map<string, any[]>();

  const ledger: any = {
    rows: [],
    AUDIT_ACTIONS: auditSchema().actions,

    /** Resolve the transaction a write runs in — explicit, else the ambient (CLS) one. */
    resolveTransaction(options: any) {
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
    write(table: any, row: any, options: any) {
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
    failNext(table: any, error: any = new Error(`simulated failure writing ${table}`)) {
      if (!failures.has(table)) {failures.set(table, []);}
      failures.get(table)!.push(error);
    },

    committed(table: any) {
      return ledger.rows.filter((e: any) => e.table === table).map((e: any) => e.row);
    },

    auditRows() {
      return ledger.committed("audit_logs");
    },

    /**
     * sequelize.transaction(): managed when given a callback, unmanaged
     * (commit/rollback by the caller) when not.
     */
    async transaction(optionsOrCallback: any, maybeCallback: any) {
      const callback =
        typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
      const tx = new LedgerTransaction(ledger);
      if (typeof callback !== "function") {return tx;}
      try {
        const result = await als.run(tx, () => callback(tx));
        await tx.commit();
        return result;
      } catch (error: any) {
        await tx.rollback();
        throw error;
      }
    },

    AuditLog: {
      create: async (values: any, options: any) => {
        const schema = auditSchema();
        if (values && values.action && !schema.actions.includes(values.action)) {
          throw new Error(
            `invalid input value for enum enum_audit_logs_action: "${values.action}"`,
          );
        }
        if (values && values.actorType && !schema.actorTypes.includes(values.actorType)) {
          throw new Error(
            `invalid input value for enum enum_audit_logs_actor_type: "${values.actorType}"`,
          );
        }
        for (const col of schema.notNull) {
          if (!values || values[col] === undefined || values[col] === null) {
            throw new Error(`null value in column "${col}" of relation "audit_logs" violates not-null constraint`);
          }
        }
        if (values && !actorCheckHolds(values)) {
          throw new Error('new row for relation "audit_logs" violates check constraint "audit_logs_actor_check"');
        }
        return ledger.write("audit_logs", values, options);
      },
      bulkCreate: async (rows: any, options: any) => {
        const created: any[] = [];
        for (const r of rows || []) {
          created.push(await ledger.AuditLog.create(r, options));
        }
        return created;
      },
    },
  };

  return ledger;
};

export { createLedger, LedgerTransaction };
module.exports = { createLedger, LedgerTransaction };
