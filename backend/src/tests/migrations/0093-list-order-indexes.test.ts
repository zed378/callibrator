/**
 * Migration 0093 — per-tenant ORDER BY indexes for the lists (P8-04, ADR-096).
 *
 * Runs the migration against a fake QueryInterface over an in-memory catalog,
 * as the 0062 test does. It proves the LOGIC: each index is built
 * CONCURRENTLY, a valid one is kept, an INVALID one (an interrupted concurrent
 * build) is dropped and rebuilt, `down` drops exactly these, a failure
 * propagates, and no model declares an index that only this migration creates.
 *
 * The SQL ran on PostgreSQL 18 (pgvector/pgvector:pg18) over the P8-07 volume;
 * the before/after plans are in ADR-096.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the migration module under test (export =)
const migration = require("../../migrations/0093-list-order-indexes") as {
  INDEXES: readonly { name: string; table: string; columns: string }[];
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
};

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0093-list-order-indexes.ts"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

const EXPECTED = [
  'CREATE INDEX CONCURRENTLY "calibration_records_tenant_id_calibration_date" ON calibration_records (tenant_id, calibration_date DESC)',
  'CREATE INDEX CONCURRENTLY "certificates_tenant_id_created_at" ON certificates (tenant_id, created_at DESC)',
  'CREATE INDEX CONCURRENTLY "calibration_devices_tenant_id_name" ON calibration_devices (tenant_id, name)',
  'CREATE INDEX CONCURRENTLY "maintenance_work_orders_tenant_id_created_at" ON maintenance_work_orders (tenant_id, created_at DESC)',
  'CREATE INDEX CONCURRENTLY "attachments_tenant_id_created_at" ON attachments (tenant_id, created_at DESC)',
  'CREATE INDEX CONCURRENTLY "stocks_tenant_id_item_name" ON stocks (tenant_id, item_name)',
];

interface FakeQi {
  state: { catalog: Map<string, boolean>; ddl: string[] };
  sequelize: { query: jest.Mock };
}

const fakeQueryInterface = (catalog: Record<string, boolean> = {}, failOn: string | null = null): FakeQi => {
  const state = { catalog: new Map(Object.entries(catalog)), ddl: [] as string[] };
  return {
    state,
    sequelize: {
      query: jest.fn((sql: string, options?: { replacements?: { tables?: string[] } }) => {
        if (sql.includes("FROM pg_index")) {
          expect(options?.replacements?.tables).toEqual([
            "calibration_records",
            "certificates",
            "calibration_devices",
            "maintenance_work_orders",
            "attachments",
            "stocks",
          ]);
          return Promise.resolve([[...state.catalog].map(([name, valid]) => ({ name, valid }))]);
        }
        if (failOn !== null && sql.includes(failOn)) {
          return Promise.reject(new Error("canceling statement due to lock timeout"));
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

describe("migration 0093 — list ORDER BY indexes (P8-04)", () => {
  it("is registered in the static manifest under its .js name (P9-23)", () => {
    expect(MANIFEST).toContain('["0093-list-order-indexes.js", require("../migrations/0093-list-order-indexes")]');
  });

  it("has no catch: a failure fails the migration instead of recording it as applied", () => {
    expect(SOURCE).not.toMatch(/\.catch\(/);
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });

  it("builds the six indexes CONCURRENTLY, in the shapes the lists order by", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual(EXPECTED);
  });

  it("a second up changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    const after = qi.state.ddl.length;

    await migration.up({ context: qi });

    expect(qi.state.ddl).toHaveLength(after);
  });

  it("an INVALID index left by an interrupted concurrent build is dropped and rebuilt, never kept", async () => {
    const valid = Object.fromEntries(migration.INDEXES.map((x) => [x.name, true]));
    const qi = fakeQueryInterface({ ...valid, certificates_tenant_id_created_at: false });

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS "certificates_tenant_id_created_at"',
      EXPECTED[1],
    ]);
  });

  it("a failing build propagates", async () => {
    const qi = fakeQueryInterface({}, "certificates_tenant_id_created_at");

    await expect(migration.up({ context: qi })).rejects.toThrow(/lock timeout/);
  });

  it("down drops exactly the six indexes it added", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    qi.state.ddl.length = 0;

    await migration.down({ context: qi });

    expect(qi.state.ddl).toEqual(migration.INDEXES.map((x) => `DROP INDEX CONCURRENTLY IF EXISTS "${x.name}"`));
  });

  it("no model declares an index this migration creates (sync() runs first; D-13)", () => {
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
