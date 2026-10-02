/**
 * P8-03 (ADR-086) — two backend instances starting together, against a REAL
 * PostgreSQL: one migration run, the other instance waits, and the result is
 * verified by inspecting columns (P6-05), not by reading the migration log.
 *
 * Each "instance" is a separately loaded copy of config/index.js (its own
 * Sequelize, its own pool) + config/migrator.js + utils/migrationLock.util.js,
 * the way two replicas each load their own. Both run runSchemaSetup — the
 * function backend/index.js boots through — at the same moment.
 *
 * OPT-IN — needs a scratch database the connecting role owns; its `public`
 * schema is DROPPED and recreated, so the name must contain "scratch":
 *
 *   MIGRATION_LOCK_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=31432 \
 *     DB_NAME=callibrator_p8_scratch DB_USER=postgres DB_PASS=p8pass \
 *     npm test -- src/tests/utils/migrationLock.p803.live --coverage=false
 *
 * Run on pgvector/pgvector:pg18 (PostgreSQL 18).
 */

const live = process.env.MIGRATION_LOCK_LIVE_TEST === "1" ? describe : describe.skip;

const startInstance = (label, messages) => {
  let graph;
  jest.isolateModules(() => {
    const { db } = require("../../config");
    db.options.logging = false;
    // the models define what db.sync() creates, as app.js's require chain does at boot
    require("../../models");
    graph = {
      label,
      db,
      migrator: require("../../config/migrator").migrator,
      lock: require("../../utils/migrationLock.util"),
      schemaVerify: require("../../utils/schemaVerify.util"),
    };
  });
  graph.logger = {
    info: (m) => messages.push({ label, at: Date.now(), m }),
    warn: (m) => messages.push({ label, at: Date.now(), m }),
    error: (m) => messages.push({ label, at: Date.now(), m }),
  };
  return graph;
};

live("P8-03 schema lock — two instances, real PostgreSQL", () => {
  jest.setTimeout(300000);
  const messages = [];
  let a;
  let b;

  beforeAll(async () => {
    if (!/scratch/.test(process.env.DB_NAME || "")) {
      throw new Error("MIGRATION_LOCK_LIVE_TEST needs a DB_NAME containing 'scratch'");
    }
    a = startInstance("A", messages);
    b = startInstance("B", messages);
    await a.db.query("DROP SCHEMA public CASCADE");
    await a.db.query("CREATE SCHEMA public");
  });

  afterAll(async () => {
    await a?.db.close();
    await b?.db.close();
  });

  test("P8-03: two instances starting simultaneously produce ONE migration run; the other waits and applies nothing", async () => {
    const [appliedA, appliedB] = await Promise.all([
      a.lock.runSchemaSetup({ sequelize: a.db, migrator: a.migrator, logger: a.logger, lockOptions: { pollMs: 50 } }),
      b.lock.runSchemaSetup({ sequelize: b.db, migrator: b.migrator, logger: b.logger, lockOptions: { pollMs: 50 } }),
    ]);

    const namesA = appliedA.map((m) => m.name);
    const namesB = appliedB.map((m) => m.name);
    // exactly one instance migrated; the other found nothing pending
    expect([namesA.length === 0, namesB.length === 0].filter(Boolean)).toHaveLength(1);
    const winner = namesA.length ? "A" : "B";
    const loser = winner === "A" ? "B" : "A";
    const applied = [...namesA, ...namesB];
    expect(new Set(applied).size).toBe(applied.length);

    // every migration recorded once, and the record matches what was applied
    const [rows] = await a.db.query("SELECT name FROM schema_migrations ORDER BY name");
    expect(rows.map((r) => r.name).sort()).toEqual([...applied].sort());
    const pending = await a.migrator.pending();
    expect(pending).toEqual([]);

    // the loser WAITED: it announced the wait, and its own sync started only
    // after the winner had logged its applied migrations
    const waited = messages.find((x) => x.label === loser && /another instance is migrating/.test(x.m));
    expect(waited).toBeDefined();
    const winnerApplied = messages.find((x) => x.label === winner && /^Applied \d+ migration/.test(x.m));
    const loserSynced = messages.find((x) => x.label === loser && x.m === "All database tables synced");
    expect(winnerApplied).toBeDefined();
    expect(loserSynced.at).toBeGreaterThanOrEqual(winnerApplied.at);
    expect(messages.some((x) => x.label === loser && /^Applied/.test(x.m))).toBe(false);
  });

  test("P8-03: the run is verified by inspecting columns (P6-05), not by the migration log", async () => {
    const result = await a.schemaVerify.assertSchemaMatchesModels({
      sequelize: a.db,
      logger: a.logger,
      mode: "strict",
    });
    expect(result.problems).toEqual([]);
    expect(result.tables).toBeGreaterThan(60);
    expect(result.objects).toBeGreaterThan(0);
  });

  test("P8-03: the lock is free afterwards — a third boot takes it at once and applies nothing", async () => {
    const before = messages.length;
    const applied = await b.lock.runSchemaSetup({ sequelize: b.db, migrator: b.migrator, logger: b.logger });
    expect(applied).toEqual([]);
    expect(messages.slice(before).some((x) => /another instance is migrating/.test(x.m))).toBe(false);
    const [[{ n }]] = await a.db.query(
      "SELECT COUNT(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'",
    );
    expect(n).toBe(0);
  });
  test("P8-03: `npm run migrate` (scripts/migrate.ts up) WAITS for a held lock, then runs and exits 0", async () => {
    const { spawn } = require("child_process");
    const path = require("path");
    const holder = await a.db.connectionManager.getConnection({ type: "write" });
    await holder.query("SELECT pg_advisory_lock($1::bigint)", [a.lock.MIGRATION_LOCK_KEY]);
    let output = "";
    // ADR-087 Amendment 4: `--import tsx` — the script loads TypeScript modules
    // (the logger among them); plain `node` cannot resolve them.
    const child = spawn(process.execPath, ["--import", "tsx", path.join(__dirname, "../../scripts/migrate.ts"), "up"], {
      cwd: path.join(__dirname, "../../.."),
      env: { ...process.env, NODE_ENV: "test" },
    });
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const exited = new Promise((resolve) => child.on("exit", resolve));
    try {
      const early = await Promise.race([exited, new Promise((r) => setTimeout(() => r("still-waiting"), 4000))]);
      expect(early).toBe("still-waiting");
      expect(output).toMatch(/another instance is migrating the schema; waiting/);
    } finally {
      await holder.query("SELECT pg_advisory_unlock($1::bigint)", [a.lock.MIGRATION_LOCK_KEY]);
      a.db.connectionManager.releaseConnection(holder);
    }
    await expect(exited).resolves.toBe(0);
    expect(output).toMatch(/lock acquired after waiting/);
  });
});
