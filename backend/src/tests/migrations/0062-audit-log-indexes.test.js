/**
 * Migration 0062 — audit_logs indexes (D-08).
 *
 * Runs the migration against a fake QueryInterface over an in-memory catalog.
 * It proves the LOGIC: the three indexes are built CONCURRENTLY, an existing
 * valid index is kept, an INVALID one (an interrupted concurrent build) is
 * dropped and rebuilt, `down` drops only what it added, and a failure
 * propagates.
 *
 * The SQL was run against PostgreSQL 16.13 (not 18) on a database built by
 * db.sync() + every migration and then seeded with 400,000 audit rows across
 * 20 tenants (170 MB):
 *   before — the tenant list (ORDER BY created_at DESC LIMIT 50), the
 *            resource lookup and the GDPR subject export were Parallel Seq
 *            Scans (65 / 59 / 54 ms); a user DELETE spent 74 ms in its
 *            RESTRICT checks;
 *   after  — Index Scan using audit_logs_tenant_id_created_at (0.33 ms),
 *            Index Only Scan using audit_logs_tenant_id_resource (0.06 ms),
 *            Bitmap Index Scan on audit_logs_user_id (1.6 ms); the user
 *            DELETE took 9 ms.
 * An index marked invalid by hand (pg_index.indisvalid = false) was rebuilt
 * by a re-run; down/up converged; a fresh database built all three.
 */
const fs = require("fs");
const path = require("path");

const migration = require("../../migrations/0062-audit-log-indexes");

const SOURCE = fs.readFileSync(path.join(__dirname, "../../migrations/0062-audit-log-indexes.js"), "utf8");
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const fakeQueryInterface = (catalog = { audit_logs_pkey: true }, { failOn = null } = {}) => {
  const state = { catalog: new Map(Object.entries(catalog)), ddl: [] };
  const qi = {
    state,
    sequelize: {
      query: jest.fn(async (sql, options) => {
        if (/FROM pg_index/.test(sql)) {
          expect(options).toEqual({ replacements: { table: "audit_logs" } });
          return [[...state.catalog].map(([name, valid]) => ({ name, valid }))];
        }
        if (failOn && sql.includes(failOn)) {
          throw new Error("canceling statement due to lock timeout");
        }
        state.ddl.push(sql);
        const created = /^CREATE INDEX CONCURRENTLY "([^"]+)"/.exec(sql);
        if (created) {
          state.catalog.set(created[1], true);
        }
        const dropped = /^DROP INDEX CONCURRENTLY IF EXISTS "([^"]+)"/.exec(sql);
        if (dropped) {
          state.catalog.delete(dropped[1]);
        }
        return [[]];
      }),
    },
  };
  return qi;
};

describe("migration 0062 — audit_logs indexes (D-08)", () => {
  it("is registered in the static manifest under its .js name", () => {
    expect(MANIFEST).toContain(
      '["0062-audit-log-indexes.js", require("../migrations/0062-audit-log-indexes")]',
    );
  });

  it("has no catch: a failure fails the migration instead of recording it as applied", () => {
    expect(SOURCE).not.toMatch(/\.catch\(/);
    expect(SOURCE).not.toMatch(/\btry\s*\{/);
  });

  it("builds the three indexes CONCURRENTLY, with the shapes the audit queries need", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([
      'CREATE INDEX CONCURRENTLY "audit_logs_tenant_id_created_at" ON audit_logs (tenant_id, created_at DESC)',
      'CREATE INDEX CONCURRENTLY "audit_logs_tenant_id_resource" ON audit_logs (tenant_id, resource_type, resource_id)',
      'CREATE INDEX CONCURRENTLY "audit_logs_user_id" ON audit_logs (user_id)',
    ]);
  });

  it("a second up changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    const after = qi.state.ddl.length;

    await migration.up({ context: qi });

    expect(qi.state.ddl).toHaveLength(after);
  });

  it("an INVALID index left by an interrupted concurrent build is dropped and rebuilt, never kept", async () => {
    const qi = fakeQueryInterface({
      audit_logs_tenant_id_created_at: true,
      audit_logs_tenant_id_resource: true,
      audit_logs_user_id: false,
    });

    await migration.up({ context: qi });

    expect(qi.state.ddl).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_user_id"',
      'CREATE INDEX CONCURRENTLY "audit_logs_user_id" ON audit_logs (user_id)',
    ]);
  });

  it("a failing build propagates", async () => {
    const qi = fakeQueryInterface({}, { failOn: "audit_logs_tenant_id_resource" });

    await expect(migration.up({ context: qi })).rejects.toThrow(/lock timeout/);
  });

  it("down drops exactly the three indexes it added", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: qi });
    qi.state.ddl.length = 0;

    await migration.down({ context: qi });

    expect(qi.state.ddl).toEqual([
      'DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_tenant_id_created_at"',
      'DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_tenant_id_resource"',
      'DROP INDEX CONCURRENTLY IF EXISTS "audit_logs_user_id"',
    ]);
    expect([...qi.state.catalog.keys()]).toEqual(["audit_logs_pkey"]);
  });
});
