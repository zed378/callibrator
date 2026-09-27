/**
 * W-20 against a REAL PostgreSQL 18 — a tenant's hard delete cannot erase its
 * audit trail.
 *
 * The card: `hardDeleteOffboardedTenant` ran with no transaction and no audit
 * row, and `audit_logs.tenant_id` was ON DELETE CASCADE, so deleting the
 * tenant row deleted every audit row it ever had. Fixed by two earlier cards,
 * verified here on the database itself:
 *  - A-121/A-122, migration 0030: `audit_logs.tenant_id` is ON DELETE RESTRICT
 *    (the database refuses the tenant delete while an audit row names it);
 *  - D-23 (ADR-064): the hard delete is one transaction that refuses (409),
 *    naming each retained table, while any regulated record remains, and
 *    writes its own audit row when it does run.
 *
 * OPT-IN — needs a database built by db.sync() of the current models plus
 * every migration (migrator.up()):
 *
 *   W20_PG_LIVE_TEST=1 DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASS=... \
 *     npm test -- src/tests/services/tenantHardDelete.w20.live --coverage=false
 */
const live = process.env.W20_PG_LIVE_TEST === "1" ? describe : describe.skip;

const T = "20202020-0000-4000-8000-0000000000a1";

live("W-20 — the audit trail survives a tenant delete (live PostgreSQL)", () => {
  jest.setTimeout(60000);
  let db;

  const q = async (sql, replacements = {}) => (await db.query(sql, { replacements }))[0];
  const auditRows = async () =>
    Number((await q("SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = :t", { t: T }))[0].n);

  const cleanup = async () => {
    // audit rows are append-only in spirit; this test's own rows are removed
    // so a re-run starts clean.
    await q("DELETE FROM audit_logs WHERE tenant_id = :t", { t: T });
    await q("DELETE FROM tenants WHERE id = :t", { t: T });
  };

  beforeAll(async () => {
    ({ db } = require("../../config"));
    db.options.logging = false;
    require("../../models");
    await cleanup();
    await q(
      `INSERT INTO tenants (id, name, subdomain, email, status, offboarded_at, offboard_retention_expires_at, created_at, updated_at)
       VALUES (:t, 'w20-live', 'w20-live', 'w20@example.test', 'deleted', now() - interval '60 days', now() - interval '30 days', now(), now())`,
      { t: T },
    );
    await q(
      `INSERT INTO audit_logs (id, tenant_id, actor_type, actor_name, action, resource_type, resource_id, changes, created_at)
       VALUES (gen_random_uuid(), :t, 'system', 'system:tenant-lifecycle', 'UPDATE', 'Tenant', :t, '{"operation":"TENANT_OFFBOARD"}', now())`,
      { t: T },
    );
  });

  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.close();
    }
  });

  it("the constraint itself: audit_logs.tenant_id is ON DELETE RESTRICT", async () => {
    const [fk] = await q(
      `SELECT c.confdeltype
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'audit_logs'::regclass AND c.contype = 'f' AND a.attname = 'tenant_id'`,
    );
    expect(fk.confdeltype).toBe("r"); // r = RESTRICT (c would be CASCADE)
  });

  it("a raw DELETE of the tenant row is refused by the database, and the audit row is still there", async () => {
    // 23001 restrict_violation (RESTRICT is checked at once, not deferred).
    const err = await q("DELETE FROM tenants WHERE id = :t", { t: T }).catch((e) => e);
    expect(err.original.code).toBe("23001");
    expect(err.message).toContain('violates RESTRICT setting of foreign key constraint "audit_logs_tenant_id_fkey"');
    expect(await auditRows()).toBe(1);
  });

  it("hardDeleteOffboardedTenant refuses with 409 naming audit_logs, deletes nothing, and the trail is intact", async () => {
    const { hardDeleteOffboardedTenant } = require("../../services/tenantLifecycle.service");

    const err = await hardDeleteOffboardedTenant(T).catch((e) => e);

    expect(err.status).toBe(409);
    expect(err.message).toContain("audit_logs (1)");
    expect(err.message).toContain("Nothing was deleted");
    expect(await auditRows()).toBe(1);
    expect((await q("SELECT count(*)::int AS n FROM tenants WHERE id = :t", { t: T }))[0].n).toBe(1);
  });
});
