/**
 * The SQL-dump import's configuration (ADR-129, P24-06), read at CALL time
 * (config/env.ts): tests and the boot set variables after this module loads.
 *
 *   UPSTREAM_IMPORT_MAX_BYTES               200 MiB — the largest upload accepted
 *   UPSTREAM_IMPORT_MAX_UNCOMPRESSED_BYTES  2 GiB   — a gzip upload's decompressed
 *                                                     ceiling (a decompression bomb
 *                                                     fails the run, not the host)
 *   UPSTREAM_IMPORT_FAILED_RETENTION_DAYS   7       — how long a FAILED run keeps its
 *                                                     file for a retry; then deleted
 *   UPSTREAM_IMPORT_UPLOAD_TIMEOUT_MS       15 min  — the upload request's own budget
 *                                                     (the app-wide one is 30 s)
 *   UPSTREAM_IMPORT_DB_ROLE                 callibrator_import — the role the worker's
 *                                                     staging connection switches to
 *   UPSTREAM_TRANSFORM_DB_ROLE              callibrator_transform — the role the transform's
 *                                                     connection switches to (P24-01, 0133)
 *
 * The DPIA gate (UPSTREAM_REAL_DATA_ALLOWED) is NOT read here: it has one definition,
 * `config/upstream.ts#upstreamRealDataAllowed`, shared with the rsync image import (ADR-130).
 *
 * A value that is not a positive integer falls back to its default rather
 * than refusing the boot. The staging connection is a SECOND Sequelize
 * instance on the same database and login as the application's, whose every
 * pooled connection runs `SET ROLE <UPSTREAM_IMPORT_DB_ROLE>` (the P6-03
 * pattern): it never carries the application's tenant hooks or its
 * application role, and the application role is never granted the staging
 * schema (migration 0114's REVOKE; the grant test runs as `callibrator_app`).
 */
import { Sequelize } from "sequelize";
import { env } from "./env";
import config from "./index";

/** The staging schema (created by the migration, owned by the import role). */
export const STAGING_SCHEMA = "upstream_import";

/** The role the staging connection switches to when UPSTREAM_IMPORT_DB_ROLE is unset. */
export const DEFAULT_IMPORT_ROLE = "callibrator_import";

/** The role the transform's connection switches to when UPSTREAM_TRANSFORM_DB_ROLE is unset (P24-01). */
export const DEFAULT_TRANSFORM_ROLE = "callibrator_transform";

const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

const MIB = 1024 * 1024;

/** A positive integer read from `name`, or `fallback`. */
const positiveIntOr = (name: string, fallback: number): number => {
  const value = Number(env(name));
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/** The settings one upload or run reads. */
export interface UpstreamImportSettings {
  readonly maxUploadBytes: number;
  readonly maxUncompressedBytes: number;
  readonly failedRetentionDays: number;
  readonly uploadTimeoutMs: number;
}

/** The settings, read now. */
export const upstreamImportSettings = (): UpstreamImportSettings => ({
  maxUploadBytes: positiveIntOr("UPSTREAM_IMPORT_MAX_BYTES", 200 * MIB),
  maxUncompressedBytes: positiveIntOr("UPSTREAM_IMPORT_MAX_UNCOMPRESSED_BYTES", 2048 * MIB),
  failedRetentionDays: positiveIntOr("UPSTREAM_IMPORT_FAILED_RETENTION_DAYS", 7),
  uploadTimeoutMs: positiveIntOr("UPSTREAM_IMPORT_UPLOAD_TIMEOUT_MS", 15 * 60 * 1000),
});

/** A role name from `variable`'s value, or `fallback`; refused unless a plain lower-case identifier. */
const roleFrom = (variable: string, raw: string | undefined, fallback: string): string => {
  const name = raw === undefined || raw === "" ? fallback : raw;
  if (!ROLE_PATTERN.test(name)) {
    throw new Error(`${variable} "${name}" is not a plain lower-case identifier ([a-z_][a-z0-9_]*).`);
  }
  return name;
};

/**
 * The import role's name.
 * @throws {Error} when UPSTREAM_IMPORT_DB_ROLE is not a plain lower-case identifier (it is interpolated into SET ROLE and GRANT)
 */
export const importRoleName = (raw: string | undefined = env("UPSTREAM_IMPORT_DB_ROLE")): string =>
  roleFrom("UPSTREAM_IMPORT_DB_ROLE", raw, DEFAULT_IMPORT_ROLE);

/**
 * The transform role's name (P24-01).
 * @throws {Error} when UPSTREAM_TRANSFORM_DB_ROLE is not a plain lower-case identifier
 */
export const transformRoleName = (raw: string | undefined = env("UPSTREAM_TRANSFORM_DB_ROLE")): string =>
  roleFrom("UPSTREAM_TRANSFORM_DB_ROLE", raw, DEFAULT_TRANSFORM_ROLE);

/** A pooled pg client, as the `afterPoolAcquire` hook receives it. */
interface PoolConnection {
  query(sql: string): Promise<unknown>;
}

/**
 * A new connection (two pooled connections at most) on the application's database and login,
 * every pooled connection switched to `role`. The caller closes it when the run ends.
 */
const createRoleDb = (role: string): Sequelize => {
  const { database, username, password, host, port } = config.db.config;
  // The application's own connection settings (config/index.ts validated them at load).
  const staging = new Sequelize(database, username, password ?? "", {
    host: host as string,
    port: Number(port),
    dialect: "postgres",
    logging: false,
    pool: { max: 2, min: 0, idle: 10_000, acquire: 30_000 },
    dialectOptions: { ssl: env("DB_SSL") === "true" ? { require: true } : false },
  });
  staging.addHook("afterPoolAcquire", "upstream-import-role", async (connection: unknown) => {
    await (connection as PoolConnection).query(`SET ROLE ${role}`);
  });
  return staging;
};

/** A new staging connection, switched to the import role (stage 1). */
export const createStagingDb = (): Sequelize => createRoleDb(importRoleName());

/** A new transform connection, switched to the transform role (stage 2, P24-01). */
export const createTransformDb = (): Sequelize => createRoleDb(transformRoleName());
