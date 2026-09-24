/**
 * Phase 6 data-integrity controls against a REAL PostgreSQL — P6-03, P6-05,
 * P6-06 (and the migrations that carry them).
 *
 * The mocked suites prove which statements the services issue. They cannot
 * prove that a trigger fires, that a REVOKE bites, or that information_schema
 * says what the verifier expects. CLAUDE.md: "Test database grants as the
 * application role, not the owner. As the owner it passes whether the grant
 * exists or not." So every grant assertion here runs under
 * `SET LOCAL ROLE callibrator_app`, and the MUTATION CHECK re-grants the
 * privilege and disables the trigger to show each assertion fails when its
 * control is absent.
 *
 * OPT-IN — needs an EMPTY scratch database the connecting role owns (it is
 * rebuilt with db.sync({ force: true })), whose name contains "scratch" or
 * ends in "_p6" as a guard against pointing it at a real one:
 *
 *   DATA_PG_LIVE_TEST=1 DB_HOST=127.0.0.1 DB_PORT=54335 DB_NAME=callibrator_p6 \
 *     DB_USER=cal_owner DB_PASS=owner \
 *     npm test -- src/tests/services/dataIntegrity.p6.live --coverage=false
 *
 * The connecting role plays the compose owner (a superuser there). Run on
 * PostgreSQL 16 in development; the deployment target is 18.
 */

const live = process.env.DATA_PG_LIVE_TEST === "1" ? describe : describe.skip;

const TENANT_A = "a6a6a6a6-0000-4000-8000-00000000000a";
const TENANT_B = "b6b6b6b6-0000-4000-8000-00000000000b";
const APP_ROLE = process.env.DB_APP_ROLE || "callibrator_app"; // what migration 0057 grants

// jest.config maps `uuid` to a mock returning ONE constant (A-116) — which
// Sequelize's UUIDV4 defaults use too. Rows in a real table need real ids.
const useRealUuids = (uuid) => {
  uuid.v4.mockImplementation(() => require("crypto").randomUUID());
};

/** A separately loaded module graph: its own Sequelize instance and pool. */
const startProcess = () => {
  let graph;
  jest.isolateModules(() => {
    useRealUuids(require("uuid"));
    const { db } = require("../../config");
    db.options.logging = false;
    graph = {
      db,
      uuid: require("uuid"),
      models: require("../../models"),
      service: require("../../services/calibrationRecords.service"),
      tenantStorage: require("../../middlewares/tenantContext.middleware").tenantStorage,
      dbRole: require("../../utils/dbRole.util"),
      schemaVerify: require("../../utils/schemaVerify.util"),
      m0026: require("../../migrations/0026-calibration-device-serial-per-tenant"),
      m0057: require("../../migrations/0057-calibration-records-append-only"),
      m0059: require("../../migrations/0059-stock-adjustment-reason-and-item"),
      stockService: require("../../services/stock.service"),
    };
  });
  return graph;
};

/** Run `work` in a transaction that is ALWAYS rolled back; resolves to what work returned or threw. */
const inRolledBack = async (db, work) => {
  const t = await db.transaction();
  try {
    return await work(t);
  } finally {
    await t.rollback();
  }
};

/** The error `sql` raises inside `t` (after a savepoint, so `t` stays usable), or null. */
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

const logger = { info: () => {}, warn: () => {}, error: () => {} };

