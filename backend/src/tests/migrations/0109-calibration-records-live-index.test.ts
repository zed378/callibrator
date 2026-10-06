/**
 * Migration 0109 — the live calibration records' partial covering index (U-06, ADR-119).
 *
 * Runs the migration against a fake QueryInterface over an in-memory catalog,
 * as the 0093 test does. It proves the LOGIC: the index is built CONCURRENTLY
 * in exactly its shape, a valid one is kept, an INVALID one (an interrupted
 * concurrent build) is dropped and rebuilt, `down` drops it, a failure
 * propagates, and no model declares it.
 *
 * The SQL ran on PostgreSQL 18 (pgvector/pgvector:pg18) over the P8-07 volume —
 * up, down, up and a no-op up through the migrator, then `migrate:verify`
 * and the plans as `callibrator_app`; the numbers are in the U-06 record.
 */
import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the migration module under test (export =)
const migration = require("../../migrations/0109-calibration-records-live-index") as {
  NAME: string;
  TABLE: string;
  DEFINITION: string;
  up(o: { context: unknown }): Promise<void>;
  down(o: { context: unknown }): Promise<void>;
};

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0109-calibration-records-live-index.ts"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");

const CREATE =
  'CREATE INDEX CONCURRENTLY "calibration_records_tenant_live_date" ON calibration_records ' +
  "(tenant_id, calibration_date DESC, is_compliant, superseded_by_id) " +
  "WHERE is_deleted = false AND deleted_at IS NULL";
const DROP = 'DROP INDEX CONCURRENTLY IF EXISTS "calibration_records_tenant_live_date"';

interface FakeQi {
  state: { catalog: Map<string, boolean>; ddl: string[] };
  sequelize: { query: jest.Mock };
}

const fakeQueryInterface = (catalog: Record<string, boolean> = {}, failOnCreate = false): FakeQi => {
  const state = { catalog: new Map(Object.entries(catalog)), ddl: [] as string[] };
  return {
    state,
    sequelize: {
      query: jest.fn((sql: string, options?: { replacements?: { name?: string; table?: string } }) => {
        if (sql.includes("FROM pg_index")) {
          expect(options?.replacements).toEqual({ name: "calibration_records_tenant_live_date", table: "calibration_records" });
          const valid = state.catalog.get("calibration_records_tenant_live_date");
          return Promise.resolve([valid === undefined ? [] : [{ valid }]]);
        }
        if (failOnCreate && sql.startsWith("CREATE INDEX")) {
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

describe("migration 0109 — the live calibration records index (U-06)", () => {
  it("is registered in the static manifest under its .js name, after 0108 (P9-23)", () => {
    const entry = '["0109-calibration-records-live-index.js", require("../migrations/0109-calibration-records-live-index")]';
    expect(MANIFEST).toContain(entry);
    expect(MANIFEST.indexOf(entry)).toBeGreaterThan(MANIFEST.indexOf('"0108-tenant-backup-name-description.js"'));
  });

  it("has no catch: a failure fails the migration instead of recording it as applied", () => {
    expect(SOURCE).not.toMatch(/\.catch\(/);
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });

  it("builds the index CONCURRENTLY, partial on the live-record predicate and covering the counted columns", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([CREATE]);
  });

  it("a second up changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([CREATE]);
  });

  it("an INVALID index left by an interrupted concurrent build is dropped and rebuilt, never kept", async () => {
    const qi = fakeQueryInterface({ calibration_records_tenant_live_date: false });

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([DROP, CREATE]);
  });

  it("a failing build propagates", async () => {
    const qi = fakeQueryInterface({}, true);

    await expect(migration.up({ context: qi })).rejects.toThrow(/lock timeout/);
  });

  it("down drops exactly the index it added", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    qi.state.ddl.length = 0;

    await migration.down({ context: qi });

    expect(qi.state.ddl).toEqual([DROP]);
    expect(qi.state.catalog.has("calibration_records_tenant_live_date")).toBe(false);
  });

  it("no model declares it (sync() runs first; D-13, the ADR-100 Am. 3 trap)", () => {
    const models = path.join(__dirname, "../../models");
    const text = fs
      .readdirSync(models)
      .filter((f) => /\.model\.(js|ts)$/.test(f))
      .map((f) => fs.readFileSync(path.join(models, f), "utf8"))
      .join("\n");
    expect(text).not.toContain(migration.NAME);
  });
});
