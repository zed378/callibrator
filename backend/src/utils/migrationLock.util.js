/**
 * P8-03 (ADR-086) — one schema setup at a time, across every backend replica.
 *
 * The backend runs `db.sync()` and then `migrator.up()` at boot. Two replicas
 * starting together both ran them: both read `schema_migrations`, both saw the
 * same migrations pending, both applied them. A migration that is not
 * idempotent then fails on the second replica (which crash-loops), and one
 * that is — an UPDATE backfill — runs twice.
 *
 * `withSchemaLock` takes a PostgreSQL SESSION advisory lock on a connection of
 * its own, runs the schema step, and unlocks. A second instance polls
 * `pg_try_advisory_lock` and WAITS — it does not start against a half-migrated
 * schema. When it gets the lock, the winner's migrations are recorded in
 * `schema_migrations`, so its own `migrator.up()` applies nothing.
 *
 * Why a session lock on a raw connection, not `pg_advisory_xact_lock` in a
 * transaction: config/index.js enables Sequelize CLS, so every query issued
 * inside a managed transaction's callback JOINS that transaction — the whole
 * sync and every migration would run inside the lock's transaction. The lock
 * lives on a connection taken straight from the connection manager instead,
 * which no model query can pick up.
 *
 * If the process dies while holding the lock, PostgreSQL releases it with the
 * connection. A waiter gives up after MIGRATION_LOCK_TIMEOUT_MS (default ten
 * minutes) and refuses the boot, naming the reason, rather than waiting
 * forever behind a stuck migration.
 *
 * JavaScript, not TypeScript: the backend has no TypeScript toolchain yet
 * (P9-01 is TODO), so a .ts file here could not be loaded or tested.
 */

/** The lock key: a fixed bigint, "P8-03" in spirit. Every replica must use the same one. */
const MIGRATION_LOCK_KEY = "8003000000000000803";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_MS = 1000;
const TAG = "[migration-lock]";

/**
 * @param {object} [env] - process.env
 * @returns {number} how long a waiting instance waits for the lock, in ms
 * @throws {Error} when MIGRATION_LOCK_TIMEOUT_MS is set but not a positive integer
 */
const resolveTimeoutMs = (env = process.env) => {
  const raw = env.MIGRATION_LOCK_TIMEOUT_MS;
  if (raw === undefined || raw === "") {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`MIGRATION_LOCK_TIMEOUT_MS "${raw}" is not a positive integer (milliseconds).`);
  }
  return Number(raw);
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` while holding the cluster-wide schema lock.
 *
 * @template T
 * @param {object} args
 * @param {object} args.sequelize - the Sequelize instance (PostgreSQL)
 * @param {{info: Function, warn: Function}} args.logger
 * @param {() => Promise<T>} args.fn - the schema step (sync + migrations)
 * @param {number} [args.timeoutMs] - default: resolveTimeoutMs()
 * @param {number} [args.pollMs] - default 1000
 * @param {(ms: number) => Promise<void>} [args.sleep]
 * @param {() => number} [args.now]
 * @returns {Promise<T>} what `fn` returned
 * @throws {Error} when the lock is not acquired within `timeoutMs`, or `fn` throws
 */
const withSchemaLock = async ({
  sequelize,
  logger,
  fn,
  timeoutMs = resolveTimeoutMs(),
  pollMs = DEFAULT_POLL_MS,
  sleep = defaultSleep,
  now = Date.now,
}) => {
  const manager = sequelize.connectionManager;
  const connection = await manager.getConnection({ type: "write" });
  let held = false;
  try {
    const started = now();
    let announced = false;
    for (;;) {
      const { rows } = await connection.query(
        "SELECT pg_try_advisory_lock($1::bigint) AS locked",
        [MIGRATION_LOCK_KEY],
      );
      if (rows[0].locked) {
        held = true;
        break;
      }
      if (!announced) {
        logger.info(
          `${TAG} another instance is migrating the schema; waiting for it to finish before starting`,
        );
        announced = true;
      }
      if (now() - started >= timeoutMs) {
        throw new Error(
          `${TAG} the schema lock was not released within ${timeoutMs} ms. Another instance is ` +
            "still migrating, or is stuck. Refusing to start against a schema that may be half-migrated.",
        );
      }
      await sleep(pollMs);
    }
    if (announced) {
      logger.info(`${TAG} lock acquired after waiting; pending migrations are re-read now`);
    }
    return await fn();
  } finally {
    try {
      if (held) {
        await connection.query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_KEY]);
      }
    } finally {
      manager.releaseConnection(connection);
    }
  }
};

/**
 * The boot's schema step — `sync()` then the migrator — under the lock.
 * This is what backend/index.js runs, so the live test drives the same code.
 *
 * @param {object} args
 * @param {object} args.sequelize
 * @param {{up: () => Promise<Array<{name: string}>>}} args.migrator
 * @param {{info: Function, warn: Function}} args.logger
 * @param {object} [args.lockOptions] - timeoutMs / pollMs / sleep / now, for tests
 * @returns {Promise<Array<{name: string}>>} the migrations THIS instance applied
 */
const runSchemaSetup = ({ sequelize, migrator, logger, lockOptions = {} }) =>
  withSchemaLock({
    sequelize,
    logger,
    ...lockOptions,
    fn: async () => {
      await sequelize.sync();
      logger.info("All database tables synced");
      const applied = await migrator.up();
      if (applied.length) {
        logger.info(
          `Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(", ")}`,
        );
      }
      return applied;
    },
  });

module.exports = {
  runSchemaSetup,
  withSchemaLock,
  resolveTimeoutMs,
  MIGRATION_LOCK_KEY,
  DEFAULT_TIMEOUT_MS,
};
