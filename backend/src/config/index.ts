/**
 * The shared Sequelize instance and the database bootstrap (PostgreSQL only, ADR-039).
 *
 * P9-21 (ADR-087): converted from index.js with no behaviour change, proved by
 * an identity run of both against PostgreSQL 18 (exports, the instance's
 * options under each environment, every validation failure, and `Connection`
 * creating, finding and failing to reach a database). Two as-built points:
 *  - the three raw statements go through `sql()` (bind only, P9-07); the
 *    bootstrap's `datname = ?` replacement is now `datname = $1`, the same
 *    rows for every name;
 *  - `process.env` is read here directly, as `src/config/` may;
 *  - the modules load by `require`, in the .js order (see below); `QueryTypes`,
 *    which only the replacement query used, is no longer read.
 * It replaces `index.d.ts`, which described the `.js` exports and is removed.
 */
import type * as SequelizeModule from "sequelize";
import type * as ActivityLogModule from "../middlewares/activityLog.middleware";
import type * as DbReadyModule from "../utils/dbReady.util";
import type * as SqlModule from "../utils/sql.util";
import type { SqlRunner } from "../utils/sql.util";

/* eslint-disable @typescript-eslint/no-require-imports -- as built: the .js load order, which an
   `import` cannot keep (imports are hoisted above the code between them). cls-hooked is loaded and
   its namespace created before sequelize is read, and Sequelize.useCLS runs before the logger and
   dbReady load; each module is destructured at load, as the .js did. cls-hooked ships no types, and
   Sequelize.useCLS takes any object. sql.util (P9-07, below) is the one module the .js did not load. */
const cls = require("cls-hooked") as { createNamespace(name: string): object };
const namespace = cls.createNamespace("callibrator-namespace");
const { Sequelize } = require("sequelize") as typeof SequelizeModule;
Sequelize.useCLS(namespace);
const { logger } = require("../middlewares/activityLog.middleware") as typeof ActivityLogModule;
const { waitForDbReady } = require("../utils/dbReady.util") as typeof DbReadyModule;
const { sql } = require("../utils/sql.util") as typeof SqlModule;
/* eslint-enable @typescript-eslint/no-require-imports */

// Load Environment Variables
const host = process.env["DB_HOST"];
const dbName = process.env["DB_NAME"];
const user = process.env["DB_USER"];
const pass = process.env["DB_PASS"];
const port = process.env["DB_PORT"];
// PostgreSQL is the only supported database (ADR-039). DB_DIALECT is no
// longer required; if it is set to anything else we refuse to start rather
// than connect with a dialect the codebase does not support.
const dialect = "postgres" as const;
// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty NODE_ENV means development
const nodeEnv = process.env["NODE_ENV"] || "development";

// ------------------------------------------------------------------
// REQUIRED ENV VALIDATION
// ------------------------------------------------------------------
const validateConfig = (): void => {
  const required = [
    { key: "DB_HOST", label: "DB_HOST" },
    { key: "DB_NAME", label: "DB_NAME" },
    { key: "DB_USER", label: "DB_USER" },
    { key: "DB_PASS", label: "DB_PASS" },
    { key: "DB_PORT", label: "DB_PORT" },
  ];

  const missing: string[] = [];
  for (const { key, label } of required) {
    if (!process.env[key] || process.env[key].trim() === "") {
      missing.push(label);
    }
  }

  if (missing.length > 0) {
    const msg = `Missing required environment variables: ${missing.join(", ")}. See .env.example for required configuration.`;
    logger.error(`CONFIG_VALIDATION_FAILURE: ${msg}`);
    throw new Error(msg);
  }

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: an empty DB_DIALECT means postgres
  const requestedDialect = (process.env["DB_DIALECT"] || "postgres").trim();
  if (requestedDialect !== "postgres") {
    const msg =
      `Unsupported DB_DIALECT: "${requestedDialect}". PostgreSQL is the only ` +
      "supported database (ADR-039) — MySQL support was removed because it " +
      "never worked: the mysql2 driver was not a dependency, and full-text " +
      "search, webhooks and RAG all use PostgreSQL-only SQL.";
    logger.error(`CONFIG_VALIDATION_FAILURE: ${msg}`);
    throw new Error(msg);
  }

  // DB_PORT is set: the check above refused a missing one.
  const dbPort = parseInt(port as string, 10);
  if (isNaN(dbPort) || dbPort < 1 || dbPort > 65535) {
    const msg = `Invalid DB_PORT: "${port as string}". Must be a number between 1 and 65535.`;
    logger.error(`CONFIG_VALIDATION_FAILURE: ${msg}`);
    throw new Error(msg);
  }

  logger.info("Configuration validated successfully");
};

validateConfig();

// As built: a pool variable that is unset, empty or not a number (NaN), or 0, takes the default (`||`).
// Shared Sequelize Configuration
// DB_HOST, DB_USER and DB_PASS are set: validateConfig refused a missing one.
const baseConfig = {
  dialect,
  host: host as string,
  // As built: the environment's string; Sequelize passes it to the driver, which accepts it.
  port: port as unknown as number,
  username: user as string,
  password: pass as string,

  timezone: "+07:00",

  logging: nodeEnv === "development" ? (msg: string): void => {
    logger.info(msg);
  } : false,

  benchmark: nodeEnv === "development",

  pool: {
    max:
      parseInt(process.env["DB_POOL_MAX"] as string, 10) ||
      (process.env["NODE_ENV"] === "production" ? 20 : 10),
    min: parseInt(process.env["DB_POOL_MIN"] as string, 10) || 2,
    acquire: parseInt(process.env["DB_POOL_ACQUIRE_TIMEOUT"] as string, 10) || 30000,
    idle: parseInt(process.env["DB_POOL_IDLE_TIMEOUT"] as string, 10) || 10000,
  },
};

