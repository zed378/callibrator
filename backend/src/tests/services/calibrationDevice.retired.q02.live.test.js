/**
 * Q-02 (ADR-084) against a REAL PostgreSQL — the 0089 trigger that makes
 * `retired` terminal, and the reinstatement that is the one way past it.
 *
 * The mocked suites prove what the services issue. They cannot prove that the
 * trigger fires, which updates it lets through, that the transaction-local
 * setting ends with its transaction, or that the error PostgreSQL raises is the
 * shape the edit path maps to a 409. This does, on an UPGRADED table: devices
 * are written before the migration runs, as on a deployment that already has
 * retired devices, and the migration is then run twice and reversed.
 *
 * OPT-IN — needs an EMPTY scratch database the connecting role owns (it is
 * rebuilt with db.sync({ force: true })), whose name contains "scratch":
 *
 *   Q84_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55884 DB_NAME=callibrator_scratch_q84 \
 *     DB_USER=cal_owner DB_PASS=owner \
 *     npm test -- src/tests/services/calibrationDevice.retired.q02.live --coverage=false
 */

const live = process.env.Q84_PG_LIVE_TEST === "1" ? describe : describe.skip;

const TENANT_A = "a8a8a8a8-0000-4000-8000-00000000000a";
const TENANT_B = "b8b8b8b8-0000-4000-8000-00000000000b";

const startProcess = () => {
  let graph;
  jest.isolateModules(() => {
    const { db } = require("../../config");
    db.options.logging = false;
    graph = {
      db,
      models: require("../../models"),
      devices: require("../../services/calibrationDevices.service"),
      retirement: require("../../services/calibrationDeviceReinstate.service"),
      tenantStorage: require("../../middlewares/tenantContext.middleware").tenantStorage,
      schemaVerify: require("../../utils/schemaVerify.util"),
      m0089: require("../../migrations/0089-calibration-device-retired-terminal"),
    };
  });
  return graph;
};

/** The error `sql` raises inside a savepoint of `t`, or null. */
const errorOf = async (db, t, sql, replacements = {}) => {
  await db.query("SAVEPOINT probe", { transaction: t });
  try {
    await db.query(sql, { transaction: t, replacements });
    await db.query("RELEASE SAVEPOINT probe", { transaction: t });
    return null;
  } catch (err) {
    await db.query("ROLLBACK TO SAVEPOINT probe", { transaction: t });
    return err;
  }
};

const inRolledBack = async (db, work) => {
  const t = await db.transaction();
  try {
    return await work(t);
  } finally {
    await t.rollback();
  }
};

