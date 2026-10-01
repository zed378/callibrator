/**
 * Types for `src/config/index.js`, which is still JavaScript (P9-10, ADR-087 Amendment 11).
 *
 * The release build compiles with `allowJs: false` (ADR-087 decision 3), so a
 * `.ts` module cannot import a `.js` one without declared types; the models
 * barrel (`models/index.ts`) is the first TypeScript importer of the config.
 * TypeScript resolves `../config` to this file for types, and Node resolves it
 * to `index.js` at run time: this file emits nothing and is never copied into
 * `dist/`.
 *
 * It declares exactly what index.js exports (`module.exports = { db,
 * Connection, Sequelize }`). It is deleted when index.js itself converts (the
 * rest of P9-06); until then a change to index.js's exports must change this
 * file too.
 */
import type { Sequelize as SequelizeClass } from "sequelize";

/** The one shared Sequelize instance (pool, SSL, timezone, retry, logging from the environment). */
export declare const db: SequelizeClass;

/**
 * Creates the database if absent, then authenticates with retries; exits the
 * process after `maxAttempts` failures. Resolves with the ready message.
 */
export declare function Connection(options?: { maxAttempts?: number; delayMs?: number }): Promise<string>;

/** Sequelize's constructor, as index.js re-exports it. */
export declare const Sequelize: typeof SequelizeClass;