// PostgreSQL Configuration
// `supportsSearchPath` is not in Sequelize's Options type; the instance reads it from the config as before.
const pgConfig = {
  ...baseConfig,

  database: dbName as string,

  dialectOptions: {
    ssl: process.env["DB_SSL"] === "true" ? { require: true } : false,
  },

  supportsSearchPath: false,
};

// Final Configuration — PostgreSQL only (ADR-039).
const config = pgConfig;

// Main Sequelize Instance (v6 accepts full config object)
const db = new Sequelize(config);

// ------------------------------------------------------------------
// DATABASE BOOTSTRAP & CONNECTION
// ------------------------------------------------------------------

/**
 * Create Database If Not Exists
 * PostgreSQL only: connects to the "postgres" maintenance database to create
 * the target database when it does not exist.
 * @returns true, whether or not the database could be created (the main connection reports errors)
 */
async function createDatabaseIfNotExists(): Promise<boolean> {
  // PostgreSQL: Need to connect to 'postgres' database to create a new database
  const bootstrapDb = new Sequelize({
    database: "postgres",
    username: user as string,
    password: pass as string,
    host: host as string,
    port: port as unknown as number,
    dialect,
    logging: false,
  });

  try {
    await bootstrapDb.authenticate();

    const bootstrapRunner = bootstrapDb as unknown as SqlRunner;
    const results = await sql(bootstrapRunner, "SELECT 1 FROM pg_database WHERE datname = $1;", [dbName as string]);

    if (results.length === 0) {
      // A database name is an identifier, which cannot be bound; it comes from DB_NAME, quoted as before.
      await sql(bootstrapRunner, `CREATE DATABASE "${dbName as string}";`);
      logger.info(`Database "${dbName as string}" created (PostgreSQL).`);
    } else {
      logger.info(`Database "${dbName as string}" already exists (PostgreSQL).`);
    }

    try {
      await bootstrapDb.close();
    } catch {
      // Ignore close errors
    }
    return true;
  } catch (error) {
    logger.warn(`Database creation failed: ${String((error as { message?: unknown }).message)}`);
    try {
      await bootstrapDb.close();
    } catch {
      // Ignore close errors
    }
    // Continue anyway - the main connection will handle errors
    return true;
  }
}

/**
 * Initialize Database Connection with Retry
 * Correct flow:
 * 1. Bootstrap connection to default database
 * 2. Create target database if not exists
 * 3. Close bootstrap connection
 * 4. Establish main connection to target database
 *
 * Retries the entire connection process if database creation fails
 * @param options - `maxAttempts` (default 20) and `delayMs` between them (default 3000)
 * @returns the ready message; exits the process after `maxAttempts` failures
 */
async function Connection({ maxAttempts = 20, delayMs = 3000 }: { maxAttempts?: number; delayMs?: number } = {}): Promise<string | undefined> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info(
        `Initializing database connection... (attempt ${String(attempt)}/${String(maxAttempts)})`,
      );

      // Step 1: Create database if not exists (using bootstrap connection).
      // (The .js passed `{ maxAttempts: 20, delayMs: 3000 }` here, which the function never read.)
      const databaseCreated = await createDatabaseIfNotExists();

      // As built: createDatabaseIfNotExists always answers true, so this branch is never taken.
      if (!databaseCreated) {
        logger.warn(
          `Failed to create/access database (attempt ${String(attempt)}/${String(maxAttempts)}). ` +
            `Retrying in ${String(delayMs)}ms…`,
        );

        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        logger.error(
          "Failed to create/access database after all attempts. Exiting.",
        );
        process.exit(1);
      }

      // Step 2: Establish main connection to target database
      const readyMsg = await waitForDbReady(db, {
        maxAttempts: 10,
        delayMs: 3000,
      });
      logger.info(readyMsg);

      if (readyMsg.includes("Database connection established")) {
        await db.authenticate();
        await sql(db as unknown as SqlRunner, "SELECT 1");
        logger.info("DB Connected successfully");
        return readyMsg;
      }
    } catch (error) {
      logger.error(
        `DB Connection Failed (attempt ${String(attempt)}/${String(maxAttempts)}): ${String((error as { message?: unknown }).message)}`,
      );

      if (attempt < maxAttempts) {
        logger.info(`Retrying in ${String(delayMs)}ms…`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        logger.error(
          `DB Connection Failed after ${String(maxAttempts)} attempts. Exiting.`,
        );
        process.exit(1);
      }
    }
  }
  return undefined;
}

// NOTE: Graceful shutdown (SIGINT/SIGTERM) is owned by the application entry
// point (index.js `shutdown()`), which closes the HTTP server, then the DB,
// Redis, and RabbitMQ in order. Registering DB-closing signal handlers here too
// caused a race (this handler could `process.exit(0)` before the app finished
// draining Redis/RabbitMQ), so they were removed. Standalone scripts that use
// this config without index.js rely on process exit to release the pool.

export = { db, Connection, Sequelize };