live("Q-02 — retired is terminal, on live PostgreSQL (migration 0089)", () => {
  let g;
  const ids = {};

  const statusOf = async (id) => {
    const [[row]] = await g.db.query("SELECT status::text AS status FROM calibration_devices WHERE id = :id", {
      replacements: { id },
    });
    return row.status;
  };
  const asTenant = (tenantId, fn) =>
    new Promise((resolve, reject) => {
      g.tenantStorage.run({ tenantId, isSuperAdmin: false, isSystemTask: false }, () => fn().then(resolve, reject));
    });

  beforeAll(async () => {
    const name = process.env.DB_NAME || "";
    if (!/scratch/.test(name)) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = startProcess();
    await g.db.sync({ force: true });

    await g.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
         (:a, 'Q84 A', 'q84-a', 'q84a@live.test', now(), now()),
         (:b, 'Q84 B', 'q84-b', 'q84b@live.test', now(), now())`,
      { replacements: { a: TENANT_A, b: TENANT_B } },
    );
    const device = async (tenantId, name, status) => {
      const [[row]] = await g.db.query(
        `INSERT INTO calibration_devices (id, tenant_id, name, status, iot_enabled, is_deleted,
                                          calibration_interval_days, created_at, updated_at)
         VALUES (gen_random_uuid(), :tenantId, :name, :status, false, false, 365, now(), now())
         RETURNING id`,
        { replacements: { tenantId, name, status } },
      );
      return row.id;
    };
    const [[admin]] = await g.db.query(
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                          status, must_change_password, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, 'q84-admin', 'q84-admin@live.test', 'x', 'Q84', 'Admin', 'default.svg',
               'ACTIVE', false, false, now(), now())
       RETURNING id`,
      { replacements: { t: TENANT_A } },
    );
    ids.adminA = admin.id;
    // UPGRADE: these exist before the migration, as on a live deployment.
    ids.retiredA = await device(TENANT_A, "Retired analyser", "retired");
    ids.retiredA2 = await device(TENANT_A, "Second retired analyser", "retired");
    ids.activeA = await device(TENANT_A, "Active analyser", "active");
    ids.retiredB = await device(TENANT_B, "Tenant B retired analyser", "retired");

    // Before 0089, nothing refuses a revival — the defect Q-02 describes.
    await inRolledBack(g.db, async (t) => {
      expect(
        await errorOf(g.db, t, "UPDATE calibration_devices SET status = 'active' WHERE id = :id", { id: ids.retiredA }),
      ).toBeNull();
    });

    const qi = g.db.getQueryInterface();
    await g.m0089.up({ context: qi });
    await g.m0089.up({ context: qi }); // idempotent
  }, 120000);

  afterAll(async () => {
    if (g) {
      await g.db.close();
    }
  });

  it("the trigger exists once, on calibration_devices", async () => {
    const [rows] = await g.db.query(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'calibration_devices'::regclass AND NOT tgisinternal AND tgname = :name`,
      { replacements: { name: g.m0089.TRIGGER_NAME } },
    );
    expect(rows).toHaveLength(1);
  });

  it("the boot verifier finds it", async () => {
    const result = await g.schemaVerify.verifySchema(g.db);
    expect(result.problems.filter((p) => /calibration_devices_retired_terminal/.test(p))).toEqual([]);
  });

  it("refuses leaving 'retired' for the connecting role (the owner), with SQLSTATE 23514", async () => {
    await inRolledBack(g.db, async (t) => {
      for (const to of ["active", "inactive", "maintenance"]) {
        const err = await errorOf(g.db, t, "UPDATE calibration_devices SET status = :to WHERE id = :id", {
          id: ids.retiredA,
          to,
        });
        expect(err).not.toBeNull();
        expect(err.original.code).toBe("23514");
        expect(err.message).toMatch(/is retired, and retirement is terminal/);
      }
    });
    expect(await statusOf(ids.retiredA)).toBe("retired");
  });

  it("the error a model write raises is the shape the edit path maps to its 409", async () => {
    const row = await g.models.CalibrationDevice.unscoped().findOne({
      where: { id: ids.retiredA },
      skipTenantScope: true,
    });
    const err = await row.update({ status: "active" }).catch((e) => e);
    expect(g.retirement.isRetirementTerminalViolation(err)).toBe(true);
  });

  it("lets through what is not a revival: re-saving 'retired', other columns of a retired device, retiring, other moves", async () => {
    await inRolledBack(g.db, async (t) => {
      const ok = async (sql, id) => expect(await errorOf(g.db, t, sql, { id })).toBeNull();
      await ok("UPDATE calibration_devices SET status = 'retired' WHERE id = :id", ids.retiredA);
      await ok("UPDATE calibration_devices SET remarks = 'in the basement' WHERE id = :id", ids.retiredA);
      await ok("UPDATE calibration_devices SET status = 'maintenance' WHERE id = :id", ids.activeA);
      await ok("UPDATE calibration_devices SET status = 'retired' WHERE id = :id", ids.activeA);
    });
  });

  it("the reinstatement setting opens only the device it names, and only inside its own transaction", async () => {
    await inRolledBack(g.db, async (t) => {
      await g.db.query("SELECT set_config('callibrator.reinstate_device', :id, true)", {
        transaction: t,
        replacements: { id: ids.retiredA },
      });
      const other = await errorOf(g.db, t, "UPDATE calibration_devices SET status = 'active' WHERE id = :id", {
        id: ids.retiredA2,
      });
      expect(other.original.code).toBe("23514");
      const named = await errorOf(g.db, t, "UPDATE calibration_devices SET status = 'active' WHERE id = :id", {
        id: ids.retiredA,
      });
      expect(named).toBeNull();
    });
    // Rolled back, and the setting ended with it.
    expect(await statusOf(ids.retiredA)).toBe("retired");
    await inRolledBack(g.db, async (t) => {
      const after = await errorOf(g.db, t, "UPDATE calibration_devices SET status = 'active' WHERE id = :id", {
        id: ids.retiredA,
      });
      expect(after.original.code).toBe("23514");
    });
  });

  it("the edit path answers 409 and changes nothing", async () => {
    const result = await asTenant(TENANT_A, () =>
      g.devices.updateCalibrationDevice(TENANT_A, ids.retiredA, { status: "active" }, {}),
    );
    expect(result.status).toBe(409);
    expect(await statusOf(ids.retiredA)).toBe("retired");
  });

  it("another tenant cannot reinstate the device: 404, and it stays retired", async () => {
    const result = await asTenant(TENANT_B, () =>
      g.retirement.reinstate(TENANT_B, ids.retiredA, { reason: "Retired in error at stock take", status: "active" }, {}),
    );
    expect(result.status).toBe(404);
    expect(await statusOf(ids.retiredA)).toBe("retired");
  });

  it("the reinstatement commits the status with its audit row, and the setting does not outlive it", async () => {
    const result = await asTenant(TENANT_A, () =>
      g.retirement.reinstate(
        TENANT_A,
        ids.retiredA,
        { reason: "Retired in error at stock take", status: "inactive" },
        { userId: ids.adminA, ipAddress: "10.0.0.1", userAgent: "live" },
      ),
    );
    expect(result.status).toBe(200);
    expect(await statusOf(ids.retiredA)).toBe("inactive");

    const [rows] = await g.db.query(
      `SELECT action::text AS action, resource_type, user_id, changes FROM audit_logs
        WHERE tenant_id = :t AND resource_id = :id`,
      { replacements: { t: TENANT_A, id: ids.retiredA } },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "UPDATE", resource_type: "CalibrationDevice", user_id: ids.adminA });
    expect(rows[0].changes).toMatchObject({
      operation: "REINSTATE",
      reason: "Retired in error at stock take",
      before: { status: "retired" },
      after: { status: "inactive" },
    });

    // A later plain revival of ANOTHER retired device is still refused.
    await inRolledBack(g.db, async (t) => {
      const err = await errorOf(g.db, t, "UPDATE calibration_devices SET status = 'active' WHERE id = :id", {
        id: ids.retiredA2,
      });
      expect(err.original.code).toBe("23514");
    });
  });

  it("down removes the trigger and the function; up restores them", async () => {
    const qi = g.db.getQueryInterface();
    await g.m0089.down({ context: qi });
    const [gone] = await g.db.query(
      "SELECT 1 FROM pg_proc WHERE proname = 'calibration_devices_retired_terminal'",
    );
    expect(gone).toEqual([]);
    await inRolledBack(g.db, async (t) => {
      expect(
        await errorOf(g.db, t, "UPDATE calibration_devices SET status = 'active' WHERE id = :id", { id: ids.retiredA2 }),
      ).toBeNull();
    });

    await g.m0089.up({ context: qi });
    await inRolledBack(g.db, async (t) => {
      const err = await errorOf(g.db, t, "UPDATE calibration_devices SET status = 'active' WHERE id = :id", {
        id: ids.retiredA2,
      });
      expect(err.original.code).toBe("23514");
    });
  });
});
