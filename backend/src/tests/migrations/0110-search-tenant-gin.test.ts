/**
 * Migration 0110 — the full-text search GIN indexes are per tenant (U-06b, ADR-120).
 *
 * Runs the migration against a fake QueryInterface over an in-memory catalog,
 * as the 0093 and 0109 tests do. It proves the LOGIC: the extension first,
 * each per-tenant index built CONCURRENTLY BEFORE 0003's index is dropped, a
 * valid one kept, an INVALID one rebuilt, `down` restoring 0003's indexes
 * before dropping the new ones, a failure propagating, no catch, no model.
 *
 * The SQL ran on PostgreSQL 18 (pgvector/pgvector:pg18) over the P8-07 volume —
 * up, down, up and a no-op up through the migrator, `migrate:verify`, a reboot
 * (db.sync's showIndex), and the plans as `callibrator_app`; the numbers are in
 * the U-06b record.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the migration module under test (export =)
const migration = require("../../migrations/0110-search-tenant-gin") as {
  INDEXES: readonly { table: string; name: string; replaces: string }[];
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
};

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0110-search-tenant-gin.ts"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

const TABLES = ["calibration_devices", "stocks", "certificates"];
const EXT = "CREATE EXTENSION IF NOT EXISTS btree_gin";
const create = (t: string): string => `CREATE INDEX CONCURRENTLY "${t}_tenant_id_search_vector" ON ${t} USING gin (tenant_id, search_vector)`;
const dropNew = (t: string): string => `DROP INDEX CONCURRENTLY IF EXISTS "${t}_tenant_id_search_vector"`;
const dropOld = (t: string): string => `DROP INDEX CONCURRENTLY IF EXISTS "idx_${t}_search"`;
const createOld = (t: string): string => `CREATE INDEX CONCURRENTLY "idx_${t}_search" ON "${t}" USING GIN ("search_vector")`;

/** 0003's three indexes, valid — the state 0110 starts from. */
const AFTER_0003 = Object.fromEntries(TABLES.map((t) => [`idx_${t}_search`, true]));

interface FakeQi {
  state: { catalog: Map<string, boolean>; ddl: string[] };
  sequelize: { query: jest.Mock };
}

const fakeQueryInterface = (catalog: Record<string, boolean> = AFTER_0003, failOn: RegExp | null = null): FakeQi => {
  const state = { catalog: new Map(Object.entries(catalog)), ddl: [] as string[] };
  return {
    state,
    sequelize: {
      query: jest.fn((sql: string, options?: { replacements?: { tables?: string[] } }) => {
        if (sql.includes("FROM pg_index")) {
          expect(options?.replacements).toEqual({ tables: TABLES });
          return Promise.resolve([[...state.catalog].map(([name, valid]) => ({ name, valid }))]);
        }
        if (failOn?.test(sql)) {
          return Promise.reject(new Error('permission denied to create extension "btree_gin"'));
        }
        state.ddl.push(sql);
        const created = /^CREATE INDEX CONCURRENTLY "([^"]+)"/.exec(sql);
        if (created?.[1]) {
          state.catalog.set(created[1], true);
        }
        const dropped = /^DROP INDEX CONCURRENTLY IF EXISTS "([^"]+)"/.exec(sql);
        if (dropped?.[1]) {
          state.catalog.delete(dropped[1]);
        }
        return Promise.resolve([[]]);
      }),
    },
  };
};

const UP = [EXT, ...TABLES.flatMap((t) => [create(t), dropOld(t)])];

describe("migration 0110 — per-tenant full-text search indexes (U-06b)", () => {
  it("is registered in the static manifest under its .js name, after 0109 (P9-23)", () => {
    const entry = '["0110-search-tenant-gin.js", require("../migrations/0110-search-tenant-gin")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0109-calibration-records-live-index.js"'));
  });

  it("has no catch: a failure fails the migration instead of recording it as applied", () => {
    expect(SOURCE).not.toMatch(/\.catch\(/);
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });

  it("creates btree_gin, then per table builds (tenant_id, search_vector) CONCURRENTLY before dropping 0003's index", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual(UP);
    expect([...qi.state.catalog.keys()].sort()).toEqual(TABLES.map((t) => `${t}_tenant_id_search_vector`).sort());
  });

  it("a second up builds nothing (the extension and the drops are IF [NOT] EXISTS)", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    qi.state.ddl.length = 0;

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([EXT, ...TABLES.map(dropOld)]);
  });

  it("an INVALID index left by an interrupted concurrent build is dropped and rebuilt, never kept", async () => {
    const qi = fakeQueryInterface({ ...AFTER_0003, stocks_tenant_id_search_vector: false });

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([
      EXT,
      create("calibration_devices"),
      dropOld("calibration_devices"),
      dropNew("stocks"),
      create("stocks"),
      dropOld("stocks"),
      create("certificates"),
      dropOld("certificates"),
    ]);
  });

  it("a refused extension propagates, and no index is touched", async () => {
    const qi = fakeQueryInterface(AFTER_0003, /CREATE EXTENSION/);

    await expect(migration.up({ context: qi })).rejects.toThrow(/btree_gin/);
    expect(qi.state.ddl).toEqual([]);
    expect([...qi.state.catalog.keys()].sort()).toEqual(Object.keys(AFTER_0003).sort());
  });

  it("a failing build propagates before 0003's index is dropped", async () => {
    const qi = fakeQueryInterface(AFTER_0003, /CREATE INDEX CONCURRENTLY "calibration_devices/);

    await expect(migration.up({ context: qi })).rejects.toThrow();
    expect(qi.state.catalog.get("idx_calibration_devices_search")).toBe(true);
  });

  it("down restores 0003's indexes first, then drops the per-tenant ones, and keeps the extension", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    qi.state.ddl.length = 0;

    await migration.down({ context: qi });

    expect(qi.state.ddl).toEqual(TABLES.flatMap((t) => [createOld(t), dropNew(t)]));
    expect([...qi.state.catalog.keys()].sort()).toEqual(Object.keys(AFTER_0003).sort());
    expect(SOURCE).not.toMatch(/DROP EXTENSION/);
  });

  it("down keeps a valid 0003 index and rebuilds an INVALID one", async () => {
    const qi = fakeQueryInterface({
      idx_calibration_devices_search: true,
      idx_stocks_search: false,
      calibration_devices_tenant_id_search_vector: true,
      stocks_tenant_id_search_vector: true,
      certificates_tenant_id_search_vector: true,
    });

    await migration.down({ context: qi });

    expect(qi.state.ddl).toEqual([
      dropNew("calibration_devices"),
      dropOld("stocks"),
      createOld("stocks"),
      dropNew("stocks"),
      createOld("certificates"),
      dropNew("certificates"),
    ]);
  });

  it("no model declares them (sync() runs first; D-13, the ADR-100 Am. 3 trap)", () => {
    const models = path.join(__dirname, "../../models");
    const text = fs
      .readdirSync(models)
      .filter((f) => /\.model\.(js|ts)$/.test(f))
      .map((f) => fs.readFileSync(path.join(models, f), "utf8"))
      .join("\n");
    for (const { name } of migration.INDEXES) {
      expect(text).not.toContain(name);
    }
  });
});
