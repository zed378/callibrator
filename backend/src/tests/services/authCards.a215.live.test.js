/**
 * A-215 (migration 0078) and A-259 against a REAL PostgreSQL.
 *
 * The mocked suites prove what the code issues; these prove what the database
 * does with it:
 *  - 0078 on a FRESH boot (db.sync() then every migration: the column comes
 *    from the model, the migration only backfills) and on an UPGRADE (the
 *    column absent, a flagged account present: up adds it and starts that
 *    account's 72 hours; a second migrator.up() applies nothing; a direct
 *    re-run changes nothing; down drops it; up restores it). The boot-time
 *    schema verifier passes after each.
 *  - A-259: the append-only trigger (0057) refuses the calibration-record
 *    DELETE for every role, so `unseedDemoData` must refuse before it deletes
 *    anything — and the application role cannot drop a table, which is why
 *    the forced-sync reset helpers were removed.
 *
 * OPT-IN — needs an EMPTY scratch database the connecting role owns (it is
 * rebuilt with db.sync({ force: true })), whose name contains "scratch":
 *
 *   DATA_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=55478 DB_NAME=callibrator_a215scratch \
 *     DB_USER=cal_owner DB_PASS=owner \
 *     npm test -- src/tests/services/authCards.a215.live --coverage=false
 *
 * Run on PostgreSQL 18.6 (pgvector/pgvector:pg18) on 2026-09-25.
 */

const live = process.env.DATA_PG_LIVE_TEST === "1" ? describe : describe.skip;

const APP_ROLE = process.env.DB_APP_ROLE || "callibrator_app";
const HOUR = 60 * 60 * 1000;

const startProcess = () => {
  let graph;
  jest.isolateModules(() => {
    const { db } = require("../../config");
    db.options.logging = false;
    graph = {
      db,
      models: require("../../models"),
      migrator: require("../../config/migrator").migrator,
      schemaVerify: require("../../utils/schemaVerify.util"),
      m0078: require("../../migrations/0078-user-temporary-password-expiry"),
      migrationService: require("../../services/migration.service"),
      constants: require("../../constants"),
    };
  });
  return graph;
};

