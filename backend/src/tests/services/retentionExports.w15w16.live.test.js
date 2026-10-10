/**
 * W-15 and W-16 against a REAL PostgreSQL 18 — the nightly retention sweep
 * (dataRetention.service#runRetentionSweep) as the scheduler runs it.
 *
 *  - W-16: a tenant whose `retention_policy_notifications` is "forever" used
 *    to never purge (NaN cutoff), with only a counter in a log line. It now
 *    purges on the platform default, and the sweep reports the anomaly.
 *  - W-15: a GDPR export whose process died (so no timer exists anywhere) is
 *    deleted by the sweep, and the audit row it writes is accepted by the real
 *    table: migration 0033's actor CHECK, the NOT NULL columns, the ENUM.
 *
 * The export directory is a temporary one (storagePath is redirected); the
 * database is real.
 *
 * NEEDS a database built by db.sync() of the current models plus
 * every migration (migrator.up()):
 *
 *   DB_HOST=... DB_PORT=... DB_USER=... DB_PASS=... \
 *     npm run test:live:jest -- src/tests/services/retentionExports.w15w16.live
 *
 * ADR-095 O-2: the suite creates its OWN database (DB_USER needs CREATEDB;
 * DB_NAME is not used), builds it as the backend boots (db.sync() + every
 * migration, 0091's append-only audit_logs included) and runs as
 * `callibrator_app` through enterApplicationRole. Its audit rows cannot be
 * deleted, so it does not clean up: the database is dropped afterwards
 * (fixtures/disposableDatabase.ts, fixtures/liveBoot.ts).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const mockExportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "w15-live-"));
jest.mock("../../utils/storagePath.util", () => (...parts) => require("path").join(mockExportRoot, ...parts));

const { createDisposableDatabase, LIVE_BOOT_TIMEOUT_MS } = require("../fixtures/disposableDatabase");
const { bootSchemaAsApplicationRole } = require("../fixtures/liveBoot");

const A = "15161516-0000-4000-8000-0000000000a1"; // the malformed setting
const B = "15161516-0000-4000-8000-0000000000b1"; // a well-formed neighbour
const USER_A = "15161516-0000-4000-8000-0000000000e1";

describe("W-15 / W-16 — the retention sweep on live PostgreSQL", () => {
  jest.setTimeout(120000);
  let db;
  let scratch;
  let retention;

  const q = async (sql, replacements = {}) => (await db.query(sql, { replacements }))[0];
  const count = async (sql, replacements) => Number((await q(sql, replacements))[0].n);

  beforeAll(async () => {
    scratch = await createDisposableDatabase("w15");
    ({ db } = require("../../config"));
    db.options.logging = false;
    require("../../models");
    await bootSchemaAsApplicationRole(db);
    retention = require("../../services/dataRetention.service");
    for (const [id, sub] of [[A, "w16-live-a"], [B, "w16-live-b"]]) {
      await q(
        `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
         VALUES (:id, :sub, :sub, :email, now(), now())`,
        { id, sub, email: `${sub}@example.test` },
      );
    }
    await q(
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, created_at, updated_at)
       VALUES (:id, :t, 'w15live', 'w15live@example.test', 'x', 'W', '15', now(), now())`,
      { id: USER_A, t: A },
    );
  }, LIVE_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (db) {
      await db.close();
    }
    if (scratch) {
      await scratch.drop();
    }
    fs.rmSync(mockExportRoot, { recursive: true, force: true });
  }, LIVE_BOOT_TIMEOUT_MS);

  it("W-16: a tenant with retention_policy_notifications = 'forever' purges on the default (90 days), and the sweep reports it", async () => {
    await q(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, 'retention_policy_notifications', 'forever', now(), now())`,
      { t: A },
    );
    for (const tenantId of [A, B]) {
      for (const age of ["200 days", "10 days"]) {
        await q(
          `INSERT INTO notifications (id, tenant_id, type, title, message, created_at, updated_at)
           VALUES (gen_random_uuid(), :t, 'SYSTEM', 'w16', 'w16', now() - interval '${age}', now())`,
          { t: tenantId },
        );
      }
    }

    const summary = await retention.runRetentionSweep();

    // Both tenants lost their 200-day-old row and kept the 10-day-old one.
    for (const tenantId of [A, B]) {
      expect(await count("SELECT count(*)::int AS n FROM notifications WHERE tenant_id = :t", { t: tenantId })).toBe(1);
    }
    expect(summary.anomalies).toBeGreaterThanOrEqual(1);
    expect(summary.errors).toBe(0);
    // A's purge is recorded like any other, with the default it applied.
    const [row] = await q(
      `SELECT changes FROM audit_logs
        WHERE tenant_id = :t AND resource_type = 'DataRetention' AND actor_name = 'system:retention-purge'`,
      { t: A },
    );
    expect(row.changes.after.purged).toEqual({ notifications: 1 });
    expect(row.changes.before.retentionDays.notifications).toBe(90);
  });

  it("W-15: an expired export whose process died is deleted by the sweep, and its audit row is accepted by the table", async () => {
    const dir = path.join(mockExportRoot, "exports");
    fs.mkdirSync(dir, { recursive: true });
    const created = Date.now() - 200 * 3600000;
    const id = `export-${created}-a1b2c3d4`;
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify({
        exportId: id,
        tenantId: A,
        userId: USER_A,
        createdAt: new Date(created).toISOString(),
        expiresAt: new Date(created + 168 * 3600000).toISOString(),
      }),
    );
    fs.writeFileSync(path.join(dir, `${id}.zip`), "PK personal data");

    const summary = await retention.runRetentionSweep();

    expect(summary.exportsDeleted).toBe(1);
    expect(summary.exportErrors).toBe(0);
    expect(fs.readdirSync(dir)).toEqual([]);
    const rows = await q(
      `SELECT tenant_id, user_id, actor_type, actor_name, action, resource_id, changes
         FROM audit_logs WHERE tenant_id = :t AND resource_type = 'DataExport'`,
      { t: A },
    );
    expect(rows).toEqual([
      {
        tenant_id: A,
        user_id: null,
        actor_type: "system",
        actor_name: "system:retention-purge",
        action: "DELETE",
        resource_id: id,
        changes: expect.objectContaining({ operation: "GDPR_EXPORT_EXPIRED", subjectUserId: USER_A }),
      },
    ]);
  });
});