live("Phase 6 data integrity — live PostgreSQL (P6-03, P6-05, P6-06)", () => {
  let g;
  const ids = {};

  const insertRecord = async (db, tenantId, deviceId, performedBy, notes) => {
    const [[row]] = await db.query(
      `INSERT INTO calibration_records
         (id, tenant_id, device_id, performed_by, calibration_date, is_compliant, notes, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :tenantId, :deviceId, :performedBy, now(), true, :notes, false, now(), now())
       RETURNING id`,
      { replacements: { tenantId, deviceId, performedBy, notes } },
    );
    return row.id;
  };

  beforeAll(async () => {
    const name = process.env.DB_NAME || "";
    if (!/scratch|_p6$/.test(name)) {
      throw new Error(`Refusing to rebuild DB_NAME="${name}": use a scratch database (see the header)`);
    }
    g = startProcess();
    await g.db.sync({ force: true });
    const qi = g.db.getQueryInterface();
    await g.m0026.up({ context: qi });
    // As migration 0012 left five tables (A-242): RLS on and forced, no policy.
    for (const t of ["categories", "posts", "post_categories", "workflow_steps", "workflow_actions"]) {
      await g.db.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      await g.db.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
    }
    await g.m0057.up({ context: qi });
    // 0059 against a table shaped as it was BEFORE P6-09: a legacy adjustment
    // with no reason, and none of the new columns — the migration must add
    // them, backfill the reason, then constrain it.
    await g.db.query(
      "ALTER TABLE stock_adjustments DROP COLUMN stock_id, DROP COLUMN quantity_before, DROP COLUMN quantity_after, ALTER COLUMN reason DROP NOT NULL",
    );

    await g.db.query(
      `INSERT INTO tenants (id, name, subdomain, email, created_at, updated_at) VALUES
         (:a, 'P6 A', 'p6-a', 'p6a@live.test', now(), now()),
         (:b, 'P6 B', 'p6-b', 'p6b@live.test', now(), now())`,
      { replacements: { a: TENANT_A, b: TENANT_B } },
    );
    const user = async (tenantId, tag) => {
      const [[row]] = await g.db.query(
        `INSERT INTO users (id, tenant_id, username, email, password, first_name, last_name, avatar_url,
                            status, must_change_password, is_deleted, created_at, updated_at)
         VALUES (gen_random_uuid(), :tenantId, :tag, :email, 'x', 'P6', :tag, 'default.svg',
                 'ACTIVE', false, false, now(), now())
         RETURNING id`,
        { replacements: { tenantId, tag, email: `${tag}@live.test` } },
      );
      return row.id;
    };
    const device = async (tenantId, serial) => {
      const [[row]] = await g.db.query(
        `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, iot_enabled, is_deleted,
                                          calibration_interval_days, created_at, updated_at)
         VALUES (gen_random_uuid(), :tenantId, 'Analyser', :serial, false, false, 365, now(), now())
         RETURNING id`,
        { replacements: { tenantId, serial } },
      );
      return row.id;
    };
    ids.userA = await user(TENANT_A, "p6-user-a");
    ids.userB = await user(TENANT_B, "p6-user-b");
    ids.deviceA = await device(TENANT_A, "SN-SHARED-1");
    ids.deviceB = await device(TENANT_B, "SN-SHARED-1"); // P6-06: same serial, other tenant
    ids.recordA = await insertRecord(g.db, TENANT_A, ids.deviceA, ids.userA, "original");

    const [[wh]] = await g.db.query(
      `INSERT INTO warehouses (id, tenant_id, name, code, is_deleted, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, 'Main', 'P6-WH', false, now(), now()) RETURNING id`,
      { replacements: { t: TENANT_A } },
    );
    ids.warehouseA = wh.id;
    const [[legacy]] = await g.db.query(
      `INSERT INTO stock_adjustments (id, tenant_id, warehouse_id, type, quantity, reason, adjusted_by, created_at, updated_at)
       VALUES (gen_random_uuid(), :t, :w, 'addition', 3, NULL, :u, now(), now()) RETURNING id`,
      { replacements: { t: TENANT_A, w: ids.warehouseA, u: ids.userA } },
    );
    ids.legacyAdjustment = legacy.id;
    await g.m0059.up({ context: qi });
  });

  afterAll(async () => {
    if (g) {
      await g.db.close();
    }
  });

  // ------------------------------------------------------------------
  // P6-03 — the grant, as the APPLICATION ROLE
  // ------------------------------------------------------------------
  describe("P6-03 — as the application role (SET LOCAL ROLE)", () => {
    it("DELETE on calibration_records is refused by privilege: permission denied", async () => {
      await inRolledBack(g.db, async (t) => {
        await g.db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
        const err = await errorOf(g.db, t, "DELETE FROM calibration_records WHERE id = :id", { id: ids.recordA });
        expect(err).not.toBeNull();
        expect(err.original.code).toBe("42501");
        expect(err.message).toMatch(/permission denied for table calibration_records/);
      });
    });

    it("UPDATE of a content column is refused by privilege; TRUNCATE too", async () => {
      await inRolledBack(g.db, async (t) => {
        await g.db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
        const upd = await errorOf(g.db, t, "UPDATE calibration_records SET notes = 'edited' WHERE id = :id", {
          id: ids.recordA,
        });
        expect(upd.message).toMatch(/permission denied for table calibration_records/);
        const trunc = await errorOf(g.db, t, "TRUNCATE calibration_records");
        expect(trunc.message).toMatch(/permission denied for table calibration_records/);
      });
    });

    it("the role can still INSERT and SELECT, and write a lifecycle column once", async () => {
      await inRolledBack(g.db, async (t) => {
        await g.db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
        const [[row]] = await g.db.query(
          `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, is_deleted, created_at, updated_at)
           VALUES (gen_random_uuid(), :tenant, :device, :user, now(), false, now(), now()) RETURNING id`,
          { transaction: t, replacements: { tenant: TENANT_A, device: ids.deviceA, user: ids.userA } },
        );
        const voided = await errorOf(
          g.db,
          t,
          "UPDATE calibration_records SET is_deleted = true, void_reason = 'entered twice', voided_by = :u, updated_at = now() WHERE id = :id",
          { id: row.id, u: ids.userA },
        );
        expect(voided).toBeNull();
      });
    });

    it("MUTATION CHECK: with DELETE granted back, the privilege test would fail — and with the trigger off too, the row is gone", async () => {
      await inRolledBack(g.db, async (t) => {
        await g.db.query(`GRANT DELETE ON calibration_records TO ${APP_ROLE}`, { transaction: t });
        await g.db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
        const err = await errorOf(g.db, t, "DELETE FROM calibration_records WHERE id = :id", { id: ids.recordA });
        // No longer "permission denied": the privilege assertion above would FAIL.
        expect(err.message).not.toMatch(/permission denied/);
        // What still refuses it is the second, independent layer.
        expect(err.message).toMatch(/append-only/);
        await g.db.query("RESET ROLE", { transaction: t });
        await g.db.query("ALTER TABLE calibration_records DISABLE TRIGGER calibration_records_append_only", {
          transaction: t,
        });
        await g.db.query(`SET LOCAL ROLE ${APP_ROLE}`, { transaction: t });
        expect(
          await errorOf(g.db, t, "DELETE FROM calibration_records WHERE id = :id", { id: ids.recordA }),
        ).toBeNull();
        const [rows] = await g.db.query("SELECT id FROM calibration_records WHERE id = :id", {
          transaction: t,
          replacements: { id: ids.recordA },
        });
        expect(rows).toHaveLength(0); // both controls absent: the evidence is deleted
      });
      // Rolled back: the grant, the disabled trigger and the delete are undone.
      const [[back]] = await g.db.query(
        "SELECT has_table_privilege(:role, 'calibration_records', 'DELETE') AS d",
        { replacements: { role: APP_ROLE } },
      );
      expect(back.d).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // P6-03 — the trigger, as the OWNER (a superuser: privileges do not apply)
  // ------------------------------------------------------------------
  describe("P6-03 — as the owner (superuser), the trigger holds", () => {
    it("DELETE is refused: append-only", async () => {
      await inRolledBack(g.db, async (t) => {
        const err = await errorOf(g.db, t, "DELETE FROM calibration_records WHERE id = :id", { id: ids.recordA });
        expect(err.original.code).toBe("42501");
        expect(err.message).toMatch(/append-only: record .* cannot be deleted/);
      });
    });

    it("TRUNCATE is refused", async () => {
      await inRolledBack(g.db, async (t) => {
        const err = await errorOf(g.db, t, "TRUNCATE calibration_records CASCADE");
        expect(err.message).toMatch(/append-only: TRUNCATE is refused/);
      });
    });

    it("changing the content of a record is refused — every non-lifecycle column", async () => {
      await inRolledBack(g.db, async (t) => {
        for (const set of [
          "notes = 'edited'",
          "is_compliant = false",
          "results = '{\"reading\": 1}'::jsonb",
          "calibration_date = now() - interval '1 day'",
          "correction_reason = 'sneaky'",
        ]) {
          const err = await errorOf(g.db, t, `UPDATE calibration_records SET ${set} WHERE id = :id`, {
            id: ids.recordA,
          });
          expect(err && err.message).toMatch(/the content of record .* cannot be changed/);
        }
      });
    });

    it("a lifecycle column moves one way only: a void is final, a supersession is not reassigned", async () => {
      await inRolledBack(g.db, async (t) => {
        const other = await insertRecord(g.db, TENANT_A, ids.deviceA, ids.userA, "other");
        await g.db.query(
          "UPDATE calibration_records SET is_deleted = true, void_reason = 'wrong device' WHERE id = :id",
          { transaction: t, replacements: { id: other } },
        );
        const restore = await errorOf(g.db, t, "UPDATE calibration_records SET is_deleted = false WHERE id = :id", {
          id: other,
        });
        expect(restore.message).toMatch(/is final/);
        const reword = await errorOf(g.db, t, "UPDATE calibration_records SET void_reason = 'else' WHERE id = :id", {
          id: other,
        });
        expect(reword.message).toMatch(/is final/);
      });
    });

    it("the CHECKs: a void needs a reason; a correction needs a reason and cannot supersede itself", async () => {
      await inRolledBack(g.db, async (t) => {
        const noReason = await errorOf(g.db, t, "UPDATE calibration_records SET is_deleted = true WHERE id = :id", {
          id: ids.recordA,
        });
        expect(noReason.message).toMatch(/calibration_records_void_reason_check/);
        const blank = await errorOf(
          g.db,
          t,
          "UPDATE calibration_records SET is_deleted = true, void_reason = '   ' WHERE id = :id",
          { id: ids.recordA },
        );
        expect(blank.message).toMatch(/calibration_records_void_reason_check/);
        const self = await errorOf(
          g.db,
          t,
          `INSERT INTO calibration_records (id, tenant_id, device_id, performed_by, calibration_date, is_deleted,
             supersedes_id, correction_reason, created_at, updated_at)
           SELECT x, :tenant, :device, :user, now(), false, x, 'r', now(), now() FROM (SELECT gen_random_uuid() AS x) s`,
          { tenant: TENANT_A, device: ids.deviceA, user: ids.userA },
        );
        expect(self.message).toMatch(/calibration_records_correction_check|foreign key/);
      });
    });
  });

  // ------------------------------------------------------------------
  // P6-03 — the application works, as the application role
  // ------------------------------------------------------------------
  describe("P6-03 — the service, running as the application role", () => {
    let p;
    beforeAll(async () => {
      p = startProcess();
      await p.dbRole.enterApplicationRole({ sequelize: p.db, logger, env: { DB_APP_ROLE: APP_ROLE } });
    });
    beforeEach(() => useRealUuids(p.uuid));
    afterAll(async () => {
      await p.db.close();
    });

    const asTenant = (tenantId, userId, fn) =>
      p.tenantStorage.run({ tenantId, isSuperAdmin: false, isSystemTask: false }, fn);

    it("every query now runs as the application role", async () => {
      const [[row]] = await p.db.query("SELECT current_user AS u");
      expect(row.u).toBe(APP_ROLE);
    });

    it("create -> correct -> void, with the original kept and audited, and a cross-tenant correct is 404", async () => {
      const created = await asTenant(TENANT_A, ids.userA, () =>
        p.service.createCalibrationRecord(
          TENANT_A,
          ids.userA,
          { deviceId: ids.deviceA, isCompliant: true, notes: "first reading" },
          { ipAddress: "127.0.0.1" },
        ),
      );
      expect(created.status).toBe(201);
      const originalId = created.data.id;

      const crossTenant = await asTenant(TENANT_B, ids.userB, () =>
        p.service.correctCalibrationRecord(TENANT_B, ids.userB, originalId, { isCompliant: false, reason: "not yours" }),
      );
      expect(crossTenant.status).toBe(404);

      const corrected = await asTenant(TENANT_A, ids.userA, () =>
        p.service.correctCalibrationRecord(TENANT_A, ids.userA, originalId, {
          isCompliant: false,
          reason: "reference standard was out of calibration",
        }),
      );
      expect(corrected.status).toBe(201);
      const correctionId = corrected.data.id;
      expect(correctionId).not.toBe(originalId);

      const [[orig]] = await p.db.query(
        "SELECT is_compliant, notes, superseded_by_id FROM calibration_records WHERE id = :id",
        { replacements: { id: originalId } },
      );
      expect(orig).toEqual({ is_compliant: true, notes: "first reading", superseded_by_id: correctionId });
      const [[corr]] = await p.db.query(
        "SELECT is_compliant, notes, supersedes_id, correction_reason, performed_by FROM calibration_records WHERE id = :id",
        { replacements: { id: correctionId } },
      );
      expect(corr).toEqual({
        is_compliant: false,
        notes: "first reading",
        supersedes_id: originalId,
        correction_reason: "reference standard was out of calibration",
        performed_by: ids.userA,
      });

      // Correcting the SAME original again is a 409 that names the correction.
      const again = await asTenant(TENANT_A, ids.userA, () =>
        p.service.correctCalibrationRecord(TENANT_A, ids.userA, originalId, { notes: "x", reason: "again" }),
      );
      expect(again.status).toBe(409);
      expect(again.message).toContain(correctionId);

      // The list shows the record in force; the history on request.
      const list = await asTenant(TENANT_A, ids.userA, () =>
        p.service.fetchCalibrationRecords({ tenantId: TENANT_A, deviceId: ids.deviceA }),
      );
      const listed = list.data.rows.map((r) => r.id);
      expect(listed).toContain(correctionId);
      expect(listed).not.toContain(originalId);
      const history = await asTenant(TENANT_A, ids.userA, () =>
        p.service.fetchCalibrationRecords({ tenantId: TENANT_A, deviceId: ids.deviceA, includeSuperseded: true }),
      );
      expect(history.data.rows.map((r) => r.id)).toEqual(expect.arrayContaining([originalId, correctionId]));

      const voided = await asTenant(TENANT_A, ids.userA, () =>
        p.service.voidCalibrationRecord(TENANT_A, ids.userA, correctionId, { reason: "device was mislabelled" }),
      );
      expect(voided.status).toBe(200);
      const [[v]] = await p.db.query(
        "SELECT is_deleted, void_reason, voided_by FROM calibration_records WHERE id = :id",
        { replacements: { id: correctionId } },
      );
      expect(v).toEqual({ is_deleted: true, void_reason: "device was mislabelled", voided_by: ids.userA });
      const voidAgain = await asTenant(TENANT_A, ids.userA, () =>
        p.service.voidCalibrationRecord(TENANT_A, ids.userA, correctionId, { reason: "twice" }),
      );
      expect(voidAgain.status).toBe(409);

      const [audits] = await p.db.query(
        "SELECT action, resource_id FROM audit_logs WHERE resource_type = 'CalibrationRecord' AND resource_id IN (:ids) ORDER BY created_at",
        { replacements: { ids: [originalId, correctionId] } },
      );
      expect(audits.map((a) => `${a.action}:${a.resource_id === originalId ? "orig" : "corr"}`)).toEqual([
        "CREATE:orig",
        "CREATE:corr",
        "UPDATE:orig",
        "DELETE:corr",
      ]);
    });

    it("enterApplicationRole REFUSES a role that can delete calibration records", async () => {
      await g.db.query(`GRANT DELETE ON calibration_records TO ${APP_ROLE}`);
      const q = startProcess();
      try {
        await expect(
          q.dbRole.enterApplicationRole({ sequelize: q.db, logger, env: { DB_APP_ROLE: APP_ROLE } }),
        ).rejects.toThrow(/can DELETE from calibration_records/);
      } finally {
        await g.db.query(`REVOKE DELETE ON calibration_records FROM ${APP_ROLE}`);
        await q.db.close();
      }
    });
  });

  // ------------------------------------------------------------------
  // P6-09 — every stock quantity change is explained
  // ------------------------------------------------------------------
  describe("P6-09 — stock adjustments (migration 0059 + stock.service)", () => {
    it("the legacy adjustment with no reason was backfilled, and the columns exist", async () => {
      const [[row]] = await g.db.query("SELECT reason, stock_id FROM stock_adjustments WHERE id = :id", {
        replacements: { id: ids.legacyAdjustment },
      });
      expect(row).toEqual({ reason: g.m0059.LEGACY_REASON, stock_id: null });
    });

    it("the database refuses a NULL or blank reason", async () => {
      await inRolledBack(g.db, async (t) => {
        for (const reason of [null, "", "   "]) {
          const err = await errorOf(
            g.db,
            t,
            `INSERT INTO stock_adjustments (id, tenant_id, warehouse_id, type, quantity, reason, adjusted_by, created_at, updated_at)
             VALUES (gen_random_uuid(), :t, :w, 'addition', 1, :reason, :u, now(), now())`,
            { t: TENANT_A, w: ids.warehouseA, u: ids.userA, reason },
          );
          expect(err && err.message).toMatch(/null value in column "reason"|stock_adjustments_reason_not_blank/);
        }
      });
    });

    it("as the application role: create with stock on hand, adjust, refuse a direct quantity edit", async () => {
      const p = startProcess();
      try {
        await p.dbRole.enterApplicationRole({ sequelize: p.db, logger, env: { DB_APP_ROLE: APP_ROLE } });
        const actor = { userId: ids.userA, ipAddress: "127.0.0.1" };
        const run = (fn) => p.tenantStorage.run({ tenantId: TENANT_A, isSuperAdmin: false, isSystemTask: false }, fn);

        const created = await run(() =>
          p.stockService.createStock(TENANT_A, { warehouseId: ids.warehouseA, itemName: "Gloves", quantity: 40 }, actor),
        );
        const stockId = created.data.id;
        await run(() =>
          p.stockService.createAdjustment(
            TENANT_A,
            { stockId, type: "subtraction", quantity: 15, reason: "used in theatre 3" },
            ids.userA,
            actor,
          ),
        );
        const refused = await run(() =>
          p.stockService.updateStock(TENANT_A, stockId, { quantity: 999, description: "x" }, actor),
        ).catch((e) => e);
        expect(refused.status).toBe(400);

        const [adjustments] = await p.db.query(
          `SELECT type, quantity, quantity_before, quantity_after, reason FROM stock_adjustments
            WHERE stock_id = :stockId ORDER BY created_at`,
          { replacements: { stockId } },
        );
        expect(adjustments).toEqual([
          { type: "addition", quantity: 40, quantity_before: 0, quantity_after: 40, reason: expect.stringMatching(/Opening balance/) },
          { type: "subtraction", quantity: 15, quantity_before: 40, quantity_after: 25, reason: "used in theatre 3" },
        ]);
        const [[stock]] = await p.db.query("SELECT quantity, description FROM stocks WHERE id = :stockId", {
          replacements: { stockId },
        });
        expect(stock).toEqual({ quantity: 25, description: null }); // the refused edit changed nothing
        const [audits] = await p.db.query(
          "SELECT resource_type, action FROM audit_logs WHERE tenant_id = :t AND resource_type LIKE 'Stock%' ORDER BY created_at",
          { replacements: { t: TENANT_A } },
        );
        expect(audits.map((a) => `${a.action}:${a.resource_type}`)).toEqual([
          "CREATE:Stock",
          "CREATE:StockAdjustment",
          "CREATE:StockAdjustment",
        ]);
      } finally {
        await p.db.close();
      }
    });
  });

  // ------------------------------------------------------------------
  // P6-06 — serial numbers per tenant
  // ------------------------------------------------------------------
  describe("P6-06 — UNIQUE (tenant_id, serial_number)", () => {
    it("two tenants hold the same serial (seeded above); one tenant cannot hold it twice", async () => {
      const [rows] = await g.db.query(
        "SELECT tenant_id FROM calibration_devices WHERE serial_number = 'SN-SHARED-1' ORDER BY tenant_id",
      );
      expect(rows.map((r) => r.tenant_id)).toEqual([TENANT_A, TENANT_B]);
      await inRolledBack(g.db, async (t) => {
        const err = await errorOf(
          g.db,
          t,
          `INSERT INTO calibration_devices (id, tenant_id, name, serial_number, iot_enabled, is_deleted, created_at, updated_at)
           VALUES (gen_random_uuid(), :t, 'Dup', 'SN-SHARED-1', false, false, now(), now())`,
          { t: TENANT_A },
        );
        expect(err.original.code).toBe("23505"); // unique_violation
        expect(err.original.constraint).toBe("calibration_devices_tenant_id_serial_number_unique");
      });
    });
  });

  // ------------------------------------------------------------------
  // P6-05 — the schema verifier
  // ------------------------------------------------------------------
  describe("P6-05 — verifySchema against information_schema", () => {
    it("A-242: 0057 switched off the policy-less RLS 0012 left behind; the verifier would name it", async () => {
      const [[{ n }]] = await g.db.query(
        "SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = current_schema() AND c.relrowsecurity",
      );
      expect(n).toBe(0);
      await g.db
        .transaction(async () => {
          await g.db.query("ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY");
          await g.db.query("ALTER TABLE workflow_steps FORCE ROW LEVEL SECURITY");
          expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([
            expect.stringMatching(/^row level security is enabled on workflow_steps/),
          ]);
          // And why it matters: as the application role, the table is empty and unwritable.
          await g.db.query(`SET LOCAL ROLE ${APP_ROLE}`);
          await expect(
            g.db.query(
              "INSERT INTO workflow_steps (id, workflow_id, step_order, role_id, required_approvals, created_at, updated_at) VALUES (gen_random_uuid(), gen_random_uuid(), 1, gen_random_uuid(), 1, now(), now())",
            ),
          ).rejects.toThrow(/row-level security/);
          throw new Error("rollback");
        })
        .catch((err) => {
          if (err.message !== "rollback") {
            throw err;
          }
        });
    });

    it("a synced and migrated database matches the models", async () => {
      const result = await g.schemaVerify.verifySchema(g.db);
      expect(result.problems).toEqual([]);
      expect(result.tables).toBeGreaterThan(60);
    });

    it("FAILS on a missing column, a missing trigger and an undeclared NOT NULL column", async () => {
      // CLS: every query inside the callback joins the transaction, so the
      // verifier sees the damaged schema and the rollback repairs it.
      await g.db
        .transaction(async () => {
          await g.db.query("ALTER TABLE stocks DROP COLUMN min_quantity");
          await g.db.query("DROP TRIGGER calibration_records_append_only ON calibration_records");
          await g.db.query("ALTER TABLE warehouses ADD COLUMN legacy_code TEXT NOT NULL DEFAULT 'x'");
          await g.db.query("ALTER TABLE warehouses ALTER COLUMN legacy_code DROP DEFAULT");
          const result = await g.schemaVerify.verifySchema(g.db);
          expect(result.problems).toEqual(
            expect.arrayContaining([
              expect.stringMatching(/^column stocks\.min_quantity .* does not exist/),
              expect.stringMatching(/^trigger calibration_records_append_only on calibration_records does not exist/),
              expect.stringMatching(/^column warehouses\.legacy_code is NOT NULL with no default/),
            ]),
          );
          await expect(
            g.schemaVerify.assertSchemaMatchesModels({ sequelize: g.db, logger, mode: undefined }),
          ).rejects.toThrow(/FAILED: 3 mismatch/);
          throw new Error("rollback");
        })
        .catch((err) => {
          if (err.message !== "rollback") {
            throw err;
          }
        });
      expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // Migration 0057 — idempotent, and down keeps the record trail
  // ------------------------------------------------------------------
  describe("migration 0057", () => {
    it("a second run changes nothing and succeeds", async () => {
      await g.m0057.up({ context: g.db.getQueryInterface() });
      const [triggers] = await g.db.query(
        "SELECT tgname FROM pg_trigger WHERE tgrelid = 'calibration_records'::regclass AND NOT tgisinternal ORDER BY tgname",
      );
      expect(triggers.map((r) => r.tgname)).toEqual([
        "calibration_records_append_only",
        "calibration_records_no_truncate",
      ]);
    });

    it("down removes the trigger but keeps the lifecycle columns; up restores it", async () => {
      const qi = g.db.getQueryInterface();
      await g.m0057.down({ context: qi });
      const [none] = await g.db.query(
        "SELECT tgname FROM pg_trigger WHERE tgrelid = 'calibration_records'::regclass AND NOT tgisinternal",
      );
      expect(none).toEqual([]);
      const [cols] = await g.db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'calibration_records' AND column_name = 'supersedes_id'",
      );
      expect(cols).toHaveLength(1);
      await g.m0057.up({ context: qi });
      expect((await g.schemaVerify.verifySchema(g.db)).problems).toEqual([]);
    });
  });
});
