const cls = require("cls-hooked");
const namespace = cls.createNamespace("callibrator-namespace");
const { Sequelize, QueryTypes } = require("sequelize");
Sequelize.useCLS(namespace);
const { logger } = require("../middlewares/activityLog.middleware");
const { waitForDbReady } = require("../utils/dbReady.util");

// Load Environment Variables
const host = process.env.DB_HOST;
const dbName = process.env.DB_NAME;
const user = process.env.DB_USER;
const pass = process.env.DB_PASS;
const port = process.env.DB_PORT;
const dialect = process.env.DB_DIALECT;
const nodeEnv = process.env.NODE_ENV || "development";

// ------------------------------------------------------------------
// REQUIRED ENV VALIDATION
// ------------------------------------------------------------------
const validateConfig = () => {
  const required = [
    { key: "DB_HOST", label: "DB_HOST" },
    { key: "DB_NAME", label: "DB_NAME" },
    { key: "DB_USER", label: "DB_USER" },
    { key: "DB_PASS", label: "DB_PASS" },
    { key: "DB_PORT", label: "DB_PORT" },
    { key: "DB_DIALECT", label: "DB_DIALECT (must be 'postgres' or 'mysql')" },
  ];

  const missing = [];
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

  if (!["postgres", "mysql"].includes(dialect)) {
    const msg = `Invalid DB_DIALECT: "${dialect}". Must be "postgres" or "mysql".`;
    logger.error(`CONFIG_VALIDATION_FAILURE: ${msg}`);
    throw new Error(msg);
  }

  const dbPort = parseInt(port, 10);
  if (isNaN(dbPort) || dbPort < 1 || dbPort > 65535) {
    const msg = `Invalid DB_PORT: "${port}". Must be a number between 1 and 65535.`;
    logger.error(`CONFIG_VALIDATION_FAILURE: ${msg}`);
    throw new Error(msg);
  }

  logger.info("Configuration validated successfully");
};

validateConfig();

// Shared Sequelize Configuration
const baseConfig = {
  dialect,
  host,
  port,
  username: user,
  password: pass,

  timezone: "+07:00",

  logging: nodeEnv === "development" ? (msg) => logger.info(msg) : false,

  benchmark: nodeEnv === "development",

  pool: {
    max:
      parseInt(process.env.DB_POOL_MAX, 10) ||
      (process.env.NODE_ENV === "production" ? 20 : 10),
    min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
    acquire: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT, 10) || 30000,
    idle: parseInt(process.env.DB_POOL_IDLE_TIMEOUT, 10) || 10000,
  },
};

// MySQL Configuration
const mysqlConfig = {
  ...baseConfig,

  database: dbName,

  define: {
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
  },
};

// PostgreSQL Configuration
const pgConfig = {
  ...baseConfig,

  database: dbName,

  dialectOptions: {
    ssl: process.env.DB_SSL === "true" ? { require: true } : false,
  },

  supportsSearchPath: false,
};

// Final Configuration
const config = dialect === "mysql" ? mysqlConfig : pgConfig;

// Main Sequelize Instance (v6 accepts full config object)
const db = new Sequelize(config);

// ------------------------------------------------------------------
// DATABASE BOOTSTRAP & CONNECTION
// ------------------------------------------------------------------

/**
 * Create Database If Not Exists
 * Uses Sequelize v6 built-in database creation for PostgreSQL/MySQL.
 */
async function createDatabaseIfNotExists() {
  if (dialect === "postgres") {
    // PostgreSQL: Need to connect to 'postgres' database to create a new database
    const bootstrapDb = new Sequelize({
      database: "postgres",
      username: user,
      password: pass,
      host,
      port,
      dialect,
      logging: false,
    });

    try {
      await bootstrapDb.authenticate();

      const results = await bootstrapDb.query(
        "SELECT 1 FROM pg_database WHERE datname = ?;",
        {
          replacements: [dbName],
          type: QueryTypes.SELECT,
        },
      );

      if (results.length === 0) {
        await bootstrapDb.query(`CREATE DATABASE "${dbName}";`);
        logger.info(`Database "${dbName}" created (PostgreSQL).`);
      } else {
        logger.info(`Database "${dbName}" already exists (PostgreSQL).`);
      }

      try {
        await bootstrapDb.close();
      } catch {
        // Ignore close errors
      }
      return true;
    } catch (error) {
      logger.warn(`Database creation failed: ${error.message}`);
      try {
        await bootstrapDb.close();
      } catch {
        // Ignore close errors
      }
      // Continue anyway - the main connection will handle errors
      return true;
    }
  }

  // For MySQL, create database if not exists
  const bootstrapDb = new Sequelize({
    database: dbName,
    username: user,
    password: pass,
    host,
    port,
    dialect,
    logging: false,
  });

  try {
    await bootstrapDb.authenticate();
    await bootstrapDb.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    );
    logger.info(`Database "${dbName}" created or already exists (MySQL).`);

    try {
      await bootstrapDb.close();
    } catch {
      // Ignore close errors
    }
    return true;
  } catch (error) {
    logger.warn(`Database creation failed: ${error.message}`);
    try {
      await bootstrapDb.close();
    } catch {
      // Ignore close errors
    }
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
 */
async function Connection({ maxAttempts = 20, delayMs = 3000 } = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      logger.info(
        `Initializing database connection... (attempt ${attempt}/${maxAttempts})`,
      );

      // Step 1: Create database if not exists (using bootstrap connection)
      const databaseCreated = await createDatabaseIfNotExists({
        maxAttempts: 20,
        delayMs: 3000,
      });

      if (!databaseCreated) {
        logger.warn(
          `Failed to create/access database (attempt ${attempt}/${maxAttempts}). ` +
            `Retrying in ${delayMs}ms…`,
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
        await db.query("SELECT 1");
        logger.info("DB Connected successfully");
        return readyMsg;
      }
    } catch (error) {
      logger.error(
        `DB Connection Failed (attempt ${attempt}/${maxAttempts}): ${error.message}`,
      );

      if (attempt < maxAttempts) {
        logger.info(`Retrying in ${delayMs}ms…`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        logger.error(
          `DB Connection Failed after ${maxAttempts} attempts. Exiting.`,
        );
        process.exit(1);
      }
    }
  }
}

// NOTE: Graceful shutdown (SIGINT/SIGTERM) is owned by the application entry
// point (index.js `shutdown()`), which closes the HTTP server, then the DB,
// Redis, and RabbitMQ in order. Registering DB-closing signal handlers here too
// caused a race (this handler could `process.exit(0)` before the app finished
// draining Redis/RabbitMQ), so they were removed. Standalone scripts that use
// this config without index.js rely on process exit to release the pool.

module.exports = {
  db,
  Connection,
  Sequelize,
};
