/**
 * W-03 against a REAL PostgreSQL — two calibration scans racing on one device.
 *
 * The unit suite proves the scan counts a 409 as a skip. Only a real server
 * can prove the thing that matters: that migration 0060's partial unique index
 * makes the SECOND insert fail while the first commits, so two scans that both
 * read "no open work order" still produce exactly one work order, one audit
 * row and one tenant-wide notification — and that the loser calls no webhook.
 *
 * Each "replica" is a separately loaded module graph: its own Sequelize
 * instance and connection pool. A barrier holds BOTH scans after their
 * "open work orders" read until both have made it, so the race is forced on
 * every run rather than left to timing.
 *
 * OPT-IN — needs a database whose schema is db.sync() of the current models
 * (the test applies migration 0060 itself; it is idempotent):
 *
 * W-04 (ADR-069): the winner's tenant-wide notification carries its own audit
 * row, by the same system actor.
 *
 *   CALIBRATION_PG_LIVE_TEST=1 DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASS=... \
 *     npm test -- src/tests/services/calibrationScheduler.w03.live --coverage=false
 *
 * It creates one tenant and one device with fixed ids and removes everything
 * it wrote.
 */

const live = process.env.CALIBRATION_PG_LIVE_TEST === "1" ? describe : describe.skip;

const TENANT = "c3c3c3c3-0000-4000-8000-0000000000c3";
const DEVICE = "d4d4d4d4-0000-4000-8000-0000000000d4";

const startProcess = () => {
  let graph;
  jest.isolateModules(() => {
    const { db } = require("../../config");
    db.options.logging = false;
    graph = {
      db,
      models: require("../../models"),
      scheduler: require("../../services/calibrationScheduler.service"),
      webhookService: require("../../services/webhook.service"),
    };
  });
  return graph;
};

const barrier = (n) => {
  let arrived = 0;
  let release;
  const all = new Promise((r) => {
    release = r;
  });
  return async () => {
    arrived += 1;
    if (arrived === n) {
      release();
    }
    await all;
  };
};

live("calibration scan — two concurrent scans, live PostgreSQL (W-03)", () => {
  let p1;
  let p2;

  const cleanup = async (db) => {
    await db.query("DELETE FROM audit_logs WHERE tenant_id = :t", { replacements: { t: TENANT } });
    await db.query("DELETE FROM notifications WHERE tenant_id = :t", { replacements: { t: TENANT } });
    await db.query("DELETE FROM maintenance_work_orders WHERE tenant_id = :t", { replacements: { t: TENANT } });
    await db.query("DELETE FROM calibration_devices WHERE tenant_id = :t", { replacements: { t: TENANT } });
    await db.query("DELETE FROM tenants WHERE id = :t", { replacements: { t: TENANT } });
  };

  beforeAll(async () => {
    p1 = startProcess();
    p2 = startProcess();
    await require("../../migrations/0060-work-order-auto-scheduled-unique").up({
      context: p1.db.getQueryInterface(),
    });
    await cleanup(p1.db);
    await p1.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
       VALUES (:t, 'W-03 Hospital', 'w03-live', 'w03@example.test', now(), now())`,
      { replacements: { t: TENANT } },
    );
    await p1.db.query(
      `INSERT INTO calibration_devices (id, tenant_id, name, status, next_calibration_date, created_at, updated_at)
       VALUES (:d, :t, 'Infusion pump', 'active', now() - interval '3 days', now(), now())`,
      { replacements: { d: DEVICE, t: TENANT } },
    );
  });

  afterAll(async () => {
    if (p1) {
      await cleanup(p1.db);
      await p1.db.close();
    }
    if (p2) {
      await p2.db.close();
    }
  });

  it("the index exists, as migration 0060 builds it", async () => {
    const [rows] = await p1.db.query(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'maintenance_work_orders_one_open_auto_per_device'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toMatch(/UNIQUE INDEX .* \(device_id\) WHERE \(auto_scheduled AND/);
  });

  it("two scans that both read 'no open work order' create ONE work order, ONE audit row, ONE notification, ONE webhook event", async () => {
    const both = barrier(2);
    const emitted = [];
    for (const p of [p1, p2]) {
      const realFindAll = p.models.MaintenanceWorkOrder.findAll.bind(p.models.MaintenanceWorkOrder);
      jest.spyOn(p.models.MaintenanceWorkOrder, "findAll").mockImplementation(async (...args) => {
        const result = await realFindAll(...args);
        await both(); // neither scan creates until both have read "none"
        return result;
      });
      jest.spyOn(p.webhookService, "emitEvent").mockImplementation(async (...args) => {
        emitted.push(args);
        return { matched: 0 };
      });
    }

    const [s1, s2] = await Promise.all([
      p1.scheduler.runCalibrationScan({ tenantId: TENANT }),
      p2.scheduler.runCalibrationScan({ tenantId: TENANT }),
    ]);

    // Both saw the device; one created, the other was refused by the index.
    expect([s1.workOrdersCreated, s2.workOrdersCreated].sort()).toEqual([0, 1]);
    expect(s1.skipped + s2.skipped).toBe(1);
    expect(s1.errors + s2.errors).toBe(0);
    const loser = s1.workOrdersCreated === 0 ? s1 : s2;
    expect(loser.details).toEqual([
      { deviceId: DEVICE, action: "skipped", reason: "created by a concurrent scan" },
    ]);

    const [orders] = await p1.db.query(
      "SELECT id, auto_scheduled, status FROM maintenance_work_orders WHERE tenant_id = :t",
      { replacements: { t: TENANT } },
    );
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ auto_scheduled: true, status: "Open" });

    const [audits] = await p1.db.query(
      "SELECT actor_type, actor_name, user_id, resource_id FROM audit_logs WHERE tenant_id = :t AND resource_type = 'MaintenanceWorkOrder'",
      { replacements: { t: TENANT } },
    );
    expect(audits).toEqual([
      { actor_type: "system", actor_name: "system:calibration-scan", user_id: null, resource_id: orders[0].id },
    ]);

    const [notes] = await p1.db.query("SELECT id, type FROM notifications WHERE tenant_id = :t", {
      replacements: { t: TENANT },
    });
    expect(notes).toHaveLength(1);
    // W-04 (ADR-069): the tenant-wide notification has its own audit row, by the job.
    const [noteAudits] = await p1.db.query(
      "SELECT actor_type, actor_name, user_id, resource_id FROM audit_logs WHERE tenant_id = :t AND resource_type = 'Notification'",
      { replacements: { t: TENANT } },
    );
    expect(noteAudits).toEqual([
      { actor_type: "system", actor_name: "system:calibration-scan", user_id: null, resource_id: notes[0].id },
    ]);
    expect(emitted).toHaveLength(1);
  });

  it("a later scan, with the work order still open, skips by its read guard", async () => {
    const summary = await p1.scheduler.runCalibrationScan({ tenantId: TENANT });
    expect(summary).toMatchObject({ scanned: 1, skipped: 1, workOrdersCreated: 0 });
    expect(summary.details[0].reason).toBe("open work order exists");
  });
});
