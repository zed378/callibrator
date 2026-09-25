/**
 * ADR-070 (agent dbC) — D-22 and the webhook delivery purge against a REAL
 * PostgreSQL, running as the APPLICATION ROLE (DB_APP_ROLE), not the owner:
 * as the owner every grant question passes whether the grant exists or not.
 *
 *  - D-22: deleting a certificate / a device soft-deletes exactly its own
 *    tenant's attachments (every spelling of the type), with one audit row
 *    each in the same transaction; another tenant's row naming the same id is
 *    untouched. The orphan report's anti-join finds a deleted parent, an
 *    unlinkable type and a link to ANOTHER tenant's record — and not a voided
 *    calibration record's evidence, and not another tenant's orphans.
 *  - The purge removes finished deliveries past the window, keeps live queue
 *    rows and recent ones, and writes a system-actor audit row per tenant that
 *    satisfies migration 0033's actor CHECK.
 *
 * OPT-IN — needs a scratch database ALREADY BOOTED the way backend/index.js
 * boots (db.sync(), then every migration), whose name contains "scratch", and
 * DB_APP_ROLE naming the role migration 0057 created:
 *
 *   DATA_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55611 DB_NAME=dbc_fresh_scratch \
 *     DB_USER=postgres DB_PASS=x DB_APP_ROLE=callibrator_app \
 *     npm test -- src/tests/services/dataLayer.dbC.live --coverage=false
 *
 * Every run creates its own tenants, so it can be re-run on the same database.
 */

const live = process.env.DATA_PG_LIVE_TEST === "1" ? describe : describe.skip;

jest.setTimeout(120000);

// Loaded in the MAIN module registry, not jest.isolateModules: the services
// lazily require attachment.service at call time, and a require made after an
// isolateModules callback returns resolves in the main registry — a second
// copy of the models and the pool.
const startProcess = () => {
  const { db } = require("../../config");
  db.options.logging = false;
  return {
    db,
    models: require("../../models"),
    tenantStorage: require("../../middlewares/tenantContext.middleware").tenantStorage,
    dbRole: require("../../utils/dbRole.util"),
    certificates: require("../../services/certificate.service"),
    devices: require("../../services/calibrationDevices.service"),
    attachments: require("../../services/attachment.service"),
    purge: require("../../services/webhookDeliveryPurge.service"),
  };
};

