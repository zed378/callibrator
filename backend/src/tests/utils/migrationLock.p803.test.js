/**
 * P8-03 (ADR-086) — the schema lock's branches, on a scripted connection.
 * What PostgreSQL then does with two real instances is proven by
 * migrationLock.p803.live.test.js.
 */
const fs = require("fs");
const path = require("path");
const {
  runSchemaSetup,
  withSchemaLock,
  resolveTimeoutMs,
  MIGRATION_LOCK_KEY,
  DEFAULT_TIMEOUT_MS,
} = require("../../utils/migrationLock.util");

/** A connection whose pg_try_advisory_lock answers follow `answers` (true = acquired). */
const scripted = (answers, { unlockThrows = false } = {}) => {
  const calls = [];
  const connection = {
    query: jest.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("pg_try_advisory_lock")) {
        return { rows: [{ locked: answers.shift() }] };
      }
      if (unlockThrows) {
        throw new Error("connection lost");
      }
      return { rows: [{ pg_advisory_unlock: true }] };
    }),
  };
  const manager = {
    getConnection: jest.fn(async () => connection),
    releaseConnection: jest.fn(),
  };
  return { sequelize: { connectionManager: manager, sync: jest.fn(async () => {}) }, manager, calls };
};

const logger = () => ({ info: jest.fn(), warn: jest.fn() });

