/**
 * W-12 / W-04 / W-17 against a REAL PostgreSQL 18 — background jobs declare
 * their tenant, audit what they change, and work in bounded batches.
 *
 * The unit suites prove which calls each job makes and in which context.
 * Only a real server proves the SQL those calls become:
 *  - the tenant predicate the hooks add inside runForTenant reaches a
 *    `DELETE ... WHERE id IN (SELECT id ... LIMIT n)` (Sequelize's form of a
 *    bounded destroy on PostgreSQL), so a job for tenant A deletes nothing of
 *    tenant B's even when its own `where` forgets the tenant;
 *  - an MQTT message naming tenant B for a device of tenant A writes nothing,
 *    anywhere; an anomaly for A writes its reading, its alert and one audit
 *    row that the 0033 CHECK accepts (`system:iot-ingest`);
 *  - the batch-job sweep's `UPDATE ... RETURNING` audits each job in its own
 *    tenant;
 *  - session cleanup deletes every expired session, platform operators'
 *    included, in batches;
 *  - the backup prune's composite keyset (tenant ASC, created_at DESC, id
 *    DESC) walks pages without skipping or repeating a row.
 *
 * OPT-IN — needs a database built by db.sync() of the current models plus
 * every migration (migrator.up()):
 *
 *   BACKGROUND_JOBS_PG_LIVE_TEST=1 DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASS=... \
 *     npm test -- src/tests/services/backgroundJobs.w12.live --coverage=false
 *
 * It creates two tenants with fixed ids and removes everything it wrote.
 */
const live = process.env.BACKGROUND_JOBS_PG_LIVE_TEST === "1" ? describe : describe.skip;

const A = "a12a12a1-0000-4000-8000-0000000000a1";
const B = "b12b12b1-0000-4000-8000-0000000000b1";
const USER_A = "a12a12a1-0000-4000-8000-0000000000e1";
const USER_B = "b12b12b1-0000-4000-8000-0000000000e2";
const DEVICE_A = "a12a12a1-0000-4000-8000-0000000000d1";

