/**
 * disposableDatabase — a throwaway PostgreSQL database for one live suite
 * (ADR-095 follow-up O-2).
 *
 * WHY
 *
 * Migration 0091 makes `audit_logs` append-only: DELETE and TRUNCATE are
 * refused by a trigger for every role, the owner included, and revoked from
 * `callibrator_app`. A live suite that cleans up with `DELETE FROM audit_logs`
 * therefore cannot run on a migrated database — and it must not "fix" that by
 * disabling the trigger, which would make the control a thing tests switch
 * off. So a suite that writes audit rows gets a database of its own and drops
 * it: the audit trail is never rewritten, it is thrown away with everything
 * else the run created.
 *
 * HOW
 *
 * `createDisposableDatabase(prefix)` connects to the maintenance database
 * (`postgres`, or DB_ADMIN_DATABASE) as DB_USER — which needs CREATEDB, as the
 * compose owner has — creates `<prefix>_<8 hex>_scratch`, and points DB_NAME at
 * it. Call it BEFORE the suite first requires `config` (config/index.js reads
 * DB_NAME when it loads). `drop()` puts DB_NAME back and drops the database
 * `WITH (FORCE)`, so a pool the suite forgot to close does not keep it alive.
 *
 * LIVE_DB_TEMPLATE (optional) names an already-booted database to copy
 * (`CREATE DATABASE ... TEMPLATE`): the suite's own boot step then finds every
 * migration applied and only verifies. It saves the full sync + migrate per
 * suite on a slow host; without it each suite builds its schema from nothing.
 *
 * Roles are cluster-wide, so `callibrator_app` (migration 0057) persists across
 * these databases; migrations create it when it is absent and re-grant it per
 * database.
 */
import { randomBytes } from "crypto";
import { Sequelize } from "sequelize";
import { env, envOr, environment } from "../../config/env";

const PREFIX = /^[a-z][a-z0-9_]{0,30}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/** A live suite's beforeAll budget for creating and booting its database (a full sync + migrate). */
export const LIVE_BOOT_TIMEOUT_MS = 900_000;

export interface DisposableDatabase {
  /** The database's name; DB_NAME holds it until `drop()`. */
  readonly name: string;
  /** Restore DB_NAME and drop the database (idempotent). */
  drop(): Promise<void>;
}

const required = (name: string): string => {
  const value = env(name);
  if (value === undefined || value === "") {
    throw new Error(`disposableDatabase: ${name} is not set`);
  }
  return value;
};

/** A short-lived connection to the maintenance database, as the owner. */
const maintenance = (): Sequelize =>
  new Sequelize(envOr("DB_ADMIN_DATABASE", "postgres"), required("DB_USER"), required("DB_PASS"), {
    host: required("DB_HOST"),
    port: Number(required("DB_PORT")),
    dialect: "postgres",
    logging: false,
  });

const run = async (statement: string): Promise<void> => {
  const admin = maintenance();
  try {
    // DDL on another database: no tenant, no bind parameters (an identifier
    // cannot be bound), and the name is generated here from PREFIX + hex.
    await admin.query(statement);
  } finally {
    await admin.close();
  }
};

/**
 * Create a fresh, empty database and point DB_NAME at it.
 * @param prefix - lower-case identifier naming the suite, e.g. "w07"
 */
export const createDisposableDatabase = async (prefix: string): Promise<DisposableDatabase> => {
  if (!PREFIX.test(prefix)) {
    throw new Error(`disposableDatabase: prefix "${prefix}" is not a short lower-case identifier`);
  }
  const name = `${prefix}_${randomBytes(4).toString("hex")}_scratch`;
  const template = envOr("LIVE_DB_TEMPLATE", "");
  if (template !== "" && !IDENTIFIER.test(template)) {
    throw new Error(`disposableDatabase: LIVE_DB_TEMPLATE "${template}" is not a plain identifier`);
  }
  await run(template === "" ? `CREATE DATABASE ${name}` : `CREATE DATABASE ${name} TEMPLATE ${template}`);
  const vars = environment();
  const previous = vars["DB_NAME"];
  vars["DB_NAME"] = name;
  let dropped = false;
  return {
    name,
    drop: async () => {
      if (dropped) {
        return;
      }
      dropped = true;
      if (previous === undefined) {
        delete vars["DB_NAME"];
      } else {
        vars["DB_NAME"] = previous;
      }
      await run(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    },
  };
};