describe("P8-03 withSchemaLock", () => {
  test("P8-03: acquires, runs the step, unlocks, releases — in that order", async () => {
    const { sequelize, manager, calls } = scripted([true]);
    const log = logger();
    const fn = jest.fn(async () => {
      calls.push({ sql: "STEP" });
      return "done";
    });
    await expect(withSchemaLock({ sequelize, logger: log, fn })).resolves.toBe("done");
    expect(calls.map((c) => c.sql)).toEqual([
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      "STEP",
      "SELECT pg_advisory_unlock($1::bigint)",
    ]);
    expect(calls[0].params).toEqual([MIGRATION_LOCK_KEY]);
    expect(calls[2].params).toEqual([MIGRATION_LOCK_KEY]);
    expect(manager.getConnection).toHaveBeenCalledWith({ type: "write" });
    expect(manager.releaseConnection).toHaveBeenCalledTimes(1);
    expect(log.info).not.toHaveBeenCalled();
  });

  test("P8-03: a held lock makes the instance WAIT, then run once it is free", async () => {
    const { sequelize, calls } = scripted([false, false, true]);
    const log = logger();
    const sleep = jest.fn(async () => {});
    const fn = jest.fn(async () => "ran");
    await expect(
      withSchemaLock({ sequelize, logger: log, fn, sleep, pollMs: 5, timeoutMs: 60000 }),
    ).resolves.toBe("ran");
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.sql.includes("pg_try_advisory_lock"))).toHaveLength(3);
    // announced once, not once per poll, and the acquisition after waiting is logged
    expect(log.info).toHaveBeenCalledTimes(2);
    expect(log.info.mock.calls[0][0]).toMatch(/another instance is migrating/);
    expect(log.info.mock.calls[1][0]).toMatch(/lock acquired after waiting/);
  });

  test("P8-03: gives up after the timeout, refuses, never runs the step, never unlocks a lock it does not hold", async () => {
    const { sequelize, manager, calls } = scripted([false, false, false, false]);
    let t = 0;
    const now = () => t;
    const sleep = jest.fn(async (ms) => {
      t += ms;
    });
    const fn = jest.fn();
    await expect(
      withSchemaLock({ sequelize, logger: logger(), fn, sleep, now, pollMs: 100, timeoutMs: 250 }),
    ).rejects.toThrow(/not released within 250 ms/);
    expect(fn).not.toHaveBeenCalled();
    expect(calls.some((c) => c.sql.includes("pg_advisory_unlock"))).toBe(false);
    expect(manager.releaseConnection).toHaveBeenCalledTimes(1);
  });

  test("P8-03: a failing step still unlocks and releases, and the failure propagates", async () => {
    const { sequelize, manager, calls } = scripted([true]);
    await expect(
      withSchemaLock({
        sequelize,
        logger: logger(),
        fn: async () => {
          throw new Error("migration 0042 failed");
        },
      }),
    ).rejects.toThrow("migration 0042 failed");
    expect(calls.at(-1).sql).toBe("SELECT pg_advisory_unlock($1::bigint)");
    expect(manager.releaseConnection).toHaveBeenCalledTimes(1);
  });

  test("P8-03: a failing unlock still releases the connection, and the failure propagates", async () => {
    const { sequelize, manager } = scripted([true], { unlockThrows: true });
    await expect(
      withSchemaLock({ sequelize, logger: logger(), fn: async () => "ok" }),
    ).rejects.toThrow("connection lost");
    expect(manager.releaseConnection).toHaveBeenCalledTimes(1);
  });

  test("P8-03: the default sleep really waits", async () => {
    const { sequelize } = scripted([false, true]);
    const started = Date.now();
    await withSchemaLock({ sequelize, logger: logger(), fn: async () => 1, pollMs: 20 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});

describe("P8-03 resolveTimeoutMs", () => {
  test.each([
    [{}, DEFAULT_TIMEOUT_MS],
    [{ MIGRATION_LOCK_TIMEOUT_MS: "" }, DEFAULT_TIMEOUT_MS],
    [{ MIGRATION_LOCK_TIMEOUT_MS: "30000" }, 30000],
  ])("P8-03: %j -> %d", (env, expected) => {
    expect(resolveTimeoutMs(env)).toBe(expected);
  });

  test.each(["0", "-5", "10s", "1.5"])("P8-03: refuses %s", (value) => {
    expect(() => resolveTimeoutMs({ MIGRATION_LOCK_TIMEOUT_MS: value })).toThrow(
      /not a positive integer/,
    );
  });

  test("P8-03: reads process.env by default", () => {
    const before = process.env.MIGRATION_LOCK_TIMEOUT_MS;
    process.env.MIGRATION_LOCK_TIMEOUT_MS = "1234";
    try {
      expect(resolveTimeoutMs()).toBe(1234);
    } finally {
      if (before === undefined) {
        delete process.env.MIGRATION_LOCK_TIMEOUT_MS;
      } else {
        process.env.MIGRATION_LOCK_TIMEOUT_MS = before;
      }
    }
  });
});

describe("P8-03 runSchemaSetup", () => {
  test("P8-03: sync, then the migrator, both inside the lock; logs what it applied", async () => {
    const { sequelize, calls } = scripted([true]);
    sequelize.sync = jest.fn(async () => calls.push({ sql: "SYNC" }));
    const migrator = {
      up: jest.fn(async () => {
        calls.push({ sql: "UP" });
        return [{ name: "0091-x.js" }, { name: "0092-y.js" }];
      }),
    };
    const log = logger();
    await expect(runSchemaSetup({ sequelize, migrator, logger: log })).resolves.toEqual([
      { name: "0091-x.js" },
      { name: "0092-y.js" },
    ]);
    expect(calls.map((c) => c.sql)).toEqual([
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      "SYNC",
      "UP",
      "SELECT pg_advisory_unlock($1::bigint)",
    ]);
    expect(log.info).toHaveBeenCalledWith("All database tables synced");
    expect(log.info).toHaveBeenCalledWith("Applied 2 migration(s): 0091-x.js, 0092-y.js");
  });

  test("P8-03: nothing pending logs no 'Applied' line; lockOptions reach the lock", async () => {
    const { sequelize } = scripted([false, true]);
    const sleep = jest.fn(async () => {});
    const log = logger();
    const applied = await runSchemaSetup({
      sequelize,
      migrator: { up: async () => [] },
      logger: log,
      lockOptions: { sleep, pollMs: 7 },
    });
    expect(applied).toEqual([]);
    expect(sleep).toHaveBeenCalledWith(7);
    expect(log.info.mock.calls.some(([m]) => /^Applied/.test(m))).toBe(false);
  });

  test("P8-03: backend/index.js runs the schema step through runSchemaSetup, not a bare sync", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../../index.js"), "utf8");
    expect(source).toMatch(/await runSchemaSetup\(\{ sequelize: db, migrator, logger \}\)/);
    expect(source).not.toMatch(/await db\.sync\(\)/);
    expect(source).not.toMatch(/await migrator\.up\(\)/);
  });
});