live("background jobs — tenant context, audit and bounds on live PostgreSQL (W-12, W-04, W-17)", () => {
  jest.setTimeout(60000);
  let db;
  let models;
  let runForTenant;

  const q = async (sql, replacements = {}) => (await db.query(sql, { replacements }))[0];
  const count = async (table, tenantId) =>
    Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = :t`, { t: tenantId }))[0].n);

  const cleanup = async () => {
    const t = [A, B];
    for (const table of [
      "audit_logs",
      "iot_readings",
      "notifications",
      "sessions",
      "batch_jobs",
      "tenant_backups",
      "tenant_settings",
      "calibration_devices",
    ]) {
      await q(`DELETE FROM ${table} WHERE tenant_id IN (:t)`, { t });
    }
    await q("DELETE FROM sessions WHERE user_id IN (:u)", { u: [USER_A, USER_B] });
    await q("DELETE FROM users WHERE id IN (:u)", { u: [USER_A, USER_B] });
    await q("DELETE FROM tenants WHERE id IN (:t)", { t });
  };

  beforeAll(async () => {
    ({ db } = require("../../config"));
    db.options.logging = false;
    models = require("../../models");
    ({ runForTenant } = require("../../utils/jobContext.util"));
    await cleanup();
    for (const [id, sub] of [
      [A, "w12-live-a"],
      [B, "w12-live-b"],
    ]) {
      await q(
        `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
         VALUES (:id, :sub, :sub, :email, now(), now())`,
        { id, sub, email: `${sub}@example.test` },
      );
    }
    for (const [id, tenantId, name] of [
      [USER_A, A, "w12a"],
      [USER_B, B, "w12b"],
    ]) {
      await q(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, created_at, updated_at)
         VALUES (:id, :tenantId, :name, :email, 'x', 'W', '12', now(), now())`,
        { id, tenantId, name, email: `${name}@example.test` },
      );
    }
    await q(
      `INSERT INTO calibration_devices (id, tenant_id, name, status, iot_enabled, reading_tolerance, created_at, updated_at)
       VALUES (:d, :t, 'Fridge probe', 'active', true, '{"temperature": {"max": 50}}', now(), now())`,
      { d: DEVICE_A, t: A },
    );
  });

  afterAll(async () => {
    if (db) {
      await cleanup();
      await db.close();
    }
  });

  describe("retention purge (W-12, W-17, W-04)", () => {
    const seedOld = async (tenantId, n) => {
      for (let i = 0; i < n; i += 1) {
        await q(
          `INSERT INTO notifications (id, tenant_id, type, title, message, created_at, updated_at)
           VALUES (gen_random_uuid(), :t, 'SYSTEM', 'old', 'old', now() - interval '200 days', now())`,
          { t: tenantId },
        );
      }
    };

    it("a destroy with NO tenant predicate inside runForTenant(A) deletes only A's rows, in a bounded statement", async () => {
      await seedOld(A, 3);
      await seedOld(B, 3);

      const deleted = await runForTenant(A, () =>
        models.Notification.destroy({ where: { title: "old" }, limit: 10 }),
      );

      expect(deleted).toBe(3);
      expect(await count("notifications", A)).toBe(0);
      expect(await count("notifications", B)).toBe(3);
      await q("DELETE FROM notifications WHERE tenant_id = :t", { t: B });
    });

    it("the sweep purges each tenant in batches, one audit row per pass, and never touches a tenant on hold", async () => {
      const retention = require("../../services/dataRetention.service");
      await seedOld(A, 3);
      await seedOld(B, 3);
      await q(
        `INSERT INTO tenant_settings (id, tenant_id, key, value, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, 'legal_hold_enabled', 'true', now(), now())`,
        { t: B },
      );

      const summary = await retention.runRetentionSweep({ batchSize: 2, pageSize: 1 });

      expect(summary).toMatchObject({ errors: 0, incomplete: 0 });
      expect(summary.tenants).toBeGreaterThanOrEqual(2);
      expect(await count("notifications", A)).toBe(0);
      expect(await count("notifications", B)).toBe(3);

      const audits = await q(
        `SELECT tenant_id, actor_type, actor_name, changes FROM audit_logs
          WHERE tenant_id IN (:t) AND resource_type = 'DataRetention' ORDER BY created_at`,
        { t: [A, B] },
      );
      expect(audits.map((r) => [r.tenant_id, r.actor_name, r.changes.after.purged])).toEqual([
        [A, "system:retention-purge", { notifications: 2 }],
        [A, "system:retention-purge", { notifications: 1 }],
      ]);
      expect(audits[0].changes.batch).toEqual({ size: 2, full: ["notifications"] });
      await q("DELETE FROM notifications WHERE tenant_id = :t", { t: B });
      await q("DELETE FROM tenant_settings WHERE tenant_id = :t", { t: B });
    });
  });

  describe("IoT ingest (W-12, W-04, W-32)", () => {
    const iot = () => require("../../services/iot.service");

    it("a message naming tenant B for tenant A's device writes nothing, in either tenant", async () => {
      await expect(iot().ingestReading(B, DEVICE_A, { temperature: 60 })).rejects.toThrow(
        "Device not found or IoT disabled",
      );
      expect(await count("iot_readings", A)).toBe(0);
      expect(await count("iot_readings", B)).toBe(0);
      expect(await count("notifications", B)).toBe(0);
    });

    it("an anomaly stores the reading, the tenant-wide alert and ONE audit row naming system:iot-ingest", async () => {
      await expect(iot().ingestReading(A, DEVICE_A, { temperature: 60 })).resolves.toEqual({
        success: true,
        isAnomaly: true,
      });

      const [reading] = await q("SELECT id, is_anomaly FROM iot_readings WHERE tenant_id = :t", { t: A });
      expect(reading.is_anomaly).toBe(true);
      const alerts = await q("SELECT id, type, user_id FROM notifications WHERE tenant_id = :t", { t: A });
      expect(alerts).toEqual([{ id: expect.any(String), type: "SYSTEM", user_id: null }]);
      const audits = await q(
        "SELECT actor_type, actor_name, user_id, resource_type, resource_id, changes FROM audit_logs WHERE tenant_id = :t AND resource_type = 'Notification'",
        { t: A },
      );
      expect(audits).toEqual([
        {
          actor_type: "system",
          actor_name: "system:iot-ingest",
          user_id: null,
          resource_type: "Notification",
          resource_id: alerts[0].id,
          changes: expect.objectContaining({ operation: "IOT_ANOMALY_ALERT", readingId: reading.id }),
        },
      ]);
    });

    it("an ordinary reading is stored with no audit row (ADR-051 Q-13)", async () => {
      await iot().ingestReading(A, DEVICE_A, { temperature: 20 });
      expect(await count("iot_readings", A)).toBe(2);
      expect(await count("audit_logs", A)).toBe(3); // the two purge passes and the one alert above
    });
  });

  describe("batch jobs (W-04)", () => {
    it("the abandoned-job sweep fails each stale job and audits it in ITS OWN tenant", async () => {
      const svc = require("../../services/batchJob.service");
      const jobs = {};
      for (const tenantId of [A, B]) {
        jobs[tenantId] = require("crypto").randomUUID();
        await q(
          `INSERT INTO batch_jobs (id, tenant_id, user_id, type, status, progress, created_at, updated_at)
           VALUES (:id, :t, :u, 'w12-live', 'PROCESSING', 0, now(), now() - interval '1 hour')`,
          { id: jobs[tenantId], t: tenantId, u: tenantId === A ? USER_A : USER_B },
        );
      }

      await expect(svc.failAbandonedJobs()).resolves.toBeGreaterThanOrEqual(2);

      for (const tenantId of [A, B]) {
        const rows = await q(
          `SELECT actor_name, resource_id, changes FROM audit_logs
            WHERE tenant_id = :t AND resource_type = 'BatchJob'`,
          { t: tenantId },
        );
        expect(rows).toEqual([
          {
            actor_name: "system:batch-job",
            resource_id: jobs[tenantId],
            changes: expect.objectContaining({
              before: { status: "PROCESSING" },
              after: { status: "FAILED" },
              requestedBy: tenantId === A ? USER_A : USER_B,
            }),
          },
        ]);
      }
    });
  });

  describe("session cleanup (W-12, W-17)", () => {
    it("deletes every expired session — both tenants' and a platform operator's — in batches, and keeps live ones", async () => {
      const session = require("../../services/session.service");
      const insert = (tenantId, userId, expires) =>
        q(
          `INSERT INTO sessions (id, user_id, tenant_id, token_hash, expired_at, created_at, updated_at)
           VALUES (gen_random_uuid(), :u, :t, md5(random()::text), now() + (:e)::interval, now(), now())`,
          { u: userId, t: tenantId, e: expires },
        );
      await insert(A, USER_A, "-1 day");
      await insert(A, USER_A, "-2 days");
      await insert(B, USER_B, "-1 day");
      await insert(B, USER_B, "-3 days");
      await insert(null, USER_A, "-1 day");
      await insert(A, USER_A, "+1 day");

      await expect(session.cleanupExpiredSessions({ batchSize: 2 })).resolves.toBeGreaterThanOrEqual(5);

      const left = await q("SELECT tenant_id FROM sessions WHERE user_id IN (:u)", { u: [USER_A, USER_B] });
      expect(left).toEqual([{ tenant_id: A }]);
    });
  });

  describe("scheduled backup prune (W-17)", () => {
    it("the composite keyset walks every tenant's backups across pages, keeping the newest keepMin of each", async () => {
      const backup = require("../../services/scheduledBackup.service");
      const ids = {};
      for (const [tenantId, n] of [
        [A, 3],
        [B, 2],
      ]) {
        ids[tenantId] = [];
        for (let i = 0; i < n; i += 1) {
          const id = require("crypto").randomUUID();
          ids[tenantId].push(id);
          // Two rows of A share created_at: the id breaks the tie.
          await q(
            `INSERT INTO tenant_backups (id, tenant_id, status, expires_at, created_at, updated_at)
             VALUES (:id, :t, 'completed', now() - interval '1 day', :c, now())`,
            { id, t: tenantId, c: new Date(Date.UTC(2026, 0, 10 - Math.min(i, 1))) },
          );
        }
      }

      const out = await backup.pruneExpiredBackups({ keepMin: 1, pageSize: 2 });

      const mine = (list) => list.filter((p) => [A, B].includes(p.tenantId));
      expect(mine(out.pruned)).toHaveLength(3);
      expect(out.errors).toEqual([]);
      const kept = await q(
        "SELECT tenant_id, created_at FROM tenant_backups WHERE tenant_id IN (:t) AND deleted_at IS NULL ORDER BY tenant_id",
        { t: [A, B] },
      );
      expect(kept.map((r) => r.tenant_id)).toEqual([A, B]);
      // The survivor of each tenant is its newest.
      for (const r of kept) {
        expect(r.created_at.toISOString()).toBe("2026-01-10T00:00:00.000Z");
      }
    });
  });
});
