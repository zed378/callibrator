/**
 * P6-03 — run the backend's queries as the APPLICATION ROLE, not the owner.
 *
 * Why: the backend logs in as the database owner (in compose, POSTGRES_USER —
 * a superuser). A superuser bypasses every privilege check, so any REVOKE
 * written for "the application role" protects nothing while the application
 * runs as the owner (A-240). The owner login is still needed at boot: db.sync()
 * and the migrator create tables, triggers and grants.
 *
 * So after migrating, every pooled connection is switched with
 * `SET ROLE <DB_APP_ROLE>` when it is acquired (the `afterPoolAcquire` hook —
 * a connection opened before the switch is switched on its next acquisition,
 * so no pool is torn down). Migration 0057 creates the role, grants it DML,
 * REVOKEs UPDATE/DELETE/TRUNCATE on calibration_records, and makes the owner a
 * member so it may switch.
 *
 * Then it CHECKS, as the switched session, that the switch took and that the
 * role really cannot delete calibration records — and refuses the boot if not.
 * A role that silently kept the owner's rights is the absent control with a
 * green tick that CLAUDE.md warns about.
 *
 * What it does NOT defend against: a session that runs `RESET ROLE` — i.e.
 * arbitrary SQL execution. The append-only TRIGGER (migration 0057) holds even
 * then; a separate LOGIN role with no path back to the owner is the stronger
 * deployment (docs/DATABASE/07-CALIBRATION-TABLES.md).
 *
 * DB_APP_ROLE unset (or "none"): nothing is switched, and a warning says so on
 * every boot.
 *
 * P9-09 (ADR-087): converted from dbRole.util.js with no behaviour change. The
 * Sequelize instance and the logger are typed by the members used here; the
 * only caller (index.js) is JavaScript.
 */

import { environment } from "../config/env";

const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const HOOK_NAME = "p6-03-application-role";
/** Marks a pg client that has been switched, so SET ROLE runs once per connection. */
const SWITCHED = Symbol("callibrator.appRole");

/** The environment variables read here (process.env by default). */
export type AppRoleEnv = Readonly<Record<string, string | undefined>>;

/** A pooled pg client, as the `afterPoolAcquire` hook receives it. */
export interface PoolConnection {
  [SWITCHED]?: string;
  query(sql: string): Promise<unknown>;
}

/** The row the post-switch check reads — exactly one: pg_roles of current_user. */
export interface AppRoleCheck {
  currentUser: string;
  superuser: boolean;
  canDelete: boolean;
  canUpdateAll: boolean;
  canInsert: boolean;
}

/** The Sequelize members used here. */
export interface AppRoleSequelize {
  addHook(hookType: "afterPoolAcquire", name: string, fn: (connection: PoolConnection) => Promise<void>): unknown;
  query(sql: string, options: { type: "SELECT" }): Promise<readonly [AppRoleCheck, ...unknown[]]>;
}

/** The logger members used here. */
export interface AppRoleLogger {
  info(message: string): unknown;
  warn(message: string): unknown;
}

/** enterApplicationRole's options. */
export interface EnterApplicationRoleOptions {
  sequelize: AppRoleSequelize;
  logger: AppRoleLogger;
  /** process.env */
  env?: AppRoleEnv;
}

/**
 * @param env - process.env
 * @returns the role to switch to, or null when switching is off
 * @throws {Error} when DB_APP_ROLE is not a plain identifier
 */
const resolveAppRole = (env: AppRoleEnv = environment()): string | null => {
  const raw = env["DB_APP_ROLE"];
  if (raw === undefined || raw === "" || raw === "none") {
    return null;
  }
  if (!ROLE_PATTERN.test(raw)) {
    throw new Error(
      `DB_APP_ROLE "${raw}" is not a plain lower-case identifier ([a-z_][a-z0-9_]*).`,
    );
  }
  return raw;
};

/**
 * The hook: switch a freshly acquired connection to `role` once.
 */
const switchConnection = (role: string): ((connection: PoolConnection) => Promise<void>) => async (connection) => {
  if (connection[SWITCHED] === role) {
    return;
  }
  await connection.query(`SET ROLE ${role}`);
  connection[SWITCHED] = role;
};

/**
 * Switch every connection of `sequelize` to the application role, then prove
 * the switch as that role.
 *
 * @returns the role now in force, or null when off
 * @throws {Error} when the switched session still has DELETE or table-wide
 *   UPDATE on calibration_records, is a superuser, or is not the role
 */
const enterApplicationRole = async ({ sequelize, logger, env = environment() }: EnterApplicationRoleOptions): Promise<string | null> => {
  const role = resolveAppRole(env);
  if (!role) {
    logger.warn(
      "DB_APP_ROLE is not set: the backend runs every query as the database owner. " +
        "calibration_records stays append-only through its trigger (migration 0057), but " +
        "privilege-based protections are inactive. Set DB_APP_ROLE=callibrator_app (P6-03).",
    );
    return null;
  }

  sequelize.addHook("afterPoolAcquire", HOOK_NAME, switchConnection(role));

  const [check] = await sequelize.query(
    `SELECT current_user AS "currentUser",
            r.rolsuper AS "superuser",
            has_table_privilege('calibration_records', 'DELETE') AS "canDelete",
            has_table_privilege('calibration_records', 'UPDATE') AS "canUpdateAll",
            has_table_privilege('calibration_records', 'INSERT') AS "canInsert"
       FROM pg_roles r WHERE r.rolname = current_user`,
    { type: "SELECT" },
  );
  const wrong: string[] = [];
  if (check.currentUser !== role) {
    wrong.push(`current_user is "${check.currentUser}", not "${role}"`);
  }
  if (check.superuser) {
    wrong.push("the role is a superuser");
  }
  if (check.canDelete) {
    wrong.push("the role can DELETE from calibration_records");
  }
  if (check.canUpdateAll) {
    wrong.push("the role can UPDATE every column of calibration_records");
  }
  if (!check.canInsert) {
    wrong.push("the role cannot INSERT into calibration_records — the application would not work");
  }
  if (wrong.length) {
    throw new Error(
      `DB_APP_ROLE=${role} does not give the append-only guarantee (P6-03): ${wrong.join("; ")}. ` +
        "Migration 0057 grants the role; check it ran against this database.",
    );
  }
  logger.info(
    `Database queries now run as the application role "${role}" ` +
      "(no UPDATE/DELETE on calibration_records beyond its lifecycle columns)",
  );
  return role;
};

export { resolveAppRole, enterApplicationRole, switchConnection, SWITCHED, HOOK_NAME };
