/**
 * W-17 (ADR-073) against a REAL PostgreSQL 18 — the calibration scan writes
 * one transaction per CHUNK of a tenant's due devices, not one per device,
 * and every work order still has its own audit row naming its own device.
 *
 * What only a real server proves:
 *  - `INSERT ... ON CONFLICT DO NOTHING` skips a device whose open
 *    auto-scheduled order already exists (migration 0060's PARTIAL unique
 *    index) without aborting the rest of the batch;
 *  - the rows read back by id are the rows inserted, so the audit row, the
 *    notification and the webhook payload of each work order name the right
 *    device — Sequelize's positional RETURNING mapping would not;
 *  - the commit count is two per chunk.
 *
 * NEEDS a database built by db.sync() of the current models plus
 * every migration (migrator.up()):
 *
 *   DB_HOST=... DB_PORT=... DB_USER=... DB_PASS=... \
 *     npm run test:live:jest -- src/tests/services/calibrationScheduler.batch.w17.live
 *
 * ADR-095 O-2: the suite creates its OWN database (DB_USER needs CREATEDB;
 * DB_NAME is not used), builds it as the backend boots (db.sync() + every
 * migration, 0091's append-only audit_logs included) and runs as
 * `callibrator_app` through enterApplicationRole. Its audit rows cannot be
 * deleted, so it does not clean up: the database is dropped afterwards
 * (fixtures/disposableDatabase.ts, fixtures/liveBoot.ts).
 */
const { createDisposableDatabase, LIVE_BOOT_TIMEOUT_MS } = require("../fixtures/disposableDatabase");
const { bootSchemaAsApplicationRole } = require("../fixtures/liveBoot");
const { SELF_FACILITIES_SQL } = require("../fixtures/selfFacility");

const A = "a17a17a1-0000-4000-8000-0000000000a1";
const B = "b17b17b1-0000-4000-8000-0000000000b1";
const dev = (n) => `d17d17d1-0000-4000-8000-00000000000${n}`;
const A_DEVICES = [1, 2, 3, 4, 5].map(dev);
const B_DEVICE = dev(9);