live("A-215 / A-259 — live PostgreSQL", () => {
  let g;
  const ids = {};

  const column = async () => {
    const [rows] = await g.db.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users'
          AND column_name = 'temporary_password_expires_at'`,
    );
    return rows[0] || null;
  };
  const applied = async () => {
    const [rows] = await g.db.query(
      "SELECT name FROM schema_migrations WHERE name = '0078-user-temporary-password-expiry.js'",
    );
    return rows.length === 1;
  };
  const expiryOf = async (id) => {
    const [[row]] = await g.db.query("SELECT temporary_password_expires_at AS e FROM users WHERE id = :id", {
      replacements: { id },
    });
    return row.e;
  };
  const user = async (tag, mustChange) => {
    const [[row]] = await g.db.query(
      `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                          status, must_change_password, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :tenantId, :tag, :email, 'x', 'A215', :tag, 'default.svg',
               'ACTIVE', :mustChange, false, now(), now())
       RETURNING id`,
      { replacements: { tenantId: g.constants.DEFAULT_TENANT.id, tag, email: `${tag}@live.test`, mustChange } },
    );
    return row.id;
  };

  beforeAll(async () => {
    const name = process.env.DB_NAME || "";
    if (!/scratch/.test(name)) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = startProcess();
    await g.db.sync({ force: true });
  }, 60000);

  afterAll(async () => {
    if (g) {
      await g.db.close();
    }
  });

  it("FRESH boot: db.sync() already built the column; every migration applies; the verifier passes", async () => {
    expect(await column()).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES" });

    const ran = await g.migrator.up();

    expect(ran.map((m) => m.name)).toContain("0078-user-temporary-password-expiry.js");
    expect(await applied()).toBe(true);
    expect(await column()).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES" });
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  }, 180000);

  it("UPGRADE: the column absent and a flagged account present — up adds it and starts that account's 72 hours", async () => {
    await g.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at)
       VALUES (:id, 'Default', 'default', 'default@tenant.test', now(), now()) ON CONFLICT (id) DO NOTHING`,
      { replacements: { id: g.constants.DEFAULT_TENANT.id } },
    );
    // The schema as it was before 0078.
    await g.db.query("ALTER TABLE users DROP COLUMN temporary_password_expires_at");
    await g.db.query("DELETE FROM schema_migrations WHERE name = '0078-user-temporary-password-expiry.js'");
    expect(await column()).toBeNull();
    ids.flagged = await user("a215-flagged", true);
    ids.own = await user("a215-own", false);

    const before = Date.now();
    const ran = await g.migrator.up();

    expect(ran.map((m) => m.name)).toEqual(["0078-user-temporary-password-expiry.js"]);
    expect(await column()).toEqual({ data_type: "timestamp with time zone", is_nullable: "YES" });
    const expiry = new Date(await expiryOf(ids.flagged)).getTime();
    // now() is the database clock; allow a minute of skew against the host.
    expect(Math.abs(expiry - (before + 72 * HOUR))).toBeLessThan(60 * 1000);
    expect(await expiryOf(ids.own)).toBeNull();
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  }, 60000);

  it("RE-RUN: a second migrator.up() applies nothing; a direct up changes nothing", async () => {
    const first = await expiryOf(ids.flagged);

    expect(await g.migrator.up()).toEqual([]);
    await g.m0078.up({ context: g.db.getQueryInterface() });

    expect(await expiryOf(ids.flagged)).toEqual(first);
    expect(await expiryOf(ids.own)).toBeNull();
  });

  it("DOWN then UP: the column goes, and comes back with the backfill", async () => {
    await g.migrator.down({ to: "0078-user-temporary-password-expiry.js" });
    expect(await column()).toBeNull();
    expect(await applied()).toBe(false);
    // down is idempotent
    await g.m0078.down({ context: g.db.getQueryInterface() });

    await g.migrator.up();

    expect(await applied()).toBe(true);
    expect(await expiryOf(ids.flagged)).not.toBeNull();
    expect(await expiryOf(ids.own)).toBeNull();
    expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
  }, 60000);

  it("the model reads and writes the column (Sequelize attribute ↔ column)", async () => {
    const at = new Date(Date.now() + HOUR);
    await g.models.Users.unscoped().update(
      { temporaryPasswordExpiresAt: at },
      { where: { id: ids.own }, skipTenantScope: true },
    );
    const row = await g.models.Users.unscoped().findOne({ where: { id: ids.own }, skipTenantScope: true });

    expect(row.temporaryPasswordExpiresAt.getTime()).toBe(at.getTime());
  });

  describe("A-259", () => {
    beforeAll(async () => {
      const tenantId = g.constants.DEFAULT_TENANT.id;
      const [[device]] = await g.db.query(
        `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, iot_enabled, is_deleted,
                                          calibration_interval_days, created_at, updated_at)
         VALUES (gen_random_uuid(), :tenantId, 'Demo analyser', 'DEMO-DEV-A259', false, false, 365, now(), now())
         RETURNING id`,
        { replacements: { tenantId } },
      );
      ids.device = device.id;
      await g.db.query(
        `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, is_compliant,
                                          notes, is_deleted, created_at, updated_at)
         VALUES (gen_random_uuid(), :tenantId, :deviceId, :userId, now(), true, 'demo', false, now(), now())`,
        { replacements: { tenantId, deviceId: ids.device, userId: ids.own } },
      );
      // A demo row that the old unseed deleted FIRST, before failing on the records.
      await g.db.query(
        `INSERT INTO categories (id, name, slug, created_at, updated_at)
         VALUES (gen_random_uuid(), 'Demo category', 'demo-a259', now(), now())`,
      );
    });

    const counts = async () => {
      const [[row]] = await g.db.query(
        `SELECT (SELECT count(*)::int FROM categories WHERE slug = 'demo-a259') AS categories,
                (SELECT count(*)::int FROM calibration_devices WHERE serial_number = 'DEMO-DEV-A259') AS devices,
                (SELECT count(*)::int FROM calibration_records WHERE device_id = :d) AS records`,
        { replacements: { d: ids.device } },
      );
      return row;
    };

    it("the trigger refuses the calibration-record DELETE even for the owner", async () => {
      const err = await g.db
        .query("DELETE FROM calibration_records WHERE device_id = :d", { replacements: { d: ids.device } })
        .catch((e) => e);
      expect(String(err && err.message)).toMatch(/append-only|not allowed|refused|cannot/i);
    });

    it("unseedDemoData refuses before deleting ANYTHING, and says why", async () => {
      expect(await counts()).toEqual({ categories: 1, devices: 1, records: 1 });

      const result = await g.migrationService.unseedDemoData();

      expect(result.refused).toBe(true);
      expect(result.deleted).toEqual({});
      expect(result.errors[0]).toMatch(/1 calibration record\(s\), which are append-only/);
      // Nothing was removed — the category the old code deleted first is still there.
      expect(await counts()).toEqual({ categories: 1, devices: 1, records: 1 });
    });

    it("the application role cannot drop a table — a forced sync is an owner operation", async () => {
      const t = await g.db.transaction();
      try {
        await g.db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
        const err = await g.db.query("DROP TABLE categories", { transaction: t }).catch((e) => e);
        expect(String(err && err.message)).toMatch(/must be owner/);
      } finally {
        await t.rollback();
      }
      expect(g.migrationService.syncTables).toBeUndefined();
      expect(g.migrationService.resetAndSeed).toBeUndefined();
    });
  });
});