live("dbC — D-22 cascade + orphan report, webhook delivery purge — live PostgreSQL, as the application role", () => {
  const { randomUUID } = require("crypto");
  let g;
  const A = randomUUID();
  const B = randomUUID();
  const ids = {};

  const q = async (sql, replacements = {}) => {
    try {
      const [rows] = await g.db.query(sql, { replacements });
      return rows;
    } catch (err) {
      throw new Error(`${err.original ? err.original.message : err.message}\n${sql}`);
    }
  };
  const one = async (sql, replacements) => (await q(sql, replacements))[0];
  const inTenant = (tenantId, fn) => g.tenantStorage.run({ tenantId, isSuperAdmin: false }, fn);

  const attachment = async (tenantId, resourceType, resourceId) =>
    (
      await one(
        `INSERT INTO attachments (id, tenant_id, resource_type, resource_id, file_name, original_name, created_at, updated_at)
         VALUES (gen_random_uuid(), :tenantId, :resourceType, :resourceId, 'f.bin', 'f.pdf', now(), now()) RETURNING id`,
        { tenantId, resourceType, resourceId },
      )
    ).id;

  beforeAll(async () => {
    if (!/scratch/.test(process.env.DB_NAME || "")) {
      throw new Error(`Refusing DB_NAME="${process.env.DB_NAME}": use a scratch database`);
    }
    if (!process.env.DB_APP_ROLE) {
      throw new Error("Set DB_APP_ROLE: this test runs as the application role");
    }
    g = startProcess();
    await g.dbRole.enterApplicationRole({ sequelize: g.db, logger: { info() {}, warn() {} } });
    expect((await one("SELECT current_user AS u")).u).toBe(process.env.DB_APP_ROLE);

    const tag = A.slice(0, 8);
    await q(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
         (:a, 'dbC A', :sa, :ea, now(), now()), (:b, 'dbC B', :sb, :eb, now(), now())`,
      { a: A, b: B, sa: `dbc-a-${tag}`, sb: `dbc-b-${tag}`, ea: `a-${tag}@dbc.test`, eb: `b-${tag}@dbc.test` },
    );
    ids.user = (
      await one(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                            status, must_change_password, is_deleted, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :u, :e, 'x', 'D', 'C', 'default.svg', 'ACTIVE', false, false, now(), now())
         RETURNING id`,
        { t: A, u: `dbc-${tag}`, e: `dbc-${tag}@dbc.test` },
      )
    ).id;
    const device = async (tenantId) =>
      (
        await one(
          `INSERT INTO calibration_devices (id, tenant_id, name, created_at, updated_at)
           VALUES (gen_random_uuid(), :tenantId, 'dbC device', now(), now()) RETURNING id`,
          { tenantId },
        )
      ).id;
    ids.deviceA = await device(A);
    ids.deviceB = await device(B);
    const certificate = async (tenantId, deviceId) =>
      (
        await one(
          `INSERT INTO certificates (id, tenant_id, device_id, certificate_number, status, created_at, updated_at)
           VALUES (gen_random_uuid(), :tenantId, :deviceId, :n, 'draft', now(), now()) RETURNING id`,
          { tenantId, deviceId, n: `DBC-${randomUUID().slice(0, 12)}` },
        )
      ).id;
    ids.certA = await certificate(A, ids.deviceA);
    ids.certB = await certificate(B, ids.deviceB);
  });

  afterAll(async () => {
    if (g) {
      await g.db.close();
    }
  });

  it("D-22: a certificate's delete soft-deletes its own tenant's attachments, audited, in its transaction", async () => {
    const a1 = await attachment(A, "certificate", ids.certA);
    const a2 = await attachment(A, "Certificate", ids.certA);
    const onDevice = await attachment(A, "device", ids.deviceA);
    // Tenant B's row naming A's certificate id (a pre-A-97 row): not A's to touch.
    const foreign = await attachment(B, "certificate", ids.certA);

    const result = await inTenant(A, () =>
      g.certificates.deleteCertificate(A, ids.certA, { userId: ids.user, ipAddress: "127.0.0.1" }),
    );
    expect(result.status).toBe(200);

    const flags = await q(
      `SELECT id, is_deleted FROM attachments WHERE id IN (:list) ORDER BY id`,
      { list: [a1, a2, onDevice, foreign] },
    );
    const deleted = Object.fromEntries(flags.map((r) => [r.id, r.is_deleted]));
    expect(deleted).toEqual({ [a1]: true, [a2]: true, [onDevice]: false, [foreign]: false });

    const audit = await q(
      `SELECT resource_id, tenant_id, user_id, actor_type, changes->'cascade' AS cascade
         FROM audit_logs WHERE resource_type = 'Attachment' AND action = 'DELETE'
          AND changes->'cascade'->>'id' = :cert ORDER BY resource_id`,
      { cert: ids.certA },
    );
    expect(audit.map((r) => r.resource_id).sort()).toEqual([a1, a2].sort());
    for (const row of audit) {
      expect(row).toMatchObject({ tenant_id: A, user_id: ids.user, actor_type: "user" });
      expect(row.cascade).toEqual({ type: "Certificate", id: ids.certA });
    }
  });

  it("D-22: a device's delete soft-deletes its attachments too", async () => {
    const onDevice = await attachment(A, "CalibrationDevice", ids.deviceA);
    const device = await attachment(A, "device", ids.deviceA);

    const result = await inTenant(A, () =>
      g.devices.deleteCalibrationDevice(A, ids.deviceA, { userId: ids.user }),
    );
    expect(result.status).toBe(200);
    const rows = await q(`SELECT is_deleted FROM attachments WHERE id IN (:list)`, { list: [onDevice, device] });
    expect(rows.map((r) => r.is_deleted)).toEqual([true, true]);
  });

  it("D-22: the orphan report finds deleted parents, unlinkable types and cross-tenant links — only in the caller's tenant", async () => {
    const order = (
      await one(
        `INSERT INTO maintenance_work_orders (id, tenant_id, device_id, title, created_at, updated_at, deleted_at)
         VALUES (gen_random_uuid(), :t, :d, 'gone', now(), now(), now()) RETURNING id`,
        { t: A, d: ids.deviceB },
      )
    ).id;
    const voided = (
      await one(
        `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, is_deleted,
                                          void_reason, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :d, :u, now(), true, 'entered in error', now(), now()) RETURNING id`,
        { t: A, d: ids.deviceA, u: ids.user },
      )
    ).id;
    const deletedParent = await attachment(A, "workorder", order);
    const unlinkable = await attachment(A, "post", randomUUID());
    const crossTenant = await attachment(A, "certificate", ids.certB);
    const voidedEvidence = await attachment(A, "calibration", voided);
    const liveParent = await attachment(B, "certificate", ids.certB);
    const standalone = await attachment(A, "generic", null);

    const reportA = await inTenant(A, () => g.attachments.listOrphans(A, { limit: 200 }));
    const byId = Object.fromEntries(reportA.rows.map((r) => [r.id, r.reason]));
    expect(byId[deletedParent]).toBe("parent_missing_or_deleted");
    expect(byId[unlinkable]).toBe("unlinkable_type");
    expect(byId[crossTenant]).toBe("parent_missing_or_deleted");
    expect(byId[voidedEvidence]).toBeUndefined();
    expect(byId[standalone]).toBeUndefined();
    expect(byId[liveParent]).toBeUndefined();
    // The attachments soft-deleted by the cascades above are not orphans.
    expect(reportA.meta.total).toBe(reportA.rows.length);
    expect(reportA.rows.every((r) => typeof r.size === "number")).toBe(true);

    const reportB = await inTenant(B, () => g.attachments.listOrphans(B, { limit: 200 }));
    const bIds = reportB.rows.map((r) => r.id);
    expect(bIds).not.toContain(deletedParent);
    expect(bIds).not.toContain(liveParent);
    // B's pre-A-97 row naming A's (now deleted) certificate is B's orphan.
    expect(reportB.rows.every((r) => r.reason === "parent_missing_or_deleted")).toBe(true);
    expect(reportB.meta.total).toBe(1);
  });

  it("the purge removes finished deliveries past the window and nothing else, audited per tenant as the system", async () => {
    const webhook = async (tenantId) =>
      (
        await one(
          `INSERT INTO webhooks (id, tenant_id, url, secret, created_at, updated_at)
           VALUES (gen_random_uuid(), :tenantId, 'https://hooks.dbc.test/x', 'v1:x', now(), now()) RETURNING id`,
          { tenantId },
        )
      ).id;
    const whA = await webhook(A);
    const whB = await webhook(B);
    const delivery = async (tenantId, webhookId, status, ageDays) =>
      (
        await one(
          `INSERT INTO webhook_deliveries (id, tenant_id, webhook_id, event, status, created_at, updated_at)
           VALUES (gen_random_uuid(), :tenantId, :webhookId, 'certificate.signed', :status,
                   now() - (:age || ' days')::interval, now() - (:age || ' days')::interval) RETURNING id`,
          { tenantId, webhookId, status, age: String(ageDays) },
        )
      ).id;
    const gone = [
      await delivery(A, whA, "success", 40),
      await delivery(A, whA, "exhausted", 90),
      await delivery(B, whB, "success", 31),
    ];
    const kept = [
      await delivery(A, whA, "pending", 400),
      await delivery(A, whA, "failed", 400),
      await delivery(A, whA, "success", 1),
      await delivery(B, whB, "exhausted", 29),
    ];

    const summary = await g.purge.purgeFinishedDeliveries();
    expect(summary.deleted).toBeGreaterThanOrEqual(3);

    const left = (await q(`SELECT id FROM webhook_deliveries WHERE tenant_id IN (:a, :b)`, { a: A, b: B })).map(
      (r) => r.id,
    );
    expect(left.sort()).toEqual(kept.sort());
    for (const id of gone) {
      expect(left).not.toContain(id);
    }

    const audit = await q(
      `SELECT tenant_id, user_id, actor_type, actor_name, changes FROM audit_logs
        WHERE resource_type = 'WebhookDelivery' AND tenant_id IN (:a, :b) ORDER BY tenant_id`,
      { a: A, b: B },
    );
    expect(audit).toHaveLength(2);
    for (const row of audit) {
      expect(row).toMatchObject({ user_id: null, actor_type: "system", actor_name: "system:webhook-delivery-purge" });
      expect(row.changes.operation).toBe("purge");
      expect(row.changes.retentionDays).toBe(30);
    }
    const byTenant = Object.fromEntries(audit.map((r) => [r.tenant_id, r.changes]));
    expect(byTenant[A]).toMatchObject({ deleted: 2, byStatus: { success: 1, exhausted: 1 } });
    expect(byTenant[B]).toMatchObject({ deleted: 1, byStatus: { success: 1 } });
  });
});
