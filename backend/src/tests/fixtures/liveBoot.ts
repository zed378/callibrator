/**
 * liveBoot — build a live suite's database the way the backend boots, then
 * run the suite as the application role (ADR-095 follow-up O-2).
 *
 * `bootSchema` is `index.js`'s own schema step: `runSchemaSetup` (the advisory
 * lock, `db.sync()`, then every migration — 0057's calibration_records control
 * and 0091's append-only audit_logs among them).
 *
 * `enterAppRole` is `index.js`'s own switch: `enterApplicationRole`, which
 * installs `SET ROLE` on every pooled connection and refuses to continue unless
 * the role really lacks DELETE on calibration_records and audit_logs (O-1). A
 * suite that passes after it has proved its behaviour as `callibrator_app`, not
 * as the owner — the owner would pass whether the grants exist or not
 * (CLAUDE.md § Evidence).
 *
 * Use them on a database from `fixtures/disposableDatabase.ts`: a migrated
 * database refuses every audit-row DELETE, so the suite drops the database
 * instead of cleaning up.
 */
import { enterApplicationRole } from "../../utils/dbRole.util";
import type { AppRoleSequelize } from "../../utils/dbRole.util";
import { runSchemaSetup } from "../../utils/migrationLock.util";

type SetupArgs = Parameters<typeof runSchemaSetup>[0];

/** The role migration 0057 creates and grants. */
export const APP_ROLE = "callibrator_app";

const quiet = { info: (): void => undefined, warn: (): void => undefined, error: (): void => undefined };

/** sync + every migration, under the boot's schema lock. */
export const bootSchema = async (db: SetupArgs["sequelize"], migrator: SetupArgs["migrator"]): Promise<void> => {
  await runSchemaSetup({ sequelize: db, migrator, logger: quiet });
};

/** Switch every connection of `db` to the application role, with the boot's self-check. */
export const enterAppRole = async (db: AppRoleSequelize): Promise<void> => {
  await enterApplicationRole({ sequelize: db, logger: quiet, env: { DB_APP_ROLE: APP_ROLE } });
};

/**
 * A-283 — for a suite that builds its schema with `db.sync({ force: true })`
 * and runs only the migrations it tests (no migrator): apply the two that
 * give the application role its grants — 0057 (creates `callibrator_app` if
 * absent, grants it DML, makes calibration_records append-only) and 0091
 * (audit_logs append-only) — so that `enterAppRole` on another process of the
 * same database passes its self-check. Owner DDL: call it on the owner's
 * connection, in setup. Both are idempotent.
 *
 * @param db - any object with `getQueryInterface()` (a Sequelize instance)
 */
export const grantAppRoleOnSyncedSchema = async (db: { getQueryInterface(): unknown }): Promise<void> => {
  /* eslint-disable @typescript-eslint/no-require-imports -- loaded late on purpose, as bootSchemaAsApplicationRole's migrator: the migrations read DB_APP_ROLE when called */
  const m0057 = require("../../migrations/0057-calibration-records-append-only") as MigrationModule;
  const m0091 = require("../../migrations/0091-audit-logs-append-only") as MigrationModule;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const context = db.getQueryInterface();
  await m0057.up({ context });
  await m0091.up({ context });
};

/** A migration module, as far as grantAppRoleOnSyncedSchema calls it. */
interface MigrationModule {
  up(options: { context: unknown }): Promise<void>;
}

/**
 * Both steps, with the migrator of the module graph that loaded `config` (the
 * caller's): `require("../../config/migrator")` here resolves in the same jest
 * module registry, so it is bound to the same Sequelize instance as `db`.
 */
export const bootSchemaAsApplicationRole = async (db: SetupArgs["sequelize"] & AppRoleSequelize): Promise<void> => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded late on purpose: config/migrator reads DB_NAME when it loads, after the disposable database is created
  const { migrator } = require("../../config/migrator") as { migrator: SetupArgs["migrator"] };
  await bootSchema(db, migrator);
  await enterAppRole(db);
};
