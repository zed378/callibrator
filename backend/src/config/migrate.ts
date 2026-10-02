/**
 * `db.sync()` / `db.drop()` for the migration routes (controllers/migration.controller).
 *
 * P9-21 (ADR-087): converted from migrate.js with no behaviour change: `export =`
 * keeps the object `require()` returned, `db` and `logger` are captured at
 * load as the .js destructured them, and a failure is logged, never thrown
 * (proved by running both against PostgreSQL 18).
 */
import config from "./";
import { logger } from "../middlewares/activityLog.middleware";

const { db } = config;

async function Up(): Promise<void> {
  try {
    // Sync database tables
    await db.sync();
    logger.info("Database Synced");
  } catch (error) {
    logger.error(`Database sync failed: ${String((error as { message?: unknown }).message)}`);
  }
}

async function Down(): Promise<void> {
  try {
    await db.drop({});
    logger.info("Table Dropped");
  } catch (error) {
    logger.error(`Table drop failed: ${String((error as { message?: unknown }).message)}`);
  }
}

export = { Up, Down };