describe("calibration scan — batched transactions on live PostgreSQL (W-17)", () => {
  jest.setTimeout(60000);
  let db;
  let scratch;
  let models;
  let scheduler;
  let webhookService;

  const q = async (sql, replacements = {}) => (await db.query(sql, { replacements }))[0];

  beforeAll(async () => {
    scratch = await createDisposableDatabase("w17");
    ({ db } = require("../../config"));
    db.options.logging = false;
    models = require("../../models");
    await bootSchemaAsApplicationRole(db);
    scheduler = require("../../services/calibrationScheduler.service");
    webhookService = require("../../services/webhook.service");
    for (const [id, sub] of [
      [A, "w17-batch-a"],
      [B, "w17-batch-b"],
    ]) {
      await q(
        `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
         VALUES (:id, :sub, :sub, :email, now(), now())`,
        { id, sub, email: `${sub}@example.test` },
      );
    }
    for (const [d, t, i] of [...A_DEVICES.map((d, i) => [d, A, i]), [B_DEVICE, B, 9]]) {
      // P20-07: raw-SQL tenants need their self facility before a device (0118 refuses one without — fixtures/selfFacility).
      await q(SELF_FACILITIES_SQL);
      await q(
        `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, status, next_calibration_date, created_at, updated_at)
         VALUES (:d, :t, :name, :sn, 'active', now() - interval '3 days', now(), now())`,
        { d, t, name: `Pump ${i}`, sn: `SN-${i}` },
      );
    }
  }, LIVE_BOOT_TIMEOUT_MS);

  afterAll(async () => {
    if (db) {
      await db.close();
    }
    if (scratch) {
      await scratch.drop();
    }
  }, LIVE_BOOT_TIMEOUT_MS);

  it("chunks of 2: three work-order transactions and three notification transactions for five devices; a device conflicted AFTER the read is skipped without aborting its chunk", async () => {
    const emitted = [];
    jest.spyOn(webhookService, "emitEvent").mockImplementation(async (...args) => {
      emitted.push(args);
      return { matched: 0 };
    });
    // Between the scan's read ("no open work order") and its insert, another
    // writer opens an auto-scheduled order for device 2 — the W-03 race.
    const realFindAll = models.MaintenanceWorkOrder.findAll.bind(models.MaintenanceWorkOrder);
    const readGuard = jest.spyOn(models.MaintenanceWorkOrder, "findAll").mockImplementationOnce(async (...args) => {
      const result = await realFindAll(...args);
      await q(
        `INSERT INTO maintenance_work_orders (id, tenant_id, device_id, title, type, status, priority, auto_scheduled, created_at, updated_at)
         VALUES (gen_random_uuid(), :t, :d, 'concurrent', 'Preventative', 'Open', 'High', true, now(), now())`,
        { t: A, d: A_DEVICES[1] },
      );
      return result;
    });
    const transactions = jest.spyOn(db, "transaction");

    const summary = await scheduler.runCalibrationScan({ tenantId: A, txBatchSize: 2 });

    expect(summary).toMatchObject({ scanned: 5, workOrdersCreated: 4, notificationsCreated: 4, skipped: 1, errors: 0 });
    expect(summary.details).toContainEqual({ deviceId: A_DEVICES[1], action: "skipped", reason: "created by a concurrent scan" });
    // Chunks [1,2] [3,4] [5]: a work-order transaction each, and a
    // notification transaction each (every chunk created at least one order).
    expect(transactions).toHaveBeenCalledTimes(6);

    const orders = await q(
      "SELECT id, device_id FROM maintenance_work_orders WHERE tenant_id = :t AND title <> 'concurrent' ORDER BY device_id",
      { t: A },
    );
    expect(orders.map((o) => o.device_id)).toEqual([A_DEVICES[0], A_DEVICES[2], A_DEVICES[3], A_DEVICES[4]]);

    // One audit row per work order, naming THAT order and THAT device.
    const audits = await q(
      `SELECT resource_id, actor_name, changes->'after'->>'deviceId' AS device
         FROM audit_logs WHERE tenant_id = :t AND resource_type = 'MaintenanceWorkOrder'`,
      { t: A },
    );
    const byOrder = Object.fromEntries(orders.map((o) => [o.id, o.device_id]));
    expect(audits).toHaveLength(4);
    for (const a of audits) {
      expect(a.actor_name).toBe("system:calibration-scan");
      expect(byOrder[a.resource_id]).toBe(a.device);
    }

    // One notification per created order, each audited with its own device and order.
    const noteAudits = await q(
      `SELECT changes->>'deviceId' AS device, changes->>'workOrderId' AS wo
         FROM audit_logs WHERE tenant_id = :t AND resource_type = 'Notification'`,
      { t: A },
    );
    expect(noteAudits).toHaveLength(4);
    for (const n of noteAudits) {
      expect(byOrder[n.wo]).toBe(n.device);
    }
    expect(Number((await q("SELECT count(*)::int AS n FROM notifications WHERE tenant_id = :t", { t: A }))[0].n)).toBe(4);

    // The webhook payload of each names its own order.
    expect(emitted).toHaveLength(4);
    for (const [tenantId, , payload] of emitted) {
      expect(tenantId).toBe(A);
      expect(byOrder[payload.workOrderId]).toBe(payload.deviceId);
    }

    // Tenant B's due device was not touched by A's scan.
    expect(await q("SELECT id FROM maintenance_work_orders WHERE tenant_id = :t", { t: B })).toEqual([]);
    readGuard.mockRestore();
  });

  it("an all-tenant scan puts each tenant's devices in its own transaction, and skips the open ones by its read guard", async () => {
    jest.spyOn(webhookService, "emitEvent").mockResolvedValue({ matched: 0 });

    const summary = await scheduler.runCalibrationScan({ txBatchSize: 25 });

    // A's five are open now (four scanned in, one concurrent); B's is new.
    const mine = summary.details.filter((d) => [...A_DEVICES, B_DEVICE].includes(d.deviceId));
    expect(mine.filter((d) => d.action === "skipped")).toHaveLength(5);
    expect(mine.filter((d) => d.action === "created").map((d) => d.deviceId)).toEqual([B_DEVICE]);
    const [order] = await q("SELECT tenant_id, device_id FROM maintenance_work_orders WHERE tenant_id = :t", { t: B });
    expect(order).toEqual({ tenant_id: B, device_id: B_DEVICE });
  });
});
